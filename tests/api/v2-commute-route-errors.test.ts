// PUT /api/v2/employees/:id/commute, every answer that is not a 200: 400, 404, 409 and 503.
// In each case the run stays exactly as it was. The 200 saves are in v2-commute-route.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMUTE_LOCKED, EMPLOYEE_NOT_FOUND, HOME_OUTSIDE_NYC, INVALID_COMMUTE } from '../../server/api/v2/commutePlan';
import { GoogleApiError, GoogleKeyMissingError } from '../../server/geo/googleClient';
import { ApiError } from '../../shared/v2/schemas';
import type { Run } from '../../shared/v2/types';
import {
  AGENCY, CONSOLE_METHODS, CommuteResponseSchema, NEW_HOME_BODY, NEW_HOME_ID, NEW_POINT_TEXT, PRINT,
  commuteBody, startCommuteApp, type CommuteApp,
} from './v2-commute-route-helpers';

// Looks like a Google key. It must never reach a response body.
const FAKE_KEY = 'AIzaSyFAKE-KEY-0123456789abcdefghijklmn';

let started: CommuteApp[] = [];
const start = async (opts?: Parameters<typeof startCommuteApp>[0]) => {
  const app = await startCommuteApp(opts);
  started.push(app);
  return app;
};
let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  consoleSpies = CONSOLE_METHODS.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
});
afterEach(async () => {
  // No log line holds the new home's coordinates. The route logs nothing at all.
  const printed = JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls));
  for (const text of NEW_POINT_TEXT) expect(printed).not.toContain(text);
  vi.restoreAllMocks();
  await Promise.all(started.map((app) => app.close()));
  started = [];
});

/** The run is the very object from before the request: no mutation was committed, the version did not move. */
const expectUntouched = (app: CommuteApp, before: Run, copy: Run) => {
  expect(app.store.get()).toBe(before);
  expect(app.store.get()).toEqual(copy);
};
const expectNoCoordinates = (text: string) => {
  for (const part of NEW_POINT_TEXT) expect(text).not.toContain(part);
};

describe('PUT /api/v2/employees/:id/commute: 4xx, each with no call to the travel service', () => {
  it('unknown employee: 404', async () => {
    const app = await start();
    const before = app.store.get();
    const copy = structuredClone(before);

    const res = await app.put('emp-99', commuteBody({ home: NEW_HOME_BODY }));

    expect(res.status).toBe(404);
    expect(ApiError.parse(res.body)).toEqual({ error: EMPLOYEE_NOT_FOUND });
    expect(app.places.calls).toEqual([]);
    expectUntouched(app, before, copy);
    expectNoCoordinates(res.text);
  });

  it.each([
    ['a missing field', (() => { const { maxExtraMin: _drop, ...rest } = commuteBody(); return rest; })(), 'maxExtraMin'],
    ['maxExtraMin over 30', commuteBody({ maxExtraMin: 31 }), 'maxExtraMin'],
    ['an evening departure on Day 2', commuteBody({ eveningDepartureMin: 1440 }), 'eveningDepartureMin'],
    ['a morning departure on Day 1', commuteBody({ morningDepartureMin: 480 }), 'morningDepartureMin'],
    ['a text flag', commuteBody({ availableEvening: 'yes' }), 'availableEvening'],
    ['an empty businessId', commuteBody({ businessId: '' }), 'businessId'],
    ['no home', (() => { const { home: _drop, ...rest } = commuteBody(); return rest; })(), 'home'],
    ['a home with neither an ID nor a point', commuteBody({ home: {} }), 'home'],
    ['a new point without a neighborhood', commuteBody({ home: { lat: 40.7642, lng: -73.9235 } }), 'home'],
    // Zod names the inner field; the commute form reads the part before the dot.
    ['a latitude that is not on Earth', commuteBody({ home: { ...NEW_HOME_BODY, lat: 140.7642 } }), 'home.lat'],
    ['a body that is a list', [], 'body'],
  ])('invalid body (%s): 400 with a field error', async (_name, body, field) => {
    const app = await start();
    const before = app.store.get();
    const copy = structuredClone(before);

    const res = await app.put('emp-1', body);

    expect(res.status).toBe(400);
    const parsed = ApiError.parse(res.body);
    expect(parsed.error).toBe(INVALID_COMMUTE);
    expect(Object.keys(parsed.fieldErrors ?? {})).toContain(field);
    expect(app.places.calls).toEqual([]);
    expectUntouched(app, before, copy);
    expectNoCoordinates(res.text);
  });

  it('an invalid body is a 400 before the employee is looked up', async () => {
    const app = await start();
    const res = await app.put('emp-99', commuteBody({ maxExtraMin: -1 }));
    expect(res.status).toBe(400);
    expect(app.places.calls).toEqual([]);
  });

  it.each([
    ['south of the city', { lat: 40.4, lng: -73.9235 }],
    ['east of the city', { lat: 40.7642, lng: -73.5 }],
    ['Los Angeles', { lat: 34.0522, lng: -118.2437 }],
  ])('home outside NYC (%s): 400 on the home field', async (_name, point) => {
    const app = await start();
    const before = app.store.get();
    const copy = structuredClone(before);

    const res = await app.put('emp-1', commuteBody({ home: { ...point, neighborhood: 'Elsewhere' } }));

    expect(res.status).toBe(400);
    expect(ApiError.parse(res.body)).toEqual({ error: INVALID_COMMUTE, fieldErrors: { home: HOME_OUTSIDE_NYC } });
    expect(app.places.calls).toEqual([]);
    expectUntouched(app, before, copy);
    // The answer does not repeat the point that was sent.
    expect(res.text).not.toContain(String(point.lat));
    expect(res.text).not.toContain(String(Math.abs(point.lng)));
  });

  it('unknown business and unknown home: 400 with both field errors', async () => {
    const app = await start();
    const before = app.store.get();
    const copy = structuredClone(before);

    const res = await app.put('emp-1', commuteBody({ businessId: 'biz-nowhere', home: { homeId: 'home-999' } }));

    expect(res.status).toBe(400);
    expect(ApiError.parse(res.body)).toEqual({
      error: INVALID_COMMUTE, fieldErrors: { businessId: 'Unknown business', home: 'Unknown home' },
    });
    expect(app.places.calls).toEqual([]);
    expectUntouched(app, before, copy);
  });

  it('locked run: 409', async () => {
    const app = await start();
    await app.store.mutate((run) => { run.clock.phase = 'locked'; });
    const before = app.store.get();
    const copy = structuredClone(before);

    const res = await app.put('emp-1', commuteBody({ home: NEW_HOME_BODY }));

    expect(res.status).toBe(409);
    expect(ApiError.parse(res.body)).toEqual({ error: COMMUTE_LOCKED });
    expect(app.places.calls).toEqual([]);
    expectUntouched(app, before, copy);
    expectNoCoordinates(res.text);
  });

  it('an unknown employee in a locked run is a 404', async () => {
    const app = await start();
    await app.store.mutate((run) => { run.clock.phase = 'locked'; });
    expect((await app.put('emp-99', commuteBody())).status).toBe(404);
    expect(app.places.calls).toEqual([]);
  });
});

describe('PUT /api/v2/employees/:id/commute: 503 when the travel data cannot be fetched', () => {
  it('ensurePairs rejecting with GoogleKeyMissingError: 503 google_key_missing, the run is deep-equal to before', async () => {
    const app = await start();
    const before = app.store.get();
    const copy = structuredClone(before);
    app.places.failNext('ensurePairs', new GoogleKeyMissingError());

    const res = await app.put('emp-1', commuteBody({ home: NEW_HOME_BODY, availableMorning: true }));

    expect(res.status).toBe(503);
    expect(Object.keys(res.body).sort()).toEqual(['code', 'error']);
    expect(res.body.code).toBe('google_key_missing');
    expect(res.body.error).toContain('GOOGLE_MAPS_SERVER_KEY');
    expectUntouched(app, before, copy);
    // The save stopped at the pairs: no route lines were asked for.
    expect(app.places.calls.map((c) => c.method)).toEqual(['addPlaces', 'ensurePairs']);
    expectNoCoordinates(res.text);
  });

  it('ensurePairs rejecting with GoogleApiError: 503 google_unavailable, no key in the body', async () => {
    const app = await start();
    const before = app.store.get();
    const copy = structuredClone(before);
    app.places.failNext('ensurePairs', new GoogleApiError({
      status: 403, googleStatus: 'PERMISSION_DENIED',
      endpoint: 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
      message: `API key ${FAKE_KEY} is not authorized`,
    }));

    const res = await app.put('emp-1', commuteBody({ home: NEW_HOME_BODY }));

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('google_unavailable');
    expect(res.text).not.toContain(FAKE_KEY);
    expectUntouched(app, before, copy);
    expectNoCoordinates(res.text);
  });

  it('the same save works once the travel service answers', async () => {
    const app = await start();
    app.places.failNext('ensurePairs', new GoogleKeyMissingError());
    expect((await app.put('emp-1', commuteBody({ home: NEW_HOME_BODY, availableMorning: true }))).status).toBe(503);

    const res = await app.put('emp-1', commuteBody({ home: NEW_HOME_BODY, availableMorning: true }));

    expect(res.status).toBe(200);
    expect(CommuteResponseSchema.parse(res.body).rematchedShipmentIds).toEqual(['shp-3']);
  });

  it('pairs that are still missing after ensurePairs: 503 travel_data_missing, never an invented time', async () => {
    const app = await start();
    const before = app.store.get();
    const copy = structuredClone(before);
    app.places.skipFetch(); // resolves, but Google gave no route for the new home

    const res = await app.put('emp-1', commuteBody({ home: NEW_HOME_BODY, availableMorning: true }));

    expect(res.status).toBe(503);
    expect(Object.keys(res.body).sort()).toEqual(['code', 'error']);
    expect(res.body.code).toBe('travel_data_missing');
    // errors.ts names the pair by place ID, so a human knows what is missing.
    expect(res.body.error).toContain(NEW_HOME_ID);
    expectUntouched(app, before, copy);
  });

  it('anything else from the travel service is the app\'s 500 with no detail, and the run is unchanged', async () => {
    const app = await start();
    const before = app.store.get();
    const copy = structuredClone(before);
    app.places.failNext('addPlaces', new Error(`place conflict at 40.7642,-73.9235 with ${FAKE_KEY}`));

    const res = await app.put('emp-1', commuteBody({ home: NEW_HOME_BODY }));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(app.places.calls.map((c) => c.method)).toEqual(['addPlaces']);
    expectUntouched(app, before, copy);
    expectNoCoordinates(res.text);
  });
});

describe('PUT /api/v2/employees/:id/commute: the run changes while Google answers', () => {
  it('locked while ensurePairs is pending: 409 and the commute is not saved', async () => {
    const app = await start();
    const gate = app.places.hold('ensurePairs');
    const pending = app.put('emp-1', commuteBody({ home: NEW_HOME_BODY, availableMorning: true }));
    await gate.reached;

    await app.store.mutate((run) => { run.clock.phase = 'locked'; });
    const locked = app.store.get();
    const copy = structuredClone(locked);
    gate.release();
    const res = await pending;

    expect(res.status).toBe(409);
    expect(ApiError.parse(res.body)).toEqual({ error: COMMUTE_LOCKED });
    expectUntouched(app, locked, copy);
    expect(app.store.get().scenario.homes.map((h) => h.id)).not.toContain(NEW_HOME_ID);
    expectNoCoordinates(res.text);
  });

  it('locked while ensurePolylines is pending: 409 as well', async () => {
    const app = await start();
    const gate = app.places.hold('ensurePolylines');
    const pending = app.put('emp-1', commuteBody({ home: NEW_HOME_BODY }));
    await gate.reached;

    await app.store.mutate((run) => { run.clock.phase = 'locked'; });
    const locked = app.store.get();
    const copy = structuredClone(locked);
    gate.release();
    const res = await pending;

    expect(res.status).toBe(409);
    expectUntouched(app, locked, copy);
  });

  it('the employee is gone after a reset while ensurePairs is pending: 404 and nothing changes', async () => {
    const app = await start();
    const gate = app.places.hold('ensurePairs');
    const pending = app.put('emp-1', commuteBody({ home: NEW_HOME_BODY }));
    await gate.reached;

    // What a new scenario does to the run: other employees, no trips or plans of the old ones.
    await app.store.mutate((run) => {
      run.scenario.employees = run.scenario.employees.filter((e) => e.id !== 'emp-1');
      run.trips = run.trips.filter((t) => t.employeeId !== 'emp-1');
    });
    const replaced = app.store.get();
    const copy = structuredClone(replaced);
    gate.release();
    const res = await pending;

    expect(res.status).toBe(404);
    expect(ApiError.parse(res.body)).toEqual({ error: EMPLOYEE_NOT_FOUND });
    expectUntouched(app, replaced, copy);
  });

  it('the workplace is gone while ensurePairs is pending: 400 and nothing changes', async () => {
    const app = await start();
    const gate = app.places.hold('ensurePairs');
    const pending = app.put('emp-3', commuteBody({ businessId: AGENCY, home: NEW_HOME_BODY }));
    await gate.reached;

    await app.store.mutate((run) => {
      run.scenario.businesses = run.scenario.businesses.filter((b) => b.id !== AGENCY);
    });
    const replaced = app.store.get();
    const copy = structuredClone(replaced);
    gate.release();
    const res = await pending;

    expect(res.status).toBe(400);
    expect(ApiError.parse(res.body)).toEqual({ error: INVALID_COMMUTE, fieldErrors: { businessId: 'Unknown business' } });
    expectUntouched(app, replaced, copy);
  });

  it('a change that does not concern the commute is kept: the save applies on top of it', async () => {
    const app = await start();
    const gate = app.places.hold('ensurePairs');
    const pending = app.put('emp-1', commuteBody({ home: NEW_HOME_BODY, availableMorning: true }));
    await gate.reached;

    await app.store.mutate((run) => { run.scenario.name = 'Renamed while Google answered'; });
    const versionAfterRename = app.store.get().version;
    gate.release();
    const res = await pending;

    expect(res.status).toBe(200);
    expect(CommuteResponseSchema.parse(res.body).rematchedShipmentIds).toEqual(['shp-3']);
    expect(app.store.get().scenario.name).toBe('Renamed while Google answered');
    expect(app.store.get().version).toBe(versionAfterRename + 1);
    expect(app.store.get().scenario.employees.find((e) => e.id === 'emp-1')!.businessId).toBe(PRINT);
  });
});
