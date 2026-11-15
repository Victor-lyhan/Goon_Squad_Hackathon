// #954: POST /api/v2/advise always offers the best relay plan next to the best direct one, or says why there is
// none, on the real NYC run with no key (createV2Runtime via v2-e2e-nyc-helper.ts; nothing leaves the machine).
//   - a draft where both kinds are feasible gets both, the relay although it costs more;
//   - the reporter's sentence (Titan Foods -> "Kinshop coffee" by tomorrow 5pm) gets the direct option and a
//     note that says why there is no relay;
//   - trips already reserved stay reserved: after the direct option is sent, the next advice has another plan
//     or says which commutes are taken.
// Every price is the engine's (`expectEnginePrices`).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { adviseOffline } from '../../server/ai/advisor';
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

const asTyped = (body: AdviseResponse) => body.options.filter((o) => Object.keys(o.changes).length === 0);

describe('POST /api/v2/advise by kind (#954)', () => {
  it('both kinds feasible: the best direct and the best relay as typed, the relay although it costs more', async () => {
    const draft: DraftTimes = {
      originBusinessId: idOf('McGraw Hill'), destinationBusinessId: idOf('Starbucks Reserve Roastery'), readyMin: 960, deadlineMin: 2160,
    };
    const body = await adviseOk(draft);
    const [direct, relay] = asTyped(body);
    expect([direct?.kind, relay?.kind]).toStrictEqual(['direct', 'relay']);
    expect(direct.label).toBe(`Direct with ${direct.carrierNames[0]}, $6.00`);
    expect(relay.label).toMatch(/^Relay via .+, \$9\.50$/);
    expect(relay.customerPriceCents).toBeGreaterThan(direct.customerPriceCents);
    expect(relay.carrierNames).toHaveLength(2);
    expect(body.options.length).toBeLessThanOrEqual(3);
    expect(body.options.filter((o) => Object.keys(o.changes).length > 0).length).toBeLessThanOrEqual(1);
    expect(body.note).toBeUndefined();
    expectEnginePrices(store.get(), travel, draft, body);
  }, T);

  it('the reporter\'s sentence from Titan Foods: its direct option, and a note on why there is no relay', async () => {
    const parsed = await api.post<ParseRequestResponse>('/parse-request', { text: 'deliver a box of cookies to Kinshop coffee by tomorrow 5pm' });
    expect(parsed.status).toBe(200);
    const draft = { ...parsed.body.draft, originBusinessId: idOf('Titan Foods') } as typeof parsed.body.draft & DraftTimes;
    const res = await api.post<AdviseResponse>('/advise', { draft });
    expect(res.status).toBe(200);
    expect(res.body.options.map((o) => [o.label, o.kind, o.changes])).toStrictEqual([['Direct with Theo Martin, $6.00', 'direct', {}]]);
    expect(res.body.note).toBe('No relay: a relay would add more than 12 minutes to a commute.');
    expectEnginePrices(store.get(), travel, draft, res.body);
  }, T);

  it('trips already reserved stay reserved: once the direct option is sent, the advice no longer offers its commute', async () => {
    const draft: DraftTimes = {
      originBusinessId: idOf('McGraw Hill'), destinationBusinessId: idOf('Starbucks Reserve Roastery'), readyMin: 960, deadlineMin: 2160,
    };
    const [direct] = asTyped(await adviseOk(draft));
    const sent = await api.post<ShipmentResponse>('/shipments', {
      ...draft, clientRequestId: 'advise-kinds-954', label: 'Box', category: 'small_box', description: 'Samples', weightKg: 1,
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.plan).toMatchObject({ kind: 'direct', customerPriceCents: direct.customerPriceCents });
    const takenTrips = new Set(sent.body.plan?.legs.map((leg) => leg.tripId));

    const again = await adviseOk(draft);
    const engine = advisorEngine(store.get(), travel, draft);
    const kinds = engine.matchKinds!(draft.readyMin, draft.deadlineMin);
    for (const answer of Object.values(kinds)) {
      if ('plan' in answer) for (const leg of answer.plan.legs) expect(takenTrips.has(leg.tripId)).toBe(false);
    }
    // The direct as typed is another carrier's, or the note says why there is none.
    const directAgain = asTyped(again).find((o) => o.kind === 'direct');
    if (directAgain) expect(directAgain).not.toStrictEqual(direct);
    else expect(again.note).toMatch(/^No direct: /);
    expect(asTyped(again).some((o) => o.kind === 'relay')).toBe(true);
    expectEnginePrices(store.get(), travel, draft, again);
  }, T);
});
