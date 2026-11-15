// POST /api/v2/parse-request (docs/mvp4.md F1, DECISIONS pass 80; contract: shared/v2/parseRequest.ts).
// One plain-English sentence in, an editable DRAFT of a delivery request out. The route only reads:
// it takes the run's businesses and clock minute from the store once and never calls `store.mutate`,
// so the run, its version and the state file stay as they are, and it answers while the run is locked.
// Nothing is submitted here: the page's Send button posts the confirmed draft to POST /shipments.
// Gemini is asked first (server/ai/geminiParser.ts: prompt, response schema, checks). The offline rule parser
// answers instead, with `source: 'offline'`, when there is no key (then nothing is sent at all), when the
// call fails or takes longer than its time limit (6 s), or when the answer is no usable draft. So Gemini
// can never make this route answer 5xx, and the key and Gemini's text reach no body and no log line.
import type express from 'express';
import { ParseRequestBody, type ParseRequestResponse } from '../../../shared/v2/parseRequest';
import type { ApiError } from '../../../shared/v2/schemas';
import type { Run as RunV2 } from '../../../shared/v2/types';
import { parseWithGemini, type GeminiParseSettings } from '../../ai/geminiParser';
import { parseOffline } from '../../ai/ruleParser';
import type { Store } from '../../store';

export type ParseRequestRouteDeps = {
  /** Only `get` is used. */
  store: Pick<Store<RunV2>, 'get'>;
  /**
   * The Gemini settings (`geminiKey(env)` and `geminiModel(env)` of server/ai/env.ts, read once by the
   * caller). Left out, or with a null or blank key: every sentence is parsed offline and nothing is sent.
   */
  gemini?: GeminiParseSettings;
  /**
   * Gets one line when Gemini had a key but gave no draft, e.g. "[parse-request] Gemini is unavailable:
   * HTTP 403. Parsed offline." Fixed text only: never the key, the sentence or Gemini's answer.
   */
  log?: (line: string) => void;
};

/** The line for `deps.log` after a failed Gemini call. `message` is the fixed text of the outcome. */
export const fallbackLogLine = (message: string) => `[parse-request] ${message} Parsed offline.`;

export const INVALID_PARSE_REQUEST = 'Invalid request text';
export const PARSE_TEXT_REQUIRED = 'Describe the delivery in one sentence';

/** Registers the route on the v2 router. The path is relative to /api/v2. */
export function registerParseRequestRoutes(router: express.Router, deps: ParseRequestRouteDeps): void {
  const { store } = deps;

  router.post('/parse-request', async (
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
      const { text } = parsed.data;
      // The run is read once, before the call: the prompt, the checks and the fallback see the same minute.
      const run = store.get();
      const { businesses, settings } = run.scenario;
      const nowMin = run.clock.timeMin;

      if (hasKey(deps.gemini)) {
        const outcome = await parseWithGemini(
          text, { businesses, nowMin, windowStartMin: settings.simStartMin, windowEndMin: settings.simEndMin }, deps.gemini,
        );
        if (outcome.ok) {
          res.json(outcome.response);
          return;
        }
        try {
          deps.log?.(fallbackLogLine(outcome.message));
        } catch {
          // a log that fails must not cost the sender the offline draft
        }
      }
      res.json(parseOffline(text, { businesses, nowMin }));
    } catch (err) {
      next(err);
    }
  });
}

/** True when a Gemini call can be made at all. Without a key the route goes straight to the offline parser. */
function hasKey(gemini: GeminiParseSettings | undefined): gemini is GeminiParseSettings {
  return typeof gemini?.apiKey === 'string' && gemini.apiKey.trim() !== '';
}
