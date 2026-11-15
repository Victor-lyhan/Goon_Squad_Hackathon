// #811: one line in the server's terminal for every sentence POST /api/v2/parse-request answers, saying who
// wrote the draft: Gemini (with the model and the time), or the offline parser and why (no key, the time
// limit, an HTTP status, an answer that is no draft). So a card that says "Parsed offline" while a key is in
// `.env` is explained where the presenter looks first.
// The server here is the real one (createV2Runtime, and `startServer` as `npm start` runs it) with the two
// logs of the app: `console.info` for "Gemini answered" and "no key", `console.warn` for a fallback with a
// key set. Every console call is captured: no line holds the key, the sentence, the draft or Gemini's answer.
// No network, no real key, no .env of the repo: Gemini is a fake behind the injected `fetch`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { DEFAULT_GEMINI_TIMEOUT_MS, GEMINI_MODELS_URL, GeminiUnavailable } from '../../server/ai/gemini';
import { INVALID_ANSWER_MESSAGE } from '../../server/ai/geminiParser';
import { parseOffline } from '../../server/ai/ruleParser';
import { fallbackLogLine, geminiLogLine, NO_KEY_LOG_LINE } from '../../server/api/v2/parseRequestRoutes';
import type { FetchLike } from '../../server/geo/googleClient';
import { startServer, type RelayServer } from '../../server/index';
import type { Store } from '../../server/store';
import type { ParseRequestResponse } from '../../shared/v2/parseRequest';
import type { Run as RunV2 } from '../../shared/v2/types';
import { T, startBootstrapApi, tempRepo, type BootstrapApi, type BootstrapApiOptions, type TempRepo } from './v2-bootstrap-helper';

// Not a real key. It starts with `AQ` like a new AI Studio key.
const KEY = 'AQ.FAKE_log-key-52be';
/** In every sentence of this file: the sentence must reach no log line. */
const SENTENCE_MARKER = 'SENTENCE-MARKER-41c9';
/** In every answer and error body of the fake Gemini: its text must reach no log line. */
const BODY_MARKER = 'BODY-MARKER-7ad3';
const MODEL = 'gemini-2.5-flash';
const SENTENCE = `Deliver an envelope with ${SENTENCE_MARKER} from Etsy to Brooklyn Roasting by 10 a.m. tomorrow.`;

/** What a well-behaved Gemini answers. The description is only in its draft, not in the offline one. */
const GOOD = {
  originBusinessId: 'biz-etsy',
  destinationBusinessId: 'biz-brooklyn-roasting',
  label: 'Envelope',
  category: 'envelope',
  description: `Contract ${BODY_MARKER}`,
  weightKg: null,
  readyMin: null,
  deadlineMin: 2040,
  rejected: [],
};

type Reply = { status: number; body: unknown } | 'hang';

/** Gemini's HTTP 200 body whose first candidate says `value` as JSON. */
const geminiSays = (value: unknown): Reply => ({
  status: 200,
  body: { candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(value) }] }, finishReason: 'STOP' }] },
});

/** The only `fetch` the server gets: it answers Gemini from `reply` ('hang' = never, until the request is aborted). */
function fakeGemini(reply: () => Reply) {
  const urls: string[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    urls.push(url);
    if (!url.startsWith(GEMINI_MODELS_URL)) return Promise.reject(new Error('these tests only know the fake Gemini'));
    const answer = reply();
    if (answer === 'hang') {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException(`aborted ${KEY}`, 'AbortError')));
      });
    }
    return Promise.resolve({
      status: answer.status,
      text: async () => (typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body)),
    });
  };
  return { urls, fetch: fetchImpl };
}

type Printed = { method: string; args: unknown[] };
/** Every console call of the test, in order. */
let printed: Printed[];
let api: BootstrapApi | null = null;

beforeEach(() => {
  printed = [];
  for (const method of ['log', 'warn', 'error', 'info', 'debug', 'trace'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void printed.push({ method, args }));
  }
});
afterEach(async () => {
  // Whatever the test did: nothing that was printed holds the key, the sentence, or the draft or text of Gemini.
  const all = JSON.stringify(printed);
  for (const secret of [KEY, 'FAKE_log', SENTENCE_MARKER, BODY_MARKER, 'biz-etsy', 'biz-brooklyn-roasting', 'Etsy', 'Roasting', 'nvelope']) {
    expect(all).not.toContain(secret);
  }
  await api?.close();
  api = null;
  vi.restoreAllMocks();
}, T);

type GeminiOptions = NonNullable<BootstrapApiOptions['gemini']>;

/**
 * The server with a fake Gemini and the logs of the app: `info` is `console.info` (server/index.ts gives it),
 * `log` is left out, so a fallback goes to the default `console.warn`.
 */
async function start(reply: () => Reply, gemini: Partial<GeminiOptions> = {}) {
  const fake = fakeGemini(reply);
  api = await startBootstrapApi({
    cache: 'sample',
    fetch: fake.fetch,
    gemini: { apiKey: KEY, model: MODEL, info: (line) => console.info(line), ...gemini },
  });
  if (!api.store) throw new Error('/api/v2 did not load on the sample cache');
  return { api, store: api.store as Store<RunV2>, urls: fake.urls };
}

async function post(text: unknown = SENTENCE) {
  const answer = await (api as BootstrapApi).v2.post('/parse-request', { text });
  return { status: answer.status, body: answer.body as ParseRequestResponse };
}

const offline = (run: RunV2) => parseOffline(SENTENCE, { businesses: run.scenario.businesses, nowMin: run.clock.timeMin });

const GEMINI_LINE = /^\[parse-request\] Parsed by Gemini \(gemini-2\.5-flash, (\d+) ms\)\.$/;

describe('POST /api/v2/parse-request prints one line saying who wrote the draft', () => {
  it('Gemini answered: one console.info line with the model and the time, and Gemini\'s draft as before', async () => {
    const { urls } = await start(() => geminiSays(GOOD));

    const answer = await post();

    expect(answer.status).toBe(200);
    expect(answer.body.source).toBe('gemini');
    expect(answer.body.draft).toMatchObject({ originBusinessId: 'biz-etsy', description: `Contract ${BODY_MARKER}`, deadlineMin: 2040 });
    expect(urls).toHaveLength(1);
    expect(printed).toHaveLength(1);
    expect(printed[0].method).toBe('info');
    expect(printed[0].args).toHaveLength(1);
    const ms = GEMINI_LINE.exec(String(printed[0].args[0]))?.[1];
    expect(ms, String(printed[0].args[0])).toBeDefined();
    expect(Number(ms)).toBeLessThan(DEFAULT_GEMINI_TIMEOUT_MS);
  }, T);

  it.each<[string, Partial<GeminiOptions>]>([
    ['a null key', { apiKey: null }],
    ['an undefined key', { apiKey: undefined }],
    ['an empty key', { apiKey: '' }],
    ['a blank key', { apiKey: ' \n' }],
  ])('no key (%s): one console.info line that says "no key", and nothing is sent', async (_name, gemini) => {
    const { store, urls } = await start(() => geminiSays(GOOD), gemini);

    const answer = await post();

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual(offline(store.get()));
    expect(answer.body.source).toBe('offline');
    expect(urls).toEqual([]);
    expect(printed).toEqual([{ method: 'info', args: [NO_KEY_LOG_LINE] }]);
    expect(NO_KEY_LOG_LINE).toBe('[parse-request] Parsed offline: no key (GEMINI_API_KEY is not set).');
  }, T);

  it('a slow Gemini: one console.warn line with the time limit, after the offline draft took over', async () => {
    const { store, urls } = await start(() => 'hang', { timeoutMs: 80 });

    const answer = await post();

    expect(answer.body).toEqual(offline(store.get()));
    expect(urls).toHaveLength(1);
    expect(printed).toEqual([{ method: 'warn', args: ['[parse-request] Gemini is unavailable: no answer within 80 ms. Parsed offline.'] }]);
    // With the app's own limit the line names the 6 s of docs/mvp4.md.
    expect(fallbackLogLine(new GeminiUnavailable('timeout', { timeoutMs: DEFAULT_GEMINI_TIMEOUT_MS }).message))
      .toBe('[parse-request] Gemini is unavailable: no answer within 6000 ms. Parsed offline.');
  }, T);

  it('HTTP 400: one console.warn line with the status, not the error body', async () => {
    const { store, urls } = await start(() => ({ status: 400, body: { error: { message: `API key not valid: ${KEY} ${BODY_MARKER}` } } }));

    const answer = await post();

    expect(answer.body).toEqual(offline(store.get()));
    expect(urls).toHaveLength(1);
    expect(printed).toEqual([{ method: 'warn', args: ['[parse-request] Gemini is unavailable: HTTP 400. Parsed offline.'] }]);
  }, T);

  it.each<[string, unknown]>([
    ['a list', [GOOD]],
    ['an empty object', {}],
    ['a field of the wrong type', { ...GOOD, weightKg: `heavy ${BODY_MARKER}` }],
  ])('an invalid answer (%s): one console.warn line that says so, without the answer', async (_name, value) => {
    const { store, urls } = await start(() => geminiSays(value));

    const answer = await post();

    expect(answer.body).toEqual(offline(store.get()));
    expect(urls).toHaveLength(1);
    expect(printed).toEqual([{ method: 'warn', args: [fallbackLogLine(INVALID_ANSWER_MESSAGE)] }]);
    expect(fallbackLogLine(INVALID_ANSWER_MESSAGE)).toBe('[parse-request] Gemini answered, but not with a usable draft. Parsed offline.');
  }, T);

  it('one line per sentence, in the order of the answers', async () => {
    let n = 0;
    await start(() => (n++ === 1 ? { status: 429, body: BODY_MARKER } : geminiSays(GOOD)));

    expect((await post()).body.source).toBe('gemini');
    expect((await post()).body.source).toBe('offline');
    expect((await post()).body.source).toBe('gemini');

    expect(printed.map((call) => call.method)).toEqual(['info', 'warn', 'info']);
    expect(String(printed[0].args[0])).toMatch(GEMINI_LINE);
    expect(printed[1].args).toEqual(['[parse-request] Gemini is unavailable: HTTP 429. Parsed offline.']);
    expect(String(printed[2].args[0])).toMatch(GEMINI_LINE);
  }, T);

  it('no key: every sentence prints the line once, and nothing else', async () => {
    await start(() => geminiSays(GOOD), { apiKey: null });
    await post();
    await post();
    expect(printed).toEqual([{ method: 'info', args: [NO_KEY_LOG_LINE] }, { method: 'info', args: [NO_KEY_LOG_LINE] }]);
  }, T);

  it('a request that is refused (400) is no answered sentence: no line', async () => {
    const { urls } = await start(() => geminiSays(GOOD));
    expect((await post('   ')).status).toBe(400);
    expect((await post(42)).status).toBe(400);
    expect(urls).toEqual([]);
    expect(printed).toEqual([]);
  }, T);

  it.each<[string, () => Reply, Partial<GeminiOptions>, 'gemini' | 'offline']>([
    ['Gemini answered', () => geminiSays(GOOD), {}, 'gemini'],
    ['no key', () => geminiSays(GOOD), { apiKey: null }, 'offline'],
  ])('an info log that throws does not cost the sender the draft (%s)', async (_name, reply, gemini, source) => {
    await start(reply, {
      ...gemini,
      info: () => {
        throw new Error('the log is broken');
      },
    });
    const answer = await post();
    expect(answer.status).toBe(200);
    expect(answer.body.source).toBe(source);
  }, T);

  it('the answers are the same with and without the info log', async () => {
    const withLog: unknown[] = [];
    const replies = (): (() => Reply) => {
      let n = 0;
      return () => (n++ === 0 ? geminiSays(GOOD) : { status: 503, body: BODY_MARKER });
    };
    await start(replies());
    withLog.push((await post()).body, (await post()).body);
    await api?.close();

    await start(replies(), { info: undefined });
    const without = [(await post()).body, (await post()).body];

    expect(without).toEqual(withLog);
    expect(without.map((body) => (body as ParseRequestResponse).source)).toEqual(['gemini', 'offline']);
    // Without `info` only the fallback has a line, as before #811.
    expect(printed.map((call) => call.method)).toEqual(['info', 'warn', 'warn']);
  }, T);
});

describe('geminiLogLine', () => {
  it('names the model and the time in whole milliseconds', () => {
    expect(geminiLogLine('gemini-2.5-flash', 1840)).toBe('[parse-request] Parsed by Gemini (gemini-2.5-flash, 1840 ms).');
    expect(geminiLogLine('models/gemini-flash-latest', 12.6)).toBe('[parse-request] Parsed by Gemini (models/gemini-flash-latest, 13 ms).');
    expect(geminiLogLine('gemini-2.5-flash', -3)).toBe('[parse-request] Parsed by Gemini (gemini-2.5-flash, 0 ms).');
    expect(geminiLogLine('gemini-2.5-flash', Number.NaN)).toBe('[parse-request] Parsed by Gemini (gemini-2.5-flash, 0 ms).');
  });

  it('prints only the characters of a model name, on one line', () => {
    expect(geminiLogLine(' gemini-2.5-flash\n[parse-request] made up ', 5)).toBe('[parse-request] Parsed by Gemini (gemini-2.5-flashparse-requestmadeup, 5 ms).');
    expect(geminiLogLine('\n \t', 5)).toBe('[parse-request] Parsed by Gemini (unknown model, 5 ms).');
    expect(geminiLogLine('m'.repeat(500), 5)).toBe(`[parse-request] Parsed by Gemini (${'m'.repeat(60)}, 5 ms).`);
  });
});

describe('startServer: the line reaches the terminal log of the app', () => {
  const started: { server: RelayServer; repo: TempRepo }[] = [];
  afterEach(async () => {
    for (const one of started.splice(0)) {
      await one.server.stop();
      one.repo.remove();
    }
  });

  /** The whole server as `npm start` runs it, on a temp folder with its own `.env` and the fake Gemini. */
  async function boot(dotEnv: string, reply: () => Reply, parseRequestLog?: (line: string) => void) {
    const repo = tempRepo('sample');
    const envPath = path.join(repo.root, '.env');
    fs.writeFileSync(envPath, dotEnv);
    const fake = fakeGemini(reply);
    const lines: string[] = [];
    const server = startServer({
      env: { PORT: '0' },
      envPath,
      log: (line) => void lines.push(line),
      ...(parseRequestLog ? { parseRequestLog } : {}),
      clientDist: path.join(repo.root, 'client', 'dist'),
      fixturesDir: repo.fixturesDir,
      statePath: repo.statePath,
      fetch: fake.fetch,
    });
    started.push({ server, repo });
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const parse = async () => {
      const res = await fetch(`${origin}/api/v2/parse-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: SENTENCE }),
      });
      return (await res.json()) as ParseRequestResponse;
    };
    return { lines, urls: fake.urls, parse };
  }

  it('with the key in .env: the line names the model of GEMINI_MODEL', async () => {
    const said: string[] = [];
    const one = await boot(`GEMINI_API_KEY=${KEY}\nGEMINI_MODEL=gemini-flash-latest\n`, () => geminiSays(GOOD), (line) => void said.push(line));

    expect((await one.parse()).source).toBe('gemini');

    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^\[parse-request\] Parsed by Gemini \(gemini-flash-latest, \d+ ms\)\.$/);
    expect(said[0]).not.toContain(KEY);
    expect(one.lines.join('\n')).not.toContain(KEY);   // the start lines are as before
    expect(printed).toEqual([]);
  }, T);

  it('a key under another name in .env is no key: the card says "Parsed offline" and the line says why', async () => {
    const said: string[] = [];
    const one = await boot(`GEMINI_KEY=${KEY}\nGOOGLE_MAPS_SERVER_KEY=FAKE-maps-key\n`, () => geminiSays(GOOD), (line) => void said.push(line));

    expect((await one.parse()).source).toBe('offline');

    expect(one.urls).toEqual([]);
    expect(said).toEqual([NO_KEY_LOG_LINE]);
    expect(printed).toEqual([]);
  }, T);

  it('a fallback with the key set keeps its console.warn line and gives the info log nothing', async () => {
    const said: string[] = [];
    const one = await boot(`GEMINI_API_KEY=${KEY}\n`, () => ({ status: 403, body: `${KEY} ${BODY_MARKER}` }), (line) => void said.push(line));

    expect((await one.parse()).source).toBe('offline');

    expect(said).toEqual([]);
    expect(printed).toEqual([{ method: 'warn', args: ['[parse-request] Gemini is unavailable: HTTP 403. Parsed offline.'] }]);
  }, T);

  it('the app gives console.info as that log (server/index.ts, where it starts itself)', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../server/index.ts'), 'utf8');
    const entry = source.slice(source.lastIndexOf('if (isEntry) {'));
    expect(entry).toMatch(/startServer\(\{[^}]*parseRequestLog: \(line\) => console\.info\(line\),/);
  });
});
