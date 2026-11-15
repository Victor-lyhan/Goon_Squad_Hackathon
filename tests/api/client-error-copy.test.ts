// #909: when the browser gets no usable answer (server down, slow, a reply that is not JSON, an error
// with no text), `request` in client/src/api/http.ts writes the message itself. Each of those messages is
// one plain sentence that says what to do: no milliseconds, no status number, no browser wording.
//
// `request` is driven with a fake fetch: it hangs past `apiConfig.timeoutMs` (on a fake clock, so a slow
// runner cannot turn it red), rejects, returns HTML, returns an error with no body. What is checked:
//   - the message is one sentence of at most 14 words with none of the words in JARGON;
//   - `status`, `kind` and `code` are what they were before #909;
//   - text the server sent in `error` (#888) goes through as it is.
// The exact sentences are pinned in TEXT: this file is the table in the PR, as a test.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, apiConfig, DEFAULT_TIMEOUT_MS, isAbortError, isNetworkError, request } from '../../client/src/api/http';
import { ADVISE_TIMEOUT_MS, advise, getSimulator, isTravelUnavailable } from '../../client/src/api/v2';
import type { ParseDraft } from '../../shared/v2/parseRequest';
import { hangingFetch, settledAtTimeout } from './client-timeout-clock';

// ---------- the table: every message the client API layer writes itself ----------

const TEXT = {
  // was the browser's own text ("Failed to fetch", "fetch failed", "Load failed"), or "Network error"
  network: "Can't reach the Relay server, so check it's running and try again.",
  // was "Request timed out after 8000 ms"
  timeout: 'The Relay server took too long to answer, so try again in a moment.',
  // was "Request aborted"
  abort: 'This was cancelled before the Relay server answered, so try again.',
  // was the JSON parser's own text ("Unexpected token '<', "<!doctype "... is not valid JSON")
  badReply: "The Relay server's answer couldn't be read, so reload the page and try again.",
  // was "Request failed (500)"
  noErrorText: "The Relay server had a problem, so check it's running and try again.",
};

// ---------- the rules ----------

const MAX_WORDS = 14;

/** Words a page never uses. The first block is the list of #888 (v2-error-copy); the second is the client's own. */
const JARGON: [string, RegExp][] = [
  ['hub', /\bhubs?\b/i],
  ['trip', /\btrips?\b/i],
  ['ID', /\bids?\b/i],
  ['HTTP', /\bhttp\b/i],
  ['phase', /\bphase\b/i],
  ['locked', /\block(ed|s)?\b/i],
  ['shipment', /\bshipments?\b/i],
  ['JSON', /\bjson\b/i],
  ['a programming word', /\b(object|array|string|boolean|integer|null|undefined|nan|enum|schema|payload|body|endpoint|zod)\b/i],
  ['a label, not a sentence', /^(invalid|unknown)\b|\bnot found\b/i],
  ['a contract field (camelCase)', /[a-z][A-Z]/],
  ['a contract value (snake_case)', /[a-z]_[a-z]/],
  ['API', /\bapis?\b/i],
  ['backend', /\bback[\s-]?ends?\b/i],

  ['a number (ms, a status)', /\d/],
  ['a time unit', /\b(ms|msec|milliseconds?|seconds?)\b/i],
  ['timed out', /\btimed? ?out\b/i],
  ['request', /\brequests?\b/i],
  ['response', /\bresponses?\b/i],
  ['fetch', /\bfetch(ed|ing)?\b/i],
  ['abort', /\babort(ed|ing)?\b/i],
  ['status', /\bstatus\b/i],
  ['network', /\bnetwork/i],
  ['failed, the label', /\bfailed\b/i],
  ['error', /\berrors?\b/i],
  ['the parser\'s words', /\b(unexpected|token|parse|syntax|doctype|html|exception)\b/i],
];

const wordsOf = (text: string) => text.trim().split(/\s+/).filter(Boolean);

/** What is wrong with a text as plain copy; empty when nothing is. */
function problemsOf(text: string): string[] {
  const problems: string[] = [];
  if (text.trim() === '' || text !== text.trim()) problems.push('empty or padded');
  if (!/^[A-Z]/.test(text)) problems.push('does not start with a capital letter');
  if (!text.endsWith('.')) problems.push('does not end with a period');
  if (/[.!?…]\s|\n/.test(text)) problems.push('more than one sentence');
  if (wordsOf(text).length > MAX_WORDS) problems.push(`${wordsOf(text).length} words, more than ${MAX_WORDS}`);
  if (!/\b(try again|reload)\b/.test(text)) problems.push('does not say what to do');
  for (const [name, pattern] of JARGON) if (pattern.test(text)) problems.push(`jargon: ${name}`);
  return problems;
}

// ---------- the fake fetch ----------

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const stub = (fake: Fetch) => vi.stubGlobal('fetch', fake);
const rejects = (reason: unknown): Fetch => async () => { throw reason; };
const replies = (make: () => Response): Fetch => async () => make();
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const html = (status: number) =>
  new Response('<!doctype html><html><body><h1>It works</h1></body></html>', { status, headers: { 'Content-Type': 'text/html' } });
const hangs: Fetch = (_input, init) => hangingFetch(init);

const get = (opts?: Parameters<typeof request>[3]) => request<unknown>('GET', '/api/v2/simulator', undefined, opts);
const caught = (p: Promise<unknown>): Promise<ApiRequestError> => p.then(
  () => { throw new Error('the call was expected to fail'); },
  (e) => e,
);

/** Every message this file saw the client write, so the last test can tell that the table is complete. */
const seen = new Set<string>();

/** The error is the client's own: the class, plain copy, and the status, kind and code of before #909. */
function expectOwn(e: ApiRequestError, what: string, expected: { status: number; kind: string; text: string }) {
  expect(e, what).toBeInstanceOf(ApiRequestError);
  seen.add(e.message);
  expect(problemsOf(e.message), `${what}: "${e.message}"`).toStrictEqual([]);
  expect({ status: e.status, kind: e.kind, text: e.message }, what).toStrictEqual(expected);
  expect(e.code, what).toBeUndefined();
  expect(e.fieldErrors, what).toBeUndefined();
}

afterEach(() => {
  vi.unstubAllGlobals();
  apiConfig.timeoutMs = DEFAULT_TIMEOUT_MS;
});

// ---------- the list itself ----------

describe('the no-jargon list', () => {
  it('refuses the texts the client produced before', () => {
    for (const old of [
      'Request timed out after 8000 ms',
      'Request timed out after 15000 ms',
      'Request aborted',
      'Network error',
      'Failed to fetch',
      'fetch failed',
      'Load failed',
      'NetworkError when attempting to fetch resource.',
      'Request failed (500)',
      'Request failed (404)',
      'Unexpected token \'<\', "<!doctype "... is not valid JSON',
      'Unexpected end of JSON input',
      'This operation was aborted',
      'The server answered 503.',
    ]) {
      expect(problemsOf(old).filter((p) => p.startsWith('jargon')), old).not.toStrictEqual([]);
    }
  });

  it('refuses two sentences, a long sentence and a sentence with nothing to do', () => {
    expect(problemsOf("The Relay server didn't answer. Check it's running, then try again.")).toStrictEqual(['more than one sentence']);
    expect(problemsOf(`Word ${'word '.repeat(MAX_WORDS - 3)}so try again.`)).toStrictEqual([`${MAX_WORDS + 1} words, more than ${MAX_WORDS}`]);
    expect(problemsOf("Can't reach the Relay server.")).toStrictEqual(['does not say what to do']);
  });

  it('accepts every sentence of the table', () => {
    for (const [name, text] of Object.entries(TEXT)) expect(problemsOf(text), name).toStrictEqual([]);
    expect(new Set(Object.values(TEXT)).size).toBe(Object.keys(TEXT).length);
  });
});

// ---------- no answer at all ----------

describe('no answer: fetch fails', () => {
  it('whatever the browser calls it, the message is the one "can\'t reach" sentence', async () => {
    const reasons: unknown[] = [
      new TypeError('Failed to fetch'), // Chrome
      new TypeError('fetch failed'), // Node
      new TypeError('Load failed'), // Safari
      new TypeError('NetworkError when attempting to fetch resource.'), // Firefox
      new Error(''),
      'a string, not an Error',
      undefined,
    ];
    for (const reason of reasons) {
      stub(rejects(reason));
      const e = await caught(get());
      expectOwn(e, String(reason), { status: 0, kind: 'network', text: TEXT.network });
      expect(isNetworkError(e)).toBe(true);
      expect(isAbortError(e)).toBe(false);
    }
  });

  it('a route helper gives the same sentence, also on a write', async () => {
    stub(rejects(new TypeError('Failed to fetch')));
    expectOwn(await caught(getSimulator()), 'getSimulator', { status: 0, kind: 'network', text: TEXT.network });
    expectOwn(await caught(request('POST', '/api/v2/shipments', { label: 'L' })), 'POST', { status: 0, kind: 'network', text: TEXT.network });
  });
});

describe('no answer in time: fetch hangs', () => {
  it('ends at apiConfig.timeoutMs with a sentence that names no time', async () => {
    stub(hangs);
    expect(apiConfig.timeoutMs).toBe(8000);
    const outcome = await settledAtTimeout(() => get(), 8000);
    expect(outcome.status).toBe('rejected');
    const e = (outcome as PromiseRejectedResult).reason;
    expectOwn(e, 'the default time limit', { status: 0, kind: 'timeout', text: TEXT.timeout });
    expect(isNetworkError(e)).toBe(true);
    expect(isAbortError(e)).toBe(false);
  });

  it('a changed apiConfig.timeoutMs, a per-call limit and the advisor\'s longer limit give the same sentence', async () => {
    stub(hangs);
    apiConfig.timeoutMs = 250;
    const shared = await settledAtTimeout(() => get(), 250);
    expectOwn((shared as PromiseRejectedResult).reason, 'apiConfig.timeoutMs = 250', { status: 0, kind: 'timeout', text: TEXT.timeout });
    apiConfig.timeoutMs = DEFAULT_TIMEOUT_MS;

    const perCall = await settledAtTimeout(() => get({ timeoutMs: 30 }), 30);
    expectOwn((perCall as PromiseRejectedResult).reason, 'timeoutMs: 30', { status: 0, kind: 'timeout', text: TEXT.timeout });

    expect(ADVISE_TIMEOUT_MS).toBe(15_000);
    const slowAdvice = await settledAtTimeout(() => advise({} as ParseDraft), ADVISE_TIMEOUT_MS);
    expectOwn((slowAdvice as PromiseRejectedResult).reason, 'advise', { status: 0, kind: 'timeout', text: TEXT.timeout });
  });
});

describe('the caller ends the call', () => {
  it('an already-aborted signal and an abort in flight are abort errors with a plain sentence', async () => {
    stub(hangs);
    const before = new AbortController();
    before.abort();
    const early = await caught(get({ signal: before.signal }));
    expectOwn(early, 'aborted before the call', { status: 0, kind: 'abort', text: TEXT.abort });
    expect(isAbortError(early)).toBe(true);
    expect(isNetworkError(early)).toBe(false);

    const during = new AbortController();
    const pending = caught(get({ signal: during.signal, timeoutMs: 600_000 }));
    during.abort();
    const late = await pending;
    expectOwn(late, 'aborted in flight', { status: 0, kind: 'abort', text: TEXT.abort });
    expect(isAbortError(late)).toBe(true);
  });
});

// ---------- an answer the page cannot use ----------

describe('a 2xx reply that is not JSON', () => {
  it('an HTML page, plain text and an empty reply give the "couldn\'t be read" sentence', async () => {
    const cases: [string, () => Response][] = [
      ['an HTML page', () => html(200)],
      ['plain text', () => new Response('OK', { status: 200 })],
      ['an empty reply', () => new Response('', { status: 200 })],
      ['half a JSON reply', () => new Response('{"runId": "run-1", "clock": {', { status: 200, headers: { 'Content-Type': 'application/json' } })],
    ];
    for (const [name, make] of cases) {
      stub(replies(make));
      const e = await caught(get());
      expectOwn(e, name, { status: 0, kind: 'network', text: TEXT.badReply });
      expect(isNetworkError(e)).toBe(true);
    }
  });

  it('a reply that breaks off while it is read is the "can\'t reach" sentence, not the browser\'s text', async () => {
    stub(async () => ({ ok: true, status: 200, json: async () => { throw new TypeError('terminated'); } }) as unknown as Response);
    expectOwn(await caught(get()), 'a dropped reply', { status: 0, kind: 'network', text: TEXT.network });
  });

  it('a JSON reply is returned as before', async () => {
    stub(replies(() => json(200, { ok: true })));
    expect(await get()).toStrictEqual({ ok: true });
  });
});

describe('an HTTP error with no `error` text', () => {
  it('keeps its status and kind, and the message is one sentence without the status number', async () => {
    const cases: [string, number, () => Response][] = [
      ['a 500 with no body', 500, () => new Response(null, { status: 500 })],
      ['a 500 with an empty body', 500, () => new Response('', { status: 500 })],
      ['a 502 with an HTML page', 502, () => html(502)],
      ['a 503 with plain text', 503, () => new Response('Service Unavailable', { status: 503 })],
      ['a 404 with an HTML page', 404, () => html(404)],
      ['a 500 with JSON that has no error', 500, () => json(500, { detail: 'x' })],
      ['a 500 with JSON null', 500, () => json(500, null)],
      ['a 500 whose error is not text', 500, () => json(500, { error: { name: 'TypeError' } })],
      ['a 500 whose error is empty', 500, () => json(500, { error: '' })],
      ['a 409 whose error is blank', 409, () => json(409, { error: '   ' })],
    ];
    for (const [name, status, make] of cases) {
      stub(replies(make));
      const e = await caught(get());
      expectOwn(e, name, { status, kind: 'http', text: TEXT.noErrorText });
      expect(e.message, name).not.toContain(String(status));
      expect(isNetworkError(e)).toBe(false);
      expect(isAbortError(e)).toBe(false);
    }
  });

  it('a `code` and `fieldErrors` sent without an error text are kept', async () => {
    stub(replies(() => json(503, { code: 'google_unavailable' })));
    const coded = await caught(get());
    expect([coded.status, coded.kind, coded.code, coded.message]).toStrictEqual([503, 'http', 'google_unavailable', TEXT.noErrorText]);
    expect(isTravelUnavailable(coded)).toBe(true);

    stub(replies(() => json(400, { fieldErrors: { weightKg: 'Max 2 kg' } })));
    const fields = await caught(get());
    expect([fields.status, fields.message]).toStrictEqual([400, TEXT.noErrorText]);
    expect(fields.fieldErrors).toStrictEqual({ weightKg: 'Max 2 kg' });
  });
});

// ---------- the server's own text ----------

describe('text the server sent (#888)', () => {
  it('goes through as it is, with status, code and fieldErrors', async () => {
    const bodies: [number, { error: string; code?: string; fieldErrors?: Record<string, string> }][] = [
      [400, { error: 'Fix the missing or wrong delivery details, then try again.', fieldErrors: { weightKg: 'Max 2 kg' } }],
      [404, { error: 'This delivery no longer exists, so refresh the page to see the current list.' }],
      [409, { error: 'Playback has started, so press Back to start in the simulator to change deliveries.' }],
      [500, { error: 'Something went wrong on the Relay server, so try again.' }],
      [503, { error: 'The Google Maps server key is not set. Add GOOGLE_MAPS_SERVER_KEY to .env and restart the server.', code: 'google_key_missing' }],
      // Not the client's to reword: jargon, a status number, padding and a line break all stay.
      [409, { error: ' Request failed (409): the run is locked\n' }],
      [500, { error: 'x' }],
    ];
    for (const [status, body] of bodies) {
      stub(replies(() => json(status, body)));
      const e = await caught(get());
      expect(e).toBeInstanceOf(ApiRequestError);
      expect([e.status, e.kind, e.message, e.code], body.error).toStrictEqual([status, 'http', body.error, body.code]);
      expect(e.fieldErrors, body.error).toStrictEqual(body.fieldErrors);
      expect(Object.values(TEXT), body.error).not.toContain(e.message);
    }
  });
});

// ---------- nothing was left out ----------

describe('the table is complete', () => {
  it('every sentence of the table was produced above, and nothing else was', () => {
    expect([...seen].sort()).toStrictEqual(Object.values(TEXT).sort());
  });

  it('http.ts holds exactly these sentences, and every error it builds takes its message from them or from the server', () => {
    const source = readFileSync('client/src/api/http.ts', 'utf8');
    const block = /const API_ERROR_TEXT = \{\n([\s\S]*?)\n\} as const;/.exec(source);
    expect(block, 'the API_ERROR_TEXT block').not.toBeNull();
    const written = [...block![1].matchAll(/^\s+(\w+): (["'])(.*)\2,$/gm)].map((m) => [m[1], m[3]]);
    expect(Object.fromEntries(written)).toStrictEqual(TEXT);

    // `new ApiRequestError(status, message, ...)`: the second argument of every call.
    const messages = [...source.matchAll(/new ApiRequestError\(\s*[^,]+,\s*([^,]+),/g)].map((m) => m[1].trim());
    expect(messages).toHaveLength(4);
    for (const message of messages) {
      expect(message).toMatch(/^(API_ERROR_TEXT\.\w+|unreadable \? API_ERROR_TEXT\.badReply : API_ERROR_TEXT\.network|message)$/);
    }
    // No other file of the layer builds an error or a message.
    for (const file of ['client/src/api/v2.ts', 'client/src/api/index.ts']) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/new ApiRequestError\(|new Error\(/);
    }
  });
});
