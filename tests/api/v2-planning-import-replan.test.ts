// #570: every file POST /api/v2/scenario/import accepts can be planned again. The server's own exports
// (the sample run, the real NYC run, Random city seeds 7 and 2026) still import with nothing changed but
// `runId` and `version`, and afterwards POST /planning/reset and POST /matches/recompute answer 200.
// The NYC cases boot from a copy of the committed fixtures/nyc in a temp folder (DECISIONS pass 56), with
// no key and no network; the sample case runs on the made-up travel cache of v2-boot-sample.ts.
import fs from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Run } from '../../shared/v2/types';
import { startBootstrapApi } from './v2-bootstrap-helper';
import { T, copyNycFixtures, recordFetch, startNycApi, type NycApi } from './v2-e2e-nyc-helper';

type Post = (url: string, body?: unknown) => Promise<{ status: number; body: unknown }>;
type Server = { post: Post; exportRun: () => Promise<Run> };

const withoutRunAndVersion = ({ runId: _runId, version: _version, ...rest }: Run) => rest;

/** Export, import the file back, compare, then start a new planning cycle and recompute. */
async function roundTripThenReplan(server: Server): Promise<void> {
  const file = await server.exportRun();
  expect(file.scenario.employees.length).toBeGreaterThan(0);
  expect(file.trips.length).toBeGreaterThan(0);

  const imported = await server.post('/scenario/import', file);
  expect(imported.status, JSON.stringify(imported.body).slice(0, 300)).toBe(200);
  const stored = await server.exportRun();
  expect(withoutRunAndVersion(stored)).toStrictEqual(withoutRunAndVersion(file));
  expect(stored.runId).not.toBe(file.runId);

  for (const url of ['/planning/reset', '/matches/recompute']) {
    const reply = await server.post(url);
    expect(reply.status, `${url}: ${JSON.stringify(reply.body).slice(0, 300)}`).toBe(200);
  }
  // The new cycle keeps every delivery and trip of the file.
  const replanned = await server.exportRun();
  expect(replanned.scenario.shipments).toStrictEqual(file.scenario.shipments);
  expect(replanned.trips).toStrictEqual(file.trips);
}

describe('the sample run (sample travel cache)', () => {
  it('round-trips through import, then a new planning cycle and Recompute answer 200', async () => {
    const api = await startBootstrapApi({ cache: 'sample' });
    try {
      await roundTripThenReplan({
        post: async (url, body) => api.v2.post(url, body),
        exportRun: async () => {
          const reply = await api.v2.get('/scenario/export');
          expect(reply.status).toBe(200);
          return reply.body as Run;
        },
      });
    } finally {
      await api.close();
    }
  }, T);
});

describe('the real NYC cache', () => {
  // Installed here, not at collection time, so it does not see the sample case's local calls.
  let net: ReturnType<typeof recordFetch>;
  let fixturesDir: string;
  let api: NycApi;

  beforeAll(async () => {
    net = recordFetch();
    fixturesDir = copyNycFixtures();
    api = await startNycApi(net, { fixturesDir });
  }, T);
  afterEach(() => {
    net.expectNoOutgoing();
  });
  afterAll(async () => {
    await api?.close();
    if (fixturesDir) fs.rmSync(fixturesDir, { recursive: true, force: true });
    net?.restore();
  }, T);

  it('the default NYC run round-trips, then a new planning cycle and Recompute answer 200', async () => {
    await roundTripThenReplan(api);
  }, T);

  it.each([7, 2026])('Random city seed %i round-trips, then a new planning cycle and Recompute answer 200', async (seed) => {
    const generated = await api.post('/scenario/generate', { preset: 'random', seed });
    expect(generated.status).toBe(200);
    await roundTripThenReplan(api);
  }, T);

  it('a file whose trip drives to a home this server has no travel time for is refused, and the run still plans', async () => {
    const before = await api.exportRun();
    const file = structuredClone(before);
    file.scenario.homes.push({ id: 'home-not-in-the-cache', neighborhood: 'Midtown', lat: 40.7549, lng: -73.984 });
    file.trips[0].destinationPlaceId = 'home-not-in-the-cache';

    const refused = await api.post('/scenario/import', file);
    expect(refused).toStrictEqual({
      status: 400,
      body: {
        error: 'A commute in this file has no travel time, so it was not loaded.',
        fieldErrors: { 'trips.0.destinationPlaceId': 'No travel time' },
      },
    });
    expect(await api.exportRun()).toStrictEqual(before);
    expect((await api.post('/planning/reset')).status).toBe(200);
    expect((await api.post('/matches/recompute')).status).toBe(200);
  }, T);
});
