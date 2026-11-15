// The shape of `data/study/results.json`, written by `npm run study` (MVP IV F3, docs/mvp4.md).
//
// The study runs many full Relay simulations on the committed NYC travel cache and compares every package
// Relay matched with a traditional courier baseline: one dedicated next-day courier trip, sender -> recipient.
//
// Rules of the file:
// - Deterministic: no timestamp, no measured duration. Same cache, fixtures, grid and assumptions give a
//   byte-identical file.
// - Exact fields are whole numbers in the project's units: money in integer cents, distance in meters, time in
//   minutes since Day 1 00:00 (Day 2 = +1440). Every total of an exact field is the plain sum of its parts
//   (packages -> run totals -> study totals).
// - Miles and kg CO2 are output conversions of the exact meters, rounded to 3 decimals. A total's miles and kg
//   are converted from the total's meters, so they can differ from the sum of rounded parts in the last decimal.
// - Rates are fractions from 0 to 1, rounded to 4 decimals. A value that has no meaning (an average over zero
//   matched packages) is null, never NaN.
// - Every number the comparison uses that is not travel data or engine output is in `assumptions`.

/** The keys of `assumptions`. The math reads its constants only through these (scripts/study/assumptions.ts). */
export type AssumptionKey =
  | 'legRewardCents'
  | 'hubCostCents'
  | 'platformFeeCents'
  | 'flexDiscountCents'
  | 'flexWindowMin'
  | 'courierEnvelopeCents'
  | 'courierSmallBoxCents'
  | 'courierPromisedByMin'
  | 'courierTripSharePerPackage'
  | 'courierEmptyMilesPerLoadedMile'
  | 'relayCommuteMilesShare'
  | 'relayMinAddedMPerLeg'
  | 'commuterCo2KgPerMile'
  | 'courierCo2KgPerMile';

/** One number the study uses, with the reason it has this value. The page shows all of them. */
export type Assumption = {
  key: AssumptionKey;
  /** Short name for the assumptions table. */
  label: string;
  value: number;
  /** What `value` is counted in, e.g. "cents per package". */
  unit: string;
  /** One sentence: why this value is plausible, and which side it favours. */
  reason: string;
};

/** The settings of one simulation: one Random city of the NYC generator (`preset: 'random'`). */
export type RunParams = {
  seed: number;
  /** Number of commuting employees. */
  employees: number;
  /** Number of packages requested. */
  packages: number;
  /** Detour limit: the most minutes a package may add to one commute. */
  maxExtraMin: number;
};

/** A run that needed a place pair the travel cache does not have. It is not simulated and not in `runs`. */
export type SkippedRun = {
  /** `s<seed>-e<employees>-p<packages>-d<maxExtraMin>`. */
  id: string;
  params: RunParams;
  /** Which pair was missing, e.g. "No travel matrix data for biz-a|home-001". */
  reason: string;
};

/** What was run: every combination of the four lists, in this nesting order (seed outermost). */
export type StudyGrid = {
  preset: 'random';
  seeds: number[];
  employeeCounts: number[];
  packageCounts: number[];
  detourLimitsMin: number[];
  /**
   * When the simulated packages were requested, read from the generated scenarios (minutes since Day 1 00:00):
   * the earliest ready time and the latest deadline over every package of every completed run. Relay only
   * accepts a package it can deliver by its deadline, so when the latest deadline is before the courier's
   * promised time no matched package can be late; the price of that rule is the match rate.
   * Null when no run completed.
   */
  requestWindow: { earliestReadyMin: number; latestDeadlineMin: number } | null;
  /** seeds x employeeCounts x packageCounts x detourLimitsMin. */
  plannedRuns: number;
  /** Runs that were simulated; equals `runs.length`. */
  completedRuns: number;
  /** Runs left out because the cache lacks a pair they need. plannedRuns = completedRuns + skippedRuns.length. */
  skippedRuns: SkippedRun[];
};

/**
 * Relay's delivery time against the courier's promise ("next business day by 10:30 a.m."):
 * - `early`: delivered on Day 1, the day it was sent, so a day ahead of the courier's window.
 * - `on_time`: delivered on Day 2 at or before the promised time.
 * - `late`: delivered after the promised time.
 */
export type Timing = 'early' | 'on_time' | 'late';

/** One package Relay matched and delivered in a run, next to the courier baseline for the same package. */
export type PackageComparison = {
  shipmentId: string;
  category: 'envelope' | 'small_box';
  /** How Relay carried it: one commute, or two commutes with an overnight relay point. */
  kind: 'direct' | 'relay';
  originBusinessId: string;
  destinationBusinessId: string;

  // Cost to the sender, integer cents.
  /** The plan's `customerPriceCents`. */
  relayCostCents: number;
  /** The courier price for this category. */
  courierCostCents: number;
  /** courierCostCents - relayCostCents. */
  costSavedCents: number;

  // Added vehicle distance. Meters are exact; miles are the same value converted for output.
  /** Meters Relay adds to traffic: the carriers' detours (the legs' `extraDistanceM`, each floored). */
  relayAddedM: number;
  /** Meters of the courier's dedicated trip, from the travel matrix. */
  courierTripM: number;
  relayAddedMiles: number;
  courierMiles: number;
  /** courierMiles - relayAddedMiles, from the exact meters. */
  milesSaved: number;

  // CO2 in kg: miles x the per-mile factor of the vehicle.
  relayCo2Kg: number;
  courierCo2Kg: number;
  co2SavedKg: number;

  // Delivery time, minutes since Day 1 00:00.
  /** When the simulation delivered the package. */
  deliveredAtMin: number;
  /** The end of the courier's promised window. */
  courierPromisedByMin: number;
  /** courierPromisedByMin - deliveredAtMin: positive when Relay is ahead of the courier's promise. */
  minutesAheadOfPromise: number;
  timing: Timing;
};

/** Sums over a set of packages: one run (`runs[i].totals`) or the whole study (`totals`). */
export type ComparisonTotals = {
  /** Packages requested. */
  packages: number;
  /** Packages Relay matched and delivered; the comparison covers exactly these. */
  matched: number;
  /** packages - matched. Relay found no commute; these would go by courier and are not compared. */
  unmatched: number;
  /** matched / packages. */
  matchRate: number | null;
  /** Matched packages by kind: direct + relay = matched. */
  direct: number;
  relay: number;

  relayCostCents: number;
  courierCostCents: number;
  costSavedCents: number;

  relayAddedM: number;
  courierTripM: number;
  relayAddedMiles: number;
  courierMiles: number;
  milesSaved: number;

  relayCo2Kg: number;
  courierCo2Kg: number;
  co2SavedKg: number;

  /** Matched packages by timing: early + onTime + late = matched. */
  early: number;
  onTime: number;
  late: number;
  /** Sum of the packages' `minutesAheadOfPromise`. */
  minutesAheadOfPromise: number;
};

/** One completed simulation. */
export type StudyRun = {
  /** `s<seed>-e<employees>-p<packages>-d<maxExtraMin>`. */
  id: string;
  params: RunParams;
  /** One row per matched package, in the order of the run's plans. */
  packages: PackageComparison[];
  totals: ComparisonTotals;
};

/** The whole study: every field of the completed runs' totals added up. */
export type StudyTotals = ComparisonTotals & {
  /** Completed runs. */
  runs: number;
  skippedRuns: number;
};

/** The numbers for the top of the page. "Per package" always means per matched package. */
export type StudyHeadline = {
  runs: number;
  packages: number;
  matched: number;
  matchRate: number | null;

  /** Whole cents, rounded. */
  relayCostPerPackageCents: number | null;
  courierCostPerPackageCents: number | null;
  costSavedPerPackageCents: number | null;
  /** costSavedCents / courierCostCents. */
  costSavedRate: number | null;

  relayAddedMilesPerPackage: number | null;
  courierMilesPerPackage: number | null;
  milesSavedPerPackage: number | null;
  /** (courierTripM - relayAddedM) / courierTripM. */
  milesSavedRate: number | null;

  relayCo2KgPerPackage: number | null;
  courierCo2KgPerPackage: number | null;
  co2SavedKgPerPackage: number | null;
  co2SavedRate: number | null;

  /** (early + onTime) / matched: delivered no later than the courier's promise. */
  onTimeOrEarlyRate: number | null;
  /** early / matched: delivered a day ahead of the courier. */
  earlyRate: number | null;
  lateRate: number | null;
  /** Average minutes ahead of the courier's promise, 1 decimal. */
  avgMinutesAheadOfPromise: number | null;
};

/** `data/study/results.json`. */
export type StudyResults = {
  assumptions: Assumption[];
  grid: StudyGrid;
  runs: StudyRun[];
  totals: StudyTotals;
  headline: StudyHeadline;
};
