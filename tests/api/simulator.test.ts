import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import type { SimulatorResponse } from '../../shared/api';

let server: Server;
let base: string;
let filePath: string;
const initial = () => createInitialRun(loadDefaultScenario());

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simulator-'));
  filePath = path.join(dir, 'state.json');
  server = createApp(createStore({ filePath, initial })).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

const get = async () => (await fetch(base + '/api/simulator')).json() as Promise<SimulatorResponse>;
const control = (body: unknown) =>
  fetch(base + '/api/simulator/control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('simulator routes', () => {
  it('GET returns runId, version and clock at 930', async () => {
    const body = await get();
    expect(body.runId).toBe('run-1');
    expect(body.version).toBe(0);
    expect(body.clock.timeMin).toBe(930);
    expect(body.snapshot).toBeDefined();
    expect(Array.isArray(body.plans)).toBe(true);
    expect(body.plans.length).toBeGreaterThan(0);
    expect(body.nextEventMin).toBeGreaterThan(930);
  });

  it('invalid action returns 400 ApiError', async () => {
    const res = await control({ action: 'explode' });
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe('string');
  });

  it('play locks the phase and starts playing, bumping version', async () => {
    const res = await control({ action: 'play' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SimulatorResponse;
    expect(body.clock.phase).toBe('locked');
    expect(body.clock.playing).toBe(true);
    expect(body.version).toBe(1);
  });

  it('seek then finish moves the clock', async () => {
    const seek = (await (await control({ action: 'seek', timeMin: 1000 })).json()) as SimulatorResponse;
    expect(seek.clock.timeMin).toBe(1000);
    const fin = (await (await control({ action: 'finish' })).json()) as SimulatorResponse;
    expect(fin.clock.timeMin).toBeGreaterThan(1000);
    expect(fin.clock.playing).toBe(false);
  });

  it('a restarted store loads paused with the same clock time', async () => {
    const before = await get();
    const again = createStore({ filePath, initial });
    expect(again.get().clock.playing).toBe(false);
    expect(again.get().clock.timeMin).toBe(before.clock.timeMin);
    expect(again.get().clock.phase).toBe('locked');
  });
});
