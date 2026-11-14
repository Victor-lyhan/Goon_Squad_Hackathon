// Abort/timeout/error helpers of client/src/api against a real createApp server plus a local
// http server that never answers. Fetch is pointed at those servers since the client uses relative paths.
//
// No test here compares wall-clock time with a limit (DECISIONS pass 52). "The call ends by its timeout,
// not later" is checked on a fake clock (client-timeout-clock.ts). The tests on real sockets only check
// the error, so a slow runner makes them slower, never red.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import * as api from '../../client/src/api';
import { hangingFetch, settledAtTimeout } from './client-timeout-clock';

// Every test and hook here does real work (servers, sockets), so each has an explicit timeout.
// Locally the slowest test takes about 100 ms (a real 100 ms client timeout) and beforeAll about 50 ms.
const TIMEOUT = 20_000;

let server: Server;
let hung: Server;
let base = '';
let hungBase = '';
let target = () => base;
const realFetch = globalThis.fetch;
/** True: fetch never answers and no socket is opened (the fake-clock tests). */
let hang = false;
let onHungRequest: (() => void) | undefined;
/** Resolves when the never-answering server has received the next request. Call it before sending. */
const hungRequestArrives = () => new Promise<void>((resolve) => { onHungRequest = resolve; });

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-abort-'));
  const run = createInitialRun(loadDefaultScenario());
  const store = createStore({ filePath: path.join(dir, 'state.json'), initial: () => run });
  server = createApp(store).listen(0);
  hung = http.createServer(() => { onHungRequest?.(); /* never answers */ }).listen(0);
  await Promise.all([server, hung].map((s) => new Promise((r) => s.once('listening', r))));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  hungBase = `http://127.0.0.1:${(hung.address() as AddressInfo).port}`;
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => (hang ? hangingFetch(init) : realFetch(target() + input, init)));
}, TIMEOUT);
afterEach(() => {
  hang = false;
  onHungRequest = undefined;
  target = () => base;
  api.apiConfig.timeoutMs = api.DEFAULT_TIMEOUT_MS;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  hung.closeAllConnections?.();
  await Promise.all([server, hung].map((s) => new Promise((r) => s.close(r))));
}, TIMEOUT);

describe('client abort / timeout', () => {
  it('GET helpers work unchanged with and without options', async () => {
    expect((await api.getBusinesses()).businesses.length).toBeGreaterThan(0);
    const ctl = new AbortController();
    expect((await api.getBusinesses({ signal: ctl.signal })).businesses.length).toBeGreaterThan(0);
    expect(await api.getMap({ signal: ctl.signal })).toBeTruthy();
  }, TIMEOUT);

  it('an already-aborted signal rejects with an abort error, not a network error', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const e = await api.getSimulator({ signal: ctl.signal }).catch((x) => x);
    expect(e).toBeInstanceOf(api.ApiRequestError);
    expect(e.status).toBe(0);
    expect(api.isAbortError(e)).toBe(true);
    expect(api.isNetworkError(e)).toBe(false);
  }, TIMEOUT);

  // Abort when the server has the request, not after a fixed wait. The client timeout is 10 minutes,
  // far above the test timeout, so it cannot fire first (was: abort after a real 50 ms against the
  // real 8000 ms default).
  it('aborting an in-flight request to a hung server rejects as abort', async () => {
    target = () => hungBase;
    api.apiConfig.timeoutMs = 600_000;
    const arrived = hungRequestArrives();
    const ctl = new AbortController();
    const p = api.getSimulator({ signal: ctl.signal });
    await arrived;
    ctl.abort();
    const e = await p.catch((x) => x);
    expect(api.isAbortError(e)).toBe(true);
    expect(e.status).toBe(0);
  }, TIMEOUT);

  // Real socket, real 100 ms timer. Only the error is checked; when it ends is checked in the next test.
  it('times out against a server that never answers (status 0, network error)', async () => {
    target = () => hungBase;
    api.apiConfig.timeoutMs = 100;
    const e = await api.getSimulator().catch((x) => x);
    expect(e).toBeInstanceOf(api.ApiRequestError);
    expect(e.status).toBe(0);
    expect(e.kind).toBe('timeout');
    expect(api.isNetworkError(e)).toBe(true);
    expect(api.isAbortError(e)).toBe(false);
  }, TIMEOUT);

  // Replaces `Date.now() - t0 < 3000` around a real 100 ms timeout (measured 101 to 104 ms locally, 29x).
  it('a hung request ends when apiConfig.timeoutMs is reached, and is still pending 1 ms before', async () => {
    hang = true;
    api.apiConfig.timeoutMs = 100;
    const outcome = await settledAtTimeout(() => api.getSimulator(), 100);
    expect(outcome.status).toBe('rejected');
    const e = (outcome as PromiseRejectedResult).reason;
    expect(e).toBeInstanceOf(api.ApiRequestError);
    expect([e.status, e.kind, e.message]).toEqual([0, 'timeout', 'Request timed out after 100 ms']);
  }, TIMEOUT);

  // Was a real 80 ms wait on the hung server, which only showed that the call ended within the test timeout.
  it('per-call timeoutMs overrides the default', async () => {
    hang = true;
    expect(api.apiConfig.timeoutMs).toBe(8000);
    const outcome = await settledAtTimeout(() => api.getJob('x', { timeoutMs: 80 }), 80);
    expect(outcome.status).toBe('rejected');
    const e = (outcome as PromiseRejectedResult).reason;
    expect(e.kind).toBe('timeout');
    expect(api.isNetworkError(e)).toBe(true);
  }, TIMEOUT);

  it('connection refused is a network error', async () => {
    target = () => 'http://127.0.0.1:1';
    const e = await api.getBusinesses().catch((x) => x);
    expect(e.status).toBe(0);
    expect(api.isNetworkError(e)).toBe(true);
    expect(api.isAbortError(e)).toBe(false);
  }, TIMEOUT);

  it('HTTP errors keep status and JSON message and are neither network nor abort', async () => {
    const e = await api.getJob('does-not-exist').catch((x) => x);
    expect(e).toBeInstanceOf(api.ApiRequestError);
    expect(e.status).toBe(404);
    expect(typeof e.message).toBe('string');
    expect(e.message).not.toMatch(/^Request failed/);
    expect(api.isNetworkError(e)).toBe(false);
    expect(api.isAbortError(e)).toBe(false);
    expect(api.isNetworkError(new Error('x'))).toBe(false);
  }, TIMEOUT);
});
