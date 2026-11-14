// nextRunId, beginNewCycle, clearForRecompute and exportRun (DECISIONS pass 6), plus the module's purity.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RECOMPUTE_LOCKED, beginNewCycle, clearForRecompute, exportRun, nextRunId,
} from '../../server/api/v2/planningOps';
import type { Run } from '../../shared/v2/types';
import { expectDeterministic, lockedRun, planningRun, runWith, sharesObjects } from './v2-planning-ops-sample';

const EMPTY_ASSIGNMENTS = { plans: [], unmatched: [], computeMs: 0 };

/** What a cycle or a recompute must keep, and what it must drop. */
function expectEmptied(next: Run, from: Run) {
  expect(next.scenario).toStrictEqual(from.scenario);
  expect(next.trips).toStrictEqual(from.trips);
  expect(next.assignments).toStrictEqual(EMPTY_ASSIGNMENTS);
  expect(next.jobs).toStrictEqual([]);
  expect(next.notifications).toStrictEqual([]);
  expect(next.events).toStrictEqual([]);
  expect(next.version).toBe(from.version + 1);
  expect(Object.keys(next).sort()).toStrictEqual(Object.keys(from).sort());
  // No ID of the old cycle's matching is left anywhere in the run.
  const text = JSON.stringify(next);
  for (const old of [...from.assignments.plans, ...from.jobs, ...from.notifications, ...from.events]) {
    expect(text).not.toContain(`"${old.id}"`);
  }
  expect(sharesObjects(next, from)).toBe(false);
}

describe('nextRunId', () => {
  it('counts up from the current run', () => {
    expect(nextRunId('run-1')).toBe('run-2');
    expect(nextRunId('run-9')).toBe('run-10');
    expect(nextRunId('run-41')).toBe('run-42');
  });

  it('starts at run-1 when the current ID is not run-<n>', () => {
    for (const odd of ['', 'run-', 'run-x', 'cycle-4', 'run-2-b', ' run-2']) expect(nextRunId(odd)).toBe('run-1');
  });
});

describe('beginNewCycle', () => {
  const first = runWith((run) => { run.runId = 'run-1'; });

  it('gives run-2, then run-3, and keeps every shipment and trip', () => {
    const second = beginNewCycle(first);
    const third = beginNewCycle(second);
    expect(second.runId).toBe('run-2');
    expect(third.runId).toBe('run-3');
    for (const next of [second, third]) {
      expect(next.scenario.shipments).toStrictEqual(first.scenario.shipments);
      expect(next.scenario.shipments).toHaveLength(3);
      expect(next.trips).toStrictEqual(first.trips);
      expect(next.trips).toHaveLength(6);
      expect(next.scenario.businesses).toStrictEqual(first.scenario.businesses);
      expect(next.scenario.homes).toStrictEqual(first.scenario.homes);
      expect(next.scenario.employees).toStrictEqual(first.scenario.employees);
    }
    expect(second.version).toBe(first.version + 1);
    expect(third.version).toBe(first.version + 2);
  });

  it('drops the old cycle: no plan, unmatched reason, job, notification or event survives', () => {
    expect(first.assignments.plans).toHaveLength(2);
    expect(first.assignments.unmatched).toHaveLength(1);
    expect(first.jobs).toHaveLength(3);
    expect(first.notifications).toHaveLength(7);
    expect(first.events).toHaveLength(6);
    expectEmptied(beginNewCycle(first), first);
  });

  it('rewinds the clock to simStartMin, paused, in planning, at the speed it had', () => {
    const playing = runWith((run) => { run.clock = { phase: 'locked', playing: true, timeMin: 1500, speed: 600 }; });
    expect(beginNewCycle(playing).clock).toStrictEqual({ phase: 'planning', playing: false, timeMin: 930, speed: 600 });
    expect(beginNewCycle(lockedRun).clock).toStrictEqual({ phase: 'planning', playing: false, timeMin: 930, speed: 120 });

    const lateStart = runWith((run) => { run.scenario.settings.simStartMin = 990; });
    expect(beginNewCycle(lateStart).clock.timeMin).toBe(990);
  });

  it('works on a run that is still in planning and on one with nothing matched', () => {
    expect(beginNewCycle(planningRun).runId).toBe('run-4');
    const emptied = beginNewCycle(planningRun);
    const again = beginNewCycle(emptied);
    expect(again.runId).toBe('run-5');
    expectEmptied(again, emptied);
  });

  it('leaves its input as it was and uses no clock or randomness', () => {
    const before = structuredClone(lockedRun);
    const next = expectDeterministic(() => beginNewCycle(lockedRun)); // lockedRun is frozen: a write would throw
    expect(lockedRun).toStrictEqual(before);
    expect(next.runId).toBe('run-4');
  });
});

describe('clearForRecompute', () => {
  it('is refused with 409 while the run is locked', () => {
    expect(clearForRecompute(lockedRun)).toStrictEqual({
      kind: 'locked', status: 409, error: { error: RECOMPUTE_LOCKED },
    });
    const playing = runWith((run) => { run.clock.playing = true; });
    expect(clearForRecompute(playing).kind).toBe('locked');
  });

  it('empties the matching and keeps the runId and the clock while planning', () => {
    const paused = runWith((run) => { run.clock = { phase: 'planning', playing: false, timeMin: 945, speed: 30 }; });
    const plan = clearForRecompute(paused);
    if (plan.kind !== 'recompute') throw new Error(`expected a recompute, got ${plan.kind}`);
    expect(plan.run.runId).toBe('run-3');
    expect(plan.run.clock).toStrictEqual({ phase: 'planning', playing: false, timeMin: 945, speed: 30 });
    expectEmptied(plan.run, paused);
  });

  it('leaves its input as it was and uses no clock or randomness', () => {
    const before = structuredClone(planningRun);
    expectDeterministic(() => clearForRecompute(planningRun));
    expectDeterministic(() => clearForRecompute(lockedRun));
    expect(planningRun).toStrictEqual(before);
  });
});

describe('exportRun', () => {
  it('is the run as stored, as a separate copy', () => {
    for (const run of [lockedRun, planningRun]) {
      const file = expectDeterministic(() => exportRun(run));
      expect(file).toStrictEqual(run);
      expect(sharesObjects(file, run)).toBe(false);
    }
  });
});

describe('planningOps module', () => {
  // The route layer orders these steps around the store and the matching (DECISIONS pass 46, 47).
  it('imports only the contracts, Zod and the generator, and names no clock or random source', () => {
    const source = readFileSync(new URL('../../server/api/v2/planningOps.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]).sort();
    expect(imports).toStrictEqual([
      '../../../shared/v2/api',
      '../../../shared/v2/schemas',
      '../../../shared/v2/types',
      '../../domain/v2/generator',
      'zod',
    ]);
    expect(source).not.toMatch(/\bimport\(|\brequire\(/);
    expect(source).not.toMatch(/\bDate\b|Math\.random|performance\.|process\.|\bcrypto\b/);
  });
});
