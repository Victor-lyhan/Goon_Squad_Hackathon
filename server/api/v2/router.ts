// The one place where MVP II routes plug into the server (DECISIONS pass 45). server/index.ts mounts this
// router at /api/v2 once; later issues add handler files under server/api/v2/ and register them below.
import express from 'express';
import type { Run as RunV2, TravelProvider } from '../../../shared/v2/types';
import type { Store } from '../../store';
import { sendTravelError, travelUnavailable, TRAVEL_NOT_LOADED_MESSAGE } from './errors';

export type { RunV2 };

export type V2Deps = {
  /** null until the NYC cache (fixtures/nyc/) is loaded. */
  travel: TravelProvider | null;
  /** null until the v2 run exists. It lives in its own state file, never in the MVP 1 one. */
  store: Store<RunV2> | null;
  /** Registers more routes on the router (paths relative to /api/v2). Used by tests and by handlers owned elsewhere. */
  extraRoutes?: (router: express.Router) => void;
};

export const V2_DEPS_NOT_LOADED: V2Deps = { travel: null, store: null };

export function createV2Router(deps: V2Deps): express.Router {
  const router = express.Router();
  const { travel, store } = deps;

  // No travel data or no v2 run yet: every method and path answers the documented 503, never a 404 or a crash.
  if (!travel || !store) {
    router.use((_req, res) => {
      res.status(503).json(travelUnavailable('travel_data_missing', TRAVEL_NOT_LOADED_MESSAGE));
    });
    return router;
  }

  // ===== v2 route groups: register here =====
  // One line per group, paths relative to /api/v2, handlers built from `store` and `travel`, e.g.
  //   router.get('/businesses', getBusinesses(store));
  // Handlers may throw (or reject with) TravelDataMissingError, GoogleKeyMissingError or GoogleApiError:
  // the error handler below turns them into the 503 TravelUnavailable body.
  deps.extraRoutes?.(router);
  // ===== end of v2 route groups =====

  router.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Travel errors become 503 here; anything else goes on to the app's error handler (JSON 400/500).
  router.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent || !sendTravelError(res, err)) next(err);
  });

  return router;
}
