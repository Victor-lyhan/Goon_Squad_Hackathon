import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Run, Scenario } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../domain/pricing';
import { assignShipments } from '../domain/matching';
import { buildTrips, createRouter } from '../domain/routing';
import { materializeAssignment } from './pipeline';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures');

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf8'));

function isScenario(x: unknown): x is Scenario {
  const s = x as Partial<Scenario> | null;
  return (
    !!s && typeof s === 'object' && s.schemaVersion === 1 &&
    !!s.graph && Array.isArray(s.graph.nodes) && Array.isArray(s.graph.edges) &&
    Array.isArray(s.businesses) && Array.isArray(s.hubs) && Array.isArray(s.employees) &&
    Array.isArray(s.shipments) && !!s.settings
  );
}

export function loadDefaultScenario(): Scenario {
  try {
    const demo = readJson('demoScenario.json');
    if (isScenario(demo)) return demo;
  } catch {
    // fall through to the unit fixture
  }
  const f = readJson('relayFixture.json') as Pick<Scenario, 'graph' | 'businesses' | 'hubs' | 'employees'>;
  return {
    schemaVersion: 1,
    name: 'Relay fixture',
    preset: 'fixture',
    seed: 0,
    graph: f.graph,
    businesses: f.businesses,
    hubs: f.hubs,
    employees: f.employees,
    shipments: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

export function createInitialRun(scenario: Scenario): Run {
  const router = createRouter(scenario.graph);
  const trips = scenario.employees.flatMap((e) => buildTrips(e, scenario.businesses, router));
  const base: Run = {
    runId: 'run-1',
    version: 0,
    scenario,
    trips,
    assignments: { plans: [], unmatched: [], computeMs: 0 },
    jobs: [],
    notifications: [],
    events: [],
    clock: { phase: 'planning', playing: false, timeMin: scenario.settings.simStartMin, speed: 120 },
  };
  const t0 = performance.now();
  const result = assignShipments(scenario.shipments, {
    router, trips, employees: scenario.employees, businesses: scenario.businesses,
    hubs: scenario.hubs, settings: scenario.settings,
  });
  result.computeMs = performance.now() - t0;
  return { ...base, ...materializeAssignment(base, result) };
}
