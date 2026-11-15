// POST /api/v2/advise (#862; contract: AdviseRequest / AdviseResponse in shared/v2/api.ts).
// A parsed draft in, 0-3 priced what-if options out (server/ai/advisor.ts: Gemini as a tool-using agent when
// there is a key, the fixed offline variants otherwise). The route only reads: it takes the run from the store
// once and never calls `store.mutate`, so the run, its version and the state file stay as they are, and it
// answers while the run is locked too. The engine runs on a throwaway shipment that is never stored, against
// the run's current plans, so trips already reserved stay reserved.
// Gemini can never make this route answer 5xx; a travel error from the engine goes to the router's 503 handler.
// After one failed Gemini call (here or in parse-request) the shared pause is on for 2 minutes (#884,
// server/ai/geminiPause.ts): Gemini is not asked and the offline options come back at once.
// One line is logged, and only for an answer that was offline because of that pause:
// "[advise] Options computed offline: Gemini paused after timeout, next try in 87 s." Nothing else is: no key,
// no draft, no Gemini text.
// #947: a draft without a sender, recipient or ready time is 200 with no options and a note naming what to
// choose; no deliver-by is the window end, and one after the window end is moved to it, with a note in front of
// the advisor's (server/ai/deadline.ts). A deliver-by before the window or not after the ready time stays a 400.
import type express from 'express';
import { z } from 'zod';
import type { AdviseResponse } from '../../../shared/v2/api';
import type { ApiError } from '../../../shared/v2/schemas';
import type { Run as RunV2, Shipment, TravelProvider } from '../../../shared/v2/types';
import { adviseUnlessPaused, type AdviseDraft, type AdvisorEngine, type AdvisorGeminiSettings } from '../../ai/advisor';
import { settleDeadline } from '../../ai/deadline';
import { pausedMessage, type GeminiPause } from '../../ai/geminiPause';
import { bestPlansByKind } from '../../domain/v2/kindMatch';
import { assignShipments } from '../../domain/v2/matching';
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
  /**
   * The pause shared with POST /parse-request (#884): after one failed Gemini call neither route asks Gemini
   * for 2 minutes. The app gives one (server/index.ts). Left out: every request asks Gemini, as before #884.
   */
  pause?: GeminiPause;
  /** Gets `pausedLogLine` when the options are offline because Gemini is paused. Fixed text and numbers only. */
  log?: (line: string) => void;
};

export const INVALID_ADVISE = 'Invalid draft';

/**
 * The line for `deps.log` when Gemini was not asked because it is paused. `message` is `pausedMessage` of
 * server/ai/geminiPause.ts: "[advise] Options computed offline: Gemini paused after timeout, next try in 87 s."
 */
export const pausedLogLine = (message: string) => `[advise] Options computed offline: ${message}`;

/** The id of the throwaway shipment the engine is asked about. Never stored. */
export const ADVICE_SHIPMENT_ID = 'shp-advice';

const businessId = (message: string) => z.string({ error: message }).min(1, message).nullish();
const minute = (message: string) => z.number({ error: message }).int(message).nullish();

// A field left out or null is missing (#947): no 400, but no options either (see `checkDraft`).
const AdviseBody = z.object({
  draft: z.object({
    originBusinessId: businessId('Choose a sender'),
    destinationBusinessId: businessId('Choose a recipient'),
    readyMin: minute('Choose a ready time'),
    deadlineMin: minute('Choose a deliver-by time'),
  }, { error: 'Send the parsed draft' }),
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
    draft: { originBusinessId: origin, destinationBusinessId: destination, readyMin, deadlineMin: settled.deadlineMin },
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
 * The advisor's read-only view of the run: `match` asks the matcher (generateCandidates + rankCandidates via
 * assignShipments) about a throwaway shipment with the draft's businesses and the given times, keeping every
 * plan of the run, so only free trips can carry it. `matchKinds` asks for the best plan of each kind the same
 * way (#954, server/domain/v2/kindMatch.ts). Nothing of `run` is changed.
 */
export function advisorEngine(run: RunV2, travel: TravelProvider, draft: AdviseDraft): AdvisorEngine {
  const { scenario } = run;
  const employees = new Map(scenario.employees.map((e) => [e.id, e.name]));
  const businesses = new Map(scenario.businesses.map((b) => [b.id, b.name]));
  const ctx = matchContext(run, travel);
  return {
    draft,
    clockMin: run.clock.timeMin,
    windowStartMin: scenario.settings.simStartMin,
    windowEndMin: scenario.settings.simEndMin,
    flexWindowMin: flexWindowOf(scenario.settings),
    match(readyMin, deadlineMin) {
      const shipment = adviceShipment(draft, readyMin, deadlineMin);
      const result = assignShipments([shipment], ctx, { existing: run.assignments.plans });
      const plan = result.plans.find((p) => p.shipmentId === ADVICE_SHIPMENT_ID);
      if (plan) return { plan };
      const reason = result.unmatched.find((u) => u.shipmentId === ADVICE_SHIPMENT_ID)?.reason;
      return { reason: reason ?? 'No carrier can take it' };
    },
    matchKinds: (readyMin, deadlineMin) =>
      bestPlansByKind(adviceShipment(draft, readyMin, deadlineMin), ctx, run.assignments.plans),
    employeeName: (id) => employees.get(id) ?? 'A carrier',
    businessName: (id) => businesses.get(id) ?? null,
  };
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
        res.status(400).json({ error: INVALID_ADVISE, fieldErrors: checked.fieldErrors });
        return;
      }
      if ('missing' in checked) {
        res.json({ options: [], source: 'offline', note: missingNote(checked.missing) });
        return;
      }
      const { response, paused } = await adviseUnlessPaused(advisorEngine(run, deps.travel, checked.draft), deps.gemini, deps.pause);
      if (paused) {
        try {
          deps.log?.(pausedLogLine(pausedMessage(paused)));
        } catch {
          // the options matter more than their log line
        }
      }
      const note = [checked.note, response.note].filter((line): line is string => typeof line === 'string' && line !== '').join(' ');
      res.json(note === '' ? response : { ...response, note });
    } catch (err) {
      next(err);
    }
  });
}
