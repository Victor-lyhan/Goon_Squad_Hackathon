// Route group: the simulator's planning and scenario actions (DECISIONS pass 6, 12, 47, 48, 50, 51).
// Paths are relative to /api/v2; the v2 bootstrap registers the group in createV2Router and passes the real deps.
//   POST /planning/reset      beginNewCycle     -> full match -> SimulatorResponse
//   POST /matches/recompute   clearForRecompute -> full match -> SimulatorResponse (409 while locked)
//   POST /scenario/generate   planGenerate      -> createInitialRun -> new runId -> SimulatorResponse
//   GET  /scenario/export     exportRun, as a download
//   POST /scenario/import     parseImportedRun  -> new runId, paused -> SimulatorResponse
// The handlers are thin: a pure step from planningOps.ts, the pipeline, one store.mutate, the read routes' view.
// A refused request never reaches the end of a mutation, so it raises no version and writes no file.
import type express from 'express';
import type { ExportFile, SimulatorResponse, TravelUnavailable } from '../../../shared/v2/api';
import type { ApiError } from '../../../shared/v2/schemas';
import type { Notification, Run, Snapshot } from '../../../shared/v2/types';
import type { Store } from '../../store';
import { takesNoOptions } from './bodyGuard';
import { sendTravelError, travelUnavailable } from './errors';
import { createInitialRun } from './initialRun';
import { matchEverything, type PipelineDeps } from './pipeline';
import {
  beginNewCycle, clearForRecompute, exportRun, nextRunId, parseImportedRun, planGenerate,
  type GenerateInputs, type TravelPairs,
} from './planningOps';
import { simulatorResponse } from './views';

/** This group's own dependencies (DECISIONS pass 50). `travel` and `buildEvents` are the pipeline's. */
export type PlanningRouteDeps = PipelineDeps & {
  store: Store<Run>;
  snapshotAt: (run: Run, timeMin: number) => Snapshot;
  /** For generate: the parsed `fixtures/nyc/` files and `matrix.json` `places`. */
  generateInputs: GenerateInputs;
  /** For import: which ordered pairs the travel cache can answer (`CachedProvider.has`). */
  travelPairs: TravelPairs;
};

type Answer = SimulatorResponse | ApiError | TravelUnavailable;

// Thrown inside store.mutate to leave the run untouched (no version bump, no file write).
class PlanningRefused extends Error {
  constructor(readonly status: number, readonly body: ApiError) {
    super(body.error);
  }
}

/** `run-7` as it is; anything else a stored run might hold is made safe for a header and a file name. */
const fileSafe = (runId: string) => runId.replace(/[^A-Za-z0-9._-]/g, '_');

/**
 * Matches every package of an emptied run again (QUESTIONS pass 6). The notifications of the run it
 * replaces are the basis for the pipeline's reconcile step, so a plan that keeps its ID keeps its
 * notification IDs and `createdSeq` with the text rewritten, and the rest are dropped (pass 12).
 * The match is story first (#966, storyFirst.ts): on the default run the 24 story plans come back as they
 * were, and the employees added to the story's 60 carry only requests that were sent since.
 * A missing travel pair throws TravelDataMissingError and nothing is stored.
 */
function rematchAll(emptied: Run, previous: Notification[], deps: PipelineDeps): Run {
  emptied.notifications = previous;
  matchEverything(emptied, deps);
  return emptied;
}

export function registerPlanningRoutes(router: express.Router, deps: PlanningRouteDeps): void {
  const { store, snapshotAt, generateInputs, travelPairs } = deps;
  const pipeline: PipelineDeps = { travel: deps.travel, buildEvents: deps.buildEvents };

  // Every success answers what GET /simulator answers for the stored run.
  const sendRun = (res: express.Response<Answer>, run: Run) => {
    res.json(simulatorResponse(run, snapshotAt(run, run.clock.timeMin)));
  };

  /** Refusals become their status and body; a travel error becomes the 503 of errors.ts; the rest is the app's 500. */
  const route = (handler: (req: express.Request, res: express.Response<Answer>) => Promise<void>) =>
    async (req: express.Request, res: express.Response<Answer>, next: express.NextFunction) => {
      try {
        await handler(req, res);
      } catch (err) {
        if (res.headersSent) next(err);
        else if (err instanceof PlanningRefused) res.status(err.status).json(err.body);
        else if (!sendTravelError(res, err)) next(err);
      }
    };

  // "Start new planning cycle": allowed in any phase. It unlocks too, with a new run (the app's own way out is "Back to start", #734).
  // Neither this nor recompute has options: a body that is a list is a 400 and starts nothing.
  router.post('/planning/reset', takesNoOptions, route(async (_req, res) => {
    // `draft` is the store's own copy of the newest run, so nothing here aliases the stored run.
    const run = await store.mutate((draft) => rematchAll(beginNewCycle(draft), draft.notifications, pipeline));
    sendRun(res, run);
  }));

  router.post('/matches/recompute', takesNoOptions, route(async (_req, res) => {
    const run = await store.mutate((draft) => {
      // Decided inside the mutation queue: a Play queued before this request locks it out.
      const plan = clearForRecompute(draft);
      if (plan.kind === 'locked') throw new PlanningRefused(plan.status, plan.error);
      return rematchAll(plan.run, draft.notifications, pipeline);
    });
    sendRun(res, run);
  }));

  router.post('/scenario/generate', route(async (req, res) => {
    const plan = planGenerate(req.body, generateInputs);
    if (plan.kind === 'invalid') {
      res.status(plan.status).json(plan.error);
      return;
    }
    if (plan.kind === 'unavailable') {
      res.status(plan.status).json(travelUnavailable(plan.code, plan.error.error));
      return;
    }
    // Built before the store is touched: a pair the cache lacks throws TravelDataMissingError here,
    // which is the 503 `travel_data_missing`. Nothing is estimated and the stored run stays.
    const fresh = createInitialRun(plan.scenario, pipeline);
    const run = await store.mutate((draft) => {
      fresh.runId = nextRunId(draft.runId); // a new runId, so clients refetch the map
      return fresh;
    });
    sendRun(res, run);
  }));

  router.get('/scenario/export', (_req, res: express.Response<ExportFile>) => {
    const run = store.get();
    res.setHeader('Content-Disposition', `attachment; filename="relay-nyc-${fileSafe(run.runId)}.json"`);
    res.json(exportRun(run));
  });

  router.post('/scenario/import', route(async (req, res) => {
    const plan = parseImportedRun(req.body, travelPairs);
    if (plan.kind === 'invalid') {
      res.status(plan.status).json(plan.error);
      return;
    }
    if (plan.kind === 'unavailable') {
      // The file names places this server has no travel times for. That is a problem with the file,
      // so it is refused like the other files (400, one sentence), not reported as a server outage.
      res.status(400).json({ error: plan.error.error });
      return;
    }
    const imported = plan.run; // already a copy of the file, paused
    const run = await store.mutate((draft) => {
      imported.runId = nextRunId(draft.runId);
      return imported;
    });
    sendRun(res, run);
  }));
}
