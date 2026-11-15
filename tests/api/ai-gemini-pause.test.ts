// #884: a slow or failing Gemini key must never stall the demo twice. After one failed Gemini call (the time
// limit, HTTP 500, HTTP 429, a network error or an unusable answer) POST /api/v2/parse-request answers offline at
// once for the next 2 minutes, without asking Gemini; then Gemini is tried again, and a call that succeeds clears
// the pause. #959: POST /api/v2/advise has no pause: it neither reads nor starts it, and each request makes its
// one Gemini call with its own time limit, its options built by the engine first.
// The server here is the real one (createV2Runtime on the sample travel cache, and `startServer` as `npm start`
// runs it). Gemini is a fake behind the injected `fetch` and the pause runs on an injected clock:
// no network, no real key, no .env of the repo, no waiting for 2 minutes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { adviseOffline } from '../../server/ai/advisor';
import { GEMINI_MODELS_URL } from '../../server/ai/gemini';
import {
  createGeminiPause, GEMINI_PAUSE_MS, pauseCause, pausedMessage, type GeminiPause,
} from '../../server/ai/geminiPause';
import { parseWithGeminiUnlessPaused, type GeminiParseContext } from '../../server/ai/geminiParser';
import { parseOffline } from '../../server/ai/ruleParser';
import { advisorEngine } from '../../server/api/v2/adviseRoutes';
import { NO_KEY_LOG_LINE, pausedLogLine as parsePausedLine } from '../../server/api/v2/parseRequestRoutes';
import type { FetchLike } from '../../server/geo/googleClient';
import { startServer, type RelayServer } from '../../server/index';
import type { Store } from '../../server/store';
import type { AdviseResponse } from '../../shared/v2/api';
import type { ParseRequestResponse } from '../../shared/v2/parseRequest';
import type { Run as RunV2, Shipment, TravelProvider } from '../../shared/v2/types';
import { ownOrigin } from './own-origin-helper';
import { T, startBootstrapApi, tempRepo, type BootstrapApi, type BootstrapApiOptions, type TempRepo } from './v2-bootstrap-helper';

// Not a real key. It starts with `AQ` like a new AI Studio key.
const KEY = 'AQ.FAKE_pause-key-3c9e';
/** In every sentence of this file: the sentence must reach no log line. */
const SENTENCE_MARKER = 'SENTENCE-MARKER-884a';
/** In every answer and error body of the fake Gemini: its text must reach no log line. */
const BODY_MARKER = 'BODY-MARKER-884b';
const MODEL = 'gemini-2.5-flash';
const SENTENCE = `Deliver an envelope with ${SENTENCE_MARKER} from Etsy to Brooklyn Roasting by 10 a.m. tomorrow.`;

/** What a well-behaved Gemini answers to SENTENCE. */
const GOOD_DRAFT = {
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

/**
 * How the fake Gemini behaves, for both kinds of call:
 * - 'good': a usable draft for parse-request; for advise a valid recommendation (shp-7 has one plan, p1);
 * - 'hang': no answer until the request is aborted; 'http500' / 'http429': that status; 'network': the request throws;
 * - 'unusable': an HTTP 200 that is no draft and no recommendation (a list);
 * - 'bad-picks': advise recommends a plan that does not exist.
 */
type Mode = 'good' | 'hang' | 'http500' | 'http429' | 'network' | 'unusable' | 'bad-picks';

type Part = Record<string, unknown>;
const says = (parts: Part[]) => ({
  status: 200,
  text: async () => JSON.stringify({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }] }),
});

/** The only `fetch` the server gets. `mode` can be changed between calls; `calls` counts what reached "Gemini". */
function fakeGemini(first: Mode) {
  const state = { mode: first, calls: 0, parseCalls: 0, adviseCalls: 0 };
  const fetchImpl: FetchLike = (url, init) => {
    if (!url.startsWith(GEMINI_MODELS_URL)) return Promise.reject(new Error('these tests only know the fake Gemini'));
    const body = JSON.parse(String(init?.body)) as { generationConfig?: { responseSchema?: unknown } };
    const isAdvise = JSON.stringify(body.generationConfig?.responseSchema ?? {}).includes('recommendedId');
    state.calls++;
    if (isAdvise) state.adviseCalls++;
    else state.parseCalls++;
    switch (state.mode) {
      case 'hang':
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException(`aborted ${KEY}`, 'AbortError')));
        });
      case 'http500':
        return Promise.resolve({ status: 500, text: async () => `internal ${BODY_MARKER} ${KEY}` });
      case 'http429':
        return Promise.resolve({ status: 429, text: async () => `quota ${BODY_MARKER} ${KEY}` });
      case 'network':
        return Promise.reject(new Error(`socket hang up ${KEY}`));
      case 'unusable':
        return Promise.resolve(says([{ text: JSON.stringify([GOOD_DRAFT]) }]));
      case 'bad-picks':
      case 'good': {
        if (!isAdvise) return Promise.resolve(says([{ text: JSON.stringify(GOOD_DRAFT) }]));
        const recommendedId = state.mode === 'good' ? 'p1' : 'p9';
        // The marker sits in a sentence for a plan that is not shown: never used, never logged.
        const answer = { recommendedId, reason: 'One carrier the whole way.', sentences: [{ id: 'p9', text: BODY_MARKER }] };
        return Promise.resolve(says([{ text: JSON.stringify(answer) }]));
      }
    }
  };
  return { state, fetch: fetchImpl };
}

type Printed = { method: string; args: unknown[] };
/** Every console call of the test, in order. */
let printed: Printed[];
/** Every line the routes gave to the runtime's `log`. */
let logged: string[];
let api: BootstrapApi | null = null;
/** The injected clock of the pause, in milliseconds. It only moves when a test moves it. */
let clock: number;

beforeEach(() => {
  printed = [];
  logged = [];
  clock = 1_700_000_000_000;
  for (const method of ['log', 'warn', 'error', 'info', 'debug', 'trace'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void printed.push({ method, args }));
  }
});
afterEach(async () => {
  // Whatever the test did: no line holds the key, the sentence, or the draft or text of Gemini.
  const all = JSON.stringify([printed, logged]);
  for (const secret of [KEY, 'FAKE_pause', SENTENCE_MARKER, BODY_MARKER, 'biz-etsy', 'Etsy', 'Roasting', 'nvelope']) {
    expect(all).not.toContain(secret);
  }
  await api?.close();
  api = null;
  vi.restoreAllMocks();
}, T);

type GeminiOptions = NonNullable<BootstrapApiOptions['gemini']>;

/** The real server with the fake Gemini, short time limits, and a pause on the injected clock (unless `pause: undefined`). */
async function start(mode: Mode, gemini: Partial<GeminiOptions> = {}) {
  const fake = fakeGemini(mode);
  const pause = createGeminiPause({ now: () => clock });
  api = await startBootstrapApi({
    cache: 'sample',
    fetch: fake.fetch,
    gemini: {
      apiKey: KEY, model: MODEL, timeoutMs: 80, adviseTimeoutMs: 120, pause,
      log: (line) => void logged.push(line),
      ...gemini,
    },
  });
  if (!api.store || !api.runtime.deps.travel) throw new Error('/api/v2 did not load on the sample cache');
  const store = api.store as Store<RunV2>;
  const travel = api.runtime.deps.travel as TravelProvider;
  const run = store.get();
  // shp-7 of the sample run has one plan as typed (tests/api/v2-advise.test.ts); shp-8 has none.
  const draft = draftOf(run, 'shp-7');
  return {
    gemini: fake.state, pause, store, run, draft,
    offlineParse: parseOffline(SENTENCE, { businesses: run.scenario.businesses, nowMin: run.clock.timeMin }),
    offlineAdvice: adviseOffline(advisorEngine(run, travel, draft)),
  };
}

function draftOf(run: RunV2, shipmentId: string) {
  const s = run.scenario.shipments.find((x) => x.id === shipmentId) as Shipment;
  return {
    originBusinessId: s.originBusinessId, destinationBusinessId: s.destinationBusinessId,
    readyMin: s.readyMin, deadlineMin: s.deadlineMin,
  };
}

async function parse(): Promise<{ body: ParseRequestResponse; ms: number }> {
  const started = performance.now();
  const answer = await (api as BootstrapApi).v2.post('/parse-request', { text: SENTENCE });
  const ms = performance.now() - started;
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  expect(JSON.stringify(answer.body)).not.toContain(KEY);
  return { body: answer.body as ParseRequestResponse, ms };
}

async function advise(draft: unknown): Promise<{ body: AdviseResponse; ms: number }> {
  const started = performance.now();
  const answer = await (api as BootstrapApi).v2.post('/advise', { draft });
  const ms = performance.now() - started;
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  expect(JSON.stringify(answer.body)).not.toContain(KEY);
  return { body: answer.body as unknown as AdviseResponse, ms };
}

/**
 * Failure of the fake Gemini -> the words after "Gemini paused after", the line parse-request prints for the
 * failed call itself, and the words of advise's own line for the same failure (#959).
 */
const FAILURES: [Mode, string, string, string][] = [
  ['hang', 'timeout', '[parse-request] Gemini is unavailable: no answer within 80 ms. Parsed offline.', 'timeout'],
  ['http500', 'HTTP 500', '[parse-request] Gemini is unavailable: HTTP 500. Parsed offline.', 'HTTP 500'],
  ['http429', 'HTTP 429', '[parse-request] Gemini is unavailable: HTTP 429. Parsed offline.', 'HTTP 429'],
  ['network', 'a network error', '[parse-request] Gemini is unavailable: the request failed before an answer arrived. Parsed offline.', 'network error'],
  ['unusable', 'an unusable answer', '[parse-request] Gemini answered, but not with a usable draft. Parsed offline.', 'invalid answer: invalid shape'],
];

describe('one failed parse-request call pauses parse-request; advise has no pause (#959)', () => {
  it.each(FAILURES)('parse-request fails first (%s): it answers offline without asking Gemini for 120 s; advise still asks', async (mode, cause, firstLine, adviseWords) => {
    const s = await start(mode);

    // The failed call itself: asked once, offline as before #884, with the line of #811.
    expect((await parse()).body).toStrictEqual(s.offlineParse);
    expect(s.gemini.calls).toBe(1);
    expect(logged).toStrictEqual([firstLine]);
    expect(s.pause.current()).toStrictEqual({ cause, remainingMs: GEMINI_PAUSE_MS });

    // Paused for parse-request: nothing is sent. Advise asks Gemini all the same, and falls back on its own.
    expect((await parse()).body).toStrictEqual(s.offlineParse);
    expect(s.gemini.parseCalls).toBe(1);
    expect((await advise(s.draft)).body).toStrictEqual(s.offlineAdvice);
    expect(s.gemini.adviseCalls).toBe(1);
    expect(logged.slice(1)).toStrictEqual([
      `[parse-request] Parsed offline: Gemini paused after ${cause}, next try in 120 s.`,
      `[advise] fallback: ${adviseWords}`,
    ]);
    expect(s.pause.current()).toStrictEqual({ cause, remainingMs: GEMINI_PAUSE_MS });   // advise did not touch it

    // While parse-request is paused, a Gemini that answers again answers advise at once.
    s.gemini.mode = 'good';
    clock += GEMINI_PAUSE_MS - 1;
    expect((await advise(s.draft)).body.source).toBe('gemini');
    expect((await parse()).body).toStrictEqual(s.offlineParse);
    expect(s.gemini.parseCalls).toBe(1);
    expect(s.pause.current()?.remainingMs).toBe(1);   // a good advise answer does not clear parse-request's pause

    // After 120 s parse-request tries Gemini again.
    clock += 1;
    expect((await parse()).body.source).toBe('gemini');
    expect(s.gemini.parseCalls).toBe(2);
    expect(s.pause.current()).toBeNull();
    expect(logged).toHaveLength(4);          // a Gemini answer adds no line to `log`
    expect(printed).toStrictEqual([]);
  }, T);

  it.each(FAILURES)('advise fails (%s): its offline options and one line, no pause; parse-request still asks Gemini', async (mode, _cause, _line, adviseWords) => {
    const s = await start(mode);

    expect((await advise(s.draft)).body).toStrictEqual(s.offlineAdvice);
    expect((await advise(s.draft)).body).toStrictEqual(s.offlineAdvice);
    expect(s.gemini.adviseCalls).toBe(2);    // no pause: each request asks
    expect(logged).toStrictEqual([`[advise] fallback: ${adviseWords}`, `[advise] fallback: ${adviseWords}`]);
    expect(s.pause.current()).toBeNull();

    s.gemini.mode = 'good';
    expect((await parse()).body.source).toBe('gemini');
    expect((await advise(s.draft)).body.source).toBe('gemini');
    expect(s.pause.current()).toBeNull();
    expect(logged).toHaveLength(2);
    expect(printed).toStrictEqual([]);
  }, T);

  it('Gemini recommends a plan that does not exist: the offline options, and still no pause', async () => {
    const s = await start('bad-picks');
    expect((await advise(s.draft)).body).toStrictEqual(s.offlineAdvice);
    expect(s.gemini.adviseCalls).toBe(1);
    expect(logged).toStrictEqual(['[advise] fallback: invalid answer: unknown id']);
    expect(s.pause.current()).toBeNull();
    expect((await parse()).body.source).toBe('gemini');
    expect(s.gemini.parseCalls).toBe(1);
  }, T);

  it('Gemini still fails after the 2 minutes: one more parse-request try, then a new pause of 120 s with the new cause', async () => {
    const s = await start('http500');
    await parse();
    clock += GEMINI_PAUSE_MS;
    s.gemini.mode = 'http429';

    expect((await parse()).body).toStrictEqual(s.offlineParse);
    expect(s.gemini.calls).toBe(2);
    expect(s.pause.current()).toStrictEqual({ cause: 'HTTP 429', remainingMs: GEMINI_PAUSE_MS });

    clock += GEMINI_PAUSE_MS - 1000;
    expect((await parse()).body).toStrictEqual(s.offlineParse);
    expect(s.gemini.calls).toBe(2);
    expect(logged.at(-1)).toBe('[parse-request] Parsed offline: Gemini paused after HTTP 429, next try in 1 s.');
  }, T);

  it('while Gemini answers, nothing is paused: every call asks Gemini, advise once per request', async () => {
    const s = await start('good');
    for (let i = 0; i < 3; i++) {
      expect((await parse()).body.source).toBe('gemini');
      expect((await advise(s.draft)).body.source).toBe('gemini');
    }
    expect(s.gemini.parseCalls).toBe(3);
    expect(s.gemini.adviseCalls).toBe(3);
    expect(s.pause.current()).toBeNull();
    expect(logged).toStrictEqual([]);
  }, T);

  it('a request with no plan asks Gemini nothing: the offline note, and no pause', async () => {
    const s = await start('good');
    const unmatched = draftOf(s.run, 'shp-8');

    const answer = (await advise(unmatched)).body;

    expect(answer.source).toBe('offline');
    expect(answer.options).toStrictEqual([]);
    expect(answer.note).toMatch(/^Even with more time, /);
    expect(s.gemini.adviseCalls).toBe(0);
    expect(s.pause.current()).toBeNull();
    expect((await parse()).body.source).toBe('gemini');
    expect(logged).toStrictEqual([]);
  }, T);

  it('a refused request (400) asks nobody and neither reads nor starts a pause', async () => {
    const s = await start('http500');
    expect((await (api as BootstrapApi).v2.post('/parse-request', { text: '   ' })).status).toBe(400);
    expect((await (api as BootstrapApi).v2.post('/advise', { draft: { ...s.draft, originBusinessId: 'biz-nope' } })).status).toBe(400);
    expect(s.gemini.calls).toBe(0);
    expect(s.pause.current()).toBeNull();
    expect(logged).toStrictEqual([]);
  }, T);

  it('a log that throws does not cost the sender the answer', async () => {
    const s = await start('http500', {
      log: () => {
        throw new Error('the log is broken');
      },
    });
    await parse();
    expect((await parse()).body).toStrictEqual(s.offlineParse);
    expect((await advise(s.draft)).body).toStrictEqual(s.offlineAdvice);
    expect(s.gemini.calls).toBe(2);
  }, T);
});

describe('a paused answer does not wait for Gemini; advise waits at most its own limit', () => {
  it('a hanging Gemini with a 400 ms limit: parse-request waits once, then answers in under 200 ms; each advise waits its limit, not more', async () => {
    const s = await start('hang', { timeoutMs: 400, adviseTimeoutMs: 400 });

    const first = await parse();
    expect(first.ms).toBeGreaterThanOrEqual(390);
    expect(first.body).toStrictEqual(s.offlineParse);

    // Three of each: the fastest shows what the paused path costs even while other test files load the machine.
    const parseMs: number[] = [];
    const adviseMs: number[] = [];
    for (let i = 0; i < 3; i++) {
      parseMs.push((await parse()).ms);
      const advised = await advise(s.draft);
      expect(advised.body).toStrictEqual(s.offlineAdvice);
      adviseMs.push(advised.ms);
    }
    expect(Math.min(...parseMs)).toBeLessThan(200);
    expect(Math.min(...adviseMs)).toBeGreaterThanOrEqual(390);
    expect(Math.max(...adviseMs)).toBeLessThan(5000);
    expect(s.gemini.parseCalls).toBe(1);     // the real reason parse-request is fast: nothing was sent
    expect(s.gemini.adviseCalls).toBe(3);
  }, T);
});

describe('no key: offline as before, and the pause is not involved', () => {
  it.each<[string, string | null | undefined]>([
    ['a null key', null], ['an undefined key', undefined], ['a blank key', ' \n'],
  ])('%s: nothing is sent, the pause is neither read nor changed, and the line says "no key"', async (_name, apiKey) => {
    const touched: string[] = [];
    const watched: GeminiPause = {
      current: () => (touched.push('current'), { cause: 'timeout', remainingMs: 5000 }),   // "paused", if anyone asked
      fail: () => void touched.push('fail'),
      clear: () => void touched.push('clear'),
    };
    const s = await start('http500', { apiKey, pause: watched, info: (line) => void logged.push(line) });

    expect((await parse()).body).toStrictEqual(s.offlineParse);
    expect((await advise(s.draft)).body).toStrictEqual(s.offlineAdvice);
    expect((await parse()).body).toStrictEqual(s.offlineParse);

    expect(s.gemini.calls).toBe(0);
    expect(touched).toStrictEqual([]);
    expect(logged).toStrictEqual([NO_KEY_LOG_LINE, '[advise] fallback: no key', NO_KEY_LOG_LINE]);
  }, T);
});

describe('a runtime that is given no pause asks Gemini every time, as before #884', () => {
  it('HTTP 500 twice, then an answer: three calls reach Gemini', async () => {
    const s = await start('http500', { pause: undefined });
    expect((await parse()).body.source).toBe('offline');
    expect((await advise(s.draft)).body.source).toBe('offline');
    s.gemini.mode = 'good';
    expect((await parse()).body.source).toBe('gemini');
    expect(s.gemini.calls).toBe(3);
    expect(logged).toStrictEqual(['[parse-request] Gemini is unavailable: HTTP 500. Parsed offline.', '[advise] fallback: HTTP 500']);
  }, T);
});

describe('startServer: the app has the pause on for parse-request', () => {
  const started: { server: RelayServer; repo: TempRepo }[] = [];
  afterEach(async () => {
    for (const one of started.splice(0)) {
      await one.server.stop();
      one.repo.remove();
    }
  });

  /** The whole server as `npm start` runs it, on a temp folder with its own `.env` and the fake Gemini. */
  async function boot(dotEnv: string, mode: Mode) {
    const repo = tempRepo('sample');
    const envPath = path.join(repo.root, '.env');
    fs.writeFileSync(envPath, dotEnv);
    const fake = fakeGemini(mode);
    const info: string[] = [];
    const server = startServer({
      env: { PORT: '0' },
      envPath,
      log: () => undefined,
      parseRequestLog: (line) => void info.push(line),
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
    const origin = await ownOrigin(server); // not 127.0.0.1:<port>: another program may answer there (own-origin-helper.ts)
    const post = async <B>(url: string, body: unknown): Promise<B> => {
      const res = await fetch(`${origin}/api/v2${url}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      return (await res.json()) as B;
    };
    const simulator = (await (await fetch(`${origin}/api/v2/simulator`)).json()) as { shipments: Shipment[] };
    const shp1 = draftOf({ scenario: { shipments: simulator.shipments } } as RunV2, 'shp-1');
    return { gemini: fake.state, info, post, shp1 };
  }

  it('with a key in .env: one HTTP 500, then parse-request answers offline without asking, advise still asks; console.warn says why', async () => {
    const one = await boot(`GEMINI_API_KEY=${KEY}\n`, 'http500');

    const first = await one.post<ParseRequestResponse>('/parse-request', { text: SENTENCE });
    expect(first.source).toBe('offline');
    expect(one.gemini.calls).toBe(1);

    const second = await one.post<ParseRequestResponse>('/parse-request', { text: SENTENCE });
    expect(second).toStrictEqual(first);
    expect(one.gemini.calls).toBe(1);
    // Advise has no pause: the sample run's shp-1 has plans, so it asks Gemini (still HTTP 500) and falls back.
    const advice = await one.post<AdviseResponse>('/advise', { draft: one.shp1 });
    expect(advice.source).toBe('offline');
    expect(advice.options.length).toBeGreaterThan(0);
    expect(one.gemini.calls).toBe(2);

    expect(printed.map((p) => p.method)).toStrictEqual(['warn', 'warn', 'warn']);
    expect(printed[0].args).toStrictEqual(['[parse-request] Gemini is unavailable: HTTP 500. Parsed offline.']);
    expect(printed[1].args).toHaveLength(1);
    expect(String(printed[1].args[0])).toMatch(/^\[parse-request\] Parsed offline: Gemini paused after HTTP 500, next try in (119|120) s\.$/);
    expect(printed[2].args).toStrictEqual(['[advise] fallback: HTTP 500']);
    expect(one.info).toStrictEqual([]);
  }, T);

  it('without a key: offline with the "no key" line, however often, and nothing is sent', async () => {
    const one = await boot('', 'http500');
    for (let i = 0; i < 3; i++) {
      expect((await one.post<ParseRequestResponse>('/parse-request', { text: SENTENCE })).source).toBe('offline');
    }
    expect(one.gemini.calls).toBe(0);
    expect(one.info).toStrictEqual([NO_KEY_LOG_LINE, NO_KEY_LOG_LINE, NO_KEY_LOG_LINE]);
    expect(printed).toStrictEqual([]);
  }, T);
});

// ---------------------------------------------------------------------------------------------------------------
// Without a server: the pause itself, and the two functions the routes call
// ---------------------------------------------------------------------------------------------------------------

describe('createGeminiPause', () => {
  it('is off at first, on for exactly `pauseMs` after a failure, and off again after that', () => {
    const pause = createGeminiPause({ now: () => clock });
    expect(pause.current()).toBeNull();

    pause.fail('timeout');
    expect(pause.current()).toStrictEqual({ cause: 'timeout', remainingMs: 120_000 });
    clock += 119_999;
    expect(pause.current()).toStrictEqual({ cause: 'timeout', remainingMs: 1 });
    clock += 1;
    expect(pause.current()).toBeNull();
    clock -= 1;   // a clock that steps back does not bring an ended pause back
    expect(pause.current()).toBeNull();
  });

  it('the default is 2 minutes, and `pauseMs` changes it', () => {
    expect(GEMINI_PAUSE_MS).toBe(120_000);
    const short = createGeminiPause({ now: () => clock, pauseMs: 500 });
    short.fail('HTTP 503');
    clock += 499;
    expect(short.current()).toStrictEqual({ cause: 'HTTP 503', remainingMs: 1 });
    clock += 1;
    expect(short.current()).toBeNull();
  });

  it('a success clears it; a later failure counts from its own moment, with its own cause', () => {
    const pause = createGeminiPause({ now: () => clock });
    pause.fail('timeout');
    pause.clear();
    expect(pause.current()).toBeNull();

    pause.fail('timeout');
    clock += 60_000;
    pause.fail('HTTP 429');
    clock += 119_000;
    expect(pause.current()).toStrictEqual({ cause: 'HTTP 429', remainingMs: 1000 });
  });

  it('two pauses do not share their state, and the default clock is the real one', () => {
    const a = createGeminiPause();
    const b = createGeminiPause();
    a.fail('timeout');
    expect(b.current()).toBeNull();
    const state = a.current();
    expect(state?.cause).toBe('timeout');
    expect(state?.remainingMs).toBeGreaterThan(119_000);
    expect(state?.remainingMs).toBeLessThanOrEqual(120_000);
  });
});

describe('pauseCause and pausedMessage', () => {
  it('names every failure in fixed words; a missing key or model name starts no pause', () => {
    expect(pauseCause('timeout')).toBe('timeout');
    expect(pauseCause('network')).toBe('a network error');
    expect(pauseCause('http', 500)).toBe('HTTP 500');
    expect(pauseCause('http', 429)).toBe('HTTP 429');
    expect(pauseCause('http', 403)).toBe('HTTP 403');
    expect(pauseCause('http', null)).toBe('an HTTP error');
    expect(pauseCause('http')).toBe('an HTTP error');
    expect(pauseCause('bad_json')).toBe('an unusable answer');
    expect(pauseCause('empty')).toBe('an unusable answer');
    expect(pauseCause('invalid_answer')).toBe('an unusable answer');
    expect(pauseCause('error')).toBe('an unusable answer');
    expect(pauseCause('no_key')).toBeNull();
    expect(pauseCause('no_model')).toBeNull();
  });

  it('says the cause and the whole seconds left, rounded up', () => {
    expect(pausedMessage({ cause: 'timeout', remainingMs: 120_000 })).toBe('Gemini paused after timeout, next try in 120 s.');
    expect(pausedMessage({ cause: 'HTTP 429', remainingMs: 86_001 })).toBe('Gemini paused after HTTP 429, next try in 87 s.');
    expect(pausedMessage({ cause: 'a network error', remainingMs: 1 })).toBe('Gemini paused after a network error, next try in 1 s.');
    expect(parsePausedLine(pausedMessage({ cause: 'timeout', remainingMs: 87_000 })))
      .toBe('[parse-request] Parsed offline: Gemini paused after timeout, next try in 87 s.');
  });
});

const CONTEXT: GeminiParseContext = {
  businesses: [
    { id: 'biz-etsy', name: 'Etsy', neighborhood: 'DUMBO' },
    { id: 'biz-brooklyn-roasting', name: 'Brooklyn Roasting', neighborhood: 'Navy Yard' },
  ],
  nowMin: 480,
  windowStartMin: 360,
  windowEndMin: 2880,
};

describe('parseWithGeminiUnlessPaused', () => {
  it('a call that was already under way and succeeds clears a pause another call started', async () => {
    const pause = createGeminiPause({ now: () => clock });
    const good = says([{ text: JSON.stringify(GOOD_DRAFT) }]);
    let release: (answer: typeof good) => void = () => undefined;
    let sent = 0;
    const fetchImpl: FetchLike = () => {
      sent++;
      if (sent === 1) return new Promise((resolve) => void (release = resolve));
      if (sent === 2) return Promise.resolve({ status: 503, text: async () => '' });
      return Promise.resolve(good);
    };
    const settings = { apiKey: KEY, model: MODEL, fetchImpl };

    const slow = parseWithGeminiUnlessPaused(SENTENCE, CONTEXT, settings, pause);
    expect(await parseWithGeminiUnlessPaused(SENTENCE, CONTEXT, settings, pause)).toMatchObject({ ok: false, reason: 'http' });
    expect(pause.current()?.cause).toBe('HTTP 503');
    expect(await parseWithGeminiUnlessPaused(SENTENCE, CONTEXT, settings, pause)).toStrictEqual({
      ok: false, reason: 'paused', message: 'Gemini paused after HTTP 503, next try in 120 s.',
    });
    expect(sent).toBe(2);

    release(good);
    expect((await slow).ok).toBe(true);
    expect(pause.current()).toBeNull();
    expect((await parseWithGeminiUnlessPaused(SENTENCE, CONTEXT, settings, pause)).ok).toBe(true);
    expect(sent).toBe(3);
  });

  it('paused calls take well under 200 ms, each of them, and reach no fetch', async () => {
    const pause = createGeminiPause({ now: () => clock });
    pause.fail('timeout');
    const fetchImpl: FetchLike = () => {
      throw new Error('a paused call must not reach Gemini');
    };
    const settings = { apiKey: KEY, model: MODEL, fetchImpl };
    for (let i = 0; i < 20; i++) {
      const started = performance.now();
      const parsed = await parseWithGeminiUnlessPaused(SENTENCE, CONTEXT, settings, pause);
      expect(performance.now() - started).toBeLessThan(200);
      expect(parsed).toMatchObject({ ok: false, reason: 'paused' });
    }
  });

  it('without a key the pause is neither read nor started, even when it is on', async () => {
    const pause = createGeminiPause({ now: () => clock });
    const fetchImpl: FetchLike = () => {
      throw new Error('no key: nothing may be sent');
    };
    for (const apiKey of [null, undefined, '', '  ']) {
      const settings = { apiKey, model: MODEL, fetchImpl };
      expect(await parseWithGeminiUnlessPaused(SENTENCE, CONTEXT, settings, pause)).toMatchObject({ ok: false, reason: 'no_key' });
      expect(pause.current()).toBeNull();
    }
    pause.fail('timeout');
    expect(await parseWithGeminiUnlessPaused(SENTENCE, CONTEXT, { apiKey: null, model: MODEL, fetchImpl }, pause)).toMatchObject({ reason: 'no_key' });
  });

  it('a blank model name sends nothing and starts no pause', async () => {
    const pause = createGeminiPause({ now: () => clock });
    const fetchImpl: FetchLike = () => {
      throw new Error('no model: nothing may be sent');
    };
    expect(await parseWithGeminiUnlessPaused(SENTENCE, CONTEXT, { apiKey: KEY, model: ' ', fetchImpl }, pause)).toMatchObject({ reason: 'no_model' });
    expect(pause.current()).toBeNull();
  });
});
