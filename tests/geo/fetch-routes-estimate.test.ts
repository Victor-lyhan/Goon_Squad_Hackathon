// estimateFetch and formatEstimate (server/geo/fetchRoutes.ts): what a run would fetch, without a client.
// Also the source rules of the file: no disk, no environment, no terminal, nothing that is not on main.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pairKey } from '../../shared/v2/types';
import { emptyTravelFiles } from '../../server/geo/cache';
import { commutePairs } from '../../server/geo/fetchPlan';
import { DEFAULT_SCENARIO_REQUEST, PLAN_POLYLINES_NOTE, estimateFetch, formatEstimate, nothingToFetch } from '../../server/geo/fetchRoutes';
import { deepFreeze, firstRun, input, leakedLines, loggedLineCount, matrixPairsRequested, repoRoot, storyFile } from './fetch-routes-helpers';

describe('estimateFetch', () => {
  it('on empty files agrees with the calls the first run made for geocodes, matrix pairs and commute lines', async () => {
    const { result, calls } = await firstRun();
    const estimate = estimateFetch(input(deepFreeze(emptyTravelFiles())));
    const commuteKeys = new Set(commutePairs(result.scenario!.employees).map(({ from, to }) => pairKey(from, to)));

    expect(estimate.geocodes).toBe(calls.geocode.length);
    expect(estimate.matrixPairsMissing).toBe(matrixPairsRequested(calls).length);
    expect(estimate.matrixPairsCached).toBe(0);
    expect(estimate.matrixRequests).toBe(calls.matrix.length);
    expect(estimate.commutePolylines).toBe(calls.polyline.filter((key) => commuteKeys.has(key)).length);

    expect(estimate).toEqual({
      businesses: 18,
      geocodes: 18,
      homes: 130,
      matrixPairsCached: 0,
      matrixPairsMissing: 18 * 17 + 2 * 130 * 18,
      matrixRequests: calls.matrix.length,
      commutePolylines: 120,
      planPolylines: null, // not knowable without the matrix, so not guessed
      planPolylinesAtMost: 4 * storyFile.shipments.length,
      note: PLAN_POLYLINES_NOTE,
    });
    expect(nothingToFetch(estimate)).toBe(false);
    // The lines of the matched plans stayed inside the stated upper bound.
    expect(calls.polyline.length - estimate.commutePolylines).toBeLessThanOrEqual(estimate.planPolylinesAtMost);
  });

  it('knows the route lines of the matched plans once the matrix is cached', async () => {
    const { calls, saves } = await firstRun();
    const estimate = estimateFetch(input(deepFreeze(structuredClone(saves[1])))); // saved after the matrix step

    expect(estimate.geocodes).toBe(0);
    expect(estimate.matrixPairsMissing).toBe(0);
    expect(estimate.matrixRequests).toBe(0);
    expect(estimate.matrixPairsCached).toBe(matrixPairsRequested(calls).length);
    expect(estimate.commutePolylines).toBe(120);
    expect(estimate.planPolylines).toBe(calls.polyline.length - 120);
    expect(estimate.planPolylines).toBeGreaterThan(0);
  });

  it('reports nothing to fetch on the finished files', async () => {
    const { result } = await firstRun();
    const estimate = estimateFetch(input(deepFreeze(structuredClone(result.files))));

    expect(estimate).toMatchObject({ geocodes: 0, matrixPairsMissing: 0, matrixRequests: 0, commutePolylines: 0, planPolylines: 0 });
    expect(estimate.matrixPairsCached).toBe(18 * 17 + 2 * 130 * 18);
    expect(nothingToFetch(estimate)).toBe(true);
    expect(formatEstimate(estimate).join('\n')).toContain('Nothing to fetch');
  });

  it('counts only what is missing on half-filled files', async () => {
    const { result } = await firstRun();
    const files = structuredClone(result.files);
    delete files.matrix.places['biz-etsy'];
    delete files.matrix.pairs['biz-etsy|biz-sweetleaf'];
    const estimate = estimateFetch(input(deepFreeze(files)));

    expect(estimate.geocodes).toBe(1);
    expect(estimate.matrixPairsMissing).toBe(1);
    expect(estimate.matrixRequests).toBe(1);
    expect(estimate.commutePolylines).toBe(0);
    expect(estimate.planPolylines).toBeNull();
  });

  it('uses the default demo scenario: 60 employees, 24 packages', () => {
    expect(DEFAULT_SCENARIO_REQUEST).toMatchObject({ preset: 'demo', employees: 60, packages: 24 });
    expect(storyFile.shipments).toHaveLength(24);
  });
});

describe('formatEstimate', () => {
  it('gives the terminal lines for a first run, with the fixed note about the matched plans', () => {
    const lines = formatEstimate(estimateFetch(input()));
    const text = lines.join('\n');
    expect(lines[0]).toContain('no Google call');
    expect(text).toContain('businesses to geocode: 18 of 18');
    expect(text).toContain('matrix pairs to fetch: 4986');
    expect(text).toContain('baseline commutes: 120');
    expect(text).toContain('at most 96');
    expect(lines).toContain(`  ${PLAN_POLYLINES_NOTE}`);
    for (const line of lines) expect(line).not.toContain('\n');
  });

  it('leaves the note out once the number is known', async () => {
    const { saves } = await firstRun();
    const lines = formatEstimate(estimateFetch(input(saves[1])));
    expect(lines.join('\n')).not.toContain(PLAN_POLYLINES_NOTE);
    expect(lines.some((line) => /matched plans: \d+$/.test(line))).toBe(true);
  });
});

describe('server/geo/fetchRoutes.ts source', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'server/geo/fetchRoutes.ts'), 'utf8');

  it('has no fs, no process.env and no console', () => {
    expect(source).not.toMatch(/\bfs\b/);
    expect(source).not.toMatch(/process\s*\.\s*env|\bprocess\b/);
    expect(source).not.toMatch(/\bconsole\b/);
  });

  it('imports nothing that is not on main yet, and no key loader', () => {
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    expect(imports.length).toBeGreaterThan(5);
    for (const name of ['env', 'api/geo', 'cacheReport', 'travelService', 'planCheck', 'googleClient', 'fakeProvider']) {
      expect(imports.filter((specifier) => specifier.endsWith(name))).toEqual([]);
    }
  });
});

describe('the log of every run in this file', () => {
  it('never holds the fake key, raw or URL-encoded', () => {
    expect(loggedLineCount()).toBeGreaterThan(0);
    expect(leakedLines()).toEqual([]);
  });
});
