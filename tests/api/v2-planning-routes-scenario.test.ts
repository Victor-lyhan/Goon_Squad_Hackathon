// GET /api/v2/scenario/export and POST /api/v2/scenario/import through the real app, on the small
// hand-built city with a table TravelProvider (DECISIONS pass 6, 10, 47, 51).
import { afterEach, describe, expect, it } from 'vitest';
import mvp1Scenario from '../../fixtures/demoScenario.json';
import { MVP1_FILE, NOT_A_RELAY_FILE, UNKNOWN_FILE_VERSION } from '../../server/api/v2/planningOps';
import type { Run } from '../../shared/v2/types';
import {
  T, expectUntouched, initialRun, matchedScenario, smallScenario, startPlanningApi, stateOf, wire,
  type PlanningApi,
} from './v2-planning-routes-helper';

const apis: PlanningApi[] = [];
const start = async (...args: Parameters<typeof startPlanningApi>) => {
  const api = await startPlanningApi(...args);
  apis.push(api);
  return api;
};
afterEach(async () => {
  for (const api of apis.splice(0)) await api.close();
});

/** A simulator view without the two fields an import is allowed to change (they are in the snapshot too). */
function withoutRunAndVersion(view: Record<string, any>) {
  const { runId: _runId, version: _version, snapshot, ...rest } = view;
  const { runId: _snapRunId, version: _snapVersion, ...snapshotRest } = snapshot;
  return { ...rest, snapshot: snapshotRest };
}

/** The small city mid-evening: locked, paused at 1040, so some events have happened and one carrier is on the road. */
async function eveningServer() {
  const api = await start({ run: initialRun(smallScenario()) });
  await api.lock();
  await api.post('/simulator/control', { action: 'seek', timeMin: 1040 });
  return api;
}

describe('GET /api/v2/scenario/export', () => {
  it('answers the stored run as a JSON download named after the run', async () => {
    const api = await start({ run: initialRun(smallScenario()) });
    const before = api.store.get();

    const { status, headers, body } = await api.get('/scenario/export');

    expect(status).toBe(200);
    expect(headers.get('content-disposition')).toBe('attachment; filename="relay-nyc-run-1.json"');
    expect(headers.get('content-type')).toMatch(/^application\/json/);
    expect(body).toStrictEqual(wire(before));
    // a read: no mutation, no version
    expect(api.store.get()).toBe(before);
    expect(await api.savedRun()).toBeNull();
  }, T);

  it('the file name follows the runId after a new planning cycle', async () => {
    const api = await start({ run: initialRun(smallScenario()) });
    await api.post('/planning/reset');
    const { headers, body } = await api.get('/scenario/export');
    expect(headers.get('content-disposition')).toBe('attachment; filename="relay-nyc-run-2.json"');
    expect(body.runId).toBe('run-2');
  }, T);

  it('a stored runId that is not run-<n> cannot break the header', async () => {
    const run = initialRun(smallScenario());
    run.runId = 'my "run"\r\nX-Evil: 1';
    const api = await start({ run });
    const { status, headers, body } = await api.get('/scenario/export');
    expect(status).toBe(200);
    expect(headers.get('content-disposition')).toBe('attachment; filename="relay-nyc-my__run___X-Evil__1.json"');
    expect(headers.get('x-evil')).toBeNull();
    expect(body.runId).toBe(run.runId);
  }, T);
});

describe('POST /api/v2/scenario/import: an exported file', () => {
  it('export then import: the simulator view is the original apart from runId and version', async () => {
    const api = await eveningServer();
    const original = await api.simulator();
    expect(original.snapshot.occurredEvents.length).toBeGreaterThan(0);
    const before = api.store.get();
    const file = (await api.get('/scenario/export')).body;

    const { status, body } = await api.post('/scenario/import', file);

    expect(status).toBe(200);
    expect(withoutRunAndVersion(body)).toStrictEqual(withoutRunAndVersion(original));
    expect(body.runId).toBe('run-2');
    expect(body.version).toBe(before.version + 1);
    expect(body.snapshot).toMatchObject({ runId: 'run-2', version: before.version + 1 });
    expect(body).toStrictEqual(await api.simulator());
    // one write through the store, and the file holds the imported run
    expect(api.store.get().version).toBe(before.version + 1);
    expect(await api.savedRun()).toStrictEqual(wire(api.store.get()));
  }, T);

  it('replaces another server\'s run, in any phase, with the next runId of that server', async () => {
    const source = await eveningServer();
    const original = await source.simulator();
    const file = (await source.get('/scenario/export')).body;

    // The target holds another city (2 packages), is on its third cycle and is locked.
    const other = initialRun(matchedScenario());
    other.runId = 'run-3';
    const target = await start({ run: other });
    await target.lock();
    const before = target.store.get();

    const { status, body } = await target.post('/scenario/import', file);

    expect(status).toBe(200);
    expect(body.runId).toBe('run-4');
    expect(body.version).toBe(before.version + 1);
    expect(body.shipments).toHaveLength(3);
    expect(withoutRunAndVersion(body)).toStrictEqual(withoutRunAndVersion(original));
    expect(body).toStrictEqual(await target.simulator());
  }, T);

  it('a file saved while playing is loaded paused, at the minute and phase it had', async () => {
    const api = await start({ run: initialRun(smallScenario()) });
    const file = wire(api.store.get());
    file.clock = { phase: 'locked', playing: true, timeMin: 1040, speed: 600 };

    const { status, body } = await api.post('/scenario/import', file);

    expect(status).toBe(200);
    expect(body.clock).toEqual({ phase: 'locked', playing: false, timeMin: 1040, speed: 600 });
    expect(api.store.get().clock.playing).toBe(false);
    expect(body.snapshot.timeMin).toBe(1040);
  }, T);
});

describe('POST /api/v2/scenario/import: refused files', () => {
  const good = (): Run => wire(initialRun(smallScenario()));
  const edited = (edit: (run: any) => void) => {
    const run = good();
    edit(run);
    return run;
  };
  /** An MVP 1 export as plain JSON: the synthetic-city scenario (fixtures/demoScenario.json) inside a run. */
  const mvp1Run = () => wire({
    runId: 'run-1', version: 0, scenario: mvp1Scenario, trips: [],
    assignments: { plans: [], unmatched: [], computeMs: 0 }, jobs: [], notifications: [], events: [],
    clock: { phase: 'planning', playing: false, timeMin: mvp1Scenario.settings.simStartMin, speed: 120 },
  });

  const NOT_COMPLETE = 'This file is not a complete Relay scenario export, so it was not loaded.';
  const cases: [string, () => unknown, Record<string, unknown>][] = [
    ['an empty object', () => ({}), { error: NOT_A_RELAY_FILE }],
    ['a list', () => [good()], { error: NOT_A_RELAY_FILE }],
    ['some other JSON file', () => ({ name: 'relay', version: '1.0.0' }), { error: NOT_A_RELAY_FILE }],
    ['an MVP 1 export (the synthetic city)', mvp1Run, { error: MVP1_FILE }],
    ['a file with an unknown scenario version', () => edited((run) => { run.scenario.schemaVersion = 3; }),
      { error: UNKNOWN_FILE_VERSION }],
    ['a run whose employee lives at a place the travel cache does not know',
      () => edited((run) => {
        run.scenario.homes.push({ id: 'home-099', neighborhood: 'Elsewhere', lat: 40.6, lng: -73.9 });
        run.scenario.employees[0].homeId = 'home-099';
      }),
      { error: 'This file has 1 place without travel times, so it was not loaded.' }],
    ['a run that refers to a place that is not in the file',
      () => edited((run) => { run.scenario.employees[0].homeId = 'home-404'; }),
      {
        error: 'This file names a home it does not list, so it was not loaded.',
        fieldErrors: { 'scenario.employees.0.homeId': 'Not in this file' },
      }],
    ['a run with a part missing', () => edited((run) => { delete run.trips; }),
      { error: NOT_COMPLETE, fieldErrors: { trips: 'Missing' } }],
  ];

  it.each(cases)('%s -> 400 with the reason, and the old run still answers', async (_name, file, expected) => {
    const api = await eveningServer();
    const before = await stateOf(api);

    const { status, body } = await api.post('/scenario/import', file());

    expect(status).toBe(400);
    expect(body).toStrictEqual(expected);
    await expectUntouched(api, before.run, before.saved, before.simulator);
  }, T);

  it('the messages are the ones the simulator shows', () => {
    expect(NOT_A_RELAY_FILE).toBe('This file is not a Relay scenario export, so it was not loaded.');
    expect(MVP1_FILE).toBe('This file is from an older version of Relay, so it was not loaded.');
    expect(UNKNOWN_FILE_VERSION).toBe('This file is from another version of Relay, so it was not loaded.');
  });

  it('the MVP 1 file is a real one: schemaVersion 1 with the grid and the hubs', () => {
    const file = mvp1Run() as any;
    expect(file.scenario.schemaVersion).toBe(1);
    expect(file.scenario.graph.nodes.length).toBeGreaterThan(0);
    expect(file.scenario.hubs.length).toBeGreaterThan(0);
  });

  it('no body and malformed JSON are 400s too, and the old run still answers', async () => {
    const api = await eveningServer();
    const before = await stateOf(api);

    const empty = await api.post('/scenario/import');
    expect(empty.status).toBe(400);
    expect(empty.body).toStrictEqual({ error: NOT_A_RELAY_FILE });

    const broken = await api.post('/scenario/import', '{"scenario": {"schemaVersion": 2');
    expect(broken.status).toBe(400);
    expect(broken.body).toStrictEqual({ error: 'Request body is not valid JSON' });

    await expectUntouched(api, before.run, before.saved, before.simulator);
  }, T);

  it('a refused file does not block the next import', async () => {
    const api = await eveningServer();
    const before = api.store.get().version;
    expect((await api.post('/scenario/import', mvp1Run())).status).toBe(400);
    const { status, body } = await api.post('/scenario/import', good());
    expect(status).toBe(200);
    expect(body.version).toBe(before + 1);
    expect(body.clock.phase).toBe('planning');
  }, T);
});
