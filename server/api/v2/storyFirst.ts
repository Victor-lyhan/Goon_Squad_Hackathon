// Matching on a run that has more employees than its story, story first (#966).
//
// The default NYC run has 120 employees: the 60 the demo story was written on and 60 more, so that a business
// does not run out of free commutes after a few requests. Matching everything on all of them at once would
// move the story: a plain full match gives story packages to the added employees (#963: 14 of the 24 plans
// differ at 120), the direct-only side of the comparison finds 12 direct plans instead of 5, and the README's
// demo request becomes a direct delivery by an added employee instead of the relay the demo shows. So on a
// demo run with more than `STORY_EMPLOYEES` employees every match is made in this order, each step with the
// engine's unchanged `assignShipments` and the plans of the steps before kept:
//   1. the generated packages (the story) on the story's employees only: exactly the match of the
//      60-employee run, plan for plan and reason for reason. They are never tried on an added employee;
//   2. the other packages (requests a business sent) on the story's employees only: what the 60-employee
//      run would answer;
//   3. the requests that still have no plan on every commute: here the added employees come in.
// So the story is exactly the 60-employee story, the story's employees are asked first for a request, and the
// added ones carry only requests the story's cannot. Every match goes through here: the first match of a run
// (initialRun.ts), a request, an edit, a retry and a commute save (pipeline.ts `matchPending`), Recompute and
// a new planning cycle (pipeline.ts `matchEverything`), both sides of the comparison (compareOps.ts), and the
// advisor asks for a request's options in the same order (`matchTiers`).
// Any other run (Random city, a demo of 60 or fewer, an import of one) has no story part and is matched in one
// plain call, as before.
// Pure: no fs, no clock, nothing mutated. A missing travel pair throws TravelDataMissingError unchanged.
import { GenerateScenarioRequest } from '../../../shared/v2/schemas';
import type { AssignmentResult, DeliveryPlan, Scenario, Shipment } from '../../../shared/v2/types';
import { generatedRequestId } from '../../domain/v2/generator';
import { assignShipments, type MatchContext, type MatchMode } from '../../domain/v2/matching';

/** The employees the demo story is matched on: the contract's default count (60). */
export const STORY_EMPLOYEES: number = GenerateScenarioRequest.parse({ preset: 'demo' }).employees;

/** What of a scenario says where its story part is. */
export type StoryScenario = Pick<Scenario, 'preset' | 'seed' | 'employees' | 'shipments'>;

export type StoryPart = {
  /** The packages the generator made, as opposed to requests a business sent. */
  shipmentIds: ReadonlySet<string>;
  /** The first `STORY_EMPLOYEES` employees of the run, in the run's order. */
  employeeIds: ReadonlySet<string>;
};

/**
 * The story part of a run, or null when there is nothing to keep apart: a run that is not the demo, or a demo
 * with no employee beyond the story's. It is read from the scenario alone (the preset, the order of the
 * employees, the generator's stamp on its packages), so it holds for a restored, exported or imported run
 * without anything extra being stored.
 */
export function storyPart(scenario: StoryScenario): StoryPart | null {
  if (scenario.preset !== 'demo' || scenario.employees.length <= STORY_EMPLOYEES) return null;
  return {
    shipmentIds: new Set(scenario.shipments
      .filter((shipment) => shipment.clientRequestId === generatedRequestId(scenario.seed, shipment.createdSeq))
      .map((shipment) => shipment.id)),
    employeeIds: new Set(scenario.employees.slice(0, STORY_EMPLOYEES).map((employee) => employee.id)),
  };
}

/** `ctx` with only the story's employees and their commutes. */
function storyContext(ctx: MatchContext, story: StoryPart): MatchContext {
  return {
    ...ctx,
    employees: ctx.employees.filter((employee) => story.employeeIds.has(employee.id)),
    trips: ctx.trips.filter((trip) => story.employeeIds.has(trip.employeeId)),
  };
}

/**
 * The contexts a request is matched on, in order: the first that has a free plan is the one its plan comes
 * from. `[story's employees, everyone]` on a run with a story part, else `[ctx]`. For the advisor, which lists
 * the options of a request without matching it.
 */
export function matchTiers(ctx: MatchContext, scenario: StoryScenario): MatchContext[] {
  const story = storyPart(scenario);
  return story ? [storyContext(ctx, story), ctx] : [ctx];
}

/**
 * Matches `shipments` in the order above, keeping `opts.existing`. `ctx` is the whole run's (`matchContext`);
 * `scenario` says which part of it is the story. A story package with no plan has the reason of the story's
 * employees (the 60-employee run's); a request with no plan has the reason for all commutes.
 * With no story part this is one `assignShipments` call.
 * Plans are ordered as `assignShipments` orders them; `computeMs` is 0: the caller measures.
 */
export function assignStoryFirst(
  shipments: Shipment[], ctx: MatchContext, scenario: StoryScenario,
  opts?: { existing?: DeliveryPlan[]; mode?: MatchMode },
): AssignmentResult {
  const story = storyPart(scenario);
  if (!story) return assignShipments(shipments, ctx, opts);

  const mode = opts?.mode;
  const onStory = storyContext(ctx, story);
  const isStory = (shipment: Shipment) => story.shipmentIds.has(shipment.id);
  const packages = assignShipments(shipments.filter(isStory), onStory, { existing: opts?.existing, mode });
  const requests = assignShipments(shipments.filter((s) => !isStory(s)), onStory, { existing: packages.plans, mode });
  const left = new Set(requests.unmatched.map((u) => u.shipmentId));
  const last = left.size === 0
    ? requests
    : assignShipments(shipments.filter((s) => left.has(s.id)), ctx, { existing: requests.plans, mode });

  // Each call orders its plans by the packages it was given; order by all of them, as one call would.
  const createdSeq = new Map(shipments.map((shipment) => [shipment.id, shipment.createdSeq]));
  const seqOf = (plan: DeliveryPlan) => createdSeq.get(plan.shipmentId) ?? Infinity;
  const plans = [...last.plans].sort((a, b) =>
    seqOf(a) - seqOf(b) || (a.shipmentId < b.shipmentId ? -1 : a.shipmentId > b.shipmentId ? 1 : 0));
  return { plans, unmatched: [...packages.unmatched, ...last.unmatched], computeMs: 0 };
}
