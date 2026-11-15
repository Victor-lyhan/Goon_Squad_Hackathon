// #954 / #959: POST /api/v2/advise on the real NYC run with no key (createV2Runtime via v2-e2e-nyc-helper.ts;
// nothing leaves the machine). The options come from every candidate of both kinds; a kind with no plan gets a
// note that says why (#954).
//   - a draft where both kinds are feasible: the fastest and the cheapest over both kinds, then the balanced plan;
//   - the reporter's sentence (Titan Foods -> "Kinshop coffee" by tomorrow 5pm) gets the direct option and a
//     note that says why there is no relay;
//   - trips already reserved stay reserved: after a delivery is sent, no candidate uses its commutes.
// Every price is the engine's (`expectEnginePrices`).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { adviseOffline, candidateSet } from '../../server/ai/advisor';
import { advisorEngine } from '../../server/api/v2/adviseRoutes';
import type { Store } from '../../server/store';
import type { AdviseResponse, ShipmentResponse } from '../../shared/v2/api';
import type { ParseRequestResponse } from '../../shared/v2/parseRequest';
import type { Run as RunV2, TravelProvider } from '../../shared/v2/types';
import { expectEnginePrices, type DraftTimes } from './v2-advise-pricing-helper';
import { copyNycFixtures, recordFetch, startNycApi, T, type NycApi } from './v2-e2e-nyc-helper';

const net = recordFetch();
let api: NycApi;
let fixturesDir: string;
let store: Store<RunV2>;
let travel: TravelProvider;

beforeAll(async () => {
  fixturesDir = copyNycFixtures();
  api = await startNycApi(net, { fixturesDir });
  const { deps } = api.runtime;
  if (!deps.store || !deps.travel) throw new Error('/api/v2 did not load on fixtures/nyc');
  store = deps.store as Store<RunV2>;
  travel = deps.travel;
}, T);

afterAll(async () => {
  api.expectRepoFilesUntouched();
  await api.close();
  fs.rmSync(fixturesDir, { recursive: true, force: true });
  net.expectNoOutgoing();
  net.restore();
}, T);

const idOf = (name: string) => {
  const found = store.get().scenario.businesses.filter((b) => b.name === name);
  if (found.length !== 1) throw new Error(`the default run has ${found.length} businesses named "${name}"`);
  return found[0].id;
};

async function adviseOk(draft: DraftTimes): Promise<AdviseResponse> {
  const before = store.get();
  const res = await api.post<AdviseResponse>('/advise', { draft });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.source).toBe('offline');
  expect(store.get()).toBe(before);   // advice reserves nothing
  expect(res.body).toStrictEqual(adviseOffline(advisorEngine(store.get(), travel, draft)));
  return res.body;
}

describe('POST /api/v2/advise over both kinds (#954, #959)', () => {
  it('both kinds feasible: the fastest and the cheapest over every direct and relay candidate, then the balanced one', async () => {
    const draft: DraftTimes = {
      originBusinessId: idOf('McGraw Hill'), destinationBusinessId: idOf('Starbucks Reserve Roastery'), readyMin: 960, deadlineMin: 2160,
    };
    const body = await adviseOk(draft);
    const { candidates } = candidateSet(advisorEngine(store.get(), travel, draft));
    expect(new Set(candidates.map((c) => c.option.kind))).toStrictEqual(new Set(['direct', 'relay']));
    const fastest = body.options.find((o) => o.tags?.includes('fastest'));
    const cheapest = body.options.find((o) => o.tags?.includes('cheapest'));
    expect(fastest?.deliveryMin).toBe(Math.min(...candidates.map((c) => c.option.deliveryMin)));
    expect(cheapest?.customerPriceCents).toBe(Math.min(...candidates.map((c) => c.option.customerPriceCents)));
    expect(cheapest).toMatchObject({ kind: 'direct', customerPriceCents: 600 });
    expect(cheapest?.label).toMatch(/^(Fastest and cheapest|Cheapest): Direct with .+, \$6\.00$/);
    expect(body.options.length).toBeLessThanOrEqual(3);
    expect(body.options.at(-1)?.tags).toStrictEqual(['balanced']);
    expect(body.options.every((o) => Object.keys(o.changes).length === 0)).toBe(true);
    expect(body.note).toBeUndefined();
    expectEnginePrices(store.get(), travel, draft, body);
  }, T);

  it('the reporter\'s sentence from Titan Foods: its direct option, and a note on why there is no relay', async () => {
    const parsed = await api.post<ParseRequestResponse>('/parse-request', { text: 'deliver a box of cookies to Kinshop coffee by tomorrow 5pm' });
    expect(parsed.status).toBe(200);
    const draft = { ...parsed.body.draft, originBusinessId: idOf('Titan Foods') } as typeof parsed.body.draft & DraftTimes;
    const res = await api.post<AdviseResponse>('/advise', { draft });
    expect(res.status).toBe(200);
    expect(res.body.options.map((o) => [o.label, o.kind, o.changes])).toStrictEqual([['Fastest and cheapest: Direct with Theo Martin, $6.00', 'direct', {}]]);
    expect(res.body.note).toBe('No relay: a relay would add more than 12 minutes to a commute.');
    expectEnginePrices(store.get(), travel, draft, res.body);
  }, T);

  it('trips already reserved stay reserved: once a delivery is sent, no candidate uses its commutes', async () => {
    const draft: DraftTimes = {
      originBusinessId: idOf('McGraw Hill'), destinationBusinessId: idOf('Starbucks Reserve Roastery'), readyMin: 960, deadlineMin: 2160,
    };
    const first = await adviseOk(draft);
    const cheapest = first.options.find((o) => o.tags?.includes('cheapest'))!;
    const sent = await api.post<ShipmentResponse>('/shipments', {
      ...draft, clientRequestId: 'advise-kinds-954', label: 'Box', category: 'small_box', description: 'Samples', weightKg: 1,
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    // The matcher picks its own plan: a direct one at the cheapest price.
    expect(sent.body.plan).toMatchObject({ kind: 'direct', customerPriceCents: cheapest.customerPriceCents });
    const takenTrips = new Set(sent.body.plan?.legs.map((leg) => leg.tripId));

    const again = await adviseOk(draft);
    const engine = advisorEngine(store.get(), travel, draft);
    const { plans } = engine.candidates(draft.readyMin, draft.deadlineMin);
    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) for (const leg of plan.legs) expect(takenTrips.has(leg.tripId)).toBe(false);
    expect(again.options.length).toBeGreaterThan(0);
    expectEnginePrices(store.get(), travel, draft, again);
  }, T);
});
