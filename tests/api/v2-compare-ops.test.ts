// compareRun (server/api/v2/compareOps.ts): the pure step behind POST /api/v2/matches/compare.
// City and travel table: tests/api/v2-sample.ts + tests/api/v2-compare-helper.ts (only a relay can carry shp-1).
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../shared/v2/schemas';
import { TravelDataMissingError, type Run } from '../../shared/v2/types';
import { compareRun, INVALID_COMPARE } from '../../server/api/v2/compareOps';
import { directPlan, relayPlan, sampleRun, snapshotStart } from './v2-sample';
import { MISSING_PAIR, sampleCityTravel, sampleCityTravelMissingPair, withoutComputeMs } from './v2-compare-helper';

const travel = sampleCityTravel();

function okResponse(run: Run = sampleRun, body: unknown = {}) {
  const result = compareRun(run, travel, body);
  if (result.kind !== 'ok') throw new Error(`expected kind ok, got ${result.kind}`);
  return result.response;
}

describe('compareRun on a city where only a relay can carry one package', () => {
  const { directOnly, withRelay } = okResponse();

  it('direct only: shp-2 is matched; shp-1 and shp-3 are not', () => {
    expect(directOnly.result.plans).toEqual([directPlan]);
    expect(directOnly.result.plans.every((p) => p.kind === 'direct')).toBe(true);
    expect(directOnly.result.unmatched.map((u) => u.shipmentId).sort()).toEqual(['shp-1', 'shp-3']);
    for (const u of directOnly.result.unmatched) expect(u.reason).toMatch(/\S/);
  });

  it('with relay: shp-1 travels through the Cafe, exactly as in the hand-built sample plans', () => {
    expect(withRelay.result.plans).toEqual([relayPlan, directPlan]);
    expect(withRelay.result.plans[0]).toMatchObject({ kind: 'relay', relayBusinessId: 'biz-cafe', deliveryMin: 1952 });
    expect(withRelay.result.unmatched.map((u) => u.shipmentId)).toEqual(['shp-3']);
  });

  it('with relay matches at least as many packages as direct only (here 2 against 1)', () => {
    expect(withRelay.metrics.matched).toBeGreaterThanOrEqual(directOnly.metrics.matched);
    expect([directOnly.metrics.matched, withRelay.metrics.matched]).toEqual([1, 2]);
    expect([directOnly.metrics.unmatched, withRelay.metrics.unmatched]).toEqual([2, 1]);
  });

  it('metrics are projections from computeMetrics with no occurred events', () => {
    // The sample's start snapshot (nothing has happened yet) holds the same hand-computed numbers.
    expect(withRelay.metrics).toEqual(snapshotStart.metrics);
    expect(directOnly.metrics).toEqual({
      requested: 3, matched: 1, delivered: 0, direct: 1, relay: 0, unmatched: 2,
      avgExtraMinPerTrip: 8, maxExtraMin: 8,
      earnedRewardsCents: 0,
      projectedCustomerSavingsCents: 400,          // 1 matched x (1400 - 1000)
      projectedCustomerSpendCents: 3800,           // 1 x 1000 + 2 unmatched x 1400
      projectedPlatformContributionCents: 650,
      earnedPlatformContributionCents: 0,
      extraDistanceM: 2100,
    });
  });

  it('is deterministic apart from the measured computeMs', () => {
    expect(withoutComputeMs(okResponse())).toEqual(withoutComputeMs({ directOnly, withRelay }));
  });
});

describe('compareRun never changes the run', () => {
  it('works on a deep-frozen run (a write would throw) and leaves a plain copy byte-identical', () => {
    expect(Object.isFrozen(sampleRun)).toBe(true);
    const copy = structuredClone(sampleRun) as Run;
    const before = JSON.stringify(copy);
    const response = okResponse(copy);
    expect(JSON.stringify(copy)).toBe(before);
    expect(copy.version).toBe(12);
    // The live plans are not handed out either: changing the answer cannot reach the run.
    expect(response.withRelay.result.plans).not.toBe(copy.assignments.plans);
    expect(response.withRelay.result.unmatched).not.toBe(copy.assignments.unmatched);
  });

  it('ignores the live assignments: a run with no plans yet compares the same', () => {
    const fresh: Run = { ...sampleRun, assignments: { plans: [], unmatched: [], computeMs: 0 }, jobs: [], events: [], notifications: [] };
    expect(withoutComputeMs(okResponse(fresh))).toEqual(withoutComputeMs(okResponse()));
  });

  it('uses the run settings: with allowRelay off, both sides are direct only', () => {
    const noRelay: Run = { ...sampleRun, scenario: { ...sampleRun.scenario, settings: { ...sampleRun.scenario.settings, allowRelay: false } } };
    const response = okResponse(noRelay);
    expect(response.withRelay.result.plans).toEqual([directPlan]);
    expect(response.withRelay.metrics).toEqual(response.directOnly.metrics);
  });
});

describe('computeMs is measured, per side', () => {
  it('comes from the stopwatch passed in', () => {
    const ticks = [100, 105, 200, 212]; // direct only: start, end; with relay: start, end
    const result = compareRun(sampleRun, travel, {}, () => ticks.shift()!);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.response.directOnly.result.computeMs).toBe(5);
    expect(result.response.withRelay.result.computeMs).toBe(12);
    expect(ticks).toEqual([]);
  });

  it('defaults to a real clock: a finite number that is not negative', () => {
    const { directOnly, withRelay } = okResponse();
    for (const ms of [directOnly.result.computeMs, withRelay.result.computeMs]) {
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('request validation (CompareRequest)', () => {
  it.each([
    ['no body', undefined],
    ['an empty object', {}],
    ['an object with keys the schema does not know', { mode: 'anything' }],
  ])('%s is accepted', (_name, body) => {
    expect(compareRun(sampleRun, travel, body).kind).toBe('ok');
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'relay'],
    ['a number', 42],
    ['a boolean', true],
  ])('%s is a 400 with an ApiError, and the matcher is not run', (_name, body) => {
    // With this provider a valid body throws (a pair is missing): an invalid body must be refused before matching.
    const result = compareRun(sampleRun, sampleCityTravelMissingPair(), body);
    expect(result).toEqual({ kind: 'invalid', status: 400, error: { error: INVALID_COMPARE } });
    if (result.kind === 'invalid') expect(ApiError.safeParse(result.error).success).toBe(true);
  });
});

describe('a pair missing from the travel provider', () => {
  it('throws TravelDataMissingError naming the pair; no result is returned', () => {
    let thrown: unknown;
    let returned: unknown;
    try {
      returned = compareRun(sampleRun, sampleCityTravelMissingPair(), {});
    } catch (err) {
      thrown = err;
    }
    expect(returned).toBeUndefined();
    expect(thrown).toBeInstanceOf(TravelDataMissingError);
    expect(thrown).toMatchObject({ from: MISSING_PAIR.from, to: MISSING_PAIR.to, what: 'matrix' });
  });
});
