// A small, generic Gemini structured-output client (docs/mvp4.md F1). One POST to `generateContent`, the answer
// parsed as JSON. The parse-request route calls it and falls back to the offline parser on any GeminiUnavailable.
// Rules it enforces (the same safety pattern as server/geo/googleClient.ts):
// - the key travels only in the `x-goog-api-key` header, never as `?key=` in the URL;
// - `fetch` is injected, so tests never touch the network or a key;
// - every error is a GeminiUnavailable built from fixed text (plus an HTTP status number or the time limit):
//   never the key, the response body or the text of a thrown error (which can quote a header, and so the key);
// - one attempt, no retry, and a hard time limit, so the caller can fall back fast;
// - thinking is turned off for the 2.5 Flash models (`thinkingConfigFor`), so an answer fits that limit;
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
  /**
   * `generationConfig.thinkingConfig` to send instead of the default of `thinkingConfigFor` (#959: the advisor
   * asks gemini-3.x Flash for minimal thinking). Null: none is sent. Left out: `thinkingConfigFor(model)`.
   */
  thinkingConfig?: Record<string, unknown> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The model id as the API names it: trimmed, without a leading `models/`. */
function modelId(model: string): string {
  return model.trim().replace(/^models\//, '');
}

/** The `generateContent` URL of a model. The name is encoded, so it can never add a query string. */
export function generateContentUrl(model: string): string {
  return `${GEMINI_MODELS_URL}/${encodeURIComponent(modelId(model))}:generateContent`;
}

/** Model ids that start with this take a thinking budget of 0: `gemini-2.5-flash` and `gemini-2.5-flash-lite`. */
export const NO_THINKING_MODEL_PREFIX = 'gemini-2.5-flash';

/**
 * The `generationConfig.thinkingConfig` of a model, or null when none is sent.
 * 2.5 Flash thinks by default, which can push an answer past the 6 s limit (PR #793), so its budget is set
 * to 0: thinking off. Every other model gets no `thinkingConfig` and keeps its default: `gemini-2.5-pro`
 * cannot turn thinking off (a budget of 0 is an HTTP 400 there), and other model families take other settings.
 */
export function thinkingConfigFor(model: string): { thinkingBudget: 0 } | null {
  return modelId(model).toLowerCase().startsWith(NO_THINKING_MODEL_PREFIX) ? { thinkingBudget: 0 } : null;
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

/** What every `generateContent` call shares: the key, the model, the time limit and the injected `fetch`. */
interface CallSettings {
  apiKey: string | null;
  model: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

/**
 * POSTs `body` to the model's `generateContent` and returns the parsed response JSON. The one place that sends
 * the key (in the `x-goog-api-key` header), enforces the time limit and turns every failure into a GeminiUnavailable.
 */
async function postGenerateContent(settings: CallSettings, body: Record<string, unknown>): Promise<unknown> {
  const { timeoutMs = DEFAULT_GEMINI_TIMEOUT_MS, fetchImpl = fetch } = settings;
  const apiKey = typeof settings.apiKey === 'string' ? settings.apiKey.trim() : '';
  if (apiKey === '') throw new GeminiUnavailable('no_key');
  if (typeof settings.model !== 'string' || settings.model.trim() === '') throw new GeminiUnavailable('no_model');
  if (!(timeoutMs > 0)) throw new GeminiUnavailable('timeout', { timeoutMs: 0 });
  const payload = JSON.stringify(body);

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
      const res = await fetchImpl(generateContentUrl(settings.model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: payload,
        signal: controller.signal,
      });
      status = res.status;
      text = await res.text();
    } catch {
      // The thrown error is dropped, not attached as `cause`: its text can quote a request header, and so the key.
      throw new GeminiUnavailable(timedOut ? 'timeout' : 'network', { timeoutMs });
    }
    if (!(status >= 200 && status < 300)) throw new GeminiUnavailable('http', { status });
    try {
      return JSON.parse(text) as unknown;
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

/** `generationConfig.thinkingConfig` when the model takes one, else nothing. */
function thinkingFields(model: string): Record<string, unknown> {
  const thinkingConfig = thinkingConfigFor(model);
  return thinkingConfig === null ? {} : { thinkingConfig };
}

/**
 * Asks Gemini for a JSON answer that follows `responseSchema` and returns it parsed. The caller validates the
 * value (it is `unknown`): the schema guides the model, it is not a guarantee.
 * Throws GeminiUnavailable (see GeminiUnavailableReason) and nothing else.
 */
export async function generateJson(opts: GenerateJsonOptions): Promise<unknown> {
  const { systemText, userText, responseSchema } = opts;
  const json = await postGenerateContent(opts, {
    ...(systemText.trim() === '' ? {} : { systemInstruction: { parts: [{ text: systemText }] } }),
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
      ...(opts.thinkingConfig === undefined
        ? thinkingFields(opts.model)
        : opts.thinkingConfig === null ? {} : { thinkingConfig: opts.thinkingConfig }),
    },
  });
  const answer = firstCandidateText(json);
  if (answer === null) throw new GeminiUnavailable('empty');
  try {
    return JSON.parse(answer) as unknown;
  } catch {
    throw new GeminiUnavailable('bad_json');
  }
}

// ---------- Function calling (the AI advisor, #862) ----------

/** One turn of a function-calling conversation, in the API's shape. Model turns are sent back exactly as received. */
export type GeminiContent = { role: 'user' | 'model'; parts: Record<string, unknown>[] };

/** A function the model may call: name, description and its OpenAPI-style `parameters` schema. */
export type GeminiFunctionDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/** A function call of the model's turn. `args` is `unknown` on purpose: the caller validates every argument. */
export type GeminiFunctionCall = { name: string; args: unknown };

export interface GenerateWithToolsOptions extends CallSettings {
  systemText: string;
  /** The conversation so far: the user's turn, then model turns and the `functionResponse` turns that answer them. */
  contents: GeminiContent[];
  functions: GeminiFunctionDeclaration[];
  /** 'ANY': the model must call one of the functions (no free text). Defaults to 'AUTO'. */
  mode?: 'AUTO' | 'ANY';
}

export type ToolTurn = {
  /** The model's turn, to append to `contents` before the function responses. */
  content: GeminiContent;
  /** Its function calls, in order. Empty when the model only wrote text. */
  calls: GeminiFunctionCall[];
  /** Its text parts joined ("thought" parts left out); '' when there is none. */
  text: string;
};

/**
 * One model turn with function calling. Same rules as `generateJson`: the key only in the header, one attempt,
 * a hard time limit, nothing logged. Throws GeminiUnavailable ('empty' when the first candidate has no parts).
 */
export async function generateWithTools(opts: GenerateWithToolsOptions): Promise<ToolTurn> {
  const json = await postGenerateContent(opts, {
    ...(opts.systemText.trim() === '' ? {} : { systemInstruction: { parts: [{ text: opts.systemText }] } }),
    contents: opts.contents,
    tools: [{ functionDeclarations: opts.functions }],
    toolConfig: { functionCallingConfig: { mode: opts.mode ?? 'AUTO' } },
    generationConfig: { ...thinkingFields(opts.model) },
  });
  if (!isRecord(json) || !Array.isArray(json.candidates)) throw new GeminiUnavailable('empty');
  const candidate: unknown = json.candidates[0];
  if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) {
    throw new GeminiUnavailable('empty');
  }
  const parts = candidate.content.parts.filter(isRecord);
  if (parts.length === 0) throw new GeminiUnavailable('empty');
  const calls: GeminiFunctionCall[] = [];
  let text = '';
  for (const part of parts) {
    const fc = part.functionCall;
    if (isRecord(fc) && typeof fc.name === 'string') calls.push({ name: fc.name, args: fc.args ?? {} });
    if (typeof part.text === 'string' && part.thought !== true) text += part.text;
  }
  return { content: { role: 'model', parts }, calls, text: text.trim() };
}
