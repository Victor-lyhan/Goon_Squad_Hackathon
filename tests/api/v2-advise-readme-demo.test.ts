// #867: POST /api/v2/advise on the README's demo sentence, offline (no GEMINI_API_KEY), on the real NYC run.
// Every option's price must be the engine's per-plan price (#861): `customerPriceCents()` of the plan the
// matcher picks for that option, with the $1.00 flexibility discount exactly when the option's window is at
// least `settings.flexWindowMin` (18 h). The advisor adds no number of its own.
// The server is the real one (v2-e2e-nyc-helper.ts: `createV2Runtime` with no Google key and no Gemini
// settings) on a temp copy of fixtures/nyc, with `globalThis.fetch` as a recorder: a call that is not to the
// test server (to Gemini, say) fails the test. The sender, the recipient and the price are read from the
// README's ```demo-request block and found in the run by name; no carrier and no ID is written here.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { adviseOffline, money, timeText } from '../../server/ai/advisor';
import { advisorEngine } from '../../server/api/v2/adviseRoutes';
import { customerPriceCents } from '../../server/domain/pricing';
import type { Store } from '../../server/store';
import type { AdviseResponse, ShipmentResponse } from '../../shared/v2/api';
import type { ParseRequestResponse } from '../../shared/v2/parseRequest';
import type { Run as RunV2, TravelProvider } from '../../shared/v2/types';
import { expectEnginePrices, withFlexWindow, type DraftTimes } from './v2-advise-pricing-helper';
import { copyNycFixtures, recordFetch, REPO_ROOT, startNycApi, T, type NycApi } from './v2-e2e-nyc-helper';

/** The sentence the README's 2-minute demo types (README "2-minute demo"; also in v2-f1-demo-sentence.test.ts). */
const DEMO_SENTENCE = 'Send a 0.5 kg envelope of espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow, ready at 4 p.m.';
/** The same request due an hour earlier: 17 h from ready to deliver-by, one hour short of the flexibility window. */
const NINE_AM_SENTENCE = DEMO_SENTENCE.replace('by 10 a.m. tomorrow', 'by 9 a.m. tomorrow');

const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
const block = /```demo-request\n([\s\S]*?)```/.exec(readme)?.[1];
if (!block) throw new Error('README.md has no ```demo-request block');
const demo: Record<string, string> = Object.fromEntries(
  block.trim().split('\n').map((line) => {
    const colon = line.indexOf(':');
    return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  }),
);

const net = recordFetch();
type Demo = { api: NycApi; fixturesDir: string; store: Store<RunV2>; travel: TravelProvider; senderId: string };
let open: Demo[] = [];

/** A new server on a new copy of fixtures/nyc: the default run, with nothing requested yet. */
async function freshRun(): Promise<Demo> {
  const fixturesDir = copyNycFixtures();
  const api = await startNycApi(net, { fixturesDir });
  const { store, travel } = api.runtime.deps;
  if (!store || !travel) throw new Error('/api/v2 did not load on fixtures/nyc');
  const senders = store.get().scenario.businesses.filter((b) => b.name === demo.sender);
  if (senders.length !== 1) throw new Error(`README names the sender "${demo.sender}", and the default run has ${senders.length} of them`);
  const run: Demo = { api, fixturesDir, store: store as Store<RunV2>, travel, senderId: senders[0].id };
  open.push(run);
  return run;
}

afterEach(async () => {
  for (const run of open) {
    run.api.expectRepoFilesUntouched();
    await run.api.close();
    fs.rmSync(run.fixturesDir, { recursive: true, force: true });
  }
  open = [];
  net.expectNoOutgoing(); // no key: nothing was sent to Gemini (or anywhere else)
}, T);
afterAll(() => net.restore());

/** The sentence parsed offline, as the sender's Business page sends it to /advise: with the sender filled in. */
async function demoDraft(run: Demo, text: string) {
  const parsed = await run.api.post<ParseRequestResponse>('/parse-request', { text });
  expect(parsed.status, text).toBe(200);
  expect(parsed.body.source).toBe('offline');
  expect(parsed.body.missing).toStrictEqual(['originBusinessId']);
  const draft = { ...parsed.body.draft, originBusinessId: run.senderId };
  expect(timeText(draft.readyMin as number)).toBe(demo.ready);   // "Day 1, 4:00 PM"
  return draft as typeof draft & DraftTimes;
}

/** POST /advise, which must answer 200 offline; and the run must be the very same object afterwards. */
async function adviseOk(run: Demo, draft: unknown): Promise<AdviseResponse> {
  const before = { run: run.store.get(), copy: structuredClone(run.store.get()) };
  const res = await run.api.post<AdviseResponse>('/advise', { draft });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.source).toBe('offline');
  expect(run.store.get()).toBe(before.run);       // no mutation was committed
  expect(run.store.get()).toEqual(before.copy);   // and nothing was changed in place
  return res.body;
}

describe('POST /api/v2/advise on the README demo sentence, offline: the prices are the engine\'s (#867)', () => {
  it('every option\'s price equals customerPriceCents() of its plan; the request as typed shows the $1.00 discount', async () => {
    const run = await freshRun();
    const { settings } = run.store.get().scenario;
    // Pricing per plan (#861), as the README's Pricing table has it.
    expect(settings).toMatchObject({ legRewardCents: 300, hubCostCents: 50, platformFeeCents: 400, flexDiscountCents: 100, flexWindowMin: 1080 });
    const draft = await demoDraft(run, DEMO_SENTENCE);
    expect(timeText(draft.deadlineMin)).toBe(demo.deliver_by);   // "Day 2, 10:00 AM"
    expect(draft.deadlineMin - draft.readyMin).toBe(settings.flexWindowMin);   // 18 h: exactly the window

    const body = await adviseOk(run, draft);

    expect(body.options.length).toBeGreaterThan(0);
    expect(body.note).toBeUndefined();
    const priced = expectEnginePrices(run.store.get(), run.travel, draft, body);
    // Every option of this request leaves at least 18 h (a variant only widens the window), so every one
    // shows the discount: its price is $1.00 under the same plan's price without it.
    for (const { option, plan, readyMin, deadlineMin, flexible } of priced) {
      expect(flexible, option.label).toBe(true);
      expect(deadlineMin - readyMin).toBeGreaterThanOrEqual(settings.flexWindowMin);
      const withoutDiscount = customerPriceCents(plan, { readyMin, deadlineMin }, { ...settings, flexDiscountCents: 0 });
      expect(withoutDiscount - option.customerPriceCents, option.label).toBe(100);
      expect(option.summary, option.label).toContain(`${money(option.customerPriceCents)}.`);   // the text shows the same price
    }
    // The request as typed is first, at the README's price: a relay, 2 x $3.00 + $0.50 + $4.00 - $1.00.
    const [asTyped] = body.options;
    expect(asTyped.changes).toStrictEqual({});
    expect(money(asTyped.customerPriceCents)).toBe(demo.price);
    expect(asTyped).toMatchObject({ kind: 'relay', customerPriceCents: 950 });
    expect(body).toStrictEqual(adviseOffline(advisorEngine(run.store.get(), run.travel, draft)));
    expect(await run.api.savedRun()).toBeNull();   // parse and advise wrote no state file

    // Sent as it is, the delivery gets the plan and the price the advisor showed.
    const sent = await run.api.post<ShipmentResponse>('/shipments', { ...draft, clientRequestId: 'advise-readme-demo' });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.plan).toMatchObject({
      kind: asTyped.kind, relayBusinessId: asTyped.relayBusinessId, deliveryMin: asTyped.deliveryMin,
      customerPriceCents: asTyped.customerPriceCents,
    });
  }, T);

  it('due at 9 a.m. (17 h) it has no discount as typed, and the "later deliver-by" option is ready + 18 h with the discount', async () => {
    const run = await freshRun();
    const { settings } = run.store.get().scenario;
    const draft = await demoDraft(run, NINE_AM_SENTENCE);
    expect(draft.deadlineMin - draft.readyMin).toBe(settings.flexWindowMin - 60);

    const body = await adviseOk(run, draft);

    const priced = expectEnginePrices(run.store.get(), run.travel, draft, body);
    const [asTyped] = priced;
    expect(asTyped.option.changes).toStrictEqual({});
    expect(asTyped.flexible).toBe(false);
    expect(asTyped.option.customerPriceCents).toBe(customerPriceCents(asTyped.plan, draft, { ...settings, flexDiscountCents: 0 }));
    const later = priced.filter((p) => p.option.changes.deadlineMin !== undefined);
    expect(later).toHaveLength(1);
    expect(later[0].option.changes).toStrictEqual({ deadlineMin: draft.readyMin + settings.flexWindowMin });
    expect(later[0].flexible).toBe(true);
    // The same carriers on the same commutes: the only difference is the discount.
    expect(later[0].option.carrierNames).toStrictEqual(asTyped.option.carrierNames);
    expect(asTyped.option.customerPriceCents - later[0].option.customerPriceCents).toBe(settings.flexDiscountCents);
    expect([asTyped.option.customerPriceCents, later[0].option.customerPriceCents]).toStrictEqual([1050, 950]);
  }, T);

  it('on a run whose settings say 19 h, the demo request has no discount as typed and the flexible option is ready + 19 h', async () => {
    const run = await freshRun();
    await run.store.mutate((r) => withFlexWindow(r, 1140));
    const { settings } = run.store.get().scenario;
    const draft = await demoDraft(run, DEMO_SENTENCE);

    const body = await adviseOk(run, draft);

    const priced = expectEnginePrices(run.store.get(), run.travel, draft, body);
    expect(priced[0].option.changes).toStrictEqual({});
    expect(priced[0].flexible).toBe(false);
    expect(priced[0].option.customerPriceCents).toBe(1050);
    const flexible = priced.filter((p) => p.flexible);
    expect(flexible.map((p) => [p.option.changes, p.option.customerPriceCents]))
      .toStrictEqual([[{ deadlineMin: draft.readyMin + settings.flexWindowMin }, 950]]);
    expect(flexible[0].option.label).toBe(`Deliver by ${timeText(draft.readyMin + 1140)}`);
  }, T);
});
