// server/api/v2/storyFirst.ts (#966): matching on a demo run that has more employees than its story.
// The data is the made-up sample cache of v2-boot-sample.ts (no network, no committed travel time). The order:
//   1. the story's packages on the story's employees only, 2. sent requests on the story's employees,
//   3. the requests that have no plan on every commute.
// A variant with some of the story's employees unavailable leaves story packages without a plan, so the rule
// "a story package is never given to an added employee" is exercised too.
// Rules only: no shipment or employee ID of the story is pinned (DECISIONS pass 54).
import { describe, expect, it } from 'vitest';
import { GenerateScenarioRequest } from '../../shared/v2/schemas';
import type { DeliveryPlan, Run as RunV2, Scenario, Shipment } from '../../shared/v2/types';
import { buildDefaultRun } from '../../server/api/v2/bootRun';
import { createInitialRun } from '../../server/api/v2/initialRun';
import { matchContext, matchEverything, matchPending, type PipelineDeps } from '../../server/api/v2/pipeline';
import { beginNewCycle, clearForRecompute } from '../../server/api/v2/planningOps';
import { assignStoryFirst, matchTiers, storyPart, STORY_EMPLOYEES } from '../../server/api/v2/storyFirst';
import { buildNycScenario, generatedRequestId } from '../../server/domain/v2/generator';
import { assignShipments } from '../../server/domain/v2/matching';
import { checkPlans } from '../../server/domain/v2/planCheck';
import { buildTimeline } from '../../server/domain/v2/timeline';
import { deepFreeze } from './v2-sample';
import { bootSample } from './v2-boot-sample';

/** Explicit limit (DECISIONS pass 19): the slowest test here matches a 120-employee city a few times, about 0.3 s locally. */
const T = 20_000;

const sample = bootSample();
const deps: PipelineDeps = { travel: sample.travel, buildEvents: buildTimeline };

function scenarioOf(request: Partial<GenerateScenarioRequest> & Pick<GenerateScenarioRequest, 'preset'>): Scenario {
  return buildNycScenario({ ...sample.fixtures, places: sample.places, request: GenerateScenarioRequest.parse(request) });
}
const runOf = (scenario: Scenario): RunV2 => createInitialRun(scenario, deps);

/** The demo with the story's employees only, and the same demo with all 120. */
const storyOnly = runOf(scenarioOf({ preset: 'demo' }));
const full = runOf(scenarioOf({ preset: 'demo', employees: 120 }));
const storyIds = new Set(full.scenario.employees.slice(0, STORY_EMPLOYEES).map((employee) => employee.id));
const isAdded = (employeeId: string) => !storyIds.has(employeeId);
const planOf = (run: Pick<RunV2, 'assignments'>, shipmentId: string): DeliveryPlan | undefined =>
  run.assignments.plans.find((plan) => plan.shipmentId === shipmentId);

/** A request a business sends, between the two businesses of one of the run's packages. */
function sent(run: RunV2, like: Shipment, n: number): Shipment {
  const createdSeq = Math.max(...run.scenario.shipments.map((shipment) => shipment.createdSeq)) + 1;
  return { ...like, id: `shp-${createdSeq}`, clientRequestId: `sent-${n}`, label: `Sent ${n}`, createdSeq };
}

/** `run` with `shipment` added and matched the way POST /shipments does. A copy: `run` is not changed. */
function withRequest(run: RunV2, shipment: Shipment): RunV2 {
  const next = structuredClone(run);
  next.scenario.shipments.push(shipment);
  matchPending(next, [shipment.id], deps);
  return next;
}

describe('storyPart: which part of a run is the story', () => {
  it('is the contract\'s default employee count, and null when there is nothing to keep apart', () => {
    expect(STORY_EMPLOYEES).toBe(GenerateScenarioRequest.parse({ preset: 'demo' }).employees);
    expect(storyPart(storyOnly.scenario)).toBeNull();
    expect(storyPart(scenarioOf({ preset: 'demo', employees: 10 }))).toBeNull();
    expect(storyPart(scenarioOf({ preset: 'random', employees: 120 }))).toBeNull();
    expect(storyPart({ ...full.scenario, preset: 'custom' })).toBeNull();
  }, T);

  it('on a demo with added employees: the first 60 employees and the packages the generator made', () => {
    const part = storyPart(full.scenario);
    expect(part).not.toBeNull();
    expect([...part!.employeeIds]).toEqual(storyOnly.scenario.employees.map((employee) => employee.id));
    expect([...part!.shipmentIds]).toEqual(storyOnly.scenario.shipments.map((shipment) => shipment.id));
    // One employee more than the story's is enough.
    const oneMore = scenarioOf({ preset: 'demo', employees: STORY_EMPLOYEES + 1 });
    expect(storyPart(oneMore)?.employeeIds.has(oneMore.employees[STORY_EMPLOYEES]!.id)).toBe(false);
    expect(storyPart(oneMore)?.employeeIds.size).toBe(STORY_EMPLOYEES);
  }, T);

  it('a request a business sent is not part of the story, whatever its ID', () => {
    const request = sent(full, full.scenario.shipments[0]!, 1);
    const scenario = { ...full.scenario, shipments: [...full.scenario.shipments, request] };
    expect(storyPart(scenario)?.shipmentIds.has(request.id)).toBe(false);
    expect(storyPart(scenario)?.shipmentIds.size).toBe(full.scenario.shipments.length);
    // The generator's stamp is what marks a package as generated.
    for (const shipment of full.scenario.shipments) {
      expect(shipment.clientRequestId).toBe(generatedRequestId(full.scenario.seed, shipment.createdSeq));
    }
    expect(request.clientRequestId).not.toBe(generatedRequestId(full.scenario.seed, request.createdSeq));
  }, T);
});

describe('assignStoryFirst on a run with no story part', () => {
  it.each([
    ['a Random city of 120', scenarioOf({ preset: 'random', employees: 120 })],
    ['the demo with the story\'s employees only', storyOnly.scenario],
  ])('%s: one plain match, with the kept plans and the mode passed on', (_name, scenario) => {
    const run = runOf(scenario);
    const ctx = matchContext(run, sample.travel);
    expect(run.assignments.plans).toEqual(assignShipments(scenario.shipments, ctx).plans);
    expect(matchTiers(ctx, scenario)).toEqual([ctx]);
    for (const mode of ['with_relay', 'direct_only'] as const) {
      expect(assignStoryFirst(scenario.shipments, ctx, scenario, { mode })).toEqual(assignShipments(scenario.shipments, ctx, { mode }));
    }
    const existing = run.assignments.plans.slice(0, 3);
    expect(assignStoryFirst(scenario.shipments, ctx, scenario, { existing }))
      .toEqual(assignShipments(scenario.shipments, ctx, { existing }));
  }, T);
});

/**
 * The scenario with the story's employees of one package's two businesses not available, so the story's
 * employees cannot carry every package. The added employees (if the scenario has any) are left as they are.
 */
function short(scenario: Scenario): Scenario {
  const target = scenario.shipments[0]!;
  const ends = new Set([target.originBusinessId, target.destinationBusinessId]);
  return {
    ...scenario,
    employees: scenario.employees.map((employee, index) => (index < STORY_EMPLOYEES && ends.has(employee.businessId)
      ? { ...employee, availableEvening: false, availableMorning: false }
      : employee)),
  };
}
const storyOnlyShort = runOf(short(storyOnly.scenario));
const fullShort = runOf(short(full.scenario));

describe('the first match of a demo with added employees', () => {
  it('the sample: the story\'s employees carry every package, and not every one once some are unavailable', () => {
    expect(storyOnly.assignments.plans.length).toBe(storyOnly.scenario.shipments.length);
    expect(full.assignments.plans).toEqual(storyOnly.assignments.plans);
    expect(storyOnlyShort.assignments.plans.length).toBeGreaterThan(0);
    expect(storyOnlyShort.assignments.unmatched.length).toBeGreaterThan(0);
    expect(fullShort.scenario.employees.slice(0, STORY_EMPLOYEES)).toEqual(storyOnlyShort.scenario.employees);
  });

  it('every package the story\'s employees can carry has exactly its plan of the 60-employee run', () => {
    for (const [onStory, onAll] of [[storyOnly, full], [storyOnlyShort, fullShort]] as const) {
      for (const plan of onStory.assignments.plans) {
        expect(planOf(onAll, plan.shipmentId), plan.shipmentId).toEqual(plan);
        expect(plan.legs.some((leg) => isAdded(leg.employeeId)), plan.shipmentId).toBe(false);
      }
    }
  }, T);

  it('a story package they cannot carry is never given to an added employee: it keeps the 60-employee run\'s reason', () => {
    for (const [onStory, onAll] of [[storyOnly, full], [storyOnlyShort, fullShort]] as const) {
      expect(onAll.assignments.plans).toEqual(onStory.assignments.plans);
      expect(onAll.assignments.unmatched).toEqual(onStory.assignments.unmatched);
      expect(onAll.jobs).toEqual(onStory.jobs);
      expect(onAll.events).toEqual(onStory.events);
      expect(onAll.jobs.some((job) => isAdded(job.employeeId))).toBe(false);
    }
    // Although an added employee could carry it: sent as a request, the same delivery gets a plan.
    let carriable = 0;
    for (const { shipmentId } of fullShort.assignments.unmatched) {
      const like = fullShort.scenario.shipments.find((shipment) => shipment.id === shipmentId)!;
      const request = sent(fullShort, like, 1);
      const plan = planOf(withRequest(fullShort, request), request.id);
      if (!plan) continue;
      carriable += 1;
      expect(plan.legs.some((leg) => isAdded(leg.employeeId)), shipmentId).toBe(true);
    }
    expect(carriable).toBeGreaterThan(0);
  }, T);

  it.each([['the sample', full], ['the sample with some of the story\'s employees unavailable', fullShort]])(
    '%s is a valid assignment: every package has a plan or a reason, plans in package order, no commute used twice',
    (_name, run) => {
      const { plans, unmatched } = run.assignments;
      const ids = run.scenario.shipments.map((shipment) => shipment.id);
      expect([...plans.map((plan) => plan.shipmentId), ...unmatched.map((u) => u.shipmentId)].sort()).toEqual([...ids].sort());
      expect(plans.map((plan) => plan.shipmentId)).toEqual(ids.filter((id) => planOf(run, id)));
      for (const { reason } of unmatched) expect(reason).not.toBe('');
      expect(checkPlans({
        plans, shipments: run.scenario.shipments, employees: run.scenario.employees, trips: run.trips,
        businesses: run.scenario.businesses, settings: run.scenario.settings, travel: sample.travel,
      })).toEqual([]);
    }, T);

  it('is the run the server boots with, and reads its arguments only', () => {
    const frozen = bootSample();
    deepFreeze(frozen.fixtures);
    deepFreeze(frozen.files);
    const booted = buildDefaultRun(frozen);
    expect(booted.scenario).toEqual(full.scenario);
    expect(booted.assignments.plans).toEqual(full.assignments.plans);
    expect(booted.assignments.unmatched).toEqual(full.assignments.unmatched);

    const scenario = deepFreeze(structuredClone(full.scenario));
    const trips = deepFreeze(structuredClone(full.trips));
    const ctx = { travel: sample.travel, trips, employees: scenario.employees, businesses: scenario.businesses, settings: scenario.settings };
    const again = assignStoryFirst(scenario.shipments, ctx, scenario);
    expect(again.plans).toEqual(full.assignments.plans);
    expect(again.computeMs).toBe(0);
  }, T);

  it('direct only: the same order with direct plans only', () => {
    const ctx = matchContext(full, sample.travel);
    const direct = assignStoryFirst(full.scenario.shipments, ctx, full.scenario, { mode: 'direct_only' });
    expect(direct.plans.length).toBeGreaterThan(0);
    expect(direct.plans.every((plan) => plan.kind === 'direct')).toBe(true);
    // It is the direct-only match of the 60-employee run: the same plans and the same reasons.
    const storyDirect = assignShipments(storyOnly.scenario.shipments, matchContext(storyOnly, sample.travel), { mode: 'direct_only' });
    expect(direct).toEqual(storyDirect);
    expect(storyDirect.unmatched.length).toBeGreaterThan(0);
    expect(direct.plans.length + direct.unmatched.length).toBe(full.scenario.shipments.length);
  }, T);
});

describe('matchTiers: the order a request is matched in', () => {
  it('the story\'s employees and their commutes first, then everyone', () => {
    const ctx = matchContext(full, sample.travel);
    const tiers = matchTiers(ctx, full.scenario);
    expect(tiers).toHaveLength(2);
    expect(tiers[1]).toBe(ctx);
    expect(tiers[0]!.employees).toEqual(storyOnly.scenario.employees);
    expect(tiers[0]!.trips).toEqual(storyOnly.trips);
    expect(tiers[0]!.businesses).toBe(ctx.businesses);
    expect(tiers[0]!.settings).toBe(ctx.settings);
  }, T);
});

describe('a request sent to a demo with added employees (matchPending)', () => {
  it('gets the plan the 60-employee run gives it while the story\'s employees have a free one', () => {
    let matchedOnStory = 0;
    for (const like of full.scenario.shipments) {
      const onStoryOnly = withRequest(storyOnly, sent(storyOnly, like, 1));
      const request = sent(full, like, 1);
      const onFull = withRequest(full, request);
      const expected = planOf(onStoryOnly, request.id);
      if (!expected) continue;
      matchedOnStory += 1;
      expect(planOf(onFull, request.id), like.id).toEqual(expected);
      // And nothing else moved.
      expect(onFull.assignments.plans.filter((plan) => plan.shipmentId !== request.id), like.id).toEqual(full.assignments.plans);
    }
    expect(matchedOnStory).toBeGreaterThan(0);
  }, T);

  it('goes to the added employees when the story\'s have none, as a plain match on what is free would', () => {
    let rescued = 0;
    for (const like of full.scenario.shipments) {
      const request = sent(full, like, 1);
      if (planOf(withRequest(storyOnly, sent(storyOnly, like, 1)), request.id)) continue;
      const onFull = withRequest(full, request);
      const plain = assignShipments([request], matchContext(full, sample.travel), { existing: full.assignments.plans });
      const expected = plain.plans.find((plan) => plan.shipmentId === request.id);
      expect(planOf(onFull, request.id), like.id).toEqual(expected);
      if (expected) {
        rescued += 1;
        expect(expected.legs.some((leg) => isAdded(leg.employeeId)), like.id).toBe(true);
      } else {
        expect(onFull.assignments.unmatched.find((u) => u.shipmentId === request.id)?.reason, like.id)
          .toBe(plain.unmatched[0]?.reason);
      }
    }
    expect(rescued).toBeGreaterThan(0);
  }, T);
});

describe('Recompute and a new planning cycle on a demo with added employees (matchEverything)', () => {
  const rematch = (emptied: RunV2): RunV2 => {
    matchEverything(emptied, deps);
    return emptied;
  };
  const recomputed = (run: RunV2): RunV2 => {
    const plan = clearForRecompute(run);
    if (plan.kind !== 'recompute') throw new Error('the run is in planning');
    return rematch(plan.run);
  };

  it('a fresh run comes back as it was: plans, reasons, jobs and events', () => {
    for (const run of [full, fullShort]) {
      for (const again of [recomputed(run), rematch(beginNewCycle(run))]) {
        expect(again.assignments.plans).toEqual(run.assignments.plans);
        expect(again.assignments.unmatched).toEqual(run.assignments.unmatched);
        expect(again.jobs).toEqual(run.jobs);
        expect(again.events).toEqual(run.events);
      }
    }
    // And the same holds for a run with no story part.
    expect(recomputed(storyOnly).assignments.plans).toEqual(storyOnly.assignments.plans);
  }, T);

  it('with requests sent since: the story\'s plans on the story\'s employees stay, and no request takes one of their commutes', () => {
    let run = full;
    const requests: Shipment[] = [];
    for (const [n, like] of full.scenario.shipments.slice(0, 8).entries()) {
      const request = sent(run, like, n + 1);
      requests.push(request);
      run = withRequest(run, request);
    }
    expect(requests.some((request) => planOf(run, request.id))).toBe(true);

    for (const again of [recomputed(run), rematch(beginNewCycle(run))]) {
      for (const plan of storyOnly.assignments.plans) {
        expect(planOf(again, plan.shipmentId), plan.shipmentId).toEqual(plan);
      }
      const { plans, unmatched } = again.assignments;
      expect(plans.length + unmatched.length).toBe(run.scenario.shipments.length);
      expect(checkPlans({
        plans, shipments: again.scenario.shipments, employees: again.scenario.employees, trips: again.trips,
        businesses: again.scenario.businesses, settings: again.scenario.settings, travel: sample.travel,
      })).toEqual([]);
    }
  }, T);
});
