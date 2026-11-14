// POST /api/v2/matches/compare over HTTP, registered by registerReadRoutes through createV2Router.
// It is read-only by contract: "does NOT modify live state" (shared/v2/api.ts, SPEC nice-to-have 13).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../../shared/v2/schemas';
import { compareRun, INVALID_COMPARE } from '../../server/api/v2/compareOps';
import { directPlan, relayPlan, sampleRun } from './v2-sample';
import { MISSING_PAIR, sampleCityTravel, sampleCityTravelMissingPair, withoutComputeMs } from './v2-compare-helper';
import { startReadApi, wire, type ReadApi } from './v2-read-routes-helper';

const travel = sampleCityTravel();
let api: ReadApi;      // every pair cached
let missing: ReadApi;  // one pair not cached

beforeAll(async () => {
  api = await startReadApi({ travel });
  missing = await startReadApi({ travel: sampleCityTravelMissingPair() });
});
afterAll(async () => {
  await api.close();
  await missing.close();
});

describe('POST /api/v2/matches/compare', () => {
  it('answers 200 with the pure step\'s result: with relay matches more than direct only', async () => {
    const res = await api.call('POST', '/matches/compare', {});
    expect(res.status).toBe(200);

    const pure = compareRun(sampleRun, travel, {});
    if (pure.kind !== 'ok') throw new Error('expected ok');
    expect(withoutComputeMs(res.body as typeof pure.response)).toEqual(wire(withoutComputeMs(pure.response)));

    expect(res.body.directOnly.result.plans).toEqual(wire([directPlan]));
    expect(res.body.withRelay.result.plans).toEqual(wire([relayPlan, directPlan]));
    expect(res.body.withRelay.metrics.matched).toBeGreaterThanOrEqual(res.body.directOnly.metrics.matched);
    expect([res.body.directOnly.metrics.matched, res.body.withRelay.metrics.matched]).toEqual([1, 2]);
    for (const side of [res.body.directOnly, res.body.withRelay]) {
      expect(typeof side.result.computeMs).toBe('number');
      expect(side.result.computeMs).toBeGreaterThanOrEqual(0);
      expect(side.metrics).toMatchObject({ delivered: 0, earnedRewardsCents: 0, earnedPlatformContributionCents: 0 });
    }
  });

  it('accepts a request with no body at all', async () => {
    const res = await api.call('POST', '/matches/compare');
    expect(res.status).toBe(200);
    expect(res.body.withRelay.metrics.matched).toBe(2);
  });

  it('leaves the run, its version and the store untouched', async () => {
    const before = api.store.get();
    const simulatorBefore = await api.get('/simulator');

    for (let i = 0; i < 3; i++) expect((await api.call('POST', '/matches/compare', {})).status).toBe(200);

    expect(api.store.get()).toBe(before);      // the same frozen object: nothing was written or replaced
    expect(api.store.get().version).toBe(12);
    expect(api.mutations()).toBe(0);
    const simulatorAfter = await api.get('/simulator');
    expect(simulatorAfter.text).toBe(simulatorBefore.text); // live plans, version and statuses as before
    expect(simulatorAfter.body.version).toBe(12);
  });

  it.each([
    ['an array', '[]'],
    ['an array with content', '[{"mode":"relay"}]'],
  ])('an invalid body (%s) is a 400 ApiError', async (_name, body) => {
    const res = await api.call('POST', '/matches/compare', body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: INVALID_COMPARE });
    expect(ApiError.safeParse(res.body).success).toBe(true);
  });

  it.each([
    ['a bare string', '"relay"'],
    ['broken JSON', '{"mode":'],
  ])('a body the JSON parser refuses (%s) is a 400 too', async (_name, body) => {
    const res = await api.call('POST', '/matches/compare', body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Request body is not valid JSON' });
  });

  it('a pair missing from the provider is a 503 travel_data_missing, never a made-up number', async () => {
    const res = await missing.call('POST', '/matches/compare', {});
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      code: 'travel_data_missing',
      error: `No travel time is cached for ${MISSING_PAIR.from} to ${MISSING_PAIR.to}. Run npm run fetch:routes and commit fixtures/nyc/.`,
    });
    // No partial answer: neither side, no plans, no metrics.
    expect(res.text).not.toMatch(/directOnly|withRelay|plans|metrics|computeMs/);
    expect(missing.store.get()).toBe(sampleRun);
    expect(missing.mutations()).toBe(0);
  });

  it('an invalid body is refused before any travel lookup (400, not 503)', async () => {
    const res = await missing.call('POST', '/matches/compare', '[]');
    expect(res.status).toBe(400);
  });

  it('GET /matches/compare is not a route', async () => {
    const res = await api.get('/matches/compare');
    expect(res.status).toBe(404);
  });
});
