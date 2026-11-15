// POST /api/v2/parse-request (docs/mvp4.md F1, DECISIONS pass 80; contract: shared/v2/parseRequest.ts).
// One plain-English sentence in, an editable DRAFT of a delivery request out. The route only reads:
// it takes the run's businesses and clock minute from the store once and never calls `store.mutate`,
// so the run, its version and the state file stay as they are, and it answers while the run is locked.
// Nothing is submitted here: the page's Send button posts the confirmed draft to POST /shipments.
// Gemini is asked first (server/ai/geminiParser.ts: prompt, response schema, checks). The offline rule parser
// answers instead, with `source: 'offline'`, when there is no key (then nothing is sent at all), when the
// call fails or takes longer than its time limit (6 s), or when the answer is no usable draft. So Gemini
// can never make this route answer 5xx, and the key and Gemini's text reach no body and no log line.
// Every answered sentence gives exactly one line saying who wrote the draft (#811): Gemini with its model and
// time, the offline parser because there is no key (both to `info`), or the offline parser with the reason
// Gemini gave no draft (to `log`). No line holds the key, the sentence, the draft or Gemini's answer.
// After one failed Gemini call the shared pause is on for 2 minutes (#884, server/ai/geminiPause.ts): Gemini is
// not asked, the offline parser answers at once, and the line (to `log`) says so and why:
// "[parse-request] Parsed offline: Gemini paused after timeout, next try in 87 s."
import type express from 'express';
import { ParseRequestBody, type ParseRequestResponse } from '../../../shared/v2/parseRequest';
import type { ApiError } from '../../../shared/v2/schemas';
import type { Run as RunV2 } from '../../../shared/v2/types';
import type { GeminiPause } from '../../ai/geminiPause';
import { parseWithGeminiUnlessPaused, type GeminiParseSettings } from '../../ai/geminiParser';
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
   * The pause shared with POST /advise (#884): after one failed Gemini call neither route asks Gemini for
   * 2 minutes. The app gives one (server/index.ts). Left out: every sentence asks Gemini, as before #884.
   */
  pause?: GeminiPause;
  /**
   * Gets one line when Gemini had a key but gave no draft, e.g. "[parse-request] Gemini is unavailable:
   * HTTP 403. Parsed offline.", or `pausedLogLine` when Gemini was not asked because it is paused.
   * Fixed text only: never the key, the sentence or Gemini's answer.
   */
  log?: (line: string) => void;
  /**
   * Gets one line for each answered sentence `log` says nothing about, so that every sentence has exactly one
   * line: "[parse-request] Parsed by Gemini (gemini-2.5-flash, 1840 ms)." when Gemini wrote the draft, and
   * `NO_KEY_LOG_LINE` when there is no key. Left out: no such line. The app gives `console.info` (server/index.ts).
   */
  info?: (line: string) => void;
};

/** The line for `deps.log` after a failed Gemini call. `message` is the fixed text of the outcome. */
export const fallbackLogLine = (message: string) => `[parse-request] ${message} Parsed offline.`;

/**
 * The line for `deps.log` when Gemini was not asked because it is paused. `message` is `pausedMessage` of
 * server/ai/geminiPause.ts: "[parse-request] Parsed offline: Gemini paused after timeout, next try in 87 s."
 */
export const pausedLogLine = (message: string) => `[parse-request] Parsed offline: ${message}`;

/** The line for `deps.info` when no key was given: the card says "Parsed offline" and this says why. */
export const NO_KEY_LOG_LINE = '[parse-request] Parsed offline: no key (GEMINI_API_KEY is not set).';

/** The line for `deps.info` when Gemini wrote the draft: the model that was asked and how long the call took. */
export function geminiLogLine(model: string, ms: number): string {
  // GEMINI_MODEL comes from .env: only the characters of a model name are printed, on one line.
  const name = model.replace(/[^\w.:/-]/g, '').slice(0, 60) || 'unknown model';
  const took = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
  return `[parse-request] Parsed by Gemini (${name}, ${took} ms).`;
}

/** Gives `line` to a log. A log that fails must not cost the sender the draft. */
function tell(log: ((line: string) => void) | undefined, line: string): void {
  try {
    log?.(line);
  } catch {
    // the draft matters more than its log line
  }
}

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

      const gemini = hasKey(deps.gemini) ? deps.gemini : null;
      if (gemini) {
        const startedMs = Date.now();
        const outcome = await parseWithGeminiUnlessPaused(
          text, { businesses, nowMin, windowStartMin: settings.simStartMin, windowEndMin: settings.simEndMin }, gemini,
          deps.pause,
        );
        if (outcome.ok) {
          tell(deps.info, geminiLogLine(gemini.model, Date.now() - startedMs));
          res.json(outcome.response);
          return;
        }
        tell(deps.log, outcome.reason === 'paused' ? pausedLogLine(outcome.message) : fallbackLogLine(outcome.message));
      }
      const offline = parseOffline(text, { businesses, nowMin });
      if (!gemini) tell(deps.info, NO_KEY_LOG_LINE);
      res.json(offline);
    } catch (err) {
      next(err);
    }
  });
}

/** True when a Gemini call can be made at all. Without a key the route goes straight to the offline parser. */
function hasKey(gemini: GeminiParseSettings | undefined): gemini is GeminiParseSettings {
  return typeof gemini?.apiKey === 'string' && gemini.apiKey.trim() !== '';
}
