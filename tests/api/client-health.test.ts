// probeHealth against the real createApp server on an ephemeral port, plus a never-answering server.
//
// No test here compares wall-clock time with a limit (DECISIONS pass 52). "The probe ends by its timeout,
// not later" is checked on a fake clock (client-timeout-clock.ts). The tests on real sockets only check
// the result, so a slow runner makes them slower, never red.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import * as api from '../../client/src/api';
import { hangingFetch, settledAtTimeout } from './client-timeout-clock';

// Every test and hook here does real work (servers, sockets), so each has an explicit timeout.
// Locally the slowest test takes about 200 ms (a real 200 ms client timeout) and beforeAll about 50 ms.
const TIMEOUT = 20_000;

let server: Server;
let hung: Server;
let base = '';
let hungBase = '';
let target = () => base;
let lastInit: RequestInit | undefined;
const realFetch = globalThis.fetch;
/** True: fetch never answers and no socket is opened (the fake-clock tests). */
let hang = false;
let onHungRequest: (() => void) | undefined;
/** Resolves when the never-answering server has received the next request. Call it before sending. */
const hungRequestArrives = () => new Promise<void>((resolve) => { onHungRequest = resolve; });

beforeAll(async () => {
  server = createApp().listen(0);
  hung = http.createServer(() => { onHungRequest?.(); /* never answers */ }).listen(0);
  await Promise.all([server, hung].map((s) => new Promise((r) => s.once('listening', r))));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  hungBase = `http://127.0.0.1:${(hung.address() as AddressInfo).port}`;
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
    lastInit = init;
    return hang ? hangingFetch(init) : realFetch(target() + input, init);
  });
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
  await Promise.all([server, hung].map((s) => (s.listening ? new Promise((r) => s.close(r)) : undefined)));
}, TIMEOUT);

describe('probeHealth', () => {
  it('is true when the server is up and sends cache no-store', async () => {
    expect(await api.probeHealth()).toBe(true);
    expect(lastInit?.cache).toBe('no-store');
    expect(await api.probeHealth({ signal: new AbortController().signal })).toBe(true);
  }, TIMEOUT);

  // Real socket, real 200 ms timer. Only the result is checked; when it ends is checked in the next test.
  it('is false on a server that never answers', async () => {
    target = () => hungBase;
    expect(await api.probeHealth({ timeoutMs: 200 })).toBe(false);
  }, TIMEOUT);

  // Replaces `Date.now() - t0 < 1000` around a real 200 ms timeout (measured 203 to 207 ms locally, 5x).
  it('is false on a hung request when timeoutMs is reached, and still pending 1 ms before', async () => {
    hang = true;
    const outcome = await settledAtTimeout(() => api.probeHealth({ timeoutMs: 200 }), 200);
    expect(outcome).toEqual({ status: 'fulfilled', value: false });
    expect(lastInit?.cache).toBe('no-store');
  }, TIMEOUT);

  // Replaces `Date.now() - t0 < 1000` around a real 150 ms timeout (measured 151 to 154 ms locally, 6.5x).
  it('uses apiConfig.timeoutMs by default', async () => {
    hang = true;
    api.apiConfig.timeoutMs = 150;
    const outcome = await settledAtTimeout(() => api.probeHealth(), 150);
    expect(outcome).toEqual({ status: 'fulfilled', value: false });
  }, TIMEOUT);

  it('falls back to DEFAULT_TIMEOUT_MS (8000) when no timeout is given', async () => {
    hang = true;
    const outcome = await settledAtTimeout(() => api.probeHealth(), api.DEFAULT_TIMEOUT_MS);
    expect(outcome).toEqual({ status: 'fulfilled', value: false });
  }, TIMEOUT);

  it('is false on a non-2xx reply', async () => {
    const bad = http.createServer((_q, r) => { r.statusCode = 503; r.end('down'); }).listen(0);
    await new Promise((r) => bad.once('listening', r));
    target = () => `http://127.0.0.1:${(bad.address() as AddressInfo).port}`;
    expect(await api.probeHealth()).toBe(false);
    await new Promise((r) => bad.close(r));
  }, TIMEOUT);

  it('rejects with an abort error when the caller aborts (already aborted and mid-flight)', async () => {
    const pre = new AbortController();
    pre.abort();
    await expect(api.probeHealth({ signal: pre.signal })).rejects.toSatisfy(api.isAbortError);

    // Mid-flight: abort when the server has the request, not after a fixed wait. The client timeout is
    // 10 minutes, far above the test timeout, so it cannot fire first (was: abort after a real 50 ms
    // against a real 5000 ms timeout).
    target = () => hungBase;
    const arrived = hungRequestArrives();
    const ctl = new AbortController();
    const p = api.probeHealth({ signal: ctl.signal, timeoutMs: 600_000 });
    await arrived;
    ctl.abort();
    await expect(p).rejects.toSatisfy(api.isAbortError);
  }, TIMEOUT);

  it('is false once the server is closed (last test)', async () => {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    expect(await api.probeHealth({ timeoutMs: 2000 })).toBe(false);
  }, TIMEOUT);
});
