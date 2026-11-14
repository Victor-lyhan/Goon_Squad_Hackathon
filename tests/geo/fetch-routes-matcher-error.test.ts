// runFetchRoutes when the matcher itself hits a missing pair. The completeness check before the matcher makes
// this unreachable with the real matcher, so the matcher is replaced here by one that throws.
import { describe, expect, it, vi } from 'vitest';
import { TravelDataMissingError } from '../../shared/v2/types';
import { estimateFetch } from '../../server/geo/fetchRoutes';
import { firstRun, input, leakedLines, loggedLineCount, run, totalCalls } from './fetch-routes-helpers';

const matcher = vi.hoisted(() => ({ fail: null as null | (() => never) }));

vi.mock('../../server/domain/v2/matching', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/domain/v2/matching')>();
  return {
    ...original,
    assignShipments: (...args: Parameters<typeof original.assignShipments>) => {
      if (matcher.fail) matcher.fail();
      return original.assignShipments(...args);
    },
  };
});

describe('runFetchRoutes: the matcher lacks a travel time', () => {
  it('catches TravelDataMissingError and reports steps 3 and 4 as skipped', async () => {
    const { result: complete } = await firstRun();
    matcher.fail = () => {
      throw new TravelDataMissingError('biz-etsy', 'home-001');
    };
    try {
      const { result, calls, saves } = await run(complete.files);

      expect(result.scenario).toBeNull();
      expect(result.assignments).toBeNull();
      expect(result.trips).toEqual([]);
      expect(result.skipped.map((entry) => entry.step)).toEqual(['match', 'polylines']);
      expect(result.skipped[0].reason).toContain('biz-etsy -> home-001');
      for (const { reason } of result.skipped) expect(reason.endsWith('Run again to resume.')).toBe(true);
      expect(totalCalls(calls)).toBe(0);
      expect(saves).toEqual([]);
      expect(result.files).toEqual(complete.files);

      // The estimate does not throw either; it just cannot know the plans' lines.
      expect(estimateFetch(input(complete.files)).planPolylines).toBeNull();
    } finally {
      matcher.fail = null;
    }
  });

  it('does not hide any other error from the matcher', async () => {
    const { result: complete } = await firstRun();
    matcher.fail = () => {
      throw new TypeError('a bug, not missing data');
    };
    try {
      await expect(run(complete.files)).rejects.toThrow('a bug, not missing data');
    } finally {
      matcher.fail = null;
    }
  });
});

describe('the log of every run in this file', () => {
  it('never holds the fake key, raw or URL-encoded', () => {
    expect(loggedLineCount()).toBeGreaterThan(0);
    expect(leakedLines()).toEqual([]);
  });
});
