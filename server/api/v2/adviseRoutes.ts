// POST /api/v2/advise (#862; contract: AdviseRequest / AdviseResponse in shared/v2/api.ts).
// A parsed draft in, 0-3 priced what-if options out (server/ai/advisor.ts: Gemini as a tool-using agent when
// there is a key, the fixed offline variants otherwise). The route only reads: it takes the run from the store
// once and never calls `store.mutate`, so the run, its version and the state file stay as they are, and it
// answers while the run is locked too. The engine runs on a throwaway shipment that is never stored, against
// the run's current plans, so trips already reserved stay reserved.
// Gemini can never make this route answer 5xx; a travel error from the engine goes to the router's 503 handler.
// Nothing is logged: no key, no draft, no Gemini text.
import type express from 'express';
import { z } from 'zod';
import type { AdviseResponse } from '../../../shared/v2/api';
import type { ApiError } from '../../../shared/v2/schemas';
import type { Run as RunV2, Shipment, TravelProvider } from '../../../shared/v2/types';
import { advise, type AdviseDraft, type AdvisorEngine, type AdvisorGeminiSettings } from '../../ai/advisor';
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
};

export const INVALID_ADVISE = 'Invalid draft';

/** The id of the throwaway shipment the engine is asked about. Never stored. */
export const ADVICE_SHIPMENT_ID = 'shp-advice';

const businessId = (message: string) => z.string({ error: message }).min(1, message);
const minute = (message: string) => z.number({ error: message }).int(message);

const AdviseBody = z.object({
  draft: z.object({
    originBusinessId: businessId('Choose a sender'),
    destinationBusinessId: businessId('Choose a recipient'),
    readyMin: minute('Choose a ready time'),
    deadlineMin: minute('Choose a deliver-by time'),
  }, { error: 'Send the parsed draft' }),
}, { error: 'Send the parsed draft' });

/** The draft checked against the run, or the field errors (keyed like the delivery form). */
export function checkDraft(run: RunV2, body: unknown): { draft: AdviseDraft } | { fieldErrors: Record<string, string> } {
  const parsed = AdviseBody.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.length > 1 ? String(issue.path[1]) : 'draft';
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors };
  }
  const draft = parsed.data.draft;
  const fieldErrors: Record<string, string> = {};
  const known = new Set(run.scenario.businesses.map((b) => b.id));
  const { simStartMin, simEndMin } = run.scenario.settings;
  const outside = (min: number) => min < simStartMin || min > simEndMin;
  if (!known.has(draft.originBusinessId)) fieldErrors.originBusinessId = UNKNOWN_BUSINESS;
  if (draft.destinationBusinessId === draft.originBusinessId) fieldErrors.destinationBusinessId = SAME_BUSINESS;
  else if (!known.has(draft.destinationBusinessId)) fieldErrors.destinationBusinessId = UNKNOWN_BUSINESS;
  if (outside(draft.readyMin)) fieldErrors.readyMin = READY_OUTSIDE_WINDOW;
  if (draft.deadlineMin <= draft.readyMin) fieldErrors.deadlineMin = DEADLINE_BEFORE_READY;
  else if (outside(draft.deadlineMin)) fieldErrors.deadlineMin = DEADLINE_OUTSIDE_WINDOW;
  return Object.keys(fieldErrors).length > 0 ? { fieldErrors } : { draft };
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
 * plan of the run, so only free trips can carry it. Nothing of `run` is changed.
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
      const shipment: Shipment = {
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
      const result = assignShipments([shipment], ctx, { existing: run.assignments.plans });
      const plan = result.plans.find((p) => p.shipmentId === ADVICE_SHIPMENT_ID);
      if (plan) return { plan };
      const reason = result.unmatched.find((u) => u.shipmentId === ADVICE_SHIPMENT_ID)?.reason;
      return { reason: reason ?? 'No carrier can take it' };
    },
    employeeName: (id) => employees.get(id) ?? 'A carrier',
    businessName: (id) => businesses.get(id) ?? null,
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
      res.json(await advise(advisorEngine(run, deps.travel, checked.draft), deps.gemini));
    } catch (err) {
      next(err);
    }
  });
}
