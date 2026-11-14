import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { jobIdFor } from '../../shared/types';
import { DEMO_SCENARIO_OPTIONS, generateScenario } from '../../server/domain/generator';
import { assignShipments } from '../../server/domain/matching';
import { createRouter } from '../../server/domain/routing';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { materializeAssignment } from '../../server/api/pipeline';

// CI-safe (DECISIONS pass 17/19): generated cities and real servers get 3x+ headroom over local time.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const demoPath = path.resolve(__dirname, '../../fixtures/demoScenario.json');
const strip = <T extends { assignments: { computeMs: number } }>(r: T) =>
  ({ ...r, assignments: { ...r.assignments, computeMs: 0 } });

describe('demo scenario fixture', () => {
  it('matches generateScenario(DEMO_SCENARIO_OPTIONS)', () => {
    expect(JSON.parse(fs.readFileSync(demoPath, 'utf8'))).toEqual(generateScenario(DEMO_SCENARIO_OPTIONS));
  });
});

describe('initial demo run', () => {
  const run = createInitialRun(loadDefaultScenario());

  it('is fully matched with direct and relay plans', () => {
    const plans = run.assignments.plans;
    expect(plans.filter((p) => p.kind === 'direct').length).toBeGreaterThanOrEqual(2);
    expect(plans.filter((p) => p.kind === 'relay').length).toBeGreaterThanOrEqual(2);
    expect(run.clock.phase).toBe('planning');
    expect(run.clock.timeMin).toBe(run.scenario.settings.simStartMin);
  });

  it('has one job per leg with deterministic ids and a timeline', () => {
    expect(run.jobs.length).toBe(run.assignments.plans.reduce((n, p) => n + p.legs.length, 0));
    const ids = new Set(run.assignments.plans.flatMap((p) => p.legs.map((_, i) => jobIdFor(p.id, i))));
    expect(new Set(run.jobs.map((j) => j.id))).toEqual(ids);
    expect(run.events.length).toBeGreaterThan(0);
  });

  it('is deterministic apart from computeMs', () => {
    const again = createInitialRun(loadDefaultScenario());
    expect(strip(again)).toEqual(strip(run));
  });

  it('re-applying materializeAssignment adds no notifications', () => {
    expect(run.notifications.length).toBeGreaterThan(0);
    const again = materializeAssignment(run, run.assignments);
    expect(again.notifications).toEqual(run.notifications);
  });

  it('leaves a free ordered business pair for a new shipment', () => {
    const { scenario } = run;
    const ctx = {
      router: createRouter(scenario.graph), trips: run.trips, employees: scenario.employees,
      businesses: scenario.businesses, hubs: scenario.hubs, settings: scenario.settings,
    };
    const template = scenario.shipments[0];
    let found = false;
    for (const a of scenario.businesses) {
      for (const b of scenario.businesses) {
        if (a.id === b.id || found) continue;
        const shipment = {
          ...template, id: 'shp-probe', clientRequestId: 'probe', originBusinessId: a.id,
          destinationBusinessId: b.id, createdSeq: 10_000,
        };
        const res = assignShipments([shipment], ctx, { existing: run.assignments.plans });
        if (res.plans.some((p) => p.shipmentId === shipment.id)) found = true;
      }
    }
    expect(found).toBe(true);
  });
});
