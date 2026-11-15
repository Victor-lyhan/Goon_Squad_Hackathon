// The study on worker threads (scripts/study/parallel.ts) against the same study on one thread
// (`runStudy`): any number of workers gives the same results, byte for byte, because every outcome is filed
// under its place in the grid. Small grids on the REAL committed NYC cache; no key, no network, nothing written.
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { GenerateScenarioRequest } from '../../shared/v2/schemas';
import { buildNycScenario } from '../../server/domain/v2/generator';
import { serializeStudy } from '../../scripts/study/cli';
import { runsCsv } from '../../scripts/study/csv';
import { gridRuns, runIdOf, type GridSpec } from '../../scripts/study/grid';
import { renderStudyPage } from '../../scripts/study/page';
import { defaultWorkerCount, runStudyParallel } from '../../scripts/study/parallel';
import { runStudy, studyInputOf } from '../../scripts/study/runner';
import { ASSUMPTIONS } from '../../scripts/study/assumptions';
import { STUDY_TIMEOUT_MS, nycTravelFiles, studyData, studyInput } from './study-helper';

/** 24 runs: two values of every setting and three seeds, so runs differ in length and finish out of order. */
const SMALL_GRID: GridSpec = { seeds: [1, 2, 3], employeeCounts: [30, 120], packageCounts: [12, 48], detourLimitsMin: [8, 16] };

describe('a 2-worker run', () => {
  it('gives the 1-worker result: the same results file, page and CSV, byte for byte', async () => {
    const data = studyData({ grid: SMALL_GRID });
    const one = await runStudyParallel(data, { workers: 1 });
    const two = await runStudyParallel(data, { workers: 2 });
    expect(one.workers).toBe(1);
    expect(two.workers).toBe(2);
    expect(two.results.runs).toHaveLength(24);
    expect(two.results.totals.matched).toBeGreaterThan(0);
    expect(serializeStudy(two.results)).toBe(serializeStudy(one.results));
    expect(renderStudyPage(two.results)).toBe(renderStudyPage(one.results));
    expect(runsCsv(two.results)).toBe(runsCsv(one.results));
    // And both are the plain single-threaded study.
    expect(serializeStudy(one.results)).toBe(serializeStudy(runStudy(studyInput({ grid: SMALL_GRID }))));
  }, STUDY_TIMEOUT_MS);

  it('keeps the runs in grid order, whichever worker finished first', async () => {
    const { results } = await runStudyParallel(studyData({ grid: SMALL_GRID }), { workers: 2 });
    expect(results.runs.map(run => run.id)).toEqual(gridRuns(SMALL_GRID).map(runIdOf));
    expect(results.grid).toMatchObject({ plannedRuns: 24, completedRuns: 24, skippedRuns: [] });
  }, STUDY_TIMEOUT_MS);

  it('gives the same result again, and with 3 workers and with more workers than runs', async () => {
    const data = studyData({ grid: SMALL_GRID });
    const first = serializeStudy((await runStudyParallel(data, { workers: 2 })).results);
    expect(serializeStudy((await runStudyParallel(data, { workers: 2 })).results)).toBe(first);
    expect(serializeStudy((await runStudyParallel(data, { workers: 3 })).results)).toBe(first);

    const tiny = studyData({ grid: { seeds: [1, 2], employeeCounts: [60], packageCounts: [24], detourLimitsMin: [12] } });
    const many = await runStudyParallel(tiny, { workers: 8 });
    expect(many.workers).toBe(2); // never more workers than runs
    expect(serializeStudy(many.results)).toBe(serializeStudy(runStudy(studyInputOf(tiny))));
  }, STUDY_TIMEOUT_MS);

  it('tells the caller after every run how many are done: 1, 2, ... to the number planned', async () => {
    for (const workers of [1, 2]) {
      const seen: Array<[number, number]> = [];
      await runStudyParallel(studyData({ grid: SMALL_GRID }), { workers, onRun: (done, planned) => seen.push([done, planned]) });
      expect(seen, `${workers} workers`).toEqual(Array.from({ length: 24 }, (_, index) => [index + 1, 24]));
    }
  }, STUDY_TIMEOUT_MS);

  it('uses the assumptions it was given, like the single-threaded study', async () => {
    const assumptions = ASSUMPTIONS.map(assumption => (assumption.key === 'courierEnvelopeCents' ? { ...assumption, value: assumption.value + 100 } : assumption));
    const grid: GridSpec = { seeds: [1, 2], employeeCounts: [60], packageCounts: [24], detourLimitsMin: [12] };
    const changed = await runStudyParallel(studyData({ grid, assumptions }), { workers: 2 });
    expect(serializeStudy(changed.results)).toBe(serializeStudy(runStudy(studyInput({ grid, assumptions }))));
    expect(serializeStudy(changed.results)).not.toBe(serializeStudy(runStudy(studyInput({ grid }))));
  }, STUDY_TIMEOUT_MS);
});

describe('a run that needs an uncached pair, on worker threads', () => {
  // The same hole as tests/study/study-run.test.ts: one home the 10-employee runs do not use loses its pairs.
  const grid: GridSpec = { seeds: [1], employeeCounts: [10, 120], packageCounts: [12, 24], detourLimitsMin: [12] };
  const files = nycTravelFiles();
  const used = new Set<string>();
  for (const packages of grid.packageCounts) {
    const small = buildNycScenario({
      ...studyInput({ files }).fixtures, places: files.matrix.places,
      request: GenerateScenarioRequest.parse({ preset: 'random', seed: 1, employees: 10, packages, maxExtraMin: 12 }),
    });
    for (const employee of small.employees) used.add(employee.homeId);
  }
  const droppedHome = Object.keys(files.matrix.places).filter(id => /^home-\d{3}$/.test(id) && !used.has(id)).sort()[0]!;
  const pairs = Object.fromEntries(Object.entries(files.matrix.pairs).filter(([key]) => !key.split('|').includes(droppedHome)));
  const holed = { ...files, matrix: { ...files.matrix, pairs } };

  it('is skipped and counted exactly as on one thread', async () => {
    const two = await runStudyParallel(studyData({ files: holed, grid }), { workers: 2 });
    expect(two.results.grid.skippedRuns.map(run => run.id)).toEqual(['s1-e120-p12-d12', 's1-e120-p24-d12']);
    expect(two.results.grid.skippedRuns[0]!.reason).toContain(droppedHome);
    expect(two.results.runs.map(run => run.id)).toEqual(['s1-e10-p12-d12', 's1-e10-p24-d12']);
    expect(two.results.totals).toMatchObject({ runs: 2, skippedRuns: 2 });
    expect(serializeStudy(two.results)).toBe(serializeStudy(runStudy(studyInput({ files: holed, grid }))));
    // The CSV has the skipped runs in their place in the grid.
    expect(runsCsv(two.results).split('\n').slice(1, 5).map(line => line.split(',').slice(0, 6).join(','))).toEqual([
      's1-e10-p12-d12,1,10,12,12,simulated', 's1-e10-p24-d12,1,10,24,12,simulated',
      's1-e120-p12-d12,1,120,12,12,skipped', 's1-e120-p24-d12,1,120,24,12,skipped',
    ]);
  }, STUDY_TIMEOUT_MS);
});

describe('errors', () => {
  it('any other error in a worker fails the study, as it does on one thread, and no worker is left running', async () => {
    // 121 employees is outside what the generator accepts: not a missing pair, so not a skip.
    const grid: GridSpec = { seeds: [1, 2], employeeCounts: [60, 121], packageCounts: [12], detourLimitsMin: [12] };
    expect(() => runStudy(studyInput({ grid }))).toThrow();
    await expect(runStudyParallel(studyData({ grid }), { workers: 2 })).rejects.toThrow();
    await expect(runStudyParallel(studyData({ grid }), { workers: 1 })).rejects.toThrow();
  }, STUDY_TIMEOUT_MS);

  it('an error thrown by the progress callback fails the study too', async () => {
    const onRun = (done: number): void => {
      if (done === 3) throw new Error('the terminal is gone');
    };
    await expect(runStudyParallel(studyData({ grid: SMALL_GRID }), { workers: 2, onRun })).rejects.toThrow('the terminal is gone');
  }, STUDY_TIMEOUT_MS);

  it('refuses a worker count that is not a whole number of 1 or more', async () => {
    for (const workers of [0, -1, 1.5, Number.NaN]) {
      await expect(runStudyParallel(studyData({ grid: SMALL_GRID }), { workers })).rejects.toThrow(/whole number of 1 or more/);
    }
  });
});

describe('the default number of workers', () => {
  it('is one per CPU core less one, and at least 1', () => {
    expect(defaultWorkerCount()).toBe(Math.max(1, os.availableParallelism() - 1));
    expect(defaultWorkerCount()).toBeGreaterThanOrEqual(1);
  });

  it('runs a study with nothing planned on this thread', async () => {
    const none = await runStudyParallel(studyData({ grid: { seeds: [], employeeCounts: [30], packageCounts: [12], detourLimitsMin: [8] } }));
    expect(none.workers).toBe(1);
    expect(none.results.grid).toMatchObject({ plannedRuns: 0, completedRuns: 0, requestWindow: null });
    expect(none.results.totals).toMatchObject({ runs: 0, packages: 0, matchRate: null });
  });
});
