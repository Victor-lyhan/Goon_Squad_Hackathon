// The bootstrap without usable travel data (server/api/v2/bootstrap.ts): the server starts as before,
// every /api/v2 path answers 503 `travel_data_missing`, MVP 1 keeps working, and the v2 state file is
// never created. No network, no key.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createV2Runtime } from '../../server/api/v2/bootstrap';
import { TRAVEL_NOT_LOADED_MESSAGE } from '../../server/api/v2/errors';
import { V2_DEPS_NOT_LOADED } from '../../server/api/v2/router';
import { MATRIX_FILE, writeTravelFiles } from '../../server/geo/cache';
import { pairKey } from '../../shared/v2/types';
import { bootSample } from './v2-boot-sample';
import { FAKE_KEY, noNetwork, startBootstrapApi, T, tempRepo, type BootstrapApi, type TempRepo } from './v2-bootstrap-helper';

let api: BootstrapApi | null = null;
let repo: TempRepo | null = null;
afterEach(async () => {
  await api?.close();
  api = null;
  repo?.remove();
  repo = null;
  vi.restoreAllMocks();
});

const NOT_LOADED_BODY = { error: TRAVEL_NOT_LOADED_MESSAGE, code: 'travel_data_missing' };

// Every documented /api/v2 route (shared/v2/api.ts, shared/v2/parseRequest.ts), plus a path that does not exist.
const V2_PATHS: [method: string, url: string, body?: unknown][] = [
  ['GET', '/businesses'],
  ['GET', '/businesses/biz-etsy/dashboard'],
  ['POST', '/shipments', { clientRequestId: 'x' }],
  ['GET', '/shipments/shp-1'],
  ['PATCH', '/shipments/shp-1', { label: 'x' }],
  ['POST', '/shipments/shp-1/match'],
  ['GET', '/employees'],
  ['GET', '/employees/emp-1/dashboard'],
  ['PUT', '/employees/emp-1/commute', { businessId: 'biz-etsy' }],
  ['GET', '/jobs/job-1'],
  ['GET', '/map'],
  ['GET', '/simulator'],
  ['POST', '/simulator/control', { action: 'play' }],
  ['POST', '/matches/compare', {}],
  ['POST', '/matches/recompute'],
  ['POST', '/planning/reset'],
  ['POST', '/scenario/generate', { preset: 'demo' }],
  ['GET', '/scenario/export'],
  ['POST', '/scenario/import', {}],
  ['GET', '/geocode?q=350%20Fifth%20Avenue'],
  ['POST', '/parse-request', { text: 'Deliver an envelope from Etsy to Brooklyn Roasting by noon' }],
  ['GET', '/no-such-route'],
  ['DELETE', '/simulator'],
];

/** The runtime on `repo`, with a key, so a reason that held the key would show. */
const runtimeOn = (at: TempRepo) =>
  createV2Runtime({ fixturesDir: at.fixturesDir, statePath: at.statePath, key: FAKE_KEY, fetch: noNetwork().fetch });

describe('bootstrap with an empty cache folder', () => {
  it('is not_loaded with the "run fetch:routes" reason and the router\'s not-loaded deps', async () => {
    api = await startBootstrapApi({ cache: 'empty' });
    expect(api.runtime.status).toBe('not_loaded');
    expect(api.runtime.reason).toBe(TRAVEL_NOT_LOADED_MESSAGE);
    expect(api.runtime.deps).toBe(V2_DEPS_NOT_LOADED);
  }, T);

  it('every /api/v2 path answers 503 travel_data_missing', async () => {
    api = await startBootstrapApi({ cache: 'empty' });
    for (const [method, url, body] of V2_PATHS) {
      const res = await api.call(method, `/api/v2${url}`, body);
      expect([method, url, res.status]).toStrictEqual([method, url, 503]);
      expect(res.body).toStrictEqual(NOT_LOADED_BODY);
    }
  }, T);

  it('/api/health still answers 200, and the deleted MVP 1 paths are the JSON 404, not the 503 (#628)', async () => {
    api = await startBootstrapApi({ cache: 'empty' });
    expect((await api.call('GET', '/api/health')).body).toStrictEqual({ ok: true });
    for (const [method, url, body] of [
      ['GET', '/api/simulator'], ['GET', '/api/businesses'], ['POST', '/api/simulator/control', { action: 'speed', speed: 600 }],
    ] as const) {
      const res = await api.call(method, url, body);
      expect([method, url, res.status]).toStrictEqual([method, url, 404]);
      expect(res.body).toStrictEqual({ error: 'Not found' });
    }
  }, T);

  it('the ticker and the shutdown do nothing: no state file, no data folder, no cache file', async () => {
    api = await startBootstrapApi({ cache: 'empty' });
    const filesBefore = fs.readdirSync(api.repo.fixturesDir).sort();
    api.runtime.startTicker({ intervalMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await api.runtime.shutdown(); // what Ctrl-C runs in server/index.ts
    await api.runtime.shutdown(); // and a second Ctrl-C

    expect(fs.existsSync(api.repo.statePath)).toBe(false);
    expect(fs.existsSync(path.dirname(api.repo.statePath))).toBe(false); // no data folder either
    expect(fs.readdirSync(api.repo.fixturesDir).sort()).toStrictEqual(filesBefore);
  }, T);
});

describe('bootstrap with travel data it cannot use', () => {
  const expectNotLoaded = (at: TempRepo, reason: RegExp) => {
    const runtime = runtimeOn(at);
    expect(runtime.status).toBe('not_loaded');
    expect(runtime.reason).toMatch(reason);
    expect(runtime.reason).not.toContain(FAKE_KEY);
    expect(runtime.deps).toBe(V2_DEPS_NOT_LOADED);
    expect(fs.existsSync(at.statePath)).toBe(false);
    return runtime;
  };

  it('a corrupt matrix.json does not throw at start: not_loaded, the reason names the file, the file is kept', () => {
    repo = tempRepo('empty');
    const file = path.join(repo.fixturesDir, MATRIX_FILE);
    fs.writeFileSync(file, '{"schemaVersion":1,"places":{');
    expectNotLoaded(repo, /matrix\.json.*not valid JSON/);
    expect(fs.readFileSync(file, 'utf8')).toBe('{"schemaVersion":1,"places":{');
  }, T);

  it('a cache with places but no pairs is not loaded', () => {
    repo = tempRepo('empty');
    const sample = bootSample();
    sample.files.matrix.pairs = {};
    writeTravelFiles(repo.fixturesDir, sample.files);
    const runtime = expectNotLoaded(repo, /not loaded/);
    expect(runtime.reason).toBe(TRAVEL_NOT_LOADED_MESSAGE);
  }, T);

  it('a cache that lacks a pair the default run needs is not loaded, and the reason names the pair', () => {
    repo = tempRepo('empty');
    const sample = bootSample();
    const { originBusinessId, destinationBusinessId } = sample.fixtures.storyFile.shipments[0];
    delete sample.files.matrix.pairs[pairKey(originBusinessId, destinationBusinessId)];
    writeTravelFiles(repo.fixturesDir, sample.files);
    expectNotLoaded(repo, new RegExp(`No travel time is cached for ${originBusinessId} to ${destinationBusinessId}`));
  }, T);

  it('a missing NYC fixture file is not loaded, and the reason names the file', () => {
    repo = tempRepo('sample');
    fs.rmSync(path.join(repo.fixturesDir, 'demoStory.json'));
    expectNotLoaded(repo, /demoStory\.json.*missing/);
  }, T);

  it('such a server answers 503 on /api/v2, 200 on /api/health and 404 on a deleted MVP 1 path', async () => {
    repo = tempRepo('empty');
    fs.writeFileSync(path.join(repo.fixturesDir, MATRIX_FILE), 'not json');
    api = await startBootstrapApi({ cache: 'empty', repo });
    expect(api.runtime.status).toBe('not_loaded');
    const simulator = await api.v2.get('/simulator');
    expect(simulator.status).toBe(503);
    expect(simulator.body).toStrictEqual(NOT_LOADED_BODY);
    expect((await api.call('GET', '/api/health')).status).toBe(200);
    expect((await api.call('GET', '/api/simulator')).status).toBe(404); // an MVP 1 route until #628
  }, T);
});
