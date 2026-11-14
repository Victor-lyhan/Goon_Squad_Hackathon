// Abort/timeout/error helpers of client/src/api against a real createApp server plus a local
// http server that never answers. Fetch is pointed at those servers since the client uses relative paths.
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

let server: Server;
let hung: Server;
let base = '';
let hungBase = '';
let target = () => base;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-abort-'));
  const run = createInitialRun(loadDefaultScenario());
  const store = createStore({ filePath: path.join(dir, 'state.json'), initial: () => run });
  server = createApp(store).listen(0);
  hung = http.createServer(() => { /* never answers */ }).listen(0);
  await Promise.all([server, hung].map((s) => new Promise((r) => s.once('listening', r))));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  hungBase = `http://127.0.0.1:${(hung.address() as AddressInfo).port}`;
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => realFetch(target() + input, init));
});
afterEach(() => { target = () => base; api.apiConfig.timeoutMs = api.DEFAULT_TIMEOUT_MS; });
afterAll(async () => {
  vi.unstubAllGlobals();
  hung.closeAllConnections?.();
  await Promise.all([server, hung].map((s) => new Promise((r) => s.close(r))));
});

describe('client abort / timeout', () => {
  it('GET helpers work unchanged with and without options', async () => {
    expect((await api.getBusinesses()).businesses.length).toBeGreaterThan(0);
    const ctl = new AbortController();
    expect((await api.getBusinesses({ signal: ctl.signal })).businesses.length).toBeGreaterThan(0);
    expect(await api.getMap({ signal: ctl.signal })).toBeTruthy();
  });

  it('an already-aborted signal rejects with an abort error, not a network error', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const e = await api.getSimulator({ signal: ctl.signal }).catch((x) => x);
    expect(e).toBeInstanceOf(api.ApiRequestError);
    expect(e.status).toBe(0);
    expect(api.isAbortError(e)).toBe(true);
    expect(api.isNetworkError(e)).toBe(false);
  });

  it('aborting an in-flight request to a hung server rejects as abort', async () => {
    target = () => hungBase;
    const ctl = new AbortController();
    const p = api.getSimulator({ signal: ctl.signal });
    setTimeout(() => ctl.abort(), 50);
    const e = await p.catch((x) => x);
    expect(api.isAbortError(e)).toBe(true);
    expect(e.status).toBe(0);
  });

  it('times out against a server that never answers (status 0, network error)', async () => {
    target = () => hungBase;
    api.apiConfig.timeoutMs = 100;
    const t0 = Date.now();
    const e = await api.getSimulator().catch((x) => x);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(e).toBeInstanceOf(api.ApiRequestError);
    expect(e.status).toBe(0);
    expect(e.kind).toBe('timeout');
    expect(api.isNetworkError(e)).toBe(true);
    expect(api.isAbortError(e)).toBe(false);
  });

  it('per-call timeoutMs overrides the default', async () => {
    target = () => hungBase;
    const e = await api.getJob('x', { timeoutMs: 80 }).catch((x) => x);
    expect(api.isNetworkError(e)).toBe(true);
  });

  it('connection refused is a network error', async () => {
    target = () => 'http://127.0.0.1:1';
    const e = await api.getBusinesses().catch((x) => x);
    expect(e.status).toBe(0);
    expect(api.isNetworkError(e)).toBe(true);
    expect(api.isAbortError(e)).toBe(false);
  });

  it('HTTP errors keep status and JSON message and are neither network nor abort', async () => {
    const e = await api.getJob('does-not-exist').catch((x) => x);
    expect(e).toBeInstanceOf(api.ApiRequestError);
    expect(e.status).toBe(404);
    expect(typeof e.message).toBe('string');
    expect(e.message).not.toMatch(/^Request failed/);
    expect(api.isNetworkError(e)).toBe(false);
    expect(api.isAbortError(e)).toBe(false);
    expect(api.isNetworkError(new Error('x'))).toBe(false);
  });
});
