// scripts/gemini-check.ts, the human's one-command check of the real Gemini key, run here through its main
// function with a fake fetch: no network, no real key, and never the repo's `.env` (every run gets a temp path).
// The NYC run is built from the committed fixtures/nyc, as the script does.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GEMINI_MODELS_URL } from '../../server/ai/gemini';
import { PARSE_RESPONSE_SCHEMA } from '../../server/ai/geminiParser';
import type { FetchInitLike, FetchLike } from '../../server/geo/googleClient';
import { PARSE_TEXT_MAX } from '../../shared/v2/parseRequest';
import {
  EXAMPLE_SENTENCE, EXIT_GEMINI, EXIT_NOT_RUN, EXIT_OFFLINE, USAGE,
  reasonLabel, runGeminiCheck, withoutSecret, type GeminiCheckOptions,
} from '../../scripts/gemini-check';

// Not a real key. It starts with `AQ` like a new AI Studio key and has characters that change when URL-encoded.
const KEY = 'AQ.FAKE_check-456+/=';
const KEY_ENCODED = encodeURIComponent(KEY);
/** A marker put into error bodies, to show that no body text is printed. */
const BODY_MARKER = 'BODY-MARKER-91c4';
const T = 30_000;

/** What a well-behaved Gemini answers to the example sentence. */
const GOOD = {
  originBusinessId: 'biz-etsy',
  destinationBusinessId: 'biz-brooklyn-roasting',
  label: 'Envelope',
  category: 'envelope',
  description: null,
  weightKg: null,
  readyMin: null,
  deadlineMin: 2040,
  rejected: [],
};

interface Call {
  url: string;
  init?: FetchInitLike;
}
type Reply = { status: number; body: unknown };

function fakeFetch(reply: (call: Call) => Reply) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    const answer = reply(call);
    return { status: answer.status, text: async () => (typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body)) };
  };
  return { calls, fetchImpl };
}

/** A fetch that never answers and, like the real one, rejects when its signal aborts (quoting the key, as a real error might). */
function hangingFetch() {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, init });
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException(`aborted ${KEY}`, 'AbortError')));
    });
  };
  return { calls, fetchImpl };
}

const geminiSays = (answer: unknown): Reply => ({
  status: 200,
  body: { candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(answer) }] }, finishReason: 'STOP' }] },
});

const temps: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-check-'));
  temps.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Runs the check with a `.env` that does not exist unless `dotEnv` gives its text. Returns the exit code and what was printed. */
async function run(
  fetchImpl: FetchLike,
  extra: Partial<GeminiCheckOptions> & { dotEnv?: string } = {},
): Promise<{ code: number; lines: string[]; text: string }> {
  const { dotEnv, ...options } = extra;
  const envPath = path.join(tempDir(), '.env');
  if (dotEnv !== undefined) fs.writeFileSync(envPath, dotEnv);
  const lines: string[] = [];
  // A clock that moves 250 ms per reading: the elapsed time of every run is 250 ms.
  let clock = 1000;
  const code = await runGeminiCheck({
    argv: [EXAMPLE_SENTENCE],
    env: { GEMINI_API_KEY: KEY },
    envPath,
    out: (line) => void lines.push(line),
    fetchImpl,
    now: () => (clock += 250),
    ...options,
  });
  return { code, lines, text: lines.join('\n') };
}

/** No form of the key, and no response body, in anything that was printed. */
function expectNoKey(text: string) {
  expect(text).not.toContain(KEY);
  expect(text).not.toContain(KEY_ENCODED);
  expect(text).not.toContain('FAKE_check');
  expect(text).not.toContain(BODY_MARKER);
}

/** The draft the report printed after `draft: `. */
function printedDraft(lines: string[]): unknown {
  const line = lines.find((entry) => entry.startsWith('draft: '));
  if (line === undefined) throw new Error(`no draft line in:\n${lines.join('\n')}`);
  return JSON.parse(line.slice('draft: '.length));
}

describe('scripts/gemini-check.ts', () => {
  it('a good answer: exit 0, source gemini, the model, the elapsed ms and the draft, and never the key', async () => {
    const { calls, fetchImpl } = fakeFetch(() => geminiSays(GOOD));

    const { code, lines, text } = await run(fetchImpl);

    expect(code).toBe(EXIT_GEMINI);
    expect(code).toBe(0);
    expect(lines.slice(0, 4)).toEqual([
      `sentence: ${EXAMPLE_SENTENCE}`,
      'model: gemini-2.5-flash (thinking: off)',
      'source: gemini',
      'elapsed: 250 ms (limit 6000 ms)',
    ]);
    expect(text).not.toMatch(/^(reason|hint): /m);
    expect(printedDraft(lines)).toEqual({
      originBusinessId: 'biz-etsy',
      destinationBusinessId: 'biz-brooklyn-roasting',
      label: 'Envelope',
      category: 'envelope',
      description: null,
      weightKg: null,
      readyMin: 930, // the default NYC run's clock: Day 1 15:30
      deadlineMin: 2040,
    });
    expect(lines.slice(-2)).toEqual(['missing: description, weightKg', 'rejected: nothing']);
    expectNoKey(text);

    // One request, the one the route sends: the key in the header only, the route's schema, thinking off.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${GEMINI_MODELS_URL}/gemini-2.5-flash:generateContent`);
    expect(calls[0].url).not.toContain('?');
    expect(calls[0].init?.headers).toEqual({ 'Content-Type': 'application/json', 'x-goog-api-key': KEY });
    expect(calls[0].init?.body).not.toContain(KEY);
    const sent = JSON.parse(calls[0].init?.body ?? '{}');
    expect(sent.contents).toEqual([{ role: 'user', parts: [{ text: EXAMPLE_SENTENCE }] }]);
    expect(sent.generationConfig).toEqual({
      responseMimeType: 'application/json', responseSchema: PARSE_RESPONSE_SCHEMA, thinkingConfig: { thinkingBudget: 0 },
    });
    // The prompt is about the NYC run: its businesses and its clock.
    const prompt: string = sent.systemInstruction.parts[0].text;
    expect(prompt).toContain('- biz-etsy | Etsy | DUMBO');
    expect(prompt).toContain('- biz-brooklyn-roasting | Brooklyn Roasting Company | Brooklyn Navy Yard');
    expect(prompt).toContain('Current simulated time: Day 1 15:30 (minute 930).');
  }, T);

  it('HTTP 400: exit 1, source offline, the reason HTTP 400, the offline draft, and never the key or the body', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 400, body: `${BODY_MARKER} API key not valid: ${KEY}` }));

    const { code, lines, text } = await run(fetchImpl);

    expect(code).toBe(EXIT_OFFLINE);
    expect(code).toBe(1);
    expect(calls).toHaveLength(1);
    expect(lines).toContain('source: offline');
    expect(lines).toContain('reason: HTTP 400 (Gemini is unavailable: HTTP 400.)');
    expect(text).toMatch(/^hint: Gemini refused the request/m);
    // The offline parser filled the draft, as in the route.
    expect(printedDraft(lines)).toMatchObject({
      originBusinessId: 'biz-etsy', destinationBusinessId: 'biz-brooklyn-roasting', category: 'envelope', deadlineMin: 2040,
    });
    expectNoKey(text);
  }, T);

  it('no key: exit 1, the reason "no key", and no request is sent', async () => {
    for (const env of [{}, { GEMINI_API_KEY: '' }, { GEMINI_API_KEY: '   ' }]) {
      const { calls, fetchImpl } = fakeFetch(() => geminiSays(GOOD));

      const { code, lines, text } = await run(fetchImpl, { env });

      expect(code).toBe(1);
      expect(calls).toHaveLength(0);
      expect(lines).toContain('source: offline');
      expect(lines).toContain('reason: no key (Gemini is unavailable: GEMINI_API_KEY is not set.)');
      expect(lines).toContain('hint: add GEMINI_API_KEY to .env at the repo root and run the check again.');
      expect(printedDraft(lines)).toMatchObject({ originBusinessId: 'biz-etsy', destinationBusinessId: 'biz-brooklyn-roasting' });
    }
  }, T);

  it('no answer within the limit: exit 1 with the reason "timeout"', async () => {
    const { calls, fetchImpl } = hangingFetch();

    const { code, lines, text } = await run(fetchImpl, { timeoutMs: 30 });

    expect(code).toBe(1);
    expect(calls).toHaveLength(1);
    expect(lines).toContain('elapsed: 250 ms (limit 30 ms)');
    expect(lines).toContain('reason: timeout (Gemini is unavailable: no answer within 30 ms.)');
    expectNoKey(text);
  }, T);

  it('the other ways to fail are named too, each with exit 1', async () => {
    const cases: [Reply | Error, string][] = [
      [{ status: 403, body: BODY_MARKER }, 'reason: HTTP 403 (Gemini is unavailable: HTTP 403.)'],
      [{ status: 404, body: BODY_MARKER }, 'reason: HTTP 404 (Gemini is unavailable: HTTP 404.)'],
      [{ status: 429, body: BODY_MARKER }, 'reason: HTTP 429 (Gemini is unavailable: HTTP 429.)'],
      [{ status: 503, body: BODY_MARKER }, 'reason: HTTP 503 (Gemini is unavailable: HTTP 503.)'],
      [new Error(`socket closed ${KEY}`), 'reason: network error (Gemini is unavailable: the request failed before an answer arrived.)'],
      [{ status: 200, body: `<html>${BODY_MARKER}</html>` }, 'reason: not JSON (Gemini is unavailable: the answer was not valid JSON.)'],
      [{ status: 200, body: { candidates: [] } }, 'reason: empty answer (Gemini is unavailable: the answer had no text.)'],
      [geminiSays({ note: BODY_MARKER }), 'reason: unusable answer (Gemini answered, but not with a usable draft.)'],
    ];
    for (const [reply, reasonLine] of cases) {
      const fetchImpl: FetchLike = async () => {
        if (reply instanceof Error) throw reply;
        return { status: reply.status, text: async () => (typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)) };
      };
      const { code, lines, text } = await run(fetchImpl);
      expect(code, reasonLine).toBe(1);
      expect(lines).toContain('source: offline');
      expect(lines).toContain(reasonLine);
      expectNoKey(text);
    }
  }, T);

  it('loads .env like the server: the key and GEMINI_MODEL come from the file, and a variable that is already set wins', async () => {
    const { calls, fetchImpl } = fakeFetch(() => geminiSays(GOOD));
    const dotEnv = `GEMINI_API_KEY="${KEY}"\nGEMINI_MODEL=gemini-2.5-pro\n`;

    const fromFile = await run(fetchImpl, { env: {}, dotEnv });

    expect(fromFile.code).toBe(0);
    expect(fromFile.lines).toContain('model: gemini-2.5-pro (thinking: the model default)');
    expect(fromFile.lines).toContain('source: gemini');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${GEMINI_MODELS_URL}/gemini-2.5-pro:generateContent`);
    expect(calls[0].init?.headers).toMatchObject({ 'x-goog-api-key': KEY });
    // 2.5 Pro cannot turn thinking off: no thinkingConfig is sent.
    expect(JSON.parse(calls[0].init?.body ?? '{}').generationConfig).toEqual({
      responseMimeType: 'application/json', responseSchema: PARSE_RESPONSE_SCHEMA,
    });
    expectNoKey(fromFile.text);

    const fromEnv = await run(fetchImpl, { env: { GEMINI_API_KEY: 'AQ.other-fake', GEMINI_MODEL: 'gemini-2.5-flash-lite' }, dotEnv });
    expect(fromEnv.lines).toContain('model: gemini-2.5-flash-lite (thinking: off)');
    expect(calls[1].url).toBe(`${GEMINI_MODELS_URL}/gemini-2.5-flash-lite:generateContent`);
    expect(calls[1].init?.headers).toMatchObject({ 'x-goog-api-key': 'AQ.other-fake' });
    expect(JSON.parse(calls[1].init?.body ?? '{}').generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(fromEnv.text).not.toContain('AQ.other-fake');
  }, T);

  it('the key is hidden even where it was put by mistake: in the sentence, in GEMINI_MODEL or in Gemini\'s answer', async () => {
    const { fetchImpl } = fakeFetch(() => geminiSays({ ...GOOD, label: `Envelope ${KEY}`, description: KEY_ENCODED }));

    const { code, lines, text } = await run(fetchImpl, {
      argv: ['Deliver', 'an', 'envelope', KEY, 'from', 'Etsy', 'to', 'Brooklyn', 'Roasting'],
      env: { GEMINI_API_KEY: ` ${KEY} `, GEMINI_MODEL: KEY },
    });

    expect(code).toBe(0);
    expect(lines[0]).toBe('sentence: Deliver an envelope [hidden] from Etsy to Brooklyn Roasting');
    expect(lines[1]).toBe('model: [hidden] (thinking: the model default)');
    expect(printedDraft(lines)).toMatchObject({ label: 'Envelope [hidden]', description: '[hidden]' });
    expectNoKey(text);
  }, T);

  it('joins the words of the command line into the sentence, and asks the example when there is none', async () => {
    const { calls, fetchImpl } = fakeFetch(() => geminiSays(GOOD));

    const words = await run(fetchImpl, { argv: ['  Send a box', 'from Etsy', 'to Levain Bakery '] });
    expect(words.lines[0]).toBe('sentence: Send a box from Etsy to Levain Bakery');
    expect(JSON.parse(calls[0].init?.body ?? '{}').contents[0].parts[0].text).toBe('Send a box from Etsy to Levain Bakery');

    const none = await run(fetchImpl, { argv: [] });
    expect(none.lines[0]).toBe(`sentence: ${EXAMPLE_SENTENCE}`);
    expect(JSON.parse(calls[1].init?.body ?? '{}').contents[0].parts[0].text).toBe(EXAMPLE_SENTENCE);
  }, T);

  it('--help prints the usage and sends nothing; a sentence the route would refuse and a missing travel cache exit 2', async () => {
    const { calls, fetchImpl } = fakeFetch(() => geminiSays(GOOD));

    const help = await run(fetchImpl, { argv: ['--help'] });
    expect(help).toMatchObject({ code: 0, lines: [USAGE] });

    const long = await run(fetchImpl, { argv: ['x'.repeat(PARSE_TEXT_MAX + 1)] });
    expect(long.code).toBe(EXIT_NOT_RUN);
    expect(long.code).toBe(2);
    expect(long.lines[0]).toBe(`The sentence cannot be sent: Max ${PARSE_TEXT_MAX} characters.`);

    const empty = tempDir();
    const noCache = await run(fetchImpl, { fixturesDir: empty });
    expect(noCache.code).toBe(2);
    expect(noCache.lines).toEqual([`No travel cache in ${empty} (matrix.json): the NYC run cannot be built.`]);

    expect(calls).toHaveLength(0);
    for (const result of [help, long, noCache]) expectNoKey(result.text);
  }, T);

  it('reasonLabel reads the status of an HTTP failure from the fixed message', () => {
    expect(reasonLabel('http', 'Gemini is unavailable: HTTP 400.')).toBe('HTTP 400');
    expect(reasonLabel('http', 'Gemini is unavailable: HTTP error.')).toBe('HTTP error');
    expect(reasonLabel('timeout', 'Gemini is unavailable: no answer within 6000 ms.')).toBe('timeout');
    expect(reasonLabel('no_key', 'Gemini is unavailable: GEMINI_API_KEY is not set.')).toBe('no key');
  });

  it('withoutSecret replaces the key as it is and URL-encoded, and leaves text alone when there is no key', () => {
    expect(withoutSecret(`a ${KEY} b ${KEY_ENCODED} c ${KEY}`, KEY)).toBe('a [hidden] b [hidden] c [hidden]');
    expect(withoutSecret(`a ${KEY} b`, `  ${KEY}\n`)).toBe('a [hidden] b');
    expect(withoutSecret('nothing to hide', KEY)).toBe('nothing to hide');
    expect(withoutSecret('a b', null)).toBe('a b');
    expect(withoutSecret('a b', '')).toBe('a b');
    expect(withoutSecret('a b', ' ')).toBe('a b');
  });

  it('the script file never names the key variable in a line it prints, and reads the key only through server/ai/env.ts', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../scripts/gemini-check.ts'), 'utf8');
    expect(source).not.toMatch(/process\.env\.GEMINI/);
    expect(source).not.toMatch(/[?&]key=/);
    expect(source).toContain('geminiKey(opts.env)');
  });
});
