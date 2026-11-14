import { describe, expect, it } from 'vitest';
import { generateScenario } from '../../server/domain/generator.js';

const options = {
  seed: 42,
  employees: 60,
  packages: 24,
  hubs: 6,
  maxExtraMin: 8,
  preset: 'demo' as const,
};

describe('generateScenario', () => {
  it('is deterministic for the same options and varies by seed', () => {
    expect(generateScenario(options)).toEqual(generateScenario(options));
    expect(generateScenario({ ...options, seed: 43 })).not.toEqual(generateScenario(options));
  });

  it('keeps city and demand fixed while employee count selects a roster prefix', () => {
    const small = generateScenario({ ...options, employees: 30 });
    const large = generateScenario(options);

    expect(small.employees).toEqual(large.employees.slice(0, 30));
    expect(small.businesses).toEqual(large.businesses);
    expect(small.hubs).toEqual(large.hubs);
    expect(small.shipments).toEqual(large.shipments);
  });

  it('produces valid references and requested entity counts, including no hubs', () => {
    const scenario = generateScenario({ ...options, employees: 10, packages: 5, hubs: 0, maxExtraMin: 11 });
    const nodeIds = new Set(scenario.graph.nodes.map((node) => node.id));
    const businessIds = new Set(scenario.businesses.map((business) => business.id));

    expect(scenario.businesses).toHaveLength(12);
    expect(scenario.employees).toHaveLength(10);
    expect(scenario.shipments).toHaveLength(5);
    expect(scenario.hubs).toHaveLength(0);
    expect(scenario.settings.defaultMaxExtraMin).toBe(11);
    expect(scenario.businesses.every((business) => nodeIds.has(business.nodeId))).toBe(true);
    expect(scenario.employees.every((employee) => (
      businessIds.has(employee.businessId)
      && nodeIds.has(employee.homeNodeId)
      && employee.eveningDepartureMin >= 1020 && employee.eveningDepartureMin <= 1080
      && employee.morningDepartureMin >= 1860 && employee.morningDepartureMin <= 1950
      && employee.availableEvening && employee.availableMorning
      && employee.maxExtraMin === 11
      && employee.eveningViaNodeIds.length === 0 && employee.morningViaNodeIds.length === 0
    ))).toBe(true);
    expect(scenario.shipments.every((shipment) => (
      businessIds.has(shipment.originBusinessId)
      && businessIds.has(shipment.destinationBusinessId)
      && shipment.originBusinessId !== shipment.destinationBusinessId
      && shipment.readyMin === 960 && shipment.deadlineMin === 2040
      && shipment.weightGrams > 0 && shipment.weightGrams <= 2000
    ))).toBe(true);
  });
});
