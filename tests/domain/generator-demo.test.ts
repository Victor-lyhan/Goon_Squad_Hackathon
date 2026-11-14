import { describe, expect, it } from 'vitest';
import { DEMO_SCENARIO_OPTIONS, generateScenario } from '../../server/domain/generator.js';
import { generateCandidates } from '../../server/domain/matching.js';
import { buildTrips, createRouter } from '../../server/domain/routing.js';

describe('demo scenario', () => {
  it('has the requested entities and clear direct and relay-only candidates', () => {
    const scenario = generateScenario(DEMO_SCENARIO_OPTIONS);
    const router = createRouter(scenario.graph);
    const context = {
      router,
      trips: scenario.employees.flatMap(employee => buildTrips(employee, scenario.businesses, router)),
      employees: scenario.employees,
      businesses: scenario.businesses,
      hubs: scenario.hubs,
      settings: scenario.settings,
    };
    const counts = scenario.shipments.reduce((result, shipment) => {
      const candidates = generateCandidates(shipment, context);
      if (candidates.some(candidate => candidate.kind === 'direct')) result.direct += 1;
      else if (candidates.some(candidate => candidate.kind === 'relay')) result.relayOnly += 1;
      else result.none += 1;
      return result;
    }, { direct: 0, relayOnly: 0, none: 0 });

    expect(scenario.businesses).toHaveLength(12);
    expect(scenario.hubs).toHaveLength(6);
    expect(scenario.employees).toHaveLength(60);
    expect(scenario.shipments).toHaveLength(24);
    expect(scenario.shipments.every(shipment => shipment.originBusinessId !== shipment.destinationBusinessId)).toBe(true);
    expect(counts.direct).toBeGreaterThanOrEqual(2);
    expect(counts.relayOnly).toBeGreaterThanOrEqual(2);
  });
});
