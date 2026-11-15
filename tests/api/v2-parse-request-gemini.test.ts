// POST /api/v2/parse-request with Gemini (docs/mvp4.md F1, #785) on the real server: createV2Runtime, the
// sample travel cache, the committed NYC businesses, and a FAKE Gemini behind the injected `fetch`.
// Gemini is asked first; the offline rule parser answers when there is no key (then nothing is sent), when
// the call fails or is slow, or when the answer is no usable draft. The route never answers 5xx because of
// Gemini, stores nothing, and the key reaches no body and no log line.
// No network, no real key, no .env of the repo: everything runs on a temp folder.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { GEMINI_MODELS_URL } from '../../server/ai/gemini';
import { buildParsePrompt, INVALID_ANSWER_MESSAGE, PARSE_RESPONSE_SCHEMA } from '../../server/ai/geminiParser';
import { parseOffline } from '../../server/ai/ruleParser';
import { fallbackLogLine } from '../../server/api/v2/parseRequestRoutes';
import type { FetchInitLike, FetchLike } from '../../server/geo/googleClient';
import { startServer, type RelayServer } from '../../server/index';
import type { Store } from '../../server/store';
import type { ParseRequestResponse } from '../../shared/v2/parseRequest';
import type { ParseAnswer } from '../../server/ai/deadline';
import type { Run as RunV2 } from '../../shared/v2/types';
import { T, startBootstrapApi, tempRepo, type Answer, type BootstrapApi, type BootstrapApiOptions, type TempRepo } from './v2-bootstrap-helper';
import { ownOrigin } from './own-origin-helper';

// Not a real key. It starts with `AQ` like a new AI Studio key.
const KEY = 'AQ.FAKE_route-key-8d41';
/** A marker put into Gemini's answers and error bodies, to show that its raw text reaches no body and no log. */
const BODY_MARKER = 'BODY-MARKER-c07e';
const MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `${GEMINI_MODELS_URL}/${MODEL}:generateContent`;
const EXAMPLE = 'Deliver an envelope from Etsy to Brooklyn Roasting by 10 a.m. tomorrow.';

/** What a well-behaved Gemini answers to EXAMPLE. Unlike the offline parser it also fills in a description. */
const GOOD = {
  originBusinessId: 'biz-etsy',
  destinationBusinessId: 'biz-brooklyn-roasting',
  label: 'Envelope',
  category: 'envelope',
  description: 'Signed contract',
  weightKg: null,
  readyMin: null,
  deadlineMin: 2040,
  rejected: [],
};

// A strict copy of `ParseRequestResponse` (shared/v2 has types, not response schemas) plus the optional `note`
// and `assumed` of #947 (`ParseAnswer`): any other key fails.
const minute = z.number().int().min(0).max(2880);
const DRAFT_KEYS = [
  'originBusinessId', 'destinationBusinessId', 'label', 'category', 'description', 'weightKg', 'readyMin', 'deadlineMin',
] as const;
const ResponseSchema = z.strictObject({
  draft: z.strictObject({
    originBusinessId: z.string().nullable(),
    destinationBusinessId: z.string().nullable(),
    label: z.string().nullable(),
    category: z.enum(['envelope', 'small_box']).nullable(),
    description: z.string().nullable(),
    weightKg: z.number().nullable(),
    readyMin: minute.nullable(),
    deadlineMin: minute.nullable(),
  }),
  missing: z.array(z.enum(DRAFT_KEYS)),
  rejected: z.string().nullable(),
  source: z.enum(['gemini', 'offline']),
  // Beside the contract's fields (#947, `ParseAnswer` in server/ai/deadline.ts): left out when empty.
  note: z.string().min(1).optional(),
  assumed: z.array(z.enum(DRAFT_KEYS)).min(1).optional(),
});

interface Call {
  url: string;
  init?: FetchInitLike;
}
type Reply = { status: number; body: unknown } | Error | 'hang';

/** Gemini's HTTP 200 body whose first candidate says `value` (as JSON, or as the given text). */
function geminiSays(value: unknown): Reply {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return { status: 200, body: { candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] } };
}

/**
 * The only `fetch` the server gets. It answers Gemini's `generateContent` from `reply` ('hang' = never, until
 * the request is aborted) and throws for every other address, so a call to Google Maps would be seen.
 */
function fakeGemini(reply: (call: Call) => Reply) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    const call = { url, init };
    calls.push(call);
    if (!url.startsWith(GEMINI_MODELS_URL)) return Promise.reject(new Error('these tests only know the fake Gemini'));
    const answer = reply(call);
    if (answer === 'hang') {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException(`aborted ${KEY}`, 'AbortError')));
      });
    }
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve({
      status: answer.status,
      text: async () => (typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body)),
    });
  };
  return { calls, fetch: fetchImpl };
}

let api: BootstrapApi | null = null;
/** Every line the route gave to its `log`. */
let logged: string[];
/** Every console call of the test. */
let printed: { method: string; args: unknown[] }[];
/** Every answer of POST /parse-request in the test, as text: none may hold the key or Gemini's raw text. */
let answered: string[];

beforeEach(() => {
  logged = [];
  printed = [];
  answered = [];
  for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args) => void printed.push({ method, args }));
  }
});
afterEach(async () => {
  // Whatever the test did: the key and Gemini's text are in no answer, no log line and no console call.
  for (const text of [...answered, ...logged, JSON.stringify(printed)]) {
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('FAKE_route');
    expect(text).not.toContain(BODY_MARKER);
  }
  await api?.close();
  api = null;
  vi.restoreAllMocks();
}, T);

type GeminiOptions = NonNullable<BootstrapApiOptions['gemini']>;

/** The server with a fake Gemini. `gemini: null` starts it the way a server without the option does. */
async function start(reply: (call: Call) => Reply, gemini: Partial<GeminiOptions> | null = {}) {
  const fake = fakeGemini(reply);
  api = await startBootstrapApi({
    cache: 'sample',
    fetch: fake.fetch,
    ...(gemini === null ? {} : { gemini: { apiKey: KEY, model: MODEL, log: (line: string) => void logged.push(line), ...gemini } }),
  });
  if (!api.store) throw new Error('/api/v2 did not load on the sample cache');
  return { api, store: api.store as Store<RunV2>, calls: fake.calls };
}

async function post(body?: unknown): Promise<Answer> {
  const answer = await (api as BootstrapApi).v2.post('/parse-request', body);
  answered.push(JSON.stringify(answer.body), JSON.stringify([...answer.headers.entries()]));
  return answer;
}

/** A 200 in the contract's shape, with `missing` counted from the draft and only businesses of the run. */
function expectDraft(answer: Answer, run: RunV2): ParseAnswer {
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  expect(answer.headers.get('content-type')).toMatch(/^application\/json\b/);
  const body: ParseAnswer = ResponseSchema.parse(answer.body);
  expect(body.missing).toEqual(DRAFT_KEYS.filter((key) => body.draft[key] === null));
  const ids = run.scenario.businesses.map((b) => b.id);
  for (const id of [body.draft.originBusinessId, body.draft.destinationBusinessId]) {
    if (id !== null) expect(ids).toContain(id);
  }
  return body;
}

const offline = (text: string, run: RunV2) => parseOffline(text, { businesses: run.scenario.businesses, nowMin: run.clock.timeMin });

const promptOf = (run: RunV2) => buildParsePrompt({
  businesses: run.scenario.businesses,
  nowMin: run.clock.timeMin,
  windowStartMin: run.scenario.settings.simStartMin,
  windowEndMin: run.scenario.settings.simEndMin,
});

const remember = (store: Store<RunV2>) => ({ run: store.get(), copy: structuredClone(store.get()) });
function expectUntouched(store: Store<RunV2>, before: ReturnType<typeof remember>) {
  expect(store.get()).toBe(before.run);       // no mutation was committed
  expect(store.get()).toEqual(before.copy);   // and nothing was changed in place
}

describe('POST /api/v2/parse-request with a Gemini key', () => {
  it('a good answer is the draft: source gemini, with the ids of the run', async () => {
    const { store, calls } = await start(() => geminiSays(GOOD));
    const run = store.get();

    const body = expectDraft(await post({ text: EXAMPLE }), run);

    expect(body).toEqual({
      draft: {
        originBusinessId: 'biz-etsy',
        destinationBusinessId: 'biz-brooklyn-roasting',
        label: 'Envelope',
        category: 'envelope',
        description: 'Signed contract',
        weightKg: null,
        readyMin: 930,          // the clock's minute (Day 1 15:30): Gemini said null
        deadlineMin: 2040,      // Day 2 10:00
      },
      missing: ['weightKg'],
      rejected: null,
      source: 'gemini',
    });
    // The offline parser would not have found the description: this draft really is Gemini's.
    expect(offline(EXAMPLE, run).draft.description).toBeNull();
    expect(calls).toHaveLength(1);
    expect(logged).toEqual([]);
    expect(printed).toEqual([]);
  }, T);

  it('asks Gemini once: the run\'s businesses and clock in the prompt, the sentence as the user turn, the key in the header only', async () => {
    const { store, calls } = await start(() => geminiSays(GOOD));
    const run = store.get();

    await post({ text: `  ${EXAMPLE}  ` });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(GEMINI_URL);
    expect(calls[0].url).not.toMatch(/[?&]key=/);
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.headers).toEqual({ 'Content-Type': 'application/json', 'x-goog-api-key': KEY });
    expect(calls[0].init?.body).not.toContain(KEY);
    const sent = JSON.parse(calls[0].init?.body ?? '{}');
    expect(sent).toEqual({
      systemInstruction: { parts: [{ text: promptOf(run) }] },
      contents: [{ role: 'user', parts: [{ text: EXAMPLE }] }],   // trimmed
      // gemini-2.5-flash: thinking off, so the answer fits the 6 s limit (#797)
      generationConfig: { responseMimeType: 'application/json', responseSchema: PARSE_RESPONSE_SCHEMA, thinkingConfig: { thinkingBudget: 0 } },
    });
    const prompt: string = sent.systemInstruction.parts[0].text;
    for (const business of run.scenario.businesses) {
      expect(prompt).toContain(`- ${business.id} | ${business.name} | ${business.neighborhood}`);
    }
    expect(prompt).toContain('Current simulated time: Day 1 15:30 (minute 930).');
    expect(prompt).toContain('from Day 1 15:30 (minute 930) to Day 2 12:00 (minute 2160)');
  }, T);

  it('an invented business id is null in the draft, and rejected says so in the plain sentence', async () => {
    const { store } = await start(() => geminiSays({ ...GOOD, destinationBusinessId: 'biz-grandmas-house' }));
    const invented = expectDraft(await post({ text: "Deliver an envelope from Etsy to grandma's house" }), store.get());
    expect(invented.draft).toMatchObject({ originBusinessId: 'biz-etsy', destinationBusinessId: null });
    expect(invented.missing).toContain('destinationBusinessId');
    expect(invented.rejected).toBe('Relay delivers only between network businesses.');
    expect(invented.source).toBe('gemini');
  }, T);

  it('a stop Gemini names as outside the network is refused in the same words as offline', async () => {
    const { store } = await start(() => geminiSays({ ...GOOD, destinationBusinessId: null, rejected: ['my home'] }));
    const text = 'Deliver an envelope from Etsy to my home by 10 a.m. tomorrow';
    const home = expectDraft(await post({ text }), store.get());
    expect(home.draft).toMatchObject({ originBusinessId: 'biz-etsy', destinationBusinessId: null });
    expect(home.rejected).toBe('Relay delivers only between network businesses, and "my home" is not one.');
    expect(home.rejected).toBe(offline(text, store.get()).rejected);
    expect(home.source).toBe('gemini');
  }, T);

  it('checks the answer against the run: a category, a time or a deadline that does not fit is null, missing is recounted', async () => {
    const { store } = await start(() => geminiSays({
      ...GOOD, category: 'pallet', readyMin: 100, deadlineMin: 2881, missing: [], source: 'offline',
    }));
    // 2881 is after the end of Day 2: no deliver-by a request can name, so it is null and not moved (#947).
    const body = expectDraft(await post({ text: EXAMPLE }), store.get());
    expect(body.draft).toMatchObject({ category: null, readyMin: 930, deadlineMin: null });
    expect(body.missing).toEqual(['category', 'weightKg', 'deadlineMin']);
    expect(body.source).toBe('gemini');
    expect(body.note).toBeUndefined();
  }, T);

  it('a deliver-by after the window end is moved to the end, with a note (#947)', async () => {
    const { store } = await start(() => geminiSays({ ...GOOD, deadlineMin: 2161 }));
    const body = expectDraft(await post({ text: EXAMPLE }), store.get());
    expect(body.draft.deadlineMin).toBe(2160);
    expect(body.missing).toEqual(['weightKg']);
    expect(body.note).toBe('Relay delivers by 12:00 PM tomorrow, ahead of your 12:01 PM deadline.');
    expect(body.assumed).toBeUndefined();
  }, T);

  it('reads the businesses, the clock and the planning window of the run as it is now', async () => {
    const { store, calls } = await start(() => geminiSays({ ...GOOD, readyMin: 610, deadlineMin: 720 }));
    await store.mutate((run) => {
      const etsy = run.scenario.businesses.find((b) => b.id === 'biz-etsy');
      if (!etsy) throw new Error('the run has no biz-etsy');
      etsy.name = 'Handmade Headquarters';
      run.scenario.businesses = run.scenario.businesses.filter((b) => b.id !== 'biz-brooklyn-roasting');
      run.scenario.settings.simStartMin = 600;
      run.clock.timeMin = 600;
    });
    const before = remember(store);

    const body = expectDraft(await post({ text: 'A box from Handmade Headquarters to Brooklyn Roasting by noon' }), store.get());

    // 610 and 720 are inside this run's window; Brooklyn Roasting is no longer a business of this run.
    expect(body.draft).toMatchObject({ originBusinessId: 'biz-etsy', destinationBusinessId: null, readyMin: 610, deadlineMin: 720 });
    expect(body.rejected).toBe('Relay delivers only between network businesses.');
    const prompt: string = JSON.parse(calls[0].init?.body ?? '{}').systemInstruction.parts[0].text;
    expect(prompt).toContain('- biz-etsy | Handmade Headquarters | ');
    expect(prompt).not.toContain('biz-brooklyn-roasting');
    expect(prompt).toContain('Current simulated time: Day 1 10:00 (minute 600).');
    expectUntouched(store, before);
  }, T);

  it('the Gemini draft, once its missing fields are filled in, is a request POST /shipments stores', async () => {
    const { api: server, store } = await start(() => geminiSays(GOOD));
    const { draft, missing } = expectDraft(await post({ text: EXAMPLE }), store.get());
    expect(missing).toEqual(['weightKg']);

    const sent = await server.v2.post('/shipments', { ...draft, clientRequestId: 'parse-request-gemini-1', weightKg: 0.2 });

    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.shipment).toMatchObject({
      originBusinessId: 'biz-etsy', destinationBusinessId: 'biz-brooklyn-roasting', label: 'Envelope',
      category: 'envelope', description: 'Signed contract', readyMin: 930, deadlineMin: 2040, weightGrams: 200,
    });
  }, T);

  it('stores nothing, also while the run is locked: the LLM never submits', async () => {
    const { api: server, store, calls } = await start(() => geminiSays(GOOD));
    const exported = JSON.stringify((await server.v2.get('/scenario/export')).body);
    let before = remember(store);

    const together = await Promise.all(Array.from({ length: 5 }, () => post({ text: EXAMPLE })));
    expect(together.map((answer) => answer.status)).toEqual(Array(5).fill(200));
    expect(together.map((answer) => answer.body.source)).toEqual(Array(5).fill('gemini'));
    expectUntouched(store, before);
    await store.flush();
    expect(fs.existsSync(server.repo.statePath)).toBe(false);   // a fresh run is only written by a change
    expect(JSON.stringify((await server.v2.get('/scenario/export')).body)).toBe(exported);

    expect((await server.v2.post('/simulator/control', { action: 'play' })).status).toBe(200);
    await server.v2.post('/simulator/control', { action: 'pause' });
    expect(store.get().clock.phase).toBe('locked');
    before = remember(store);

    const locked = expectDraft(await post({ text: EXAMPLE }), store.get());
    expect(locked.source).toBe('gemini');
    expect(locked.draft.readyMin).toBe(Math.floor(before.copy.clock.timeMin));
    expectUntouched(store, before);
    expect(calls.every((call) => call.url === GEMINI_URL)).toBe(true);   // Gemini is the only address called
  }, T);

  it('a body that is refused with 400 is never sent to Gemini', async () => {
    const { calls } = await start(() => geminiSays(GOOD));
    for (const body of [{ text: '' }, { text: '   ' }, { text: 'x'.repeat(501) }, {}, { text: 42 }, [], undefined]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(calls).toEqual([]);
    expect(logged).toEqual([]);
  }, T);
});

describe('POST /api/v2/parse-request falls back to the offline parser', () => {
  it.each<[string, () => Reply, string]>([
    ['http 400 (a schema or request Gemini refuses)', () => ({ status: 400, body: { error: { message: BODY_MARKER } } }), 'Gemini is unavailable: HTTP 400.'],
    ['http 403 (a bad key)', () => ({ status: 403, body: { error: { message: `API key not valid: ${KEY} ${BODY_MARKER}` } } }), 'Gemini is unavailable: HTTP 403.'],
    ['http 404 (an unknown model)', () => ({ status: 404, body: BODY_MARKER }), 'Gemini is unavailable: HTTP 404.'],
    ['http 429 (quota)', () => ({ status: 429, body: BODY_MARKER }), 'Gemini is unavailable: HTTP 429.'],
    ['http 503', () => ({ status: 503, body: BODY_MARKER }), 'Gemini is unavailable: HTTP 503.'],
    ['network', () => new Error(`ECONNRESET, sent x-goog-api-key: ${KEY}`), 'Gemini is unavailable: the request failed before an answer arrived.'],
    ['bad_json (the response is no JSON)', () => ({ status: 200, body: `<html>${BODY_MARKER}</html>` }), 'Gemini is unavailable: the answer was not valid JSON.'],
    ['bad_json (the answer text is no JSON)', () => geminiSays(`Here you go: ${BODY_MARKER}`), 'Gemini is unavailable: the answer was not valid JSON.'],
    ['empty (no candidate)', () => ({ status: 200, body: { candidates: [] } }), 'Gemini is unavailable: the answer had no text.'],
    ['empty (a blocked prompt)', () => ({ status: 200, body: { promptFeedback: { blockReason: 'SAFETY' } } }), 'Gemini is unavailable: the answer had no text.'],
    ['an answer of the wrong shape (a list)', () => geminiSays([GOOD]), INVALID_ANSWER_MESSAGE],
    ['an answer of the wrong shape (an empty object)', () => geminiSays({}), INVALID_ANSWER_MESSAGE],
    ['an answer with a field of the wrong type', () => geminiSays({ ...GOOD, weightKg: `heavy ${BODY_MARKER}` }), INVALID_ANSWER_MESSAGE],
  ])('%s: 200 with the offline draft, and one log line', async (_name, reply, message) => {
    const { store, calls } = await start(reply);
    const run = store.get();
    const before = remember(store);

    const body = expectDraft(await post({ text: EXAMPLE }), run);

    expect(body).toEqual(offline(EXAMPLE, run));
    expect(body.source).toBe('offline');
    expect(body.draft).toMatchObject({ originBusinessId: 'biz-etsy', destinationBusinessId: 'biz-brooklyn-roasting', deadlineMin: 2040 });
    expect(calls).toHaveLength(1);   // one attempt, no retry
    expect(logged).toEqual([`[parse-request] ${message} Parsed offline.`]);
    expect(logged).toEqual([fallbackLogLine(message)]);
    expect(printed).toEqual([]);
    expectUntouched(store, before);
  }, T);

  it('a slow Gemini: the offline draft as soon as the time limit is over', async () => {
    const { store, calls } = await start(() => 'hang', { timeoutMs: 80 });
    const run = store.get();
    const started = Date.now();

    const body = expectDraft(await post({ text: EXAMPLE }), run);

    const took = Date.now() - started;
    expect(body).toEqual(offline(EXAMPLE, run));
    expect(took).toBeGreaterThanOrEqual(70);
    expect(took).toBeLessThan(5000);   // far from Gemini's "never"
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.signal?.aborted).toBe(true);   // the request was given up, not left running
    expect(logged).toEqual(['[parse-request] Gemini is unavailable: no answer within 80 ms. Parsed offline.']);
  }, T);

  it('the default time limit is the 6 s of docs/mvp4.md', async () => {
    const { calls } = await start(() => geminiSays(GOOD));
    const timeouts: unknown[] = [];
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
      timeouts.push(ms);
      return realSetTimeout(fn, ms, ...rest);
    }) as typeof setTimeout);

    const answer = await post({ text: EXAMPLE });

    expect(answer.body.source).toBe('gemini');
    expect(calls).toHaveLength(1);
    expect(timeouts).toContain(6000);
  }, T);

  it('recovers: after a failed call the next sentence is Gemini\'s again', async () => {
    let n = 0;
    const { store } = await start(() => (n++ === 0 ? { status: 500, body: BODY_MARKER } : geminiSays(GOOD)));
    expect(expectDraft(await post({ text: EXAMPLE }), store.get()).source).toBe('offline');
    expect(expectDraft(await post({ text: EXAMPLE }), store.get()).source).toBe('gemini');
    expect(logged).toEqual(['[parse-request] Gemini is unavailable: HTTP 500. Parsed offline.']);
  }, T);

  it('a log that throws does not cost the sender the offline draft', async () => {
    const { store } = await start(() => ({ status: 500, body: BODY_MARKER }), {
      log: () => {
        throw new Error('the log is broken');
      },
    });
    expect(expectDraft(await post({ text: EXAMPLE }), store.get())).toEqual(offline(EXAMPLE, store.get()));
  }, T);

  it('without a log of its own the line goes to console.warn, once', async () => {
    const { store } = await start(() => ({ status: 403, body: `${KEY} ${BODY_MARKER}` }), { log: undefined });
    expect(expectDraft(await post({ text: EXAMPLE }), store.get()).source).toBe('offline');
    expect(printed).toEqual([{ method: 'warn', args: ['[parse-request] Gemini is unavailable: HTTP 403. Parsed offline.'] }]);
  }, T);
});

describe('POST /api/v2/parse-request without a Gemini key', () => {
  it.each<[string, Partial<GeminiOptions> | null]>([
    ['no Gemini settings at all', null],
    ['a null key', { apiKey: null }],
    ['an undefined key', { apiKey: undefined }],
    ['an empty key', { apiKey: '' }],
    ['a blank key', { apiKey: '  \n' }],
  ])('%s: the offline draft, nothing is sent and nothing is logged', async (_name, gemini) => {
    const { store, calls } = await start(() => geminiSays(GOOD), gemini);
    const run = store.get();

    const body = expectDraft(await post({ text: EXAMPLE }), run);

    expect(body).toEqual(offline(EXAMPLE, run));
    expect(body.source).toBe('offline');
    expect(calls).toEqual([]);
    expect(logged).toEqual([]);
    expect(printed).toEqual([]);
  }, T);
});

describe('startServer: GEMINI_API_KEY and GEMINI_MODEL from .env reach the route', () => {
  const started: { server: RelayServer; repo: TempRepo }[] = [];
  afterEach(async () => {
    for (const one of started.splice(0)) {
      await one.server.stop();
      one.repo.remove();
    }
  });

  /** The whole server as `npm start` runs it, on a temp folder with its own `.env` and the fake Gemini. */
  async function boot(dotEnv: string, reply: (call: Call) => Reply) {
    const repo = tempRepo('sample');
    const envPath = path.join(repo.root, '.env');
    fs.writeFileSync(envPath, dotEnv);
    const fake = fakeGemini(reply);
    const lines: string[] = [];
    const server = startServer({
      env: { PORT: '0' },
      envPath,
      log: (line) => void lines.push(line),
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
    const parse = async (text: string) => {
      const res = await fetch(`${origin}/api/v2/parse-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
      });
      const body = (await res.json()) as ParseRequestResponse;
      answered.push(JSON.stringify(body));
      return { status: res.status, body };
    };
    return { lines, calls: fake.calls, parse };
  }

  it('with the key in .env the sentence goes to Gemini, with the model of GEMINI_MODEL', async () => {
    const one = await boot(`GEMINI_API_KEY=${KEY}\nGEMINI_MODEL=gemini-flash-latest\n`, () => geminiSays(GOOD));

    const answer = await one.parse(EXAMPLE);

    expect(answer.status).toBe(200);
    expect(answer.body.source).toBe('gemini');
    expect(answer.body.draft.description).toBe('Signed contract');
    expect(one.calls.map((call) => call.url)).toEqual([`${GEMINI_MODELS_URL}/gemini-flash-latest:generateContent`]);
    expect(one.calls[0].init?.headers?.['x-goog-api-key']).toBe(KEY);
    // The start lines say nothing of the key, and neither does the console.
    expect(one.lines.join('\n')).not.toContain(KEY);
    expect(one.lines.join('\n')).not.toMatch(/gemini/i);
    expect(printed).toEqual([]);
  }, T);

  it('with the key and no GEMINI_MODEL the model is gemini-2.5-flash', async () => {
    const one = await boot(`GEMINI_API_KEY=${KEY}\n`, () => geminiSays(GOOD));
    expect((await one.parse(EXAMPLE)).body.source).toBe('gemini');
    expect(one.calls.map((call) => call.url)).toEqual([GEMINI_URL]);
  }, T);

  it('without the key in .env nothing is sent and the draft is the offline one', async () => {
    const one = await boot('GEMINI_MODEL=gemini-flash-latest\nGOOGLE_MAPS_SERVER_KEY=FAKE-maps-key\n', () => geminiSays(GOOD));

    const answer = await one.parse(EXAMPLE);

    expect(answer.status).toBe(200);
    expect(answer.body.source).toBe('offline');
    expect(answer.body.draft).toMatchObject({ originBusinessId: 'biz-etsy', destinationBusinessId: 'biz-brooklyn-roasting' });
    expect(one.calls).toEqual([]);   // the Google Maps key is not a Gemini key
    expect(printed).toEqual([]);
  }, T);
});
