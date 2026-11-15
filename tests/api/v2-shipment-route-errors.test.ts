// The /api/v2 delivery-request routes when travel data is missing (503, run untouched) and what happens
// to the route lines of a new plan: asked for once after the response, and never able to fail or delay it.
import { afterEach, describe, expect, it } from 'vitest';
import { GoogleApiError, GoogleKeyMissingError } from '../../server/geo/googleClient';
import { pairKey } from '../../shared/v2/types';
import {
  CAFE, PRINT, AGENCY,
  deliveryBody, emptyCity, expectShipmentResponse, expectUntouched, openMorningCommute, remember, startShipmentApp,
  type LinesMode, type Reply, type ShipmentApp,
} from './v2-shipment-route-helpers';

// Looks like a Google key. It must never reach a response body.
const FAKE_KEY = 'AIzaSyFAKE-KEY-0123456789abcdefghijklmn';

let started: ShipmentApp[] = [];
const start = async (opts?: Parameters<typeof startShipmentApp>[0]) => {
  const app = await startShipmentApp(opts);
  started.push(app);
  return app;
};
afterEach(async () => {
  await Promise.all(started.map((app) => app.close()));
  started = [];
});

const expectTravelMissing = (reply: Reply, from: string, to: string) => {
  expect(reply.status).toBe(503);
  expect(reply.body).toEqual({
    code: 'travel_data_missing',
    error: `A travel time is missing on this server. Run npm run fetch:routes and commit fixtures/nyc/ (${from} to ${to}).`,
  });
};

describe('a missing travel pair: 503 travel_data_missing and the run as it was', () => {
  it('POST /shipments; the same request works once the pair is there, with the ID the failed one did not use', async () => {
    const app = await start();
    const pair = pairKey(CAFE, 'home-002'); // emp-2's way home from the new drop-off
    const saved = app.table[pair];
    delete app.table[pair];
    const before = remember(app);

    const failed = await app.create(deliveryBody());

    expectTravelMissing(failed, CAFE, 'home-002');
    expectUntouched(app, before);
    expect(app.snapshots).toEqual([]);
    expect(app.lines.calls).toEqual([]);

    app.table[pair] = saved;
    const reply = await app.create(deliveryBody());
    expect(reply.status).toBe(201);
    expect(expectShipmentResponse(app, reply)).toMatchObject({ matched: true, shipment: { id: 'shp-4' } });
    expect(app.store.get().version).toBe(before.copy.version + 1);
  });

  it('PATCH /shipments/:id: the edit is not stored either', async () => {
    const app = await start();
    expect((await app.create(deliveryBody({ deadlineMin: 1040 }))).status).toBe(201);
    delete app.table[pairKey(CAFE, 'home-002')];
    const before = remember(app);

    const reply = await app.patch('shp-4', { deadlineMin: 1980, label: 'Edited' });

    expectTravelMissing(reply, CAFE, 'home-002');
    expectUntouched(app, before);
    expect(app.store.get().scenario.shipments[3]).toMatchObject({ deadlineMin: 1040, label: 'Catering order' });
    expect(app.lines.calls).toEqual([]);
  });

  it('POST /shipments/:id/match', async () => {
    const app = await start();
    await openMorningCommute(app);
    delete app.table[pairKey('home-001', CAFE)]; // emp-1's way to the pickup
    const before = remember(app);

    const reply = await app.retry('shp-3');

    expectTravelMissing(reply, 'home-001', CAFE);
    expectUntouched(app, before);
    expect(app.lines.calls).toEqual([]);
  });
});

describe('a travel provider that cannot reach Google: the router answers the 503', () => {
  it('GoogleKeyMissingError -> 503 google_key_missing', async () => {
    const app = await start();
    app.travelFailure.error = new GoogleKeyMissingError();
    const before = remember(app);

    const reply = await app.create(deliveryBody());

    expect(reply.status).toBe(503);
    expect(reply.body).toEqual({
      code: 'google_key_missing',
      error: 'The Google Maps server key is not set. Add GOOGLE_MAPS_SERVER_KEY to .env and restart the server.',
    });
    expectUntouched(app, before);
  });

  it('GoogleApiError -> 503 google_unavailable, without the upstream message', async () => {
    const app = await start();
    app.travelFailure.error = new GoogleApiError({
      status: 403, googleStatus: 'PERMISSION_DENIED',
      endpoint: 'https://routes.googleapis.com/directions/v2:computeRoutes',
      message: `API key ${FAKE_KEY} is not authorized`,
    });
    await openMorningCommute(app);
    const before = remember(app);

    const reply = await app.retry('shp-3');

    expect(reply.status).toBe(503);
    expect(reply.body).toEqual({
      code: 'google_unavailable', error: 'Google Maps is not answering right now, so try again in a moment.',
    });
    expect(reply.text).not.toContain(FAKE_KEY);
    expectUntouched(app, before);
  });

  it('any other failure in the matcher is a JSON 500 that stores nothing and shows no detail', async () => {
    const app = await start();
    app.travelFailure.error = new Error(`boom with ${FAKE_KEY}`);
    const before = remember(app);

    const reply = await app.create(deliveryBody());

    expect(reply.status).toBe(500);
    expect(reply.body).toEqual({ error: 'Internal server error' });
    expectUntouched(app, before);

    app.travelFailure.error = null;
    expect((await app.create(deliveryBody())).status).toBe(201);
  });
});

describe('route lines of a new plan (ensureLegPolylines)', () => {
  it('is called once with the new legs, after the response is sent and the plan is stored', async () => {
    const app = await start();

    const reply = await app.create(deliveryBody());

    const body = expectShipmentResponse(app, reply);
    expect(app.lines.calls).toHaveLength(1);
    const [call] = app.lines.calls;
    expect(call.legs).toEqual(body.plan!.legs);
    expect(call.legs.map((l) => l.placeIds)).toEqual([[AGENCY, CAFE, 'home-002']]);
    expect(call.responseSent).toBe(true);
    expect(call.run).toBe(app.store.get());
    expect(call.run.assignments.plans.some((p) => p.id === 'plan-shp-4')).toBe(true);
  });

  it('gets both legs of a relay plan in one call', async () => {
    const app = await start({ scenario: emptyCity() });

    const reply = await app.create(deliveryBody({ originBusinessId: PRINT, destinationBusinessId: AGENCY }));

    expect(reply.status).toBe(201);
    expect(app.lines.calls.map((c) => c.legs.map((l) => l.placeIds))).toEqual([
      [[PRINT, CAFE, 'home-001'], ['home-002', CAFE, AGENCY]],
    ]);
  });

  it('is not called for an unmatched delivery, a replay or a refusal', async () => {
    const app = await start();

    const unmatched = await app.create(deliveryBody({ originBusinessId: CAFE, destinationBusinessId: PRINT }));
    expect(unmatched.status).toBe(201);
    expect(expectShipmentResponse(app, unmatched).matched).toBe(false);
    expect((await app.create(deliveryBody({ clientRequestId: 'req-bad', weightKg: 9 }))).status).toBe(400);
    expect(app.lines.calls).toEqual([]);

    expect((await app.create(deliveryBody({ clientRequestId: 'req-ok' }))).status).toBe(201);
    expect(app.lines.calls).toHaveLength(1);
    expect((await app.create(deliveryBody({ clientRequestId: 'req-ok' }))).status).toBe(200);
    expect(app.lines.calls).toHaveLength(1);
  });

  it.each<LinesMode>(['reject', 'throw', 'hang'])('a fake that %ss changes neither the status nor the body', async (mode) => {
    const [app, calm] = [await start(), await start()];
    app.lines.mode = mode;

    const [reply, expected] = [await app.create(deliveryBody()), await calm.create(deliveryBody())];

    expect(expected.status).toBe(201);
    expect(reply.status).toBe(201);
    expect(reply.body).toEqual(expected.body);
    expect(expectShipmentResponse(app, reply).matched).toBe(true);
    expect(app.lines.calls).toHaveLength(1);
    expect(app.store.get().version).toBe(1);

    // The server is still answering, and the edit and retry routes behave the same way.
    expect((await app.create(deliveryBody())).status).toBe(200);
    await openMorningCommute(app);
    const retried = await app.retry('shp-3');
    expect(retried.status).toBe(200);
    expect(expectShipmentResponse(app, retried).matched).toBe(true);
    expect(app.lines.calls).toHaveLength(2);
  });

  it('is optional: without the dependency a match is still a 201', async () => {
    const app = await start({ lines: false });

    const reply = await app.create(deliveryBody());

    expect(reply.status).toBe(201);
    expect(expectShipmentResponse(app, reply).matched).toBe(true);
    expect(app.lines.calls).toEqual([]);
  });
});
