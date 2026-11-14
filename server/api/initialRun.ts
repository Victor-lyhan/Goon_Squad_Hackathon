import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Run, Scenario, Settings } from '../../shared/types';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures');

// TODO: switch to DEFAULT_SETTINGS from server/domain/pricing.ts once #2 merges.
const DEFAULT_SETTINGS: Settings = {
  handlingMin: 2,
  defaultMaxExtraMin: 8,
  priceCents: 1000,
  legRewardCents: 300,
  hubCostCents: 50,
  platformVariableCostCents: 50,
  courierPriceCents: 1400,
  simStartMin: 930,
  simEndMin: 2160,
  allowRelay: true,
};

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
  return {
    runId: 'run-1',
    version: 0,
    scenario,
    trips: [], // computed once routing is wired in (follow-up issue)
    assignments: { plans: [], unmatched: [], computeMs: 0 },
    jobs: [],
    notifications: [],
    events: [],
    clock: { phase: 'planning', playing: false, timeMin: scenario.settings.simStartMin, speed: 120 },
  };
}
