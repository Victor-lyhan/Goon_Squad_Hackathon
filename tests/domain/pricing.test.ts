// Pricing per plan (issue #861): price = carrier pay + relay fee + platform fee - flexibility discount,
// computed by ONE function, `customerPriceCents(plan, shipment, settings)` in server/domain/pricing.ts.
// The matcher stores its result on the plan; metrics, views, notifications and the study read it from there.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS, carrierPayCents, customerPriceCents, isFlexible, platformContributionCents,
  projectedCustomerSavingsCents,
} from '../../server/domain/pricing';
import { assignShipments, generateCandidates, rankCandidates } from '../../server/domain/v2/matching';
import { computeMetrics } from '../../server/domain/v2/metrics';
import type { DeliveryPlan } from '../../shared/v2/types';
import { context, employee, relayContext, shipment } from './matching-v2-helpers';
import { STORY_TEST_TIMEOUT_MS, loadNycFixtures, runDefaultStory } from './generator-v2-nyc-story-helper';

const S = DEFAULT_SETTINGS;
const leg = { rewardCents: S.legRewardCents };
const DIRECT = { kind: 'direct', legs: [leg] } as const;
const RELAY = { kind: 'relay', legs: [leg, leg] } as const;
/** Ready at 4:00 p.m. on Day 1. */
const READY = 960;
/** 17 h after READY: one hour short of the flexible window. */
const STANDARD = { readyMin: READY, deadlineMin: READY + 17 * 60 };
/** 18 h after READY (10:00 a.m. on Day 2): exactly the flexible window. */
const FLEXIBLE = { readyMin: READY, deadlineMin: READY + 18 * 60 };

describe('the default pricing settings', () => {
  it('are the four values of the issue, with an 18-hour flexible window and the courier price unchanged', () => {
    expect(S).toMatchObject({
      legRewardCents: 300, hubCostCents: 50, platformFeeCents: 400, flexDiscountCents: 100, flexWindowMin: 1080,
      courierPriceCents: 1400,
    });
    expect(S.flexWindowMin).toBe(18 * 60);
    // The flat price is gone: nothing can read it by accident.
    expect(Object.keys(S)).not.toContain('priceCents');
  });
});

describe('customerPriceCents: the four price cases', () => {
  it.each([
    ['direct', DIRECT, STANDARD, 700],
    ['direct, flexible', DIRECT, FLEXIBLE, 600],
    ['relay', RELAY, STANDARD, 1050],
    ['relay, flexible', RELAY, FLEXIBLE, 950],
  ] as const)('%s: %i cents', (_name, plan, window, cents) => {
    expect(customerPriceCents(plan, window, S)).toBe(cents);
  });

  it('gives the discount from exactly flexWindowMin on, not a minute earlier', () => {
    const window = (minutes: number) => ({ readyMin: READY, deadlineMin: READY + minutes });
    expect(isFlexible(window(S.flexWindowMin - 1), S)).toBe(false);
    expect(isFlexible(window(S.flexWindowMin), S)).toBe(true);
    expect(customerPriceCents(DIRECT, window(S.flexWindowMin - 1), S)).toBe(700);
    expect(customerPriceCents(DIRECT, window(S.flexWindowMin), S)).toBe(600);
    expect(customerPriceCents(DIRECT, window(S.flexWindowMin + 1), S)).toBe(600);
  });

  it('adds up what the plan\'s legs pay, and the relay fee only for a relay', () => {
    expect(carrierPayCents(DIRECT)).toBe(300);
    expect(carrierPayCents(RELAY)).toBe(600);
    // Carrier pay is read from the legs, so a plan whose legs pay differently is priced from them.
    expect(customerPriceCents({ kind: 'relay', legs: [{ rewardCents: 250 }, { rewardCents: 400 }] }, STANDARD, S))
      .toBe(250 + 400 + S.hubCostCents + S.platformFeeCents);
    expect(customerPriceCents(RELAY, STANDARD, S) - customerPriceCents(DIRECT, STANDARD, S)).toBe(S.legRewardCents + S.hubCostCents);
  });

  it('follows every setting', () => {
    expect(customerPriceCents(RELAY, FLEXIBLE, { ...S, hubCostCents: 80 })).toBe(980);
    expect(customerPriceCents(RELAY, FLEXIBLE, { ...S, platformFeeCents: 500 })).toBe(1050);
    expect(customerPriceCents(RELAY, FLEXIBLE, { ...S, flexDiscountCents: 150 })).toBe(900);
    expect(customerPriceCents(RELAY, FLEXIBLE, { ...S, flexWindowMin: 1081 })).toBe(1050);
    expect(customerPriceCents(RELAY, STANDARD, { ...S, flexWindowMin: 17 * 60 })).toBe(950);
  });

  it('leaves the platform the fee less the discount and its variable cost', () => {
    // price - carrier pay - relay fee - 50 variable cost
    expect(platformContributionCents(DIRECT, STANDARD, S)).toBe(350);
    expect(platformContributionCents(DIRECT, FLEXIBLE, S)).toBe(250);
    expect(platformContributionCents(RELAY, STANDARD, S)).toBe(350);
    expect(platformContributionCents(RELAY, FLEXIBLE, S)).toBe(250);
  });
});

describe('savings against the courier', () => {
  it('are the courier price less the plan\'s price', () => {
    expect([700, 600, 1050, 950].map(price => projectedCustomerSavingsCents({ customerPriceCents: price }, S)))
      .toEqual([700, 800, 350, 450]);
  });

  it('are never negative, even when a price is above the courier price', () => {
    expect(projectedCustomerSavingsCents({ customerPriceCents: 1400 }, S)).toBe(0);
    expect(projectedCustomerSavingsCents({ customerPriceCents: 1401 }, S)).toBe(0);
    expect(projectedCustomerSavingsCents({ customerPriceCents: 5000 }, S)).toBe(0);
    // A cheap courier (or a dear platform fee): every saving is 0, none is negative.
    for (const settings of [{ ...S, courierPriceCents: 500 }, { ...S, courierPriceCents: 0 }, { ...S, platformFeeCents: 2000 }]) {
      for (const plan of [DIRECT, RELAY]) {
        for (const window of [STANDARD, FLEXIBLE]) {
          const price = customerPriceCents(plan, window, settings);
          expect(projectedCustomerSavingsCents({ customerPriceCents: price }, settings)).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe('the matcher prices every plan with the one function', () => {
  const direct = () => context([employee('emp-1', 'biz-a', { availableMorning: false })], { 'biz-a': 10, 'biz-b': 20, 'home-emp-1': 30 });

  it.each([
    ['direct', direct, { readyMin: 960, deadlineMin: 1980 }, 'direct', 700, 350],
    ['direct, flexible', direct, { readyMin: 900, deadlineMin: 1980 }, 'direct', 600, 250],
    ['relay', relayContext, { readyMin: 960, deadlineMin: 1980 }, 'relay', 1050, 350],
    ['relay, flexible', relayContext, { readyMin: 900, deadlineMin: 1980 }, 'relay', 950, 250],
  ] as const)('%s', (_name, ctx, window, kind, price, contribution) => {
    const request = shipment(window);
    const { plans, unmatched } = assignShipments([request], ctx());
    expect(unmatched).toEqual([]);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ kind, customerPriceCents: price, platformContributionCents: contribution });
    expect(plans[0]!.customerPriceCents).toBe(customerPriceCents(plans[0]!, request, S));
  });

  it('ranks as before: by carrier cost, so a direct plan still comes before a relay whatever the customer prices are', () => {
    const ctx = context([
      employee('emp-1', 'biz-a', { availableMorning: false }),
      employee('emp-2', 'biz-b', { availableEvening: false }),
    ], { 'biz-a': 0, 'biz-r': 2, 'biz-b': 4, 'home-emp-1': 6, 'home-emp-2': 2 });
    const candidates = generateCandidates(shipment(), ctx);
    expect(new Set(candidates.map(plan => plan.kind))).toEqual(new Set(['direct', 'relay']));
    // The ranking does not read the customer price: the same candidates with odd prices rank the same way.
    const repriced = candidates.map((plan, index) => ({ ...plan, customerPriceCents: 5000 - index * 100 }));
    expect(rankCandidates(repriced, ctx.settings).map(plan => plan.kind)).toEqual(rankCandidates(candidates, ctx.settings).map(plan => plan.kind));
    expect(rankCandidates(candidates, ctx.settings)[0]!.kind).toBe('direct');
  });
});

describe('metrics add up the plans\' own prices', () => {
  const plan = (id: string, kind: DeliveryPlan['kind'], customerPriceCents: number): DeliveryPlan => ({
    id: `plan-${id}`, shipmentId: id, kind, deliveryMin: 0, customerPriceCents, platformContributionCents: 0,
    legs: (kind === 'relay' ? [0, 1] : [0]).map(index => ({
      tripId: `trip-${id}-${index}`, employeeId: `emp-${id}-${index}`, placeIds: [], stops: [], finishMin: 0,
      extraMin: 0, extraDistanceM: 0, rewardCents: 300,
    })),
  });
  const plans = [plan('shp-1', 'direct', 700), plan('shp-2', 'direct', 600), plan('shp-3', 'relay', 1050), plan('shp-4', 'relay', 950)];
  const shipments = ['shp-1', 'shp-2', 'shp-3', 'shp-4', 'shp-5'].map(id => shipment({ id }));
  const input = { shipments, plans, unmatched: [{ shipmentId: 'shp-5', reason: 'none' }], occurredEvents: [] };

  it('spend is the sum of the matched prices plus the courier price for each unmatched package', () => {
    const metrics = computeMetrics({ ...input, settings: S });
    expect(metrics.projectedCustomerSpendCents).toBe(700 + 600 + 1050 + 950 + 1400);
    expect(metrics.projectedCustomerSavingsCents).toBe(700 + 800 + 350 + 450);
    // Every package costs the courier price, either paid to the courier or split into Relay's price and the saving.
    expect(metrics.projectedCustomerSpendCents + metrics.projectedCustomerSavingsCents).toBe(5 * S.courierPriceCents);
  });

  it('savings are never negative: a plan dearer than the courier counts 0', () => {
    // Courier at $8.00: the two directs save 100 and 200, the two relays would be -250 and -150 and count 0.
    const metrics = computeMetrics({ ...input, settings: { ...S, courierPriceCents: 800 } });
    expect(metrics.projectedCustomerSavingsCents).toBe(100 + 200);
    expect(computeMetrics({ ...input, settings: { ...S, courierPriceCents: 0 } }).projectedCustomerSavingsCents).toBe(0);
  });
});

describe('the default NYC run', () => {
  const run = runDefaultStory(loadNycFixtures());

  it('prices all 24 story plans with the function: $7.00 or $6.00 direct, $10.50 or $9.50 relay', () => {
    const shipments = new Map(run.scenario.shipments.map(request => [request.id, request]));
    expect(run.result.unmatched).toEqual([]);
    expect(run.result.plans).toHaveLength(24);
    for (const plan of run.result.plans) {
      const request = shipments.get(plan.shipmentId)!;
      const flexible = request.deadlineMin - request.readyMin >= 1080;
      const expected = (plan.kind === 'relay' ? 1050 : 700) - (flexible ? 100 : 0);
      expect(plan.customerPriceCents, plan.id).toBe(expected);
      expect(plan.customerPriceCents, plan.id).toBe(customerPriceCents(plan, request, run.scenario.settings));
      expect(plan.platformContributionCents, plan.id).toBe(flexible ? 250 : 350);
    }
    // The story has both kinds and both windows, so the demo shows more than one price.
    expect(new Set(run.result.plans.map(plan => plan.customerPriceCents)).size).toBeGreaterThanOrEqual(3);
  }, STORY_TEST_TIMEOUT_MS);

  it('has no negative saving and a spend that is the sum of its prices', () => {
    const metrics = computeMetrics({
      shipments: run.scenario.shipments, plans: run.result.plans, unmatched: run.result.unmatched,
      occurredEvents: [], settings: run.scenario.settings,
    });
    const prices = run.result.plans.map(plan => plan.customerPriceCents);
    expect(metrics.projectedCustomerSpendCents).toBe(prices.reduce((total, cents) => total + cents, 0));
    expect(metrics.projectedCustomerSavingsCents).toBe(prices.reduce((total, cents) => total + (1400 - cents), 0));
    expect(Math.max(...prices)).toBeLessThanOrEqual(run.scenario.settings.courierPriceCents);
  }, STORY_TEST_TIMEOUT_MS);
});
