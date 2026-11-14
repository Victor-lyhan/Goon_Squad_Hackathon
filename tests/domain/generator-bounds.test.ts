import { describe, expect, it } from 'vitest';
import { assignShipments, type MatchContext } from '../../server/domain/matching.js';
import { generateScenario } from '../../server/domain/generator.js';
import { buildTrips, createRouter } from '../../server/domain/routing.js';

const seeds = [1, 42, 999];
const employeeCounts = [10, 200];
const packageCounts = [5, 60];
const hubCounts = [0, 10];
const detourLimits = [0, 30];

function options(seed: number, employees: number, packages: number, hubs: number, maxExtraMin: number) {
  return { seed, employees, packages, hubs, maxExtraMin, preset: 'random' as const };
}

function expectUnique(ids: string[]) {
  expect(new Set(ids).size).toBe(ids.length);
}

describe('generateScenario Setup drawer bounds', () => {
  it.each(seeds.flatMap(seed => employeeCounts.flatMap(employees => packageCounts.flatMap(packages =>
    hubCounts.flatMap(hubs => detourLimits.map(maxExtraMin => [seed, employees, packages, hubs, maxExtraMin] as const)),
  ))))(
    'generates valid deterministic data for seed %i, employees %i, packages %i, hubs %i, and max extra %i',
    (seed, employees, packages, hubs, maxExtraMin) => {
      const input = options(seed, employees, packages, hubs, maxExtraMin);
      const scenario = generateScenario(input);
      const nodeIds = new Set(scenario.graph.nodes.map(node => node.id));
      const businessIds = new Set(scenario.businesses.map(business => business.id));

      expect(scenario).toEqual(generateScenario(input));
      expect(scenario.employees).toHaveLength(employees);
      expect(scenario.shipments).toHaveLength(packages);
      expect(scenario.hubs).toHaveLength(hubs);

      expectUnique(scenario.graph.nodes.map(node => node.id));
      expectUnique(scenario.businesses.map(business => business.id));
      expectUnique(scenario.hubs.map(hub => hub.id));
      expectUnique(scenario.employees.map(employee => employee.id));
      expectUnique(scenario.shipments.map(shipment => shipment.id));
      expectUnique(scenario.shipments.map(shipment => shipment.clientRequestId));
      expect(scenario.businesses.every(business => /^biz-[a-z0-9-]+$/.test(business.id))).toBe(true);
      expect(scenario.hubs.every(hub => /^hub-[a-z0-9-]+$/.test(hub.id))).toBe(true);
      expect(scenario.employees.every(employee => /^emp-[1-9][0-9]*$/.test(employee.id))).toBe(true);
      expect(scenario.shipments.every(shipment => /^shp-[1-9][0-9]*$/.test(shipment.id))).toBe(true);
      expect(scenario.graph.nodes.every(node => /^n-[0-9]+-[0-9]+$/.test(node.id))).toBe(true);

      expect(scenario.businesses.every(business => nodeIds.has(business.nodeId))).toBe(true);
      expect(scenario.hubs.every(hub => nodeIds.has(hub.nodeId))).toBe(true);
      expect(scenario.employees.every(employee => (
        businessIds.has(employee.businessId)
        && nodeIds.has(employee.homeNodeId)
        && employee.maxExtraMin === maxExtraMin
      ))).toBe(true);
      expect(scenario.shipments.every(shipment => (
        businessIds.has(shipment.originBusinessId)
        && businessIds.has(shipment.destinationBusinessId)
        && shipment.originBusinessId !== shipment.destinationBusinessId
        && scenario.settings.simStartMin <= shipment.readyMin
        && shipment.readyMin < shipment.deadlineMin
        && shipment.deadlineMin <= scenario.settings.simEndMin
        && shipment.weightGrams > 0
        && shipment.weightGrams <= 2000
      ))).toBe(true);
    },
  );

  it('uses only direct plans when no hubs are generated', () => {
    const scenario = generateScenario(options(42, 200, 60, 0, 30));
    const context: MatchContext = {
      router: createRouter(scenario.graph),
      trips: [],
      employees: scenario.employees,
      businesses: scenario.businesses,
      hubs: scenario.hubs,
      settings: scenario.settings,
    };
    context.trips = scenario.employees.flatMap(employee => buildTrips(employee, scenario.businesses, context.router));

    const result = assignShipments(scenario.shipments, context);

    expect(scenario.hubs).toEqual([]);
    expect(result.plans.every(plan => plan.kind === 'direct')).toBe(true);
  });
});
