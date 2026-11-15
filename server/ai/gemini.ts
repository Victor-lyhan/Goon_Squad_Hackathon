// A small, generic Gemini structured-output client (docs/mvp4.md F1). One POST to `generateContent`, the answer
// parsed as JSON. The parse-request route calls it and falls back to the offline parser on any GeminiUnavailable.
// Rules it enforces (the same safety pattern as server/geo/googleClient.ts):
// - the key travels only in the `x-goog-api-key` header, never as `?key=` in the URL;
// - `fetch` is injected, so tests never touch the network or a key;
// - every error is a GeminiUnavailable built from fixed text (plus an HTTP status number or the time limit):
//   never the key, the response body or the text of a thrown error (which can quote a header, and so the key);
// - one attempt, no retry, and a hard time limit, so the caller can fall back fast;
// - this file logs nothing and never reads the environment (the caller does, with server/ai/env.ts).
import type { FetchLike } from '../geo/googleClient';

export const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
/** docs/mvp4.md F1: after 6 s the offline parser takes over. */
export const DEFAULT_GEMINI_TIMEOUT_MS = 6000;

export type GeminiUnavailableReason =
  /** `apiKey` was null or blank. Nothing was sent. */
  | 'no_key'
  /** `model` was blank. Nothing was sent. */
  | 'no_model'
  /** No complete answer within `timeoutMs`. The request was aborted. */
  | 'timeout'
  /** The request failed without an HTTP answer. */
  | 'network'
  /** An HTTP status outside 200-299 (`status` holds it): 400 bad request, 403 bad key, 404 unknown model, 429 quota, 5xx. */
  | 'http'
  /** The response, or the text of its first candidate, was not JSON. */
  | 'bad_json'
  /** No candidate, or a first candidate without text (for example a blocked prompt). */
  | 'empty';

const MESSAGES: Record<Exclude<GeminiUnavailableReason, 'timeout' | 'http'>, string> = {
  no_key: 'GEMINI_API_KEY is not set',
  no_model: 'no model name was given',
  network: 'the request failed before an answer arrived',
  bad_json: 'the answer was not valid JSON',
  empty: 'the answer had no text',
};

/** Gemini gave no usable answer. Safe to show or log: its text never holds the key or the response body. */
export class GeminiUnavailable extends Error {
  readonly reason: GeminiUnavailableReason;
  /** The HTTP status when `reason` is 'http', else null. */
  readonly status: number | null;

  constructor(reason: GeminiUnavailableReason, detail: { status?: number; timeoutMs?: number } = {}) {
    const status = reason === 'http' && Number.isInteger(detail.status) ? (detail.status as number) : null;
    const what =
      reason === 'http'
        ? `HTTP ${status ?? 'error'}`
        : reason === 'timeout'
          ? `no answer within ${Number.isFinite(detail.timeoutMs) ? detail.timeoutMs : '?'} ms`
          : MESSAGES[reason];
    super(`Gemini is unavailable: ${what}.`);
    this.name = 'GeminiUnavailable';
    this.reason = reason;
    this.status = status;
  }
}

export interface GenerateJsonOptions {
  /** GEMINI_API_KEY (`geminiKey(env)` of server/ai/env.ts). Null or blank: GeminiUnavailable 'no_key', nothing is sent. */
  apiKey: string | null;
  /** Model name, e.g. `gemini-2.5-flash` (`geminiModel(env)`). A leading `models/` is fine. */
  model: string;
  /** The system instruction. Blank: none is sent. */
  systemText: string;
  /** The user's text, sent as the one user turn. */
  userText: string;
  /** Gemini `responseSchema` (its OpenAPI-style schema object) the answer must follow. */
  responseSchema: Record<string, unknown>;
  /** Time limit of the whole call, the body included. Defaults to 6000. */
  timeoutMs?: number;
  /** Defaults to the global `fetch` (Node 22). */
  fetchImpl?: FetchLike;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The `generateContent` URL of a model. The name is encoded, so it can never add a query string. */
export function generateContentUrl(model: string): string {
  return `${GEMINI_MODELS_URL}/${encodeURIComponent(model.trim().replace(/^models\//, ''))}:generateContent`;
}

/** The text of the first candidate: its text parts joined, "thought" parts left out. Null when there is none. */
function firstCandidateText(json: unknown): string | null {
  if (!isRecord(json) || !Array.isArray(json.candidates)) return null;
  const candidate: unknown = json.candidates[0];
  if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) return null;
  let text = '';
  for (const part of candidate.content.parts) {
    if (isRecord(part) && typeof part.text === 'string' && part.thought !== true) text += part.text;
  }
  return text.trim() === '' ? null : text;
}

/**
 * Asks Gemini for a JSON answer that follows `responseSchema` and returns it parsed. The caller validates the
 * value (it is `unknown`): the schema guides the model, it is not a guarantee.
 * Throws GeminiUnavailable (see GeminiUnavailableReason) and nothing else.
 */
export async function generateJson(opts: GenerateJsonOptions): Promise<unknown> {
  const { systemText, userText, responseSchema, timeoutMs = DEFAULT_GEMINI_TIMEOUT_MS, fetchImpl = fetch } = opts;
  const apiKey = typeof opts.apiKey === 'string' ? opts.apiKey.trim() : '';
  if (apiKey === '') throw new GeminiUnavailable('no_key');
  if (typeof opts.model !== 'string' || opts.model.trim() === '') throw new GeminiUnavailable('no_model');

  const body = JSON.stringify({
    ...(systemText.trim() === '' ? {} : { systemInstruction: { parts: [{ text: systemText }] } }),
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema },
  });

  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Raced against the call as well as aborting it, so the limit holds even for a fetch that ignores the signal.
  const limit = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new GeminiUnavailable('timeout', { timeoutMs }));
    }, timeoutMs);
  });

  const call = async (): Promise<unknown> => {
    let status: number;
    let text: string;
    try {
      const res = await fetchImpl(generateContentUrl(opts.model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body,
        signal: controller.signal,
      });
      status = res.status;
      text = await res.text();
    } catch {
      // The thrown error is dropped, not attached as `cause`: its text can quote a request header, and so the key.
      throw new GeminiUnavailable(timedOut ? 'timeout' : 'network', { timeoutMs });
    }
    if (!(status >= 200 && status < 300)) throw new GeminiUnavailable('http', { status });
    let answer: string | null;
    try {
      answer = firstCandidateText(JSON.parse(text));
    } catch {
      throw new GeminiUnavailable('bad_json');
    }
    if (answer === null) throw new GeminiUnavailable('empty');
    try {
      return JSON.parse(answer) as unknown;
    } catch {
      throw new GeminiUnavailable('bad_json');
    }
  };

  try {
    return await Promise.race([call(), limit]);
  } finally {
    clearTimeout(timer);
  }
}
