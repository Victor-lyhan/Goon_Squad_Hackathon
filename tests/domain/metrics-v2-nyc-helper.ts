// Shared by tests/domain/metrics-v2-nyc-*.test.ts (#531): the MVP II metrics on the REAL committed NYC cache.
// - `buildNycRun(request)` builds a run the way the server does: readNycFixtures + buildNycScenario + createInitialRun
//   (server/api/v2/bootRun.ts builds the default run with exactly these), travel from createCachedProvider over the
//   committed fixtures/nyc/matrix.json and polylines.json. No key, no network, nothing written. The run is frozen,
//   so a function that changes its input throws instead of passing unnoticed.
// - `sweep(built)` calls the real `snapshotAt` at every whole minute from the start of Day 1 (0) to the end of
//   Day 2 (2880), and `computeMetrics` itself on each snapshot's occurred events.
// - `sourceOfProjected` / `sourceOfActuals` recompute every Metrics field from the plans, jobs, shipments and
//   settings themselves, in other code than server/domain/v2/metrics.ts, so the tests compare two derivations.
// - `describeDayRules` and `describeCompareRules` hold the rules once; the default run and every Random city
//   seed go through the same ones.
// Story IDs, names and counts are never pinned (DECISIONS pass 54): every expectation is read from the run.
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompareResponse } from '../../shared/v2/api';
import type {
  DeliveryPlan, Job, Metrics, Run, Settings, Shipment, Snapshot, TravelProvider, UnmatchedReason,
} from '../../shared/v2/types';
import { GenerateScenarioRequest } from '../../shared/v2/schemas';
import { NYC_FIXTURES_DIR, readNycFixtures } from '../../server/api/v2/bootRun';
import { compareRun } from '../../server/api/v2/compareOps';
import { createInitialRun } from '../../server/api/v2/initialRun';
import { buildNycScenario } from '../../server/domain/v2/generator';
import { computeMetrics } from '../../server/domain/v2/metrics';
import { buildTimeline } from '../../server/domain/v2/timeline';
import { snapshotAt } from '../../server/domain/v2/simulation';
import { readTravelFiles } from '../../server/geo/cache';
import { createCachedProvider } from '../../server/geo/providers';

/**
 * Per test and hook (DECISIONS pass 19 and 52: explicit, far above 10x the local time). One build plus a full
 * two-day sweep of 2881 snapshots takes about 0.2 s locally. No test here asserts a duration.
 */
export const METRICS_TIMEOUT_MS = 60_000;

/** Start of Day 1 and end of Day 2, in minutes since Day 1 00:00 (AGENTS hard rule: integer minutes). */
export const DAY_1_START_MIN = 0;
export const DAY_2_END_MIN = 2 * 24 * 60;

/** The default run's request: the demo preset, every other value the contract default (as DEFAULT_RUN_REQUEST). */
export const DEFAULT_REQUEST: GenerateScenarioRequest = GenerateScenarioRequest.parse({ preset: 'demo' });

/** Three Random city seeds on the same cache. Any whole numbers do: the rules must hold for all of them. */
export const RANDOM_SEEDS = [7, 2026, 90_210] as const;

export const randomRequest = (seed: number): GenerateScenarioRequest =>
  GenerateScenarioRequest.parse({ preset: 'random', seed });

/** The default run and the three Random cities, by the name the tests show. */
export const NYC_RUNS: ReadonlyArray<{ title: string; request: GenerateScenarioRequest }> = [
  { title: 'default NYC run', request: DEFAULT_REQUEST },
  ...RANDOM_SEEDS.map(seed => ({ title: `Random city, seed ${seed}`, request: randomRequest(seed) })),
];

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export type NycRun = { run: Run; travel: TravelProvider };

/** A frozen run on the committed cache. A place pair the cache lacks throws TravelDataMissingError: nothing is estimated. */
export function buildNycRun(request: GenerateScenarioRequest): NycRun {
  const files = readTravelFiles(NYC_FIXTURES_DIR);
  if (!files) throw new Error('fixtures/nyc has no travel cache (matrix.json and polylines.json)');
  const travel = createCachedProvider(files);
  const scenario = buildNycScenario({ ...readNycFixtures(NYC_FIXTURES_DIR), places: files.matrix.places, request });
  return { run: deepFreeze(createInitialRun(scenario, { travel, buildEvents: buildTimeline })), travel };
}

export type Moment = Pick<Snapshot, 'timeMin' | 'metrics' | 'occurredEvents' | 'shipmentStatus' | 'deliveredAtMin' | 'earningsCents'> & {
  /** `computeMetrics` called here, on the run's own lists and the snapshot's occurred events. */
  computed: Metrics;
};

/** One moment: the real `snapshotAt` at `timeMin`, and `computeMetrics` on what that snapshot says has occurred. */
export function momentAt({ run, travel }: NycRun, timeMin: number): Moment {
  const { metrics, occurredEvents, shipmentStatus, deliveredAtMin, earningsCents } = snapshotAt(run, timeMin, travel);
  const computed = computeMetrics({
    shipments: run.scenario.shipments, plans: run.assignments.plans, unmatched: run.assignments.unmatched,
    occurredEvents, settings: run.scenario.settings,
  });
  return { timeMin, metrics, occurredEvents, shipmentStatus, deliveredAtMin, earningsCents, computed };
}

/** Every whole minute of the two days, first to last (2881 moments). */
export function sweep(built: NycRun): Moment[] {
  const moments: Moment[] = [];
  for (let timeMin = DAY_1_START_MIN; timeMin <= DAY_2_END_MIN; timeMin += 1) moments.push(momentAt(built, timeMin));
  return moments;
}

// ---------- the Metrics contract (shared/types.ts) ----------

/** Known when planning ends: the same at every minute of the run. */
export const PROJECTED_FIELDS = [
  'requested', 'matched', 'direct', 'relay', 'unmatched', 'avgExtraMinPerTrip', 'maxExtraMin',
  'projectedCustomerSavingsCents', 'projectedCustomerSpendCents', 'projectedPlatformContributionCents',
  'extraDistanceM',
] as const;
/** Realized by the simulation: 0 before the first event, never smaller later. */
export const ACTUAL_FIELDS = ['delivered', 'earnedRewardsCents', 'earnedPlatformContributionCents'] as const;
/** The contract allows null here, and only here: when no trip carries anything there is no average and no maximum. */
export const NULLABLE_FIELDS: readonly string[] = ['avgExtraMinPerTrip', 'maxExtraMin'];

const ALL_FIELDS: readonly string[] = [...PROJECTED_FIELDS, ...ACTUAL_FIELDS].sort();

/**
 * Every way `metrics` breaks the number rules, as sentences (empty = fine): exactly the contract's fields,
 * each a finite number that is not negative (null only where the contract allows it); counts, cents, the
 * maximum of whole minutes and meters are whole numbers. Only the average may have a fraction.
 */
export function numberProblems(metrics: Metrics): string[] {
  const problems: string[] = [];
  const record = metrics as unknown as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join() !== ALL_FIELDS.join()) problems.push(`fields are ${keys.join()}, expected ${ALL_FIELDS.join()}`);
  for (const key of keys) {
    const value = record[key];
    if (value === null) {
      if (!NULLABLE_FIELDS.includes(key)) problems.push(`${key} is null`);
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      problems.push(`${key} is not a finite number (${String(value)})`);
    } else if (value < 0) {
      problems.push(`${key} is negative (${value})`);
    } else if (key !== 'avgExtraMinPerTrip' && !Number.isInteger(value)) {
      problems.push(`${key} is not a whole number (${value})`);
    }
  }
  return problems;
}

// ---------- the source: plans, jobs, shipments, settings ----------

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** The legs that carry a package. */
export const legsOf = (plans: DeliveryPlan[]) => plans.flatMap(plan => plan.legs);

export type PlanningLists = {
  shipments: Shipment[]; plans: DeliveryPlan[]; unmatched: UnmatchedReason[]; settings: Settings;
};

export const planningListsOf = (run: Run): PlanningLists => ({
  shipments: run.scenario.shipments, plans: run.assignments.plans, unmatched: run.assignments.unmatched,
  settings: run.scenario.settings,
});

/**
 * The projected fields recomputed from their sources: counts from the shipments, plans and unmatched list,
 * the average and the maximum from the legs' own `extraMin`, money from the plans' own cents fields and the
 * courier price of the settings.
 *
 * Extra distance: on real Google routes a leg's own `extraDistanceM` can be negative (the route through the
 * stops takes longer but is shorter in meters than the fastest commute; QUESTIONS pass 57). The summary counts
 * such a trip as 0 extra meters, never as a saving, so the total cannot go below zero. That is the rule here:
 * the sum of the legs' extra meters, each floored at 0.
 */
export function sourceOfProjected({ shipments, plans, unmatched, settings }: PlanningLists): Pick<Metrics, (typeof PROJECTED_FIELDS)[number]> {
  const legs = legsOf(plans);
  return {
    requested: shipments.length,
    matched: plans.length,
    direct: plans.filter(plan => plan.kind === 'direct').length,
    relay: plans.filter(plan => plan.kind === 'relay').length,
    unmatched: unmatched.length,
    avgExtraMinPerTrip: legs.length === 0 ? null : sum(legs.map(leg => leg.extraMin)) / legs.length,
    maxExtraMin: legs.length === 0 ? null : legs.map(leg => leg.extraMin).sort((a, b) => b - a)[0]!,
    projectedCustomerSavingsCents: sum(plans.map(plan => Math.max(0, settings.courierPriceCents - plan.customerPriceCents))),
    projectedCustomerSpendCents: sum(plans.map(plan => plan.customerPriceCents)) + unmatched.length * settings.courierPriceCents,
    projectedPlatformContributionCents: sum(plans.map(plan => plan.platformContributionCents)),
    extraDistanceM: sum(legs.map(leg => Math.max(0, leg.extraDistanceM))),
  };
}

/**
 * The actual fields at `timeMin`, recomputed from the plans' and jobs' own stop times instead of the event list:
 * a package is delivered once its plan's `deliveryMin` has passed, a job has earned its own `rewardCents` once
 * the handling of its drop-off has ended, and a delivered plan has realized its own `platformContributionCents`.
 */
export function sourceOfActuals(
  { plans, jobs }: { plans: DeliveryPlan[]; jobs: Job[] }, timeMin: number,
): Pick<Metrics, (typeof ACTUAL_FIELDS)[number]> {
  const delivered = plans.filter(plan => plan.deliveryMin <= timeMin);
  return {
    delivered: delivered.length,
    earnedRewardsCents: sum(jobs.filter(job => job.dropoff.serviceEndMin <= timeMin).map(job => job.rewardCents)),
    earnedPlatformContributionCents: sum(delivered.map(plan => plan.platformContributionCents)),
  };
}

/** `metrics` reduced to the named fields, so two derivations compare with one `toEqual` and a readable diff. */
export function pick<K extends keyof Metrics>(metrics: Metrics, fields: readonly K[]): Pick<Metrics, K> {
  return Object.fromEntries(fields.map(field => [field, metrics[field]])) as Pick<Metrics, K>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const shown = (value: unknown) => JSON.stringify(value);

/**
 * Runs `check` on every moment and returns the first problems as "minute <t>: <sentence>" (empty = the rule
 * holds at every minute). A handful is enough to read; a broken rule usually breaks at hundreds of minutes.
 */
export function problemsOver(
  moments: Moment[], check: (moment: Moment, index: number) => string | string[] | null | undefined,
): string[] {
  const problems: string[] = [];
  for (let index = 0; index < moments.length && problems.length < 5; index += 1) {
    const found = check(moments[index]!, index);
    for (const problem of found == null ? [] : [found].flat()) problems.push(`minute ${moments[index]!.timeMin}: ${problem}`);
  }
  return problems;
}

// ---------- the rules of a whole day ----------

/** The rules of the summary numbers over the two days of one run. Registers a `describe` block. */
export function describeDayRules(title: string, request: GenerateScenarioRequest): void {
  describe(`MVP II metrics over two days: ${title}`, () => {
    let built: NycRun;
    let run: Run;
    let moments: Moment[];
    let lists: PlanningLists;

    beforeAll(() => {
      built = buildNycRun(request);
      run = built.run;
      lists = planningListsOf(run);
      moments = sweep(built);
    }, METRICS_TIMEOUT_MS);

    it('has one moment per minute from Day 1 00:00 to the end of Day 2, and a run with something to measure', () => {
      expect(moments.map(moment => moment.timeMin)).toEqual(
        Array.from({ length: DAY_2_END_MIN - DAY_1_START_MIN + 1 }, (_, index) => DAY_1_START_MIN + index),
      );
      // Not a pinned count: with no plan and no event every rule below would hold for an empty summary.
      expect(run.assignments.plans.length, 'the run matched nothing; pick another seed').toBeGreaterThan(0);
      expect(run.events.length).toBeGreaterThan(0);
      // The simulated day lies inside the two days, so the sweep covers the clock's whole range.
      const { simStartMin, simEndMin } = run.scenario.settings;
      expect(simStartMin).toBeGreaterThanOrEqual(DAY_1_START_MIN);
      expect(simEndMin).toBeGreaterThan(simStartMin);
      expect(simEndMin).toBeLessThanOrEqual(DAY_2_END_MIN);
    }, METRICS_TIMEOUT_MS);

    it('every field is a finite number at every minute: no NaN, nothing negative, whole counts, whole cents', () => {
      expect(problemsOver(moments, ({ metrics }) => numberProblems(metrics))).toEqual([]);
    }, METRICS_TIMEOUT_MS);

    it('delivered <= matched <= requested at every minute, and the parts add up to the whole', () => {
      expect(problemsOver(moments, ({ metrics: m }) => [
        ...(m.delivered <= m.matched && m.matched <= m.requested
          ? [] : [`delivered ${m.delivered}, matched ${m.matched}, requested ${m.requested}`]),
        ...(m.matched + m.unmatched === m.requested ? [] : [`matched ${m.matched} + unmatched ${m.unmatched} is not requested ${m.requested}`]),
        ...(m.direct + m.relay === m.matched ? [] : [`direct ${m.direct} + relay ${m.relay} is not matched ${m.matched}`]),
        ...(m.earnedPlatformContributionCents <= m.projectedPlatformContributionCents
          ? [] : [`earned contribution ${m.earnedPlatformContributionCents} is above the projected ${m.projectedPlatformContributionCents}`]),
      ])).toEqual([]);
    }, METRICS_TIMEOUT_MS);

    it('the snapshot carries what computeMetrics returns for its own occurred events, at every minute', () => {
      expect(problemsOver(moments, ({ metrics, computed }) =>
        same(metrics, computed) ? null : `snapshot ${shown(metrics)} but computeMetrics ${shown(computed)}`)).toEqual([]);
    }, METRICS_TIMEOUT_MS);

    it('projected fields equal their source (plans, shipments, settings) and do not change with time', () => {
      // One package per trip: the mean over the legs is the mean over the used trips.
      const tripIds = legsOf(lists.plans).map(leg => leg.tripId);
      expect(new Set(tripIds).size).toBe(tripIds.length);

      const source = sourceOfProjected(lists);
      expect(pick(moments[0]!.metrics, PROJECTED_FIELDS)).toEqual(source);
      expect(problemsOver(moments, ({ metrics }) => {
        const projected = pick(metrics, PROJECTED_FIELDS);
        return same(projected, source) ? null : `projected fields ${shown(projected)} differ from the source ${shown(source)}`;
      })).toEqual([]);
    }, METRICS_TIMEOUT_MS);

    it('the average extra minutes is the mean of the legs\' own extraMin, and the maximum is the largest of them', () => {
      const extras = legsOf(lists.plans).map(leg => leg.extraMin);
      const { avgExtraMinPerTrip, maxExtraMin } = moments[0]!.metrics;
      expect(avgExtraMinPerTrip).not.toBeNull();
      expect(avgExtraMinPerTrip).toBeCloseTo(extras.reduce((total, extra) => total + extra, 0) / extras.length, 9);
      expect(maxExtraMin).toBe(Math.max(...extras));
      // The average lies between the smallest and the largest leg, and no carrier exceeds their own limit.
      expect(avgExtraMinPerTrip!).toBeGreaterThanOrEqual(Math.min(...extras));
      expect(avgExtraMinPerTrip!).toBeLessThanOrEqual(maxExtraMin!);
      const limitOf = new Map(run.scenario.employees.map(employee => [employee.id, employee.maxExtraMin]));
      expect(maxExtraMin!).toBeLessThanOrEqual(Math.max(...legsOf(lists.plans).map(leg => limitOf.get(leg.employeeId)!)));
    }, METRICS_TIMEOUT_MS);

    it('extra distance never goes below zero: a leg that is shorter in meters than its commute counts as 0', () => {
      const meters = legsOf(lists.plans).map(leg => leg.extraDistanceM);
      const rawSum = meters.reduce((total, value) => total + value, 0);
      const { extraDistanceM } = moments[0]!.metrics;
      expect(extraDistanceM).toBe(meters.reduce((total, value) => total + Math.max(0, value), 0));
      expect(extraDistanceM).toBeGreaterThanOrEqual(Math.max(0, rawSum));
      // With no shorter leg (every leg on a synthetic grid) it is the plain sum.
      if (meters.every(value => value >= 0)) expect(extraDistanceM).toBe(rawSum);
    }, METRICS_TIMEOUT_MS);

    it('actual fields are 0 at Day 1 00:00, when the clock starts and until the first event', () => {
      const zero = { delivered: 0, earnedRewardsCents: 0, earnedPlatformContributionCents: 0 };
      const firstEventMin = Math.min(...run.events.map(event => event.timeMin));
      const quietUntil = Math.max(run.scenario.settings.simStartMin, firstEventMin - 1);
      expect(firstEventMin).toBeGreaterThan(run.scenario.settings.simStartMin);
      expect(pick(moments[0]!.metrics, ACTUAL_FIELDS)).toEqual(zero);
      expect(problemsOver(moments.filter(moment => moment.timeMin <= quietUntil), ({ metrics }) => {
        const actual = pick(metrics, ACTUAL_FIELDS);
        return same(actual, zero) ? null : `actual fields are ${shown(actual)} before anything happened`;
      })).toEqual([]);
    }, METRICS_TIMEOUT_MS);

    it('actual fields never go down, and the summary changes only at a minute with an event', () => {
      const eventMinutes = new Set(run.events.map(event => event.timeMin));
      expect(problemsOver(moments, ({ metrics, timeMin }, index) => {
        if (index === 0) return null;
        const before = moments[index - 1]!.metrics;
        const fell = ACTUAL_FIELDS.filter(field => metrics[field] < before[field]);
        if (fell.length > 0) return fell.map(field => `${field} fell from ${before[field]} to ${metrics[field]}`);
        return eventMinutes.has(timeMin) || same(metrics, before) ? null : 'the summary changed at a minute with no event';
      })).toEqual([]);
    }, METRICS_TIMEOUT_MS);

    it('actual fields equal the plans\' and jobs\' own stop times and cents at every minute', () => {
      expect(problemsOver(moments, ({ metrics, timeMin }) => {
        const actual = pick(metrics, ACTUAL_FIELDS);
        const source = sourceOfActuals({ plans: lists.plans, jobs: run.jobs }, timeMin);
        return same(actual, source) ? null : `actual fields ${shown(actual)} differ from the source ${shown(source)}`;
      })).toEqual([]);
    }, METRICS_TIMEOUT_MS);

    it('the numbers agree with the rest of the snapshot: package statuses, delivery times, employee earnings', () => {
      expect(problemsOver(moments, ({ metrics: m, shipmentStatus, deliveredAtMin, earningsCents }) => {
        const statuses = Object.values(shipmentStatus);
        const deliveredStatuses = statuses.filter(status => status === 'delivered').length;
        const unmatchedStatuses = statuses.filter(status => status === 'unmatched').length;
        const earned = Object.values(earningsCents).reduce((total, cents) => total + cents, 0);
        return [
          ...(statuses.length === m.requested ? [] : [`${statuses.length} package statuses for ${m.requested} requested`]),
          ...(deliveredStatuses === m.delivered ? [] : [`${deliveredStatuses} packages have status delivered, the summary says ${m.delivered}`]),
          ...(Object.keys(deliveredAtMin).length === m.delivered ? [] : [`${Object.keys(deliveredAtMin).length} delivery times for ${m.delivered} delivered`]),
          ...(unmatchedStatuses === m.unmatched ? [] : [`${unmatchedStatuses} packages have status unmatched, the summary says ${m.unmatched}`]),
          ...(earned === m.earnedRewardsCents ? [] : [`employees earned ${earned} cents, the summary says ${m.earnedRewardsCents}`]),
        ];
      })).toEqual([]);
    }, METRICS_TIMEOUT_MS);

    it('when the simulated day ends, and at the last minute, every matched package is delivered and paid', () => {
      const allRewards = run.jobs.reduce((total, job) => total + job.rewardCents, 0);
      const legRewards = legsOf(lists.plans).reduce((total, leg) => total + leg.rewardCents, 0);
      expect(allRewards).toBe(legRewards);
      for (const timeMin of [run.scenario.settings.simEndMin, DAY_2_END_MIN]) {
        const { metrics } = moments[timeMin - DAY_1_START_MIN]!;
        expect(metrics.delivered, `delivered at minute ${timeMin}`).toBe(metrics.matched);
        expect(metrics.earnedRewardsCents, `rewards at minute ${timeMin}`).toBe(allRewards);
        expect(metrics.earnedPlatformContributionCents, `contribution at minute ${timeMin}`)
          .toBe(metrics.projectedPlatformContributionCents);
      }
      expect(moments.at(-1)!.metrics).toEqual(moments[run.scenario.settings.simEndMin - DAY_1_START_MIN]!.metrics);
    }, METRICS_TIMEOUT_MS);
  });
}

// ---------- the rules of the direct-only comparison ----------

/** The comparison of one run, as POST /api/v2/matches/compare computes it (server/api/v2/compareOps.ts). */
export function compareNycRun({ run, travel }: NycRun): CompareResponse {
  const compared = compareRun(run, travel, {});
  if (compared.kind !== 'ok') throw new Error(`the comparison was refused: ${compared.error.error}`);
  return compared.response;
}

/** The rules of both halves of the direct-only comparison of one run. Registers a `describe` block. */
export function describeCompareRules(title: string, request: GenerateScenarioRequest): void {
  describe(`MVP II direct-only comparison: ${title}`, () => {
    let built: NycRun;
    let run: Run;
    let response: CompareResponse;
    let halves: Array<{ name: string; side: CompareResponse['directOnly'] }>;

    beforeAll(() => {
      built = buildNycRun(request);
      run = built.run;
      response = compareNycRun(built);
      halves = [{ name: 'direct only', side: response.directOnly }, { name: 'with relay', side: response.withRelay }];
    }, METRICS_TIMEOUT_MS);

    it('both halves: every field is a finite number, nothing negative, whole counts and whole cents', () => {
      for (const { name, side } of halves) expect(numberProblems(side.metrics), name).toEqual([]);
    }, METRICS_TIMEOUT_MS);

    it('both halves answer for every requested package exactly once: matched + unmatched = requested', () => {
      const requestedIds = run.scenario.shipments.map(shipment => shipment.id).sort();
      for (const { name, side } of halves) {
        const answered = [
          ...side.result.plans.map(plan => plan.shipmentId), ...side.result.unmatched.map(row => row.shipmentId),
        ].sort();
        expect(answered, name).toEqual(requestedIds);
        const m = side.metrics;
        expect(m.matched + m.unmatched, name).toBe(m.requested);
        expect(m.direct + m.relay, name).toBe(m.matched);
        expect(m.matched, name).toBeLessThanOrEqual(m.requested);
      }
    }, METRICS_TIMEOUT_MS);

    it('both halves: the numbers equal their own result (plans, unmatched list) and the run\'s settings', () => {
      for (const { name, side } of halves) {
        const source = sourceOfProjected({
          shipments: run.scenario.shipments, plans: side.result.plans, unmatched: side.result.unmatched,
          settings: run.scenario.settings,
        });
        expect(pick(side.metrics, PROJECTED_FIELDS), name).toEqual(source);
      }
    }, METRICS_TIMEOUT_MS);

    it('both halves are projections: nothing is delivered or earned yet', () => {
      for (const { name, side } of halves) {
        expect(pick(side.metrics, ACTUAL_FIELDS), name)
          .toEqual({ delivered: 0, earnedRewardsCents: 0, earnedPlatformContributionCents: 0 });
      }
    }, METRICS_TIMEOUT_MS);

    it('direct only has no relay plan, and with relay matches at least as many packages', () => {
      const direct = response.directOnly;
      const relay = response.withRelay;
      expect(direct.metrics.relay).toBe(0);
      expect(direct.result.plans.every(plan => plan.kind === 'direct' && plan.legs.length === 1)).toBe(true);
      expect(relay.metrics.matched).toBeGreaterThanOrEqual(direct.metrics.matched);
      expect(relay.metrics.unmatched).toBeLessThanOrEqual(direct.metrics.unmatched);
      // The headline of the comparison ("relay matches N more") is the same from either column.
      expect(relay.metrics.matched - direct.metrics.matched).toBe(direct.metrics.unmatched - relay.metrics.unmatched);
      expect(relay.metrics.requested).toBe(direct.metrics.requested);
    }, METRICS_TIMEOUT_MS);

    it('matching more packages never costs the customers more, while Relay is not dearer than the courier', () => {
      const { priceCents, courierPriceCents } = run.scenario.settings;
      const direct = response.directOnly.metrics;
      const relay = response.withRelay.metrics;
      if (priceCents <= courierPriceCents) {
        expect(relay.projectedCustomerSpendCents).toBeLessThanOrEqual(direct.projectedCustomerSpendCents);
        expect(relay.projectedCustomerSavingsCents).toBeGreaterThanOrEqual(direct.projectedCustomerSavingsCents);
        // Each package costs the courier price, either paid to the courier or split into Relay's price and the saving.
        for (const m of [direct, relay]) {
          expect(m.projectedCustomerSpendCents + m.projectedCustomerSavingsCents).toBe(m.requested * courierPriceCents);
        }
      }
    }, METRICS_TIMEOUT_MS);

    it('the with-relay half shows the same projected numbers as the run\'s own summary', () => {
      const summary = momentAt(built, run.scenario.settings.simStartMin).metrics;
      expect(pick(response.withRelay.metrics, PROJECTED_FIELDS)).toEqual(pick(summary, PROJECTED_FIELDS));
    }, METRICS_TIMEOUT_MS);
  });
}
