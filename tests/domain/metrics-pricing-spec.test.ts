import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/relayFixture.json';
import type { Employee, Settings, Shipment } from '../../shared/types.js';
import { generateCandidates, type MatchContext } from '../../server/domain/matching.js';
import {
  DEFAULT_SETTINGS,
  projectedCustomerSavingsCents,
} from '../../server/domain/pricing.js';
import { buildTrips, createRouter } from '../../server/domain/routing.js';

function fixtureInputs(settings: Settings = { ...DEFAULT_SETTINGS }): {
  shipment: Shipment;
  context: MatchContext;
} {
  const employees: Employee[] = fixture.employees.map((employee, index) => ({
    ...employee,
    name: employee.id,
    homeNodeId: index === 0 ? 'X' : 'Y',
    eveningDepartureMin: 1020,
    morningDepartureMin: 1935,
    // The added X → B connection below makes a direct evening plan feasible.
    maxExtraMin: index === 0 ? 30 : 8,
    availableEvening: index === 0,
    availableMorning: index === 1,
    eveningViaNodeIds: [],
    morningViaNodeIds: [],
  }));
  const router = createRouter({
    ...fixture.graph,
    edges: [
      ...fixture.graph.edges,
      { from: 'X', to: 'B', durationMin: 10, distanceM: 3500 },
      { from: 'B', to: 'X', durationMin: 10, distanceM: 3500 },
    ],
  });
  const context: MatchContext = {
    router,
    employees,
    businesses: fixture.businesses,
    hubs: fixture.hubs,
    settings,
    trips: employees.flatMap(employee => buildTrips(employee, fixture.businesses, router)),
  };
  const shipment: Shipment = {
    ...fixture.shipment,
    clientRequestId: 'pricing-spec-request',
    label: 'Pricing spec package',
    category: 'small_box',
    description: '',
    weightGrams: 500,
    pickupInstructions: '',
    dropoffInstructions: '',
    createdSeq: 1,
  };
  return { shipment, context };
}

function plansFor(settings?: Settings) {
  const { shipment, context } = fixtureInputs(settings);
  const plans = generateCandidates(shipment, context);
  const direct = plans.find(plan => plan.kind === 'direct');
  const relay = plans.find(plan => plan.kind === 'relay');
  if (!direct || !relay) throw new Error('Fixture should produce both direct and relay plans');
  return { direct, relay };
}

describe('spec §8 pricing defaults', () => {
  it('uses the published assumptions in integer cents', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      priceCents: 1000,
      legRewardCents: 300,
      hubCostCents: 50,
      platformVariableCostCents: 50,
      courierPriceCents: 1400,
    });
    expect(Object.values(DEFAULT_SETTINGS).filter(value => typeof value === 'number')
      .every(value => Number.isInteger(value))).toBe(true);
  });

  it('prices real direct and relay plans from the fixture at $10, $6.50, and $3.00', () => {
    const { direct, relay } = plansFor();

    expect(direct).toMatchObject({
      customerPriceCents: 1000,
      platformContributionCents: 650,
    });
    expect(direct.legs.map(leg => leg.rewardCents)).toEqual([300]);
    expect(relay).toMatchObject({
      customerPriceCents: 1000,
      platformContributionCents: 300,
      hubId: 'hub-h',
    });
    expect(relay.legs.map(leg => leg.rewardCents)).toEqual([300, 300]);
  });

  it('recalculates generated plan prices as integer cents when assumptions are edited', () => {
    const edited = { ...DEFAULT_SETTINGS, priceCents: 1200, legRewardCents: 250 };
    const { direct, relay } = plansFor(edited);

    expect(direct).toMatchObject({ customerPriceCents: 1200, platformContributionCents: 900 });
    expect(direct.legs.map(leg => leg.rewardCents)).toEqual([250]);
    expect(relay).toMatchObject({ customerPriceCents: 1200, platformContributionCents: 600 });
    expect(relay.legs.map(leg => leg.rewardCents)).toEqual([250, 250]);
    for (const plan of [direct, relay]) {
      expect(Number.isInteger(plan.customerPriceCents)).toBe(true);
      expect(Number.isInteger(plan.platformContributionCents)).toBe(true);
      expect(plan.legs.every(leg => Number.isInteger(leg.rewardCents))).toBe(true);
    }
  });

  it('clamps projected savings to zero when an edited price exceeds the courier comparison', () => {
    // Savings is a customer-facing comparison, not a surcharge: courier minus price, floored at zero.
    expect(projectedCustomerSavingsCents(DEFAULT_SETTINGS)).toBe(400);
    expect(projectedCustomerSavingsCents({ ...DEFAULT_SETTINGS, priceCents: 1500 })).toBe(0);
  });
});
