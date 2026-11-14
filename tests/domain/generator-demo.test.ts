import { describe, expect, it } from 'vitest';
import { DEMO_SCENARIO_OPTIONS, generateScenario } from '../../server/domain/generator.js';
import { generateCandidates } from '../../server/domain/matching.js';
import { buildTrips, createRouter } from '../../server/domain/routing.js';

describe('demo scenario', () => {
  it('has the requested entities and clear direct and relay-only candidates', () => {
    const scenario = DEMO_SCENARIO;
    const counts = scenario.shipments.reduce((result, shipment) => {
      const candidates = generateCandidates(shipment, DEMO_CONTEXT);
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

const DEMO_SCENARIO = generateScenario(DEMO_SCENARIO_OPTIONS);
const demoRouter = createRouter(DEMO_SCENARIO.graph);
const DEMO_CONTEXT = {
  router: demoRouter,
  trips: DEMO_SCENARIO.employees.flatMap(employee => buildTrips(employee, DEMO_SCENARIO.businesses, demoRouter)),
  employees: DEMO_SCENARIO.employees,
  businesses: DEMO_SCENARIO.businesses,
  hubs: DEMO_SCENARIO.hubs,
  settings: DEMO_SCENARIO.settings,
};
