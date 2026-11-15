// POST /api/v2/advise (#862, reshaped by #959; contract: AdviseRequest / AdviseResponse in shared/v2/api.ts).
// A parsed draft (and, optionally, the business's sentence) in, 0-3 priced options out (server/ai/advisor.ts): the
// engine's fastest and cheapest plans, then Gemini's recommendation when there is a key and its one call succeeds,
// else the balanced plan. The route only reads: it takes the run from the store once and never calls
// `store.mutate`, so the run, its version and the state file stay as they are, and it answers while the run is
// locked too. The engine runs on a throwaway shipment that is never stored, against the run's current plans, so
// trips already reserved stay reserved. Gemini can never make this route answer 5xx; a travel error from the
// engine goes to the router's 503 handler. The advisor has no pause of its own: each request with a key makes
// one Gemini call with a 6 s limit (#959; the pause of #884 stays with parse-request).
// One line is logged per request: "[advise] gemini" when Gemini's recommendation is shown, else
// "[advise] fallback: <reason>" (no key, no plan, timeout, HTTP 429, invalid answer: unknown id, ...). A Gemini
// failure goes to `log` (console.warn in the app), every other line to `info` (console.info), as parse-request
// does (#811). Never the key, the draft, the sentence or Gemini's text.
// #947: a draft without a sender, recipient or ready time is 200 with no options and a note naming what to
// choose; no deliver-by is the window end, and one after the window end is moved to it, with a note in front of
// the advisor's (server/ai/deadline.ts). A deliver-by before the window or not after the ready time stays a 400.
import type express from 'express';
import { z } from 'zod';
import type { AdviseResponse } from '../../../shared/v2/api';
import type { ApiError } from '../../../shared/v2/schemas';
import type { Run as RunV2, Shipment, TravelProvider } from '../../../shared/v2/types';
import { PARSE_TEXT_MAX } from '../../../shared/v2/parseRequest';
import {
  advise, KINDS, type AdviseDraft, type AdvisorEngine, type AdvisorGeminiSettings, type CandidateAnswer, type PlanKind,
} from '../../ai/advisor';
import { settleDeadline } from '../../ai/deadline';
import { bestPlansByKind } from '../../domain/v2/kindMatch';
import { assignShipments, generateCandidates, rankCandidates, type MatchContext } from '../../domain/v2/matching';
import { pairKey } from '../../../shared/v2/types';
import type { Store } from '../../store';
import { matchContext } from './pipeline';
import {
  DEADLINE_BEFORE_READY, DEADLINE_OUTSIDE_WINDOW, READY_OUTSIDE_WINDOW, SAME_BUSINESS, UNKNOWN_BUSINESS,
} from './shipmentOps';

export type AdviseRouteDeps = {
  /** Only `get` is used. */
  store: Pick<Store<RunV2>, 'get'>;
  travel: TravelProvider;
  /** Gemini settings read once by the caller. Left out, or with a null or blank key: offline options, nothing is sent. */
  gemini?: AdvisorGeminiSettings;
  /** Gets the line of a request whose Gemini call failed or gave an unusable answer (`adviseLogLine`). */
  log?: (line: string) => void;
  /** Gets the line of every other request: Gemini's recommendation shown, no key, no plan, a refused draft. */
  info?: (line: string) => void;
};

/** The `by` words that are no Gemini failure, so their line goes to `info`. */
const NOT_A_FAILURE = new Set(['gemini', 'no key', 'no plan', 'invalid draft', 'draft incomplete']);

export const INVALID_ADVISE = 'Invalid draft';

/** The one line per request: "[advise] gemini" or "[advise] fallback: timeout". `by` is fixed words. */
export const adviseLogLine = (by: string) => (by === 'gemini' ? '[advise] gemini' : `[advise] fallback: ${by}`);

/** The id of the throwaway shipment the engine is asked about. Never stored. */
export const ADVICE_SHIPMENT_ID = 'shp-advice';

const businessId = (message: string) => z.string({ error: message }).min(1, message).nullish();
const minute = (message: string) => z.number({ error: message }).int(message).nullish();

// A field left out or null is missing (#947): no 400, but no options either (see `checkDraft`).
// The package fields and the sentence only help Gemini read the request: a value of the wrong type is dropped, not a 400.
const optionalText = z.unknown().optional().transform((value) => (typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, PARSE_TEXT_MAX) : null));
const optionalKg = z.unknown().optional().transform((value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null));
const AdviseBody = z.object({
  draft: z.object({
    originBusinessId: businessId('Choose a sender'),
    destinationBusinessId: businessId('Choose a recipient'),
    readyMin: minute('Choose a ready time'),
    deadlineMin: minute('Choose a deliver-by time'),
    label: optionalText,
    category: optionalText,
    description: optionalText,
    weightKg: optionalKg,
  }, { error: 'Send the parsed draft' }),
  text: optionalText,
}, { error: 'Send the parsed draft' });

/** What a missing field is called in the note, in the order of the draft. */
const MISSING_WORDS = { originBusinessId: 'a sender', destinationBusinessId: 'a recipient', readyMin: 'a ready time' } as const;
type Needed = keyof typeof MISSING_WORDS;

/** "Choose a recipient to see options." / "Choose a sender, a recipient and a ready time to see options." */
export function missingNote(missing: readonly Needed[]): string {
  const words = missing.map((key) => MISSING_WORDS[key]);
  const list = words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  return `Choose ${list} to see options.`;
}

export type CheckedDraft =
  /** `note`: what the server changed or assumed about the deliver-by, to put before the advisor's note. */
  | { draft: AdviseDraft; note: string | null }
  /** Sender, recipient or ready time not given (and nothing given is wrong): 200 with no options and a note. */
  | { missing: Needed[] }
  | { fieldErrors: Record<string, string> };

/**
 * The draft checked against the run, the fields still missing, or the field errors (keyed like the delivery
 * form). The deliver-by is settled as the parsers settle it (server/ai/deadline.ts, #947): none at all is the
 * window end, one after the window end (up to the end of Day 2) is moved to the end, with a note.
 */
export function checkDraft(run: RunV2, body: unknown): CheckedDraft {
  const parsed = AdviseBody.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.length > 1 ? String(issue.path[1]) : 'draft';
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors };
  }
  const given = parsed.data.draft;
  const fieldErrors: Record<string, string> = {};
  const known = new Set(run.scenario.businesses.map((b) => b.id));
  const { simStartMin, simEndMin } = run.scenario.settings;
  const outside = (min: number) => min < simStartMin || min > simEndMin;
  const origin = given.originBusinessId ?? null;
  const destination = given.destinationBusinessId ?? null;
  const readyMin = given.readyMin ?? null;
  if (origin !== null && !known.has(origin)) fieldErrors.originBusinessId = UNKNOWN_BUSINESS;
  if (destination !== null && destination === origin) fieldErrors.destinationBusinessId = SAME_BUSINESS;
  else if (destination !== null && !known.has(destination)) fieldErrors.destinationBusinessId = UNKNOWN_BUSINESS;
  if (readyMin !== null && outside(readyMin)) fieldErrors.readyMin = READY_OUTSIDE_WINDOW;

  const asked = given.deadlineMin ?? null;
  const settled = settleDeadline(asked, readyMin, { windowStartMin: simStartMin, windowEndMin: simEndMin });
  if (asked !== null && settled.deadlineMin === null) {
    fieldErrors.deadlineMin = readyMin !== null && asked <= readyMin ? DEADLINE_BEFORE_READY : DEADLINE_OUTSIDE_WINDOW;
  }
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  const missing = (Object.keys(MISSING_WORDS) as Needed[]).filter((key) => (given[key] ?? null) === null);
  if (missing.length > 0 || origin === null || destination === null || readyMin === null) return { missing };
  // A ready time at the window end leaves no deliver-by to assume.
  if (settled.deadlineMin === null) return { fieldErrors: { deadlineMin: DEADLINE_OUTSIDE_WINDOW } };
  return {
    draft: {
      originBusinessId: origin, destinationBusinessId: destination, readyMin, deadlineMin: settled.deadlineMin,
      text: parsed.data.text, label: given.label, category: given.category, description: given.description, weightKg: given.weightKg,
    },
    note: settled.note,
  };
}

/**
 * The run's flexibility window: `settings.flexWindowMin` (#861), the same number `customerPriceCents` reads
 * when the engine prices a plan. There is no fallback (#867): every run in the store has the field. A state
 * file saved before #861 is set aside as stale at boot (the default settings are part of the fingerprint), and
 * an imported run without it is refused.
 */
export function flexWindowOf(settings: RunV2['scenario']['settings']): number {
  return settings.flexWindowMin;
}

/**
 * The advisor's read-only view of the run. `candidates` lists every plan `generateCandidates` builds for a
 * throwaway shipment with the draft's businesses and the given times (direct and relay, every relay point and
 * carrier pair that fits) whose trips are all free in the run's current plans, in the matcher's own allocation
 * order (`rankCandidates`): p1 is the plan POST /shipments would pick, and on a tie the advisor prefers it. A kind
 * with no free plan gets the reason of `bestPlansByKind` (#954); no plan at all gets the matcher's own reason
 * (`assignShipments`). Nothing of `run` is changed.
 */
export function advisorEngine(run: RunV2, travel: TravelProvider, draft: AdviseDraft): AdvisorEngine {
  const { scenario } = run;
  const employees = new Map(scenario.employees.map((e) => [e.id, e.name]));
  const businesses = new Map(scenario.businesses.map((b) => [b.id, b.name]));
  const ctx = memoized(matchContext(run, travel));
  const reserved = new Set(run.assignments.plans.flatMap((plan) => plan.legs.map((leg) => leg.tripId)));
  return {
    draft,
    clockMin: run.clock.timeMin,
    windowStartMin: scenario.settings.simStartMin,
    windowEndMin: scenario.settings.simEndMin,
    flexWindowMin: flexWindowOf(scenario.settings),
    candidates(readyMin, deadlineMin): CandidateAnswer {
      const shipment = adviceShipment(draft, readyMin, deadlineMin);
      const plans = rankCandidates(generateCandidates(shipment, ctx, 'with_relay'), ctx.settings)
        .filter((plan) => plan.legs.every((leg) => !reserved.has(leg.tripId)));
      const reasons: Partial<Record<PlanKind, string>> = {};
      const missing = KINDS.filter((kind) => !plans.some((plan) => plan.kind === kind));
      if (missing.length > 0) {
        const answers = bestPlansByKind(shipment, ctx, run.assignments.plans);
        for (const kind of missing) {
          const answer = answers[kind];
          if ('reason' in answer) reasons[kind] = answer.reason;
        }
      }
      if (plans.length > 0) return { plans, reasons };
      const result = assignShipments([shipment], ctx, { existing: run.assignments.plans });
      const reason = result.unmatched.find((u) => u.shipmentId === ADVICE_SHIPMENT_ID)?.reason ?? 'No carrier can take it';
      return { plans, reasons, reason };
    },
    employeeName: (id) => employees.get(id) ?? 'A carrier',
    businessName: (id) => businesses.get(id) ?? null,
  };
}

/** The context with its travel lookups cached for this request: candidates and reasons revisit the same pairs. */
function memoized(ctx: MatchContext): MatchContext {
  const { travel } = ctx;
  const memo = (lookup: (from: string, to: string) => number) => {
    const cache = new Map<string, number>();
    return (from: string, to: string): number => {
      const key = pairKey(from, to);
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const value = lookup(from, to); // a missing pair still throws, and is not cached
      cache.set(key, value);
      return value;
    };
  };
  return { ...ctx, travel: {
    durationMin: memo((from, to) => travel.durationMin(from, to)),
    distanceM: memo((from, to) => travel.distanceM(from, to)),
    polyline: (from, to) => travel.polyline(from, to),
  } };
}

/** The throwaway shipment the engine is asked about: the draft's two businesses and the given times. Never stored. */
function adviceShipment(draft: AdviseDraft, readyMin: number, deadlineMin: number): Shipment {
  return {
    id: ADVICE_SHIPMENT_ID,
    clientRequestId: ADVICE_SHIPMENT_ID,
    label: 'Advice',
    originBusinessId: draft.originBusinessId,
    destinationBusinessId: draft.destinationBusinessId,
    readyMin,
    deadlineMin,
    category: 'envelope',
    description: '',
    weightGrams: 0,
    pickupInstructions: '',
    dropoffInstructions: '',
    createdSeq: Number.MAX_SAFE_INTEGER,
  };
}

/** Registers the route on the v2 router. The path is relative to /api/v2. */
export function registerAdviseRoutes(router: express.Router, deps: AdviseRouteDeps): void {
  router.post('/advise', async (
    req: express.Request, res: express.Response<AdviseResponse | ApiError>, next: express.NextFunction,
  ) => {
    try {
      // The run is read once: every variant is matched against the same state.
      const run = deps.store.get();
      const checked = checkDraft(run, req.body);
      if ('fieldErrors' in checked) {
        tell(deps.info, adviseLogLine('invalid draft'));
        res.status(400).json({ error: INVALID_ADVISE, fieldErrors: checked.fieldErrors });
        return;
      }
      if ('missing' in checked) {
        tell(deps.info, adviseLogLine('draft incomplete'));
        res.json({ options: [], source: 'offline', note: missingNote(checked.missing) });
        return;
      }
      const { response, by } = await advise(advisorEngine(run, deps.travel, checked.draft), deps.gemini);
      tell(NOT_A_FAILURE.has(by) ? deps.info : deps.log, adviseLogLine(by));
      const note = [checked.note, response.note].filter((line): line is string => typeof line === 'string' && line !== '').join(' ');
      res.json(note === '' ? response : { ...response, note });
    } catch (err) {
      next(err);
    }
  });
}

/** Logs one line; a log that throws never costs the sender the answer. */
function tell(log: ((line: string) => void) | undefined, line: string): void {
  try {
    log?.(line);
  } catch {
    // the options matter more than their log line
  }
}
