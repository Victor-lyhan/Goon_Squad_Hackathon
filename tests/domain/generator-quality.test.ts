import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEMO_SCENARIO_OPTIONS, generateScenario } from '../../server/domain/generator.js';
import { assignShipments } from '../../server/domain/matching.js';
import { buildTrips, createRouter } from '../../server/domain/routing.js';

const RANDOM_DEFAULTS = {
  preset: 'random' as const,
  employees: 60,
  packages: 24,
  hubs: 6,
  maxExtraMin: 8,
};

function assignmentsFor(seed: number) {
  const scenario = generateScenario({ ...RANDOM_DEFAULTS, seed });
  const router = createRouter(scenario.graph);
  const trips = scenario.employees.flatMap(employee => buildTrips(employee, scenario.businesses, router));
  return { scenario, result: assignShipments(scenario.shipments, { ...scenario, router, trips }) };
}

describe('random city quality', () => {
  const seeds = Array.from({ length: 20 }, (_, index) => index + 1);
  let assignments = new Map<number, ReturnType<typeof assignmentsFor>>();

  // Measured locally at 2.95 s for this 20-seed generation/matching setup; CI reported 7.184 s.
  beforeAll(() => {
    assignments = new Map(seeds.map(seed => [seed, assignmentsFor(seed)]));
  }, 30_000);

  it('has matches for every default seed and relay plans for most seeds', { timeout: 30_000 }, () => {
    const results = seeds.map(seed => assignments.get(seed)!.result);

    expect(results.every(result => result.plans.length > 0)).toBe(true);
    expect(results.filter(result => result.plans.some(plan => plan.kind === 'relay')).length).toBeGreaterThanOrEqual(15);
  });

  it.each(seeds)(
    'uses friendly locations and unique display names for seed %i',
    seed => {
      const scenario = assignments.get(seed)!.scenario;
      const nodes = new Map(scenario.graph.nodes.map(node => [node.id, node]));
      const usedNodeIds = [
        ...scenario.businesses.map(business => business.nodeId),
        ...scenario.hubs.map(hub => hub.nodeId),
        ...scenario.employees.map(employee => employee.homeNodeId),
      ];

      expect(usedNodeIds.every(nodeId => {
        const node = nodes.get(nodeId);
        return Boolean(node?.label && node.district);
      })).toBe(true);
      expect(new Set(scenario.businesses.map(business => business.name)).size).toBe(scenario.businesses.length);
      expect(new Set(scenario.employees.map(employee => employee.name)).size).toBe(scenario.employees.length);
      expect(new Set(scenario.businesses.map(business => business.nodeId)).size).toBe(scenario.businesses.length);
    },
  );

  it('leaves the demo fixture byte-for-byte reproducible', () => {
    const fixture = readFileSync(resolve(process.cwd(), 'fixtures/demoScenario.json'), 'utf8');
    expect(`${JSON.stringify(generateScenario(DEMO_SCENARIO_OPTIONS), null, 2)}\n`).toBe(fixture);
  });
});
