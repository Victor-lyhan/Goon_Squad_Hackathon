// Gemini client (server/ai/gemini.ts) and its settings (server/ai/env.ts) against a fake fetch only:
// no network, no real key, no .env.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspect } from 'node:util';
import { DEFAULT_GEMINI_MODEL, GEMINI_KEY_NAME, GEMINI_MODEL_NAME, geminiKey, geminiModel, loadDotEnv } from '../../server/ai/env';
import { loadDotEnv as geoLoadDotEnv } from '../../server/geo/env';
import {
  DEFAULT_GEMINI_TIMEOUT_MS, GEMINI_MODELS_URL, GeminiUnavailable, NO_THINKING_MODEL_PREFIX, generateContentUrl, generateJson, thinkingConfigFor,
} from '../../server/ai/gemini';
import type { GenerateJsonOptions } from '../../server/ai/gemini';
import type { FetchInitLike, FetchLike } from '../../server/geo/googleClient';

// Not a real key. It starts with `AQ` like a new AI Studio key and has characters that change when URL-encoded.
const KEY = 'AQ.FAKE_key-123+/=';
const KEY_ENCODED = encodeURIComponent(KEY);
const MODEL = 'gemini-2.5-flash';
const URL_OF_MODEL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
/** A marker put into response bodies, to show that no body text reaches an error. */
const BODY_MARKER = 'BODY-MARKER-7f3a';
const SCHEMA = { type: 'OBJECT', properties: { senderId: { type: 'STRING', nullable: true } }, required: ['senderId'] };

interface Call {
  url: string;
  init?: FetchInitLike;
}
type Reply = { status: number; body: unknown } | Error;

/** A fetch that records every call and answers from `reply`. A string body is sent as is, anything else as JSON. */
function fakeFetch(reply: (call: Call) => Reply) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    const answer = reply(call);
    if (answer instanceof Error) throw answer;
    return { status: answer.status, text: async () => (typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body)) };
  };
  return { calls, fetchImpl };
}

/** A fetch that never answers and, like the real one, rejects when its signal aborts. */
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

/** A Gemini answer whose first candidate holds `texts` as its parts. */
function answerWith(...texts: string[]) {
  return {
    candidates: [{ content: { role: 'model', parts: texts.map((text) => ({ text })) }, finishReason: 'STOP' }],
    usageMetadata: { totalTokenCount: 42 },
  };
}

function options(fetchImpl: FetchLike, extra: Partial<GenerateJsonOptions> = {}): GenerateJsonOptions {
  return {
    apiKey: KEY,
    model: MODEL,
    systemText: 'Turn the request into a delivery draft.',
    userText: 'Deliver an envelope from Etsy to Brooklyn Roasting by 10 a.m. tomorrow.',
    responseSchema: SCHEMA,
    fetchImpl,
    ...extra,
  };
}

/** The GeminiUnavailable a call rejects with. Fails when it resolves or rejects with anything else. */
async function failure(promise: Promise<unknown>): Promise<GeminiUnavailable> {
  const err = await promise.then(
    (value) => new Error(`expected a rejection, got ${JSON.stringify(value)}`),
    (reason: unknown) => reason,
  );
  expect(err).toBeInstanceOf(GeminiUnavailable);
  return err as GeminiUnavailable;
}

/** Every text form of an error a route or a log line could use: none may hold the key or a response body. */
function expectSafe(err: GeminiUnavailable) {
  const forms = [err.message, String(err), err.stack ?? '', inspect(err, { depth: 10, showHidden: true }), JSON.stringify(err), JSON.stringify(Object.entries(err))];
  for (const text of forms) {
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(KEY_ENCODED);
    expect(text).not.toContain('FAKE_key');
    expect(text).not.toContain(BODY_MARKER);
  }
  expect(err.cause).toBeUndefined();
  expect(err.name).toBe('GeminiUnavailable');
  expect(err.message).toMatch(/^Gemini is unavailable: /);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('server/ai/env', () => {
  it('geminiKey returns the trimmed GEMINI_API_KEY, or null when it is unset or blank', () => {
    expect(GEMINI_KEY_NAME).toBe('GEMINI_API_KEY');
    expect(geminiKey({ GEMINI_API_KEY: `  ${KEY}\n` })).toBe(KEY);
    expect(geminiKey({})).toBeNull();
    expect(geminiKey({ GEMINI_API_KEY: '' })).toBeNull();
    expect(geminiKey({ GEMINI_API_KEY: '   ' })).toBeNull();
    // No other variable stands in for it: not a browser (VITE_) one, not the Google Maps key.
    expect(geminiKey({ VITE_GEMINI_API_KEY: KEY, GOOGLE_MAPS_SERVER_KEY: KEY, GOOGLE_API_KEY: KEY })).toBeNull();
  });

  it('geminiKey does not check the prefix: an AQ auth key and an AIza key both pass as they are', () => {
    expect(geminiKey({ GEMINI_API_KEY: 'AQ.fake-auth-key' })).toBe('AQ.fake-auth-key');
    expect(geminiKey({ GEMINI_API_KEY: 'AIzaFAKE-old-style' })).toBe('AIzaFAKE-old-style');
    expect(geminiKey({ GEMINI_API_KEY: 'anything-else' })).toBe('anything-else');
  });

  it('geminiModel returns GEMINI_MODEL, or gemini-2.5-flash when it is unset or blank', () => {
    expect(GEMINI_MODEL_NAME).toBe('GEMINI_MODEL');
    expect(DEFAULT_GEMINI_MODEL).toBe('gemini-2.5-flash');
    expect(geminiModel({})).toBe('gemini-2.5-flash');
    expect(geminiModel({ GEMINI_MODEL: '' })).toBe('gemini-2.5-flash');
    expect(geminiModel({ GEMINI_MODEL: '  ' })).toBe('gemini-2.5-flash');
    expect(geminiModel({ GEMINI_MODEL: ' gemini-flash-latest ' })).toBe('gemini-flash-latest');
  });

  it("reuses the geo layer's .env loader, which fills both variables from a temp .env", () => {
    expect(loadDotEnv).toBe(geoLoadDotEnv);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'relay-ai-env-')), '.env');
    fs.writeFileSync(file, `GEMINI_API_KEY=${KEY}\nGEMINI_MODEL="gemini-flash-latest"\n`);
    const env: Record<string, string | undefined> = {};
    expect(loadDotEnv(file, env)).toEqual(['GEMINI_API_KEY', 'GEMINI_MODEL']);
    expect(geminiKey(env)).toBe(KEY);
    expect(geminiModel(env)).toBe('gemini-flash-latest');
  });

  it('keeps the key out of the browser: no client file names GEMINI, and the server files name no VITE_ variable', () => {
    const root = path.resolve(__dirname, '../..');
    const clientFiles = fs
      .readdirSync(path.join(root, 'client/src'), { recursive: true, encoding: 'utf8' })
      .filter((name) => /\.(ts|tsx)$/.test(name));
    expect(clientFiles.length).toBeGreaterThan(10);
    for (const name of clientFiles) {
      expect(fs.readFileSync(path.join(root, 'client/src', name), 'utf8'), name).not.toMatch(/GEMINI_API_KEY|GEMINI_MODEL/);
    }
    for (const name of ['server/ai/env.ts', 'server/ai/gemini.ts']) {
      expect(fs.readFileSync(path.join(root, name), 'utf8'), name).not.toMatch(/VITE_[A-Z]|import\.meta\.env/);
    }
  });
});

describe('generateJson: the request', () => {
  it('sends one POST with the key in the x-goog-api-key header and no key in the URL', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: answerWith('{"senderId":"biz-etsy"}') }));
    await expect(generateJson(options(fetchImpl))).resolves.toEqual({ senderId: 'biz-etsy' });

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe(URL_OF_MODEL);
    expect(url).not.toContain('key=');
    expect(url).not.toContain('?');
    expect(url).not.toContain(KEY);
    expect(url).not.toContain(KEY_ENCODED);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json', 'x-goog-api-key': KEY });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);
    // The key is in the header only: not in the body either.
    expect(init?.body).not.toContain(KEY);
  });

  it('asks for structured output: JSON mime type, the schema, the system instruction and one user turn', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: answerWith('{}') }));
    await generateJson(options(fetchImpl));
    expect(JSON.parse(calls[0].init?.body ?? '')).toEqual({
      systemInstruction: { parts: [{ text: 'Turn the request into a delivery draft.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Deliver an envelope from Etsy to Brooklyn Roasting by 10 a.m. tomorrow.' }] }],
      // MODEL is gemini-2.5-flash: its thinking is turned off.
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, thinkingConfig: { thinkingBudget: 0 } },
    });
  });

  it('turns thinking off for every gemini-2.5-flash model: a thinking budget of 0 in generationConfig', async () => {
    for (const model of [
      'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash-preview-09-2025', 'gemini-2.5-flash-lite-preview-06-17',
      'models/gemini-2.5-flash', '  gemini-2.5-flash-lite\n', 'Gemini-2.5-Flash',
    ]) {
      const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: answerWith('{}') }));
      await generateJson(options(fetchImpl, { model }));
      expect(calls, model).toHaveLength(1);
      expect(JSON.parse(calls[0].init?.body ?? '').generationConfig, model).toEqual({
        responseMimeType: 'application/json', responseSchema: SCHEMA, thinkingConfig: { thinkingBudget: 0 },
      });
      expect(thinkingConfigFor(model), model).toEqual({ thinkingBudget: 0 });
    }
    expect(NO_THINKING_MODEL_PREFIX).toBe('gemini-2.5-flash');
  });

  it('sends no thinkingConfig for any other model (gemini-2.5-pro cannot turn thinking off)', async () => {
    for (const model of [
      'gemini-2.5-pro', 'models/gemini-2.5-pro', 'gemini-flash-latest', 'gemini-2.0-flash', 'gemini-2.5-flas', 'gemini-3-flash-preview',
      'my-gemini-2.5-flash',
    ]) {
      const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: answerWith('{}') }));
      await generateJson(options(fetchImpl, { model }));
      expect(calls, model).toHaveLength(1);
      const sent = JSON.parse(calls[0].init?.body ?? '');
      expect(sent.generationConfig, model).toEqual({ responseMimeType: 'application/json', responseSchema: SCHEMA });
      expect(calls[0].init?.body, model).not.toContain('thinking');
      expect(thinkingConfigFor(model), model).toBeNull();
    }
  });

  it('sends no system instruction when the system text is blank', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: answerWith('{}') }));
    await generateJson(options(fetchImpl, { systemText: '  ' }));
    expect(JSON.parse(calls[0].init?.body ?? '')).not.toHaveProperty('systemInstruction');
  });

  it('puts the model into the path, encoded, so a model name can never add a query string', async () => {
    expect(GEMINI_MODELS_URL).toBe('https://generativelanguage.googleapis.com/v1beta/models');
    expect(generateContentUrl('gemini-2.5-flash')).toBe(URL_OF_MODEL);
    expect(generateContentUrl(' models/gemini-2.5-flash ')).toBe(URL_OF_MODEL);
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: answerWith('{}') }));
    await generateJson(options(fetchImpl, { model: `x?key=${KEY}&a=/../b` }));
    expect(calls[0].url).not.toContain('?');
    expect(calls[0].url).not.toContain('key=');
    expect(calls[0].url).not.toContain(KEY);
    expect(new URL(calls[0].url).search).toBe('');
    expect(new URL(calls[0].url).pathname.startsWith('/v1beta/models/x%3Fkey%3D')).toBe(true);
  });

  it('uses the global fetch when no fetchImpl is given', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: answerWith('{"ok":true}') }));
    vi.stubGlobal('fetch', fetchImpl);
    const { fetchImpl: _unused, ...withoutFetch } = options(fetchImpl);
    await expect(generateJson(withoutFetch)).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.headers?.['x-goog-api-key']).toBe(KEY);
  });

  it('trims the key before sending it', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: answerWith('{}') }));
    await generateJson(options(fetchImpl, { apiKey: `  ${KEY}\n` }));
    expect(calls[0].init?.headers?.['x-goog-api-key']).toBe(KEY);
  });
});

describe('generateJson: the answer', () => {
  it("returns the parsed JSON of the first candidate's text, whatever its type", async () => {
    const draft = { senderId: 'biz-etsy', recipientId: null, missing: ['recipientId'] };
    for (const value of [draft, [1, 2], 'text', 7, null]) {
      const { fetchImpl } = fakeFetch(() => ({ status: 200, body: answerWith(JSON.stringify(value)) }));
      await expect(generateJson(options(fetchImpl))).resolves.toEqual(value);
    }
  });

  it('joins the text parts of the first candidate, skips thought parts and ignores later candidates', async () => {
    const body = {
      candidates: [
        { content: { parts: [{ text: 'thinking {', thought: true }, { text: '{"senderId":' }, { inlineData: {} }, { text: '"biz-etsy"}\n' }] } },
        { content: { parts: [{ text: '{"senderId":"other"}' }] } },
      ],
    };
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body }));
    await expect(generateJson(options(fetchImpl))).resolves.toEqual({ senderId: 'biz-etsy' });
  });

  it('clears its timer after an answer', async () => {
    vi.useFakeTimers();
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: answerWith('{}') }));
    await expect(generateJson(options(fetchImpl))).resolves.toEqual({});
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('generateJson: failures are GeminiUnavailable and never hold the key or the body', () => {
  it('rejects without a key, and sends nothing', async () => {
    for (const apiKey of [null, '', '   ', undefined as unknown as null]) {
      const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: answerWith('{}') }));
      const err = await failure(generateJson(options(fetchImpl, { apiKey })));
      expect(err.reason).toBe('no_key');
      expect(err.status).toBeNull();
      expect(err.message).toBe('Gemini is unavailable: GEMINI_API_KEY is not set.');
      expect(calls).toHaveLength(0);
      expectSafe(err);
    }
  });

  it('rejects without a model name, and sends nothing', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: answerWith('{}') }));
    const err = await failure(generateJson(options(fetchImpl, { model: '  ' })));
    expect(err.reason).toBe('no_model');
    expect(calls).toHaveLength(0);
    expectSafe(err);
  });

  it('rejects on a 403, with the status and none of the body', async () => {
    const body = { error: { code: 403, status: 'PERMISSION_DENIED', message: `API key ${KEY} is not valid. ${BODY_MARKER}` } };
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 403, body }));
    const err = await failure(generateJson(options(fetchImpl)));
    expect(err.reason).toBe('http');
    expect(err.status).toBe(403);
    expect(err.message).toBe('Gemini is unavailable: HTTP 403.');
    expect(calls).toHaveLength(1); // one attempt, no retry
    expectSafe(err);
  });

  it('rejects on every other HTTP error without a retry: 400, 404, 429, 500, 503', async () => {
    for (const status of [400, 404, 429, 500, 503, 302, 199]) {
      const { calls, fetchImpl } = fakeFetch(() => ({ status, body: `<html>${BODY_MARKER} ${KEY}</html>` }));
      const err = await failure(generateJson(options(fetchImpl)));
      expect(err.reason).toBe('http');
      expect(err.status).toBe(status);
      expect(calls).toHaveLength(1);
      expectSafe(err);
    }
  });

  it('rejects when the response is not JSON', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: `<html>${BODY_MARKER} ${KEY}</html>` }));
    const err = await failure(generateJson(options(fetchImpl)));
    expect(err.reason).toBe('bad_json');
    expect(err.status).toBeNull();
    expect(err.message).toBe('Gemini is unavailable: the answer was not valid JSON.');
    expectSafe(err);
  });

  it("rejects when the candidate's text is not JSON", async () => {
    for (const text of [`Sure! Here is the draft: ${BODY_MARKER} ${KEY}`, '{"senderId": "biz-etsy"', '```json\n{}\n```']) {
      const { fetchImpl } = fakeFetch(() => ({ status: 200, body: answerWith(text) }));
      const err = await failure(generateJson(options(fetchImpl)));
      expect(err.reason).toBe('bad_json');
      expectSafe(err);
    }
  });

  it('rejects on an empty candidate', async () => {
    const empties: unknown[] = [
      {},
      [],
      null,
      { candidates: [] },
      { promptFeedback: { blockReason: `SAFETY ${BODY_MARKER}` } },
      { candidates: [{ finishReason: 'SAFETY' }] },
      { candidates: [{ content: {} }] },
      { candidates: [{ content: { parts: [] } }] },
      { candidates: [{ content: { parts: [{ text: '' }, { text: '  \n' }] } }] },
      { candidates: [{ content: { parts: [{ text: '{"a":1}', thought: true }] } }] },
      { candidates: [{ content: { parts: [{ text: 7 }, { functionCall: { name: BODY_MARKER } }] } }] },
      // Only the first candidate counts.
      { candidates: [{ content: { parts: [] } }, { content: { parts: [{ text: '{"a":1}' }] } }] },
    ];
    for (const body of empties) {
      const { fetchImpl } = fakeFetch(() => ({ status: 200, body }));
      const err = await failure(generateJson(options(fetchImpl)));
      expect(err.reason, JSON.stringify(body)).toBe('empty');
      expect(err.message).toBe('Gemini is unavailable: the answer had no text.');
      expectSafe(err);
    }
  });

  it('rejects on a network failure, and drops the thrown error even when its text quotes the key', async () => {
    // What Node's fetch does with a header value it does not accept: it quotes the value in the error.
    const thrown = new TypeError(`Headers.append: "${KEY}" is an invalid header value.`, { cause: new Error(`connect failed ${KEY}`) });
    const { fetchImpl } = fakeFetch(() => thrown);
    const err = await failure(generateJson(options(fetchImpl)));
    expect(err.reason).toBe('network');
    expect(err.status).toBeNull();
    expect(err.message).toBe('Gemini is unavailable: the request failed before an answer arrived.');
    expectSafe(err);
  });

  it('rejects when reading the body fails', async () => {
    const fetchImpl: FetchLike = async () => ({
      status: 200,
      text: async () => {
        throw new Error(`socket closed ${KEY} ${BODY_MARKER}`);
      },
    });
    const err = await failure(generateJson(options(fetchImpl)));
    expect(err.reason).toBe('network');
    expectSafe(err);
  });
});

describe('generateJson: the 6 s time limit', () => {
  it('aborts the request and rejects at 6 s by default, not before', async () => {
    vi.useFakeTimers();
    expect(DEFAULT_GEMINI_TIMEOUT_MS).toBe(6000);
    const { calls, fetchImpl } = hangingFetch();
    let settled = false;
    const result = failure(generateJson(options(fetchImpl))).finally(() => (settled = true));

    await vi.advanceTimersByTimeAsync(5999);
    expect(settled).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    const err = await result;
    expect(err.reason).toBe('timeout');
    expect(err.status).toBeNull();
    expect(err.message).toBe('Gemini is unavailable: no answer within 6000 ms.');
    expect(calls[0].init?.signal?.aborted).toBe(true);
    expect(calls).toHaveLength(1); // no retry
    expect(vi.getTimerCount()).toBe(0);
    expectSafe(err);
  });

  it('uses the given timeoutMs', async () => {
    vi.useFakeTimers();
    const { fetchImpl } = hangingFetch();
    let settled = false;
    const result = failure(generateJson(options(fetchImpl, { timeoutMs: 250 }))).finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(249);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = await result;
    expect(err.reason).toBe('timeout');
    expect(err.message).toBe('Gemini is unavailable: no answer within 250 ms.');
    expectSafe(err);
  });

  it('holds even for a fetch that ignores the abort signal', async () => {
    vi.useFakeTimers();
    const fetchImpl: FetchLike = () => new Promise(() => {});
    const result = failure(generateJson(options(fetchImpl)));
    await vi.advanceTimersByTimeAsync(6000);
    expect((await result).reason).toBe('timeout');
  });

  it('covers a body that never finishes, not only the headers', async () => {
    vi.useFakeTimers();
    const fetchImpl: FetchLike = async () => ({ status: 200, text: () => new Promise<string>(() => {}) });
    const result = failure(generateJson(options(fetchImpl)));
    await vi.advanceTimersByTimeAsync(6000);
    const err = await result;
    expect(err.reason).toBe('timeout');
    expectSafe(err);
  });

  it('an answer that arrives after the limit changes nothing and raises no unhandled rejection', async () => {
    vi.useFakeTimers();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      // Ignores the signal and fails 4 s after the limit.
      const fetchImpl: FetchLike = () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error(`late ${KEY}`)), 10_000));
      const result = failure(generateJson(options(fetchImpl)));
      await vi.advanceTimersByTimeAsync(6000);
      const err = await result;
      expect(err.reason).toBe('timeout');
      await vi.advanceTimersByTimeAsync(5000);
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

describe('generateJson: nothing is logged', () => {
  it('writes nothing to the console or the standard streams, on success or on any failure', async () => {
    const spies = [
      ...(['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {})),
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true),
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true),
    ];
    const replies: Reply[] = [
      { status: 200, body: answerWith('{"ok":true}') },
      { status: 403, body: { error: { message: `bad key ${KEY}` } } },
      { status: 200, body: 'not json' },
      { status: 200, body: answerWith('not json') },
      { status: 200, body: { candidates: [] } },
      new Error(`network down ${KEY}`),
    ];
    const outcomes: string[] = [];
    for (const reply of replies) {
      const { fetchImpl } = fakeFetch(() => reply);
      outcomes.push(await generateJson(options(fetchImpl)).then(() => 'ok', (err: GeminiUnavailable) => err.reason));
    }
    outcomes.push(await generateJson(options(fakeFetch(() => replies[0]).fetchImpl, { apiKey: null })).then(() => 'ok', (err: GeminiUnavailable) => err.reason));
    const written = spies.map((spy) => spy.mock.calls.length);
    for (const spy of spies) spy.mockRestore();
    expect(outcomes).toEqual(['ok', 'http', 'bad_json', 'bad_json', 'empty', 'network', 'no_key']);
    expect(written).toEqual(spies.map(() => 0));
  });
});
