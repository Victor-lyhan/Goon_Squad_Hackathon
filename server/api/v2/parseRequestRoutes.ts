// POST /api/v2/parse-request (docs/mvp4.md F1, DECISIONS pass 80; contract: shared/v2/parseRequest.ts).
// One plain-English sentence in, an editable DRAFT of a delivery request out. The route only reads:
// it takes the run's businesses and clock minute from the store once and never calls `store.mutate`,
// so the run, its version and the state file stay as they are, and it answers while the run is locked.
// Nothing is submitted here: the page's Send button posts the confirmed draft to POST /shipments.
// For now every draft comes from the offline rule parser (`source: 'offline'`); the Gemini call and its
// fallback are plugged in by a later issue.
import type express from 'express';
import { ParseRequestBody, type ParseRequestResponse } from '../../../shared/v2/parseRequest';
import type { ApiError } from '../../../shared/v2/schemas';
import type { Run as RunV2 } from '../../../shared/v2/types';
import { parseOffline } from '../../ai/ruleParser';
import type { Store } from '../../store';

export type ParseRequestRouteDeps = {
  /** Only `get` is used. */
  store: Pick<Store<RunV2>, 'get'>;
};

export const INVALID_PARSE_REQUEST = 'Invalid request text';
export const PARSE_TEXT_REQUIRED = 'Describe the delivery in one sentence';

/** Registers the route on the v2 router. The path is relative to /api/v2. */
export function registerParseRequestRoutes(router: express.Router, deps: ParseRequestRouteDeps): void {
  const { store } = deps;

  router.post('/parse-request', (
    req: express.Request, res: express.Response<ParseRequestResponse | ApiError>, next: express.NextFunction,
  ) => {
    try {
      const parsed = ParseRequestBody.safeParse(req.body);
      if (!parsed.success) {
        // The body has one field, so every problem is shown beside the text box. No message repeats the text.
        const issue = parsed.error.issues.find((i) => i.path[0] === 'text' && typeof i.message === 'string');
        res.status(400).json({ error: INVALID_PARSE_REQUEST, fieldErrors: { text: issue?.message ?? PARSE_TEXT_REQUIRED } });
        return;
      }
      const run = store.get();
      res.json(parseOffline(parsed.data.text, { businesses: run.scenario.businesses, nowMin: run.clock.timeMin }));
    } catch (err) {
      next(err);
    }
  });
}
