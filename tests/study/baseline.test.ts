// The comparison math on hand-made plans: every expected number below is worked out by hand from the
// default assumptions (courier $14 envelope / $18 small box, promise Day 2 10:30 a.m. = minute 2070,
// 0.4 kg CO2 per mile for both vehicles, a dedicated loaded trip, only the detour counted for Relay).
import { describe, expect, it } from 'vitest';
import type { DeliveryPlan, Leg, Shipment, Trip } from '../../shared/v2/types';
import { ASSUMPTIONS, assumptionValues } from '../../scripts/study/assumptions';
import {
  comparePackage, courierPriceCents, courierPromisedByMin, courierTripM, headlineOf, relayAddedM, runTotals,
  studyTotals, timingOf,
} from '../../scripts/study/baseline';

const a = assumptionValues(ASSUMPTIONS);
const withValues = (changes: Partial<Record<keyof typeof a, number>>) => ({ ...a, ...changes });

const shipment = (category: Shipment['category']): Shipment => ({
  id: 'shp-1', clientRequestId: 'test-1', label: 'Test', originBusinessId: 'biz-a', destinationBusinessId: 'biz-b',
  readyMin: 960, deadlineMin: 2040, category, description: '', weightGrams: 500,
  pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
});

const leg = (tripId: string, extraDistanceM: number): Leg => ({
  tripId, employeeId: tripId.replace(/-(eve|morn)$/, ''), placeIds: [], stops: [], finishMin: 0, extraMin: 0,
  extraDistanceM, rewardCents: 300,
});

const plan = (kind: DeliveryPlan['kind'], legs: Leg[]): DeliveryPlan => ({
  id: 'plan-shp-1', shipmentId: 'shp-1', kind, legs, deliveryMin: 0,
  customerPriceCents: 1000, platformContributionCents: 0,
});

const trip = (id: string, baselineDistanceM: number): Trip => ({
  id, employeeId: id.replace(/-(eve|morn)$/, ''), direction: id.endsWith('-eve') ? 'evening' : 'morning',
  originPlaceId: 'x', destinationPlaceId: 'y', departureMin: 0, baselineDurationMin: 0, baselineDistanceM,
});

const trips = new Map([trip('emp-1-eve', 10_000), trip('emp-2-morn', 20_000)].map(t => [t.id, t]));

describe('the courier baseline', () => {
  it('prices an envelope and a small box from the assumptions', () => {
    expect(courierPriceCents('envelope', a)).toBe(1400);
    expect(courierPriceCents('small_box', a)).toBe(1800);
    expect(courierPriceCents('small_box', withValues({ courierSmallBoxCents: 2500 }))).toBe(2500);
  });

  it('counts the loaded sender -> recipient drive once, and more only when the assumptions say so', () => {
    expect(courierTripM(8047, a)).toBe(8047);
    expect(courierTripM(8047, withValues({ courierEmptyMilesPerLoadedMile: 1 }))).toBe(16_094);
    expect(courierTripM(8047, withValues({ courierTripSharePerPackage: 0.25 }))).toBe(2012); // 2011.75 rounded
    expect(courierTripM(0, a)).toBe(0);
  });

  it('promises Day 2 10:30 a.m.', () => {
    expect(courierPromisedByMin(a)).toBe(1440 + 630);
  });
});

describe('Relay added distance', () => {
  it('is the sum of the legs\' extra meters', () => {
    expect(relayAddedM(plan('relay', [leg('emp-1-eve', 700), leg('emp-2-morn', 1300)]), trips, a)).toBe(2000);
  });

  it('never counts a shorter route as a saving', () => {
    expect(relayAddedM(plan('relay', [leg('emp-1-eve', -500), leg('emp-2-morn', 1000)]), trips, a)).toBe(1000);
    expect(relayAddedM(plan('direct', [leg('emp-1-eve', -1)]), trips, a)).toBe(0);
  });

  it('adds a share of the usual commute only when the assumption is not 0', () => {
    const both = plan('relay', [leg('emp-1-eve', 700), leg('emp-2-morn', 1300)]);
    expect(relayAddedM(both, trips, withValues({ relayCommuteMilesShare: 0.5 }))).toBe(2000 + 5000 + 10_000);
  });

  it('refuses a plan whose trip the run does not have', () => {
    expect(() => relayAddedM(plan('direct', [leg('emp-9-eve', 10)]), trips, a)).toThrow(/emp-9-eve/);
  });
});

describe('timing against the courier promise', () => {
  it.each([
    [1005, 'early'],     // Day 1 evening
    [1439, 'early'],     // the last minute of Day 1
    [1440, 'on_time'],   // Day 2 begins
    [2070, 'on_time'],   // exactly 10:30 a.m.
    [2071, 'late'],
  ] as const)('minute %i is %s', (minute, timing) => {
    expect(timingOf(minute, a)).toBe(timing);
  });
});

describe('one package', () => {
  // 3219 m = 2.0002 miles, 8047 m = 5.0002 miles.
  const row = comparePackage({
    shipment: shipment('envelope'), plan: plan('direct', [leg('emp-1-eve', 3219)]),
    deliveredAtMin: 1900, directM: 8047, tripsById: trips,
  }, a);

  it('compares cost, miles, CO2 and time', () => {
    expect(row).toEqual({
      shipmentId: 'shp-1', category: 'envelope', kind: 'direct',
      originBusinessId: 'biz-a', destinationBusinessId: 'biz-b',
      relayCostCents: 1000, courierCostCents: 1400, costSavedCents: 400,
      relayAddedM: 3219, courierTripM: 8047,
      relayAddedMiles: 2, courierMiles: 5, milesSaved: 3,
      relayCo2Kg: 0.8, courierCo2Kg: 2, co2SavedKg: 1.2,
      deliveredAtMin: 1900, courierPromisedByMin: 2070, minutesAheadOfPromise: 170, timing: 'on_time',
    });
  });

  it('uses each vehicle\'s own CO2 factor', () => {
    const van = comparePackage({
      shipment: shipment('small_box'), plan: plan('direct', [leg('emp-1-eve', 3219)]),
      deliveredAtMin: 2100, directM: 8047, tripsById: trips,
    }, withValues({ courierCo2KgPerMile: 0.8 }));
    expect(van).toMatchObject({
      courierCostCents: 1800, costSavedCents: 800, relayCo2Kg: 0.8, courierCo2Kg: 4, co2SavedKg: 3.2,
      minutesAheadOfPromise: -30, timing: 'late',
    });
  });

  it('adds up into run totals, study totals and the headline', () => {
    const second = comparePackage({
      shipment: shipment('small_box'), plan: plan('relay', [leg('emp-1-eve', -500), leg('emp-2-morn', 1609)]),
      deliveredAtMin: 1100, directM: 4828, tripsById: trips,
    }, a);
    const run = runTotals([row, second], 4, a);
    expect(run).toEqual({
      packages: 4, matched: 2, unmatched: 2, matchRate: 0.5, direct: 1, relay: 1,
      relayCostCents: 2000, courierCostCents: 3200, costSavedCents: 1200,
      relayAddedM: 4828, courierTripM: 12_875,
      relayAddedMiles: 3, courierMiles: 8, milesSaved: 5,
      relayCo2Kg: 1.2, courierCo2Kg: 3.2, co2SavedKg: 2,
      early: 1, onTime: 1, late: 0, minutesAheadOfPromise: 170 + 970,
    });

    const study = studyTotals([run, run], 1, a);
    expect(study).toMatchObject({
      runs: 2, skippedRuns: 1, packages: 8, matched: 4, unmatched: 4, matchRate: 0.5,
      relayCostCents: 4000, courierCostCents: 6400, costSavedCents: 2400,
      relayAddedM: 9656, courierTripM: 25_750, relayAddedMiles: 6, courierMiles: 16, milesSaved: 10,
      early: 2, onTime: 2, late: 0, minutesAheadOfPromise: 2280,
    });

    expect(headlineOf(study, a)).toEqual({
      runs: 2, packages: 8, matched: 4, matchRate: 0.5,
      relayCostPerPackageCents: 1000, courierCostPerPackageCents: 1600, costSavedPerPackageCents: 600, costSavedRate: 0.375,
      relayAddedMilesPerPackage: 1.5, courierMilesPerPackage: 4, milesSavedPerPackage: 2.5, milesSavedRate: 0.625,
      relayCo2KgPerPackage: 0.6, courierCo2KgPerPackage: 1.6, co2SavedKgPerPackage: 1, co2SavedRate: 0.625,
      onTimeOrEarlyRate: 1, earlyRate: 0.5, lateRate: 0, avgMinutesAheadOfPromise: 570,
    });
  });
});

describe('nothing matched', () => {
  it('gives zeros and nulls, never NaN', () => {
    const run = runTotals([], 12, a);
    expect(run).toMatchObject({ packages: 12, matched: 0, unmatched: 12, matchRate: 0, relayAddedMiles: 0, co2SavedKg: 0 });
    const headline = headlineOf(studyTotals([run], 0, a), a);
    expect(headline.costSavedPerPackageCents).toBeNull();
    expect(headline.co2SavedKgPerPackage).toBeNull();
    expect(headline.onTimeOrEarlyRate).toBeNull();
    expect(headline.milesSavedRate).toBeNull();
    expect(JSON.stringify({ run, headline })).not.toMatch(/NaN|Infinity/);
    for (const value of [...Object.values(run), ...Object.values(headline)]) {
      expect(value === null || Number.isFinite(value)).toBe(true);
    }
  });

  it('has no numbers for an empty study either', () => {
    const headline = headlineOf(studyTotals([], 3, a), a);
    expect(headline).toMatchObject({ runs: 0, packages: 0, matched: 0, matchRate: null });
  });
});
