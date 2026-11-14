// parseImportedRun (DECISIONS pass 10, 47): only a complete MVP II run whose references resolve and whose
// commutes are in the travel cache is accepted; anything else is refused with one sentence, never repaired.
import { describe, expect, it } from 'vitest';
import mvp1Scenario from '../../fixtures/demoScenario.json';
import {
  MVP1_FILE, NOT_A_RELAY_FILE, UNKNOWN_FILE_VERSION, exportRun, parseImportedRun, planGenerate,
} from '../../server/api/v2/planningOps';
import { pairKey, type Run } from '../../shared/v2/types';
import { deepFreeze } from './v2-sample';
import {
  expectDeterministic, generateInputs, lockedRun, planningRun, runWith, sharesObjects, travelWithout, unmatchedRunOf,
} from './v2-planning-ops-sample';

const everyPair = () => travelWithout().travel;
/** What the browser uploads: the export after a trip through JSON. */
const asUploaded = (run: Run): unknown => deepFreeze(JSON.parse(JSON.stringify(exportRun(run))));

function expectInvalid(body: unknown, sentence?: string | RegExp) {
  const plan = parseImportedRun(body, everyPair());
  if (plan.kind !== 'invalid') throw new Error(`expected invalid, got ${plan.kind}`);
  expect(plan.status).toBe(400);
  expect(plan).not.toHaveProperty('run');
  // One sentence: a single full stop, at the end.
  expect(plan.error.error).toMatch(/^[^.]+\.$/);
  if (sentence !== undefined) expect(plan.error.error).toMatch(sentence);
  return plan.error;
}

describe('parseImportedRun: round trip', () => {
  it('accepts its own export unchanged', () => {
    for (const run of [lockedRun, planningRun]) {
      const plan = expectDeterministic(() => parseImportedRun(exportRun(run), everyPair()));
      expect(plan).toStrictEqual({ kind: 'run', run });
      expect(sharesObjects(plan, run)).toBe(false);
    }
  });

  it('accepts the export after a trip through JSON, without changing the upload', () => {
    const upload = asUploaded(lockedRun);
    const before = structuredClone(upload);
    const plan = parseImportedRun(upload, everyPair()); // frozen: a write would throw
    expect(plan).toStrictEqual({ kind: 'run', run: lockedRun });
    expect(upload).toStrictEqual(before);
    expect(sharesObjects(plan, upload)).toBe(false);
  });

  it('round-trips a generated NYC demo run and checks both commute pairs of every employee', () => {
    const generated = planGenerate({ preset: 'demo' }, generateInputs);
    if (generated.kind !== 'scenario') throw new Error('the demo scenario did not build');
    const run = unmatchedRunOf(generated.scenario);
    const { travel, calls } = travelWithout();
    expect(parseImportedRun(asUploaded(run), travel)).toStrictEqual({ kind: 'run', run });
    for (const employee of run.scenario.employees) {
      expect(calls).toContain(pairKey(employee.businessId, employee.homeId));
      expect(calls).toContain(pairKey(employee.homeId, employee.businessId));
    }
  });

  it('forces the clock to paused and keeps the rest, the runId included', () => {
    const playing = runWith((run) => { run.clock = { phase: 'locked', playing: true, timeMin: 1300, speed: 600 }; });
    const plan = parseImportedRun(asUploaded(playing), everyPair());
    if (plan.kind !== 'run') throw new Error(`expected a run, got ${plan.kind}`);
    expect(plan.run.clock).toStrictEqual({ phase: 'locked', playing: false, timeMin: 1300, speed: 600 });
    expect(plan.run).toStrictEqual({ ...playing, clock: { ...playing.clock, playing: false } });
    expect(plan.run.runId).toBe('run-3'); // the route stores it with nextRunId(current)
  });

  it('keeps fields it does not know', () => {
    const upload = { ...structuredClone(lockedRun), exportedBy: 'relay', scenario: { ...structuredClone(lockedRun.scenario), note: 'kept' } };
    const plan = parseImportedRun(upload, everyPair());
    expect(plan).toMatchObject({ kind: 'run', run: { exportedBy: 'relay', scenario: { note: 'kept' } } });
  });
});

describe('parseImportedRun: files that are not MVP II runs', () => {
  it('refuses a run whose scenario has schemaVersion 1 as a synthetic-city file', () => {
    const body = { ...structuredClone(lockedRun), scenario: { ...structuredClone(lockedRun.scenario), schemaVersion: 1 } };
    const error = expectInvalid(deepFreeze(body), /^This file is from the synthetic-city version/);
    expect(error).toStrictEqual({ error: MVP1_FILE });
  });

  it('refuses a real MVP 1 export (synthetic grid, hubs) with the same sentence', () => {
    const mvp1Run = { ...structuredClone(lockedRun), scenario: mvp1Scenario };
    expect(mvp1Scenario.schemaVersion).toBe(1);
    expect(expectInvalid(mvp1Run)).toStrictEqual({ error: MVP1_FILE });

    // An older export without a version still shows the grid and the hub list.
    const { schemaVersion: _dropped, ...unversioned } = mvp1Scenario;
    expect(expectInvalid({ ...structuredClone(lockedRun), scenario: unversioned })).toStrictEqual({ error: MVP1_FILE });
  });

  it('refuses any other version', () => {
    for (const schemaVersion of [3, '2', undefined, null]) {
      const body = { ...structuredClone(lockedRun), scenario: { ...structuredClone(lockedRun.scenario), schemaVersion } };
      expect(expectInvalid(body)).toStrictEqual({ error: UNKNOWN_FILE_VERSION });
    }
  });

  it('refuses a body that is not a run at all', () => {
    for (const body of [undefined, null, 'run', 7, [], [structuredClone(lockedRun)], {}, { scenario: [] }, { scenario: 'demo' }]) {
      expect(expectInvalid(body)).toStrictEqual({ error: NOT_A_RELAY_FILE });
    }
  });

  it('refuses an incomplete run and says where', () => {
    const cases: [string, (run: Record<string, any>) => void, Record<string, string>][] = [
      ['no jobs list', (run) => { delete run.jobs; }, { jobs: 'Missing' }],
      ['events is not a list', (run) => { run.events = {}; }, { events: 'Not a valid value' }],
      ['a clock speed the server does not have', (run) => { run.clock.speed = 45; }, { 'clock.speed': 'Not a valid value' }],
      ['an unknown phase', (run) => { run.clock.phase = 'done'; }, { 'clock.phase': 'Not a valid value' }],
      ['an employee without a home', (run) => { delete run.scenario.employees[1].homeId; }, { 'scenario.employees.1.homeId': 'Missing' }],
      ['a home without a point', (run) => { run.scenario.homes[0].lat = null; }, { 'scenario.homes.0.lat': 'Not a valid value' }],
      ['a point off the globe', (run) => { run.scenario.businesses[0].lng = 181; }, { 'scenario.businesses.0.lng': 'Not a valid value' }],
      ['a null entry', (run) => { run.trips[2] = null; }, { 'trips.2': 'Not a valid value' }],
      ['a plan without legs', (run) => { run.assignments.plans[0].legs = []; }, { 'assignments.plans.0.legs': 'Not a valid value' }],
      ['no settings', (run) => { delete run.scenario.settings; }, { 'scenario.settings': 'Missing' }],
      ['a missing version', (run) => { delete run.version; }, { version: 'Missing' }],
    ];
    for (const [name, edit, fieldErrors] of cases) {
      const body = structuredClone(lockedRun) as Record<string, any>;
      edit(body);
      expect(expectInvalid(body, /^This file is not a complete Relay scenario export/), name).toMatchObject({ fieldErrors });
    }
  });

  it('lists at most 10 problems', () => {
    const body = structuredClone(lockedRun) as Record<string, any>;
    for (const home of body.scenario.homes) { delete home.lat; delete home.lng; }
    for (const employee of body.scenario.employees) { delete employee.name; delete employee.homeId; }
    expect(Object.keys(expectInvalid(body).fieldErrors ?? {})).toHaveLength(10);
  });
});

describe('parseImportedRun: references', () => {
  it('refuses a dangling homeId', () => {
    const body = runWith((run) => { run.scenario.employees[0].homeId = 'home-999'; });
    expect(expectInvalid(body)).toStrictEqual({
      error: 'An employee in this file refers to a home that is not in the file, so it was not loaded.',
      fieldErrors: { 'scenario.employees.0.homeId': 'Unknown home' },
    });
    // The same when the home itself was cut out of the file.
    const cut = runWith((run) => { run.scenario.homes = run.scenario.homes.filter((home) => home.id !== 'home-002'); });
    expect(expectInvalid(cut).fieldErrors).toStrictEqual({ 'scenario.employees.2.homeId': 'Unknown home' });
  });

  it('refuses every other reference that does not resolve', () => {
    const cases: [(run: Run) => void, string, string][] = [
      [(run) => { run.scenario.employees[1].businessId = 'biz-gone'; }, 'scenario.employees.1.businessId', 'Unknown business'],
      [(run) => { run.scenario.shipments[2].originBusinessId = 'biz-gone'; }, 'scenario.shipments.2.originBusinessId', 'Unknown business'],
      [(run) => { run.scenario.shipments[0].destinationBusinessId = 'home-001'; }, 'scenario.shipments.0.destinationBusinessId', 'Unknown business'],
      [(run) => { run.trips[3].employeeId = 'emp-9'; }, 'trips.3.employeeId', 'Unknown employee'],
      [(run) => { run.assignments.plans[1].shipmentId = 'shp-9'; }, 'assignments.plans.1.shipmentId', 'Unknown delivery'],
      [(run) => { run.assignments.plans[0].relayBusinessId = 'hub-1'; }, 'assignments.plans.0.relayBusinessId', 'Unknown business'],
      [(run) => { run.assignments.plans[0].legs[1].employeeId = 'emp-9'; }, 'assignments.plans.0.legs.1.employeeId', 'Unknown employee'],
      [(run) => { run.assignments.unmatched[0].shipmentId = 'shp-9'; }, 'assignments.unmatched.0.shipmentId', 'Unknown delivery'],
      [(run) => { run.jobs[2].planId = 'plan-shp-9'; }, 'jobs.2.planId', 'Unknown delivery plan'],
      [(run) => { run.jobs[0].shipmentId = 'shp-9'; }, 'jobs.0.shipmentId', 'Unknown delivery'],
      [(run) => { run.jobs[1].employeeId = 'emp-9'; }, 'jobs.1.employeeId', 'Unknown employee'],
      [(run) => { run.events[4].jobId = 'plan-shp-9-L0'; }, 'events.4.jobId', 'Unknown job'],
      // A plan was cut out, its jobs were not.
      [(run) => { run.assignments.plans = run.assignments.plans.slice(1); }, 'jobs.0.planId', 'Unknown delivery plan'],
      // A delivery was cut out, its plan was not.
      [(run) => { run.scenario.shipments = run.scenario.shipments.slice(1); }, 'assignments.plans.0.shipmentId', 'Unknown delivery'],
    ];
    for (const [edit, path, label] of cases) {
      const error = expectInvalid(runWith(edit), / in this file refers to an? [a-z ]+ that is not in the file, so it was not loaded\.$/);
      expect(error.fieldErrors, path).toStrictEqual({ [path]: label });
    }
  });

  it('refuses an ID that is listed twice', () => {
    const twice = runWith((run) => { run.scenario.employees[2].id = 'emp-1'; });
    expect(expectInvalid(twice)).toStrictEqual({
      error: 'This file lists the same employee ID twice, so it was not loaded.',
      fieldErrors: { 'scenario.employees.2.id': 'Duplicate ID' },
    });
    const twoHomes = runWith((run) => { run.scenario.homes.push({ ...run.scenario.homes[0] }); });
    expect(expectInvalid(twoHomes).fieldErrors).toStrictEqual({ 'scenario.homes.4.id': 'Duplicate ID' });
  });

  it('never repeats text from the file in the reason', () => {
    const body = runWith((run) => { run.scenario.employees[0].homeId = 'home-of-a-real-person'; });
    expect(JSON.stringify(expectInvalid(body))).not.toContain('home-of-a-real-person');
  });

  it('checks the references before the travel cache', () => {
    const body = runWith((run) => { run.scenario.employees[0].homeId = 'home-999'; });
    expect(parseImportedRun(body, travelWithout(['home-999', 'home-001']).travel).kind).toBe('invalid');
  });
});

describe('parseImportedRun: travel cache', () => {
  it('refuses a run with a home that is not in the cache, and says how many places are missing', () => {
    const plan = expectDeterministic(() => parseImportedRun(asUploaded(lockedRun), travelWithout(['home-002']).travel));
    expect(plan).toStrictEqual({
      kind: 'unavailable', status: 503, code: 'travel_data_missing', missingPlaces: 1,
      error: {
        code: 'travel_data_missing',
        error: 'Travel times are not cached on this server for 1 place in this file, so it was not loaded.',
      },
    });
  });

  it('counts each missing home once', () => {
    const shared = runWith((run) => { run.scenario.employees[2].homeId = 'home-001'; }); // Sam and Lee live together
    expect(parseImportedRun(shared, travelWithout(['home-001']).travel)).toMatchObject({ kind: 'unavailable', missingPlaces: 1 });

    const two = parseImportedRun(lockedRun, travelWithout(['home-001', 'home-story-ana']).travel);
    expect(two).toMatchObject({ kind: 'unavailable', code: 'travel_data_missing', missingPlaces: 2 });
    expect(two.kind === 'unavailable' && two.error.error).toBe(
      'Travel times are not cached on this server for 2 places in this file, so it was not loaded.',
    );
    expect(parseImportedRun(lockedRun, { has: () => false })).toMatchObject({ kind: 'unavailable', missingPlaces: 3 });
  });

  it('needs the commute in both directions', () => {
    for (const pair of [pairKey('biz-studio', 'home-001'), pairKey('home-001', 'biz-studio')]) {
      expect(parseImportedRun(lockedRun, travelWithout([], [pair]).travel)).toMatchObject({ kind: 'unavailable', missingPlaces: 1 });
    }
  });

  it('does not ask for a home that no employee lives in', () => {
    // home-003 belongs to nobody in the sample city.
    expect(parseImportedRun(lockedRun, travelWithout(['home-003']).travel).kind).toBe('run');
  });

  it('accepts a city with no employees without asking the cache anything', () => {
    const empty = runWith((run) => {
      run.scenario.employees = [];
      run.scenario.homes = [];
      run.trips = [];
      run.assignments = { plans: [], unmatched: [], computeMs: 0 };
      run.jobs = [];
      run.notifications = [];
      run.events = [];
    });
    const { travel, calls } = travelWithout();
    expect(parseImportedRun(empty, travel)).toStrictEqual({ kind: 'run', run: empty });
    expect(calls).toStrictEqual([]);
  });
});
