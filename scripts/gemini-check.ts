// A one-command check of the real Gemini key, for a human (no agent and no test can call Gemini):
//
//   npx tsx scripts/gemini-check.ts "Deliver an envelope from Etsy to Brooklyn Roasting by 10 a.m. tomorrow."
//
// It does what POST /api/v2/parse-request does for one sentence (docs/mvp4.md F1): `.env` is loaded the way
// server/index.ts loads it, the default NYC run is built from fixtures/nyc (the cache only; the saved state
// file is neither read nor written), and the sentence goes to `parseWithGemini`, the parser the route uses,
// with the route's 6 s limit. When Gemini gives no draft the offline parser answers, as in the route.
// It prints the model, the source (gemini / offline), the elapsed ms, on a fallback the reason (`HTTP 400`,
// `timeout`, `no key`, ...) and the draft as JSON.
// Exit code: 0 Gemini filled the draft, 1 it fell back to the offline parser, 2 the check could not run
// (no sentence, no NYC travel data).
// The key is only handed to the parser, which sends it in the `x-goog-api-key` header. No line names it,
// and every line is passed through `withoutSecret` before it is printed.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ParseRequestBody, type ParseRequestResponse } from '../shared/v2/parseRequest';
import { DEFAULT_ENV_PATH, geminiKey, geminiModel, loadDotEnv } from '../server/ai/env';
import { DEFAULT_GEMINI_TIMEOUT_MS, thinkingConfigFor } from '../server/ai/gemini';
import { parseWithGemini, type GeminiParseFailure } from '../server/ai/geminiParser';
import { parseOffline } from '../server/ai/ruleParser';
import { NYC_FIXTURES_DIR, buildDefaultRun, readNycFixtures } from '../server/api/v2/bootRun';
import { readTravelFiles } from '../server/geo/cache';
import type { FetchLike } from '../server/geo/googleClient';
import { createCachedProvider } from '../server/geo/providers';

export const EXAMPLE_SENTENCE = 'Deliver an envelope from Etsy to Brooklyn Roasting by 10 a.m. tomorrow.';

export const USAGE = `Usage: npx tsx scripts/gemini-check.ts "<one sentence that asks for a delivery>"

Sends the sentence to Gemini the way POST /api/v2/parse-request does, with the key and the model of .env,
and prints the model, the source (gemini or offline), the elapsed ms and the draft.
Without a sentence it asks: ${EXAMPLE_SENTENCE}
Exit code: 0 parsed by Gemini, 1 parsed offline (the reason is printed), 2 the check could not run.`;

export const EXIT_GEMINI = 0;
export const EXIT_OFFLINE = 1;
export const EXIT_NOT_RUN = 2;

/** The reason as the check prints it. `http` gets its status from the outcome's message: "HTTP 400". */
const REASONS: Record<GeminiParseFailure, string> = {
  no_key: 'no key',
  no_model: 'no model',
  timeout: 'timeout',
  network: 'network error',
  http: 'HTTP error',
  bad_json: 'not JSON',
  empty: 'empty answer',
  invalid_answer: 'unusable answer',
  error: 'error',
};

/** What a human can do about it, where that is known. Fixed text. */
const HINTS: Partial<Record<string, string>> = {
  'no key': 'add GEMINI_API_KEY to .env at the repo root and run the check again.',
  timeout: 'the answer took longer than the limit; a faster model can be set with GEMINI_MODEL in .env.',
  'network error': 'no answer arrived; check the internet connection.',
  'HTTP 400': 'Gemini refused the request (or the key is not valid); for a model other than 2.5 Flash, check that it takes this request.',
  'HTTP 401': 'Gemini refused the key.',
  'HTTP 403': 'Gemini refused the key, or the key may not use this model.',
  'HTTP 404': 'this key cannot use this model, or the model does not exist; set another one with GEMINI_MODEL in .env.',
  'HTTP 429': 'the quota of this key is used up; wait, or use another model or key.',
};

/** The reason of a fallback in a few words: `HTTP 400`, `timeout`, `no key`, ... */
export function reasonLabel(reason: GeminiParseFailure, message: string): string {
  return reason === 'http' ? /HTTP \d{3}/.exec(message)?.[0] ?? REASONS.http : REASONS[reason];
}

/** `text` with every occurrence of `secret` (as it is and URL-encoded) replaced. A null or blank secret hides nothing. */
export function withoutSecret(text: string, secret: string | null): string {
  if (secret === null || secret.trim() === '') return text;
  let safe = text;
  for (const form of new Set([secret, secret.trim(), encodeURIComponent(secret.trim())])) safe = safe.split(form).join('[hidden]');
  return safe;
}

export type GeminiCheckOptions = {
  /** The command line after the script name. Its words are joined into the sentence. */
  argv: string[];
  /** `process.env` in the real command. `.env` is loaded into it; a variable that is already set wins. */
  env: Record<string, string | undefined>;
  /** `DEFAULT_ENV_PATH` (the repo-root `.env`) in the real command. Tests give a temp file. */
  envPath: string;
  /** Gets every line of the report. */
  out: (line: string) => void;
  /** Folder of the travel cache and the NYC fixture files. Default: fixtures/nyc. */
  fixturesDir?: string;
  /** Defaults to the global `fetch`. Tests give a fake. */
  fetchImpl?: FetchLike;
  /** Time limit of the call. Default: the route's 6 s. */
  timeoutMs?: number;
  /** A clock in ms for the elapsed time. Default: `performance.now`. */
  now?: () => number;
};

/** Runs the check and returns the exit code (see the head of this file). It never throws. */
export async function runGeminiCheck(opts: GeminiCheckOptions): Promise<number> {
  // As server/index.ts does: `.env` first, then the settings are read from the environment.
  loadDotEnv(opts.envPath, opts.env);
  const secret = geminiKey(opts.env);
  const lines: string[] = [];
  let code: number;
  try {
    code = await check(opts, secret, geminiModel(opts.env), lines);
  } catch (error) {
    lines.push(`The check could not run: ${error instanceof Error ? error.message : 'unexpected error'}`);
    code = EXIT_NOT_RUN;
  }
  for (const line of lines) opts.out(withoutSecret(line, secret));
  return code;
}

/** The check itself: adds the report to `lines` and returns the exit code. */
async function check(opts: GeminiCheckOptions, secret: string | null, model: string, lines: string[]): Promise<number> {
  if (opts.argv.some((arg) => arg === '--help' || arg === '-h')) {
    lines.push(USAGE);
    return EXIT_GEMINI;
  }

  // The route's own check of the text: trimmed, 1 to 500 characters.
  const typed = opts.argv.join(' ').trim();
  const body = ParseRequestBody.safeParse({ text: typed === '' ? EXAMPLE_SENTENCE : typed });
  if (!body.success) {
    lines.push(`The sentence cannot be sent: ${body.error.issues[0]?.message ?? 'it is not valid'}.`, USAGE);
    return EXIT_NOT_RUN;
  }
  const { text } = body.data;

  const fixturesDir = opts.fixturesDir ?? NYC_FIXTURES_DIR;
  const files = readTravelFiles(fixturesDir);
  if (!files) {
    lines.push(`No travel cache in ${fixturesDir} (matrix.json): the NYC run cannot be built.`);
    return EXIT_NOT_RUN;
  }
  const run = buildDefaultRun({
    travel: createCachedProvider(files), places: files.matrix.places, fixtures: readNycFixtures(fixturesDir),
  });
  const { businesses, settings } = run.scenario;
  const nowMin = run.clock.timeMin;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS;
  const now = opts.now ?? (() => performance.now());
  const started = now();
  const outcome = await parseWithGemini(
    text,
    { businesses, nowMin, windowStartMin: settings.simStartMin, windowEndMin: settings.simEndMin },
    { apiKey: secret, model, timeoutMs, ...(opts.fetchImpl === undefined ? {} : { fetchImpl: opts.fetchImpl }) },
  );
  const elapsedMs = Math.max(0, Math.round(now() - started));
  // As in the route: without a Gemini draft the offline parser answers.
  const response: ParseRequestResponse = outcome.ok ? outcome.response : parseOffline(text, { businesses, nowMin });

  lines.push(
    `sentence: ${text}`,
    `model: ${model} (${thinkingConfigFor(model) === null ? 'thinking: the model default' : 'thinking: off'})`,
    `source: ${response.source}`,
    `elapsed: ${elapsedMs} ms (limit ${timeoutMs} ms)`,
  );
  if (!outcome.ok) {
    const label = reasonLabel(outcome.reason, outcome.message);
    lines.push(`reason: ${label} (${outcome.message})`);
    const hint = HINTS[label];
    if (hint !== undefined) lines.push(`hint: ${hint}`);
  }
  lines.push(
    `draft: ${JSON.stringify(response.draft, null, 2)}`,
    `missing: ${response.missing.length === 0 ? 'nothing' : response.missing.join(', ')}`,
    `rejected: ${response.rejected ?? 'nothing'}`,
  );
  return outcome.ok ? EXIT_GEMINI : EXIT_OFFLINE;
}

const isEntry = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isEntry) {
  void runGeminiCheck({
    argv: process.argv.slice(2),
    env: process.env,
    envPath: DEFAULT_ENV_PATH,
    out: (line) => console.log(line),
  }).then((code) => {
    process.exitCode = code;
  });
}
