// probeHealth against the real createApp server on an ephemeral port, plus a never-answering server.
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
let lastInit: RequestInit | undefined;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-health-'));
  const run = createInitialRun(loadDefaultScenario());
  const store = createStore({ filePath: path.join(dir, 'state.json'), initial: () => run });
  server = createApp(store).listen(0);
  hung = http.createServer(() => { /* never answers */ }).listen(0);
  await Promise.all([server, hung].map((s) => new Promise((r) => s.once('listening', r))));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  hungBase = `http://127.0.0.1:${(hung.address() as AddressInfo).port}`;
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => { lastInit = init; return realFetch(target() + input, init); });
});
afterEach(() => { target = () => base; api.apiConfig.timeoutMs = api.DEFAULT_TIMEOUT_MS; });
afterAll(async () => {
  vi.unstubAllGlobals();
  hung.closeAllConnections?.();
  await Promise.all([server, hung].map((s) => (s.listening ? new Promise((r) => s.close(r)) : undefined)));
});

describe('probeHealth', () => {
  it('is true when the server is up and sends cache no-store', async () => {
    expect(await api.probeHealth()).toBe(true);
    expect(lastInit?.cache).toBe('no-store');
    expect(await api.probeHealth({ signal: new AbortController().signal })).toBe(true);
  });

  it('is false on a hung handler after timeoutMs, in under 1 s', async () => {
    target = () => hungBase;
    const t0 = Date.now();
    expect(await api.probeHealth({ timeoutMs: 200 })).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('uses apiConfig.timeoutMs by default', async () => {
    target = () => hungBase;
    api.apiConfig.timeoutMs = 150;
    const t0 = Date.now();
    expect(await api.probeHealth()).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('is false on a non-2xx reply', async () => {
    const bad = http.createServer((_q, r) => { r.statusCode = 503; r.end('down'); }).listen(0);
    await new Promise((r) => bad.once('listening', r));
    target = () => `http://127.0.0.1:${(bad.address() as AddressInfo).port}`;
    expect(await api.probeHealth()).toBe(false);
    await new Promise((r) => bad.close(r));
  });

  it('rejects with an abort error when the caller aborts (already aborted and mid-flight)', async () => {
    const pre = new AbortController();
    pre.abort();
    await expect(api.probeHealth({ signal: pre.signal })).rejects.toSatisfy(api.isAbortError);
    target = () => hungBase;
    const ctl = new AbortController();
    const p = api.probeHealth({ signal: ctl.signal, timeoutMs: 5000 });
    setTimeout(() => ctl.abort(), 50);
    await expect(p).rejects.toSatisfy(api.isAbortError);
  });

  it('is false once the server is closed (last test)', async () => {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    expect(await api.probeHealth({ timeoutMs: 2000 })).toBe(false);
  });
});
