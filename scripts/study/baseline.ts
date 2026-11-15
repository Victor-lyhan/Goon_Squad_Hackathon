// The comparison math: one Relay plan against one dedicated next-day courier trip, and the sums over packages.
// Pure functions. Every constant comes from the assumptions (`a`); unit definitions come from units.ts.
// tests/study/assumptions.test.ts fails if a number literal other than 0 or 1 appears in this file.
import type { DeliveryPlan, Shipment, Trip } from '../../shared/v2/types';
import type { AssumptionValues } from './assumptions';
import type { ComparisonTotals, PackageComparison, StudyHeadline, StudyTotals, Timing } from './types';
import {
  KG_DECIMALS, MILES_DECIMALS, MINUTES_DECIMALS, MINUTES_PER_DAY,
  average, milesFromMeters, rate, roundTo,
} from './units';

// ---------- the courier baseline ----------

/** What the sender pays the courier for this package. */
export function courierPriceCents(category: Shipment['category'], a: AssumptionValues): number {
  return category === 'envelope' ? a.courierEnvelopeCents : a.courierSmallBoxCents;
}

/**
 * Meters the courier drives for this package. `directM` is the sender -> recipient distance from the travel
 * matrix; the assumptions say how much of that trip belongs to the package and how many empty miles go with it.
 */
export function courierTripM(directM: number, a: AssumptionValues): number {
  return Math.round(directM * a.courierTripSharePerPackage * (1 + a.courierEmptyMilesPerLoadedMile));
}

/** The end of the courier's promised window, in minutes since Day 1 00:00. The next business day is Day 2. */
export function courierPromisedByMin(a: AssumptionValues): number {
  return MINUTES_PER_DAY + a.courierPromisedByMin;
}

// ---------- Relay ----------

/**
 * Meters Relay adds to traffic for this plan: each leg's `extraDistanceM` (the commute through the stops minus
 * the usual commute), never less than the per-leg floor, plus the assumed share of the usual commute itself.
 */
export function relayAddedM(plan: DeliveryPlan, tripsById: ReadonlyMap<string, Trip>, a: AssumptionValues): number {
  let meters = 0;
  for (const leg of plan.legs) {
    const trip = tripsById.get(leg.tripId);
    if (!trip) throw new Error(`Plan ${plan.id} uses trip ${leg.tripId}, which the run does not have`);
    meters += Math.max(a.relayMinAddedMPerLeg, leg.extraDistanceM) + a.relayCommuteMilesShare * trip.baselineDistanceM;
  }
  return Math.round(meters);
}

// ---------- shared ----------

/** kg of CO2 for `meters` driven by a vehicle that emits `kgPerMile`. Not rounded. */
export function co2Kg(meters: number, kgPerMile: number): number {
  return milesFromMeters(meters) * kgPerMile;
}

/** Relay's delivery minute against the courier's window: the day before it, inside it, or after it. */
export function timingOf(deliveredAtMin: number, a: AssumptionValues): Timing {
  if (deliveredAtMin < MINUTES_PER_DAY) return 'early';
  return deliveredAtMin <= courierPromisedByMin(a) ? 'on_time' : 'late';
}

/** The miles and kg fields of a row or a total, converted from its exact meters. */
function distanceOutputs(relayM: number, courierM: number, a: AssumptionValues) {
  const relayKg = co2Kg(relayM, a.commuterCo2KgPerMile);
  const courierKg = co2Kg(courierM, a.courierCo2KgPerMile);
  return {
    relayAddedMiles: roundTo(milesFromMeters(relayM), MILES_DECIMALS),
    courierMiles: roundTo(milesFromMeters(courierM), MILES_DECIMALS),
    milesSaved: roundTo(milesFromMeters(courierM - relayM), MILES_DECIMALS),
    relayCo2Kg: roundTo(relayKg, KG_DECIMALS),
    courierCo2Kg: roundTo(courierKg, KG_DECIMALS),
    co2SavedKg: roundTo(courierKg - relayKg, KG_DECIMALS),
  };
}

export type PackageInput = {
  shipment: Shipment;
  plan: DeliveryPlan;
  /** When the simulation delivered it. */
  deliveredAtMin: number;
  /** Sender -> recipient meters from the travel matrix. */
  directM: number;
  tripsById: ReadonlyMap<string, Trip>;
};

/** One matched package: what Relay did in the simulation, next to the courier baseline. */
export function comparePackage(input: PackageInput, a: AssumptionValues): PackageComparison {
  const { shipment, plan, deliveredAtMin, directM, tripsById } = input;
  const relayCostCents = plan.customerPriceCents;
  const courierCostCents = courierPriceCents(shipment.category, a);
  const relayM = relayAddedM(plan, tripsById, a);
  const courierM = courierTripM(directM, a);
  const promisedByMin = courierPromisedByMin(a);
  return {
    shipmentId: shipment.id,
    category: shipment.category,
    kind: plan.kind,
    originBusinessId: shipment.originBusinessId,
    destinationBusinessId: shipment.destinationBusinessId,
    relayCostCents,
    courierCostCents,
    costSavedCents: courierCostCents - relayCostCents,
    relayAddedM: relayM,
    courierTripM: courierM,
    ...distanceOutputs(relayM, courierM, a),
    deliveredAtMin,
    courierPromisedByMin: promisedByMin,
    minutesAheadOfPromise: promisedByMin - deliveredAtMin,
    timing: timingOf(deliveredAtMin, a),
  };
}

// ---------- totals ----------

/** The whole-number fields of a total. Everything else in ComparisonTotals is derived from these. */
type ExactTotals = Pick<ComparisonTotals,
  'packages' | 'matched' | 'direct' | 'relay' | 'relayCostCents' | 'courierCostCents' |
  'relayAddedM' | 'courierTripM' | 'early' | 'onTime' | 'late' | 'minutesAheadOfPromise'>;

const EXACT_KEYS: readonly (keyof ExactTotals)[] = [
  'packages', 'matched', 'direct', 'relay', 'relayCostCents', 'courierCostCents',
  'relayAddedM', 'courierTripM', 'early', 'onTime', 'late', 'minutesAheadOfPromise',
];

function emptyExact(): ExactTotals {
  return {
    packages: 0, matched: 0, direct: 0, relay: 0, relayCostCents: 0, courierCostCents: 0,
    relayAddedM: 0, courierTripM: 0, early: 0, onTime: 0, late: 0, minutesAheadOfPromise: 0,
  };
}

function withDerived(exact: ExactTotals, a: AssumptionValues): ComparisonTotals {
  return {
    packages: exact.packages,
    matched: exact.matched,
    unmatched: exact.packages - exact.matched,
    matchRate: rate(exact.matched, exact.packages),
    direct: exact.direct,
    relay: exact.relay,
    relayCostCents: exact.relayCostCents,
    courierCostCents: exact.courierCostCents,
    costSavedCents: exact.courierCostCents - exact.relayCostCents,
    relayAddedM: exact.relayAddedM,
    courierTripM: exact.courierTripM,
    ...distanceOutputs(exact.relayAddedM, exact.courierTripM, a),
    early: exact.early,
    onTime: exact.onTime,
    late: exact.late,
    minutesAheadOfPromise: exact.minutesAheadOfPromise,
  };
}

/** The totals of one run: `requested` packages, of which `rows` were matched and delivered. */
export function runTotals(rows: readonly PackageComparison[], requested: number, a: AssumptionValues): ComparisonTotals {
  const exact = emptyExact();
  exact.packages = requested;
  for (const row of rows) {
    exact.matched += 1;
    exact.direct += row.kind === 'direct' ? 1 : 0;
    exact.relay += row.kind === 'relay' ? 1 : 0;
    exact.relayCostCents += row.relayCostCents;
    exact.courierCostCents += row.courierCostCents;
    exact.relayAddedM += row.relayAddedM;
    exact.courierTripM += row.courierTripM;
    exact.early += row.timing === 'early' ? 1 : 0;
    exact.onTime += row.timing === 'on_time' ? 1 : 0;
    exact.late += row.timing === 'late' ? 1 : 0;
    exact.minutesAheadOfPromise += row.minutesAheadOfPromise;
  }
  return withDerived(exact, a);
}

/** The totals of the study: the runs' whole-number fields added up, the rest derived from those sums. */
export function studyTotals(runs: readonly ComparisonTotals[], skippedRuns: number, a: AssumptionValues): StudyTotals {
  const exact = emptyExact();
  for (const totals of runs) {
    for (const key of EXACT_KEYS) exact[key] += totals[key];
  }
  return { runs: runs.length, skippedRuns, ...withDerived(exact, a) };
}

/** The page's headline numbers. "Per package" is per matched package; null when nothing was matched. */
export function headlineOf(totals: StudyTotals, a: AssumptionValues): StudyHeadline {
  const n = totals.matched;
  const relayKg = co2Kg(totals.relayAddedM, a.commuterCo2KgPerMile);
  const courierKg = co2Kg(totals.courierTripM, a.courierCo2KgPerMile);
  const cents = (total: number) => (n === 0 ? null : Math.round(total / n));
  return {
    runs: totals.runs,
    packages: totals.packages,
    matched: n,
    matchRate: totals.matchRate,
    relayCostPerPackageCents: cents(totals.relayCostCents),
    courierCostPerPackageCents: cents(totals.courierCostCents),
    costSavedPerPackageCents: cents(totals.costSavedCents),
    costSavedRate: rate(totals.costSavedCents, totals.courierCostCents),
    relayAddedMilesPerPackage: average(milesFromMeters(totals.relayAddedM), n, MILES_DECIMALS),
    courierMilesPerPackage: average(milesFromMeters(totals.courierTripM), n, MILES_DECIMALS),
    milesSavedPerPackage: average(milesFromMeters(totals.courierTripM - totals.relayAddedM), n, MILES_DECIMALS),
    milesSavedRate: rate(totals.courierTripM - totals.relayAddedM, totals.courierTripM),
    relayCo2KgPerPackage: average(relayKg, n, KG_DECIMALS),
    courierCo2KgPerPackage: average(courierKg, n, KG_DECIMALS),
    co2SavedKgPerPackage: average(courierKg - relayKg, n, KG_DECIMALS),
    co2SavedRate: rate(courierKg - relayKg, courierKg),
    onTimeOrEarlyRate: rate(totals.early + totals.onTime, n),
    earlyRate: rate(totals.early, n),
    lateRate: rate(totals.late, n),
    avgMinutesAheadOfPromise: average(totals.minutesAheadOfPromise, n, MINUTES_DECIMALS),
  };
}
