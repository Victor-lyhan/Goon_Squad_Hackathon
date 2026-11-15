// #867: POST /api/v2/advise on the README's demo sentence, offline (no GEMINI_API_KEY), on the real NYC run.
// Every option's price must be the engine's per-plan price (#861): `customerPriceCents()` of the engine's
// candidate plan the option names by id (#959), with the $1.00 flexibility discount exactly when the option's
// window is at least `settings.flexWindowMin` (18 h). The advisor adds no number of its own. #959: the options
// are the fastest, the cheapest and the balanced plan of the request as typed.
// The server is the real one (v2-e2e-nyc-helper.ts: `createV2Runtime` with no Google key and no Gemini
// settings) on a temp copy of fixtures/nyc, with `globalThis.fetch` as a recorder: a call that is not to the
// test server (to Gemini, say) fails the test. The sender, the recipient and the price are read from the
// README's ```demo-request block and found in the run by name; no carrier and no run ID is written here.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { adviseOffline, candidateSet, money, timeText } from '../../server/ai/advisor';
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
// #877: the README's sentences about these answers. A numbered step of the 2-minute demo, and the example
// under "Options for a request" (#959: the fastest, the cheapest and the balanced plan).
const demoStart = readme.indexOf('\n## 2-minute demo\n');
const demoSection = demoStart === -1 ? '' : readme.slice(demoStart, readme.indexOf('\n## ', demoStart + 1));
const step = (n: number) => demoSection.split('\n').find((line) => line.startsWith(`${n}. `)) ?? '';
const optionsExample = readme.split('\n').find((line) => line.startsWith('An example on a fresh run with no key')) ?? '';

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

/** What the card shows of an option and what tells two plans apart: tags, kind, carriers, arrival. */
const shape = (body: AdviseResponse) => body.options.map((o) => [o.tags, o.kind, o.carrierNames, o.deliveryMin, o.changes]);

describe('POST /api/v2/advise on the README demo sentence, offline: the prices are the engine\'s (#867, #959)', () => {
  it('every option\'s price equals customerPriceCents() of its plan; the fastest-and-cheapest and the balanced plan, both with the $1.00 discount', async () => {
    const run = await freshRun();
    const { settings } = run.store.get().scenario;
    // Pricing per plan (#861), as the README's Pricing table has it.
    expect(settings).toMatchObject({ legRewardCents: 300, hubCostCents: 50, platformFeeCents: 400, flexDiscountCents: 100, flexWindowMin: 1080 });
    const draft = await demoDraft(run, DEMO_SENTENCE);
    expect(timeText(draft.deadlineMin)).toBe(demo.deliver_by);   // "Day 2, 10:00 AM"
    expect(draft.deadlineMin - draft.readyMin).toBe(settings.flexWindowMin);   // 18 h: exactly the window

    const body = await adviseOk(run, draft);

    // #954: no direct plan as typed, and the note says why next to the relays.
    expect(body.note).toBe('No direct: a direct trip would be a longer detour than its carrier allows.');
    const priced = expectEnginePrices(run.store.get(), run.travel, draft, body);
    // Every option is the request as typed, which leaves exactly 18 h, so every one shows the discount: its
    // price is $1.00 under the same plan's price without it.
    for (const { option, plan, readyMin, deadlineMin, flexible } of priced) {
      expect(option.changes, option.label).toStrictEqual({});
      expect(flexible, option.label).toBe(true);
      expect(deadlineMin - readyMin).toBe(settings.flexWindowMin);
      const withoutDiscount = customerPriceCents(plan, { readyMin, deadlineMin }, { ...settings, flexDiscountCents: 0 });
      expect(withoutDiscount - option.customerPriceCents, option.label).toBe(100);
      expect(option.summary, option.label).toContain(`${money(option.customerPriceCents)}.`);   // the text shows the same price
    }
    // #959: every candidate is a relay at the README's price (2 x $3.00 + $0.50 + $4.00 - $1.00), so one plan is
    // both the fastest and the cheapest, and the third slot is the balanced plan of the rest.
    const { candidates } = candidateSet(advisorEngine(run.store.get(), run.travel, draft));
    expect(new Set(candidates.map((c) => c.option.customerPriceCents))).toStrictEqual(new Set([950]));
    expect(body.options.map((o) => [o.tags, o.kind, money(o.customerPriceCents)])).toStrictEqual([
      [['fastest', 'cheapest'], 'relay', demo.price], [['balanced'], 'relay', demo.price],
    ]);
    const [fastest, balanced] = body.options;
    expect(fastest.deliveryMin).toBe(Math.min(...candidates.map((c) => c.option.deliveryMin)));
    expect([fastest.label, balanced.label]).toStrictEqual([`Fastest and cheapest: Relay via Etsy, ${demo.price}`, `Balanced: Relay via Etsy, ${demo.price}`]);
    expect(body).toStrictEqual(adviseOffline(advisorEngine(run.store.get(), run.travel, draft)));

    // README step 2 and the example under "Options for a request" quote this answer.
    expect(readme).toContain(`\n${DEMO_SENTENCE}\n`);
    expect(step(2)).toContain(
      `for this sentence it has two options, "${fastest.label}" and "${balanced.label}", the first marked "In the form", with a note on why there is no direct one,`,
    );
    const carried = (o: typeof fastest) => o.carrierNames.join(' and ');
    expect(optionsExample).toContain(
      `so the card shows "${fastest.label}" (${carried(fastest)}, arriving ${timeText(fastest.deliveryMin)}) `
      + `and "${balanced.label}" (${carried(balanced)}, ${timeText(balanced.deliveryMin)}), with the note on why there is no direct one.`,
    );
    // README step 3: why the price is what it is, written from the run's own settings and the block's times.
    const withoutDiscount = 2 * settings.legRewardCents + settings.hubCostCents + settings.platformFeeCents;
    expect(step(3)).toContain(
      `The price is a relay's ${money(withoutDiscount)} less the ${money(settings.flexDiscountCents)} flexibility discount: the sentence leaves exactly `
      + `${settings.flexWindowMin / 60} hours between ready (${demo.ready}) and deliver-by (${demo.deliver_by}), `
      + 'the shortest window that counts as flexible ([Pricing](#pricing)).',
    );
    expect(await run.api.savedRun()).toBeNull();   // parse and advise wrote no state file

    // Sent as it is, the delivery gets the matcher's first plan (p1), which here is the balanced option: the
    // block's carriers, arrival and price ("Find a delivery match gets the matcher's own first plan, here the balanced one").
    expect(balanced.id).toBe('p1');
    expect(balanced.carrierNames).toStrictEqual([demo.evening_carrier, demo.morning_carrier]);
    expect(optionsExample).toContain('**Find a delivery match** gets the matcher\'s own first plan, here the balanced one.');
    const sent = await run.api.post<ShipmentResponse>('/shipments', { ...draft, clientRequestId: 'advise-readme-demo' });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.plan).toMatchObject({
      kind: balanced.kind, relayBusinessId: balanced.relayBusinessId, deliveryMin: balanced.deliveryMin,
      customerPriceCents: balanced.customerPriceCents,
    });
  }, T);

  it('due at 9 a.m. (17 h) the same two options have no discount: each costs customerPriceCents() without it', async () => {
    const tenAmRun = await freshRun();
    const tenAm = await adviseOk(tenAmRun, await demoDraft(tenAmRun, DEMO_SENTENCE));
    const run = await freshRun();
    const { settings } = run.store.get().scenario;
    const draft = await demoDraft(run, NINE_AM_SENTENCE);
    expect(draft.deadlineMin - draft.readyMin).toBe(settings.flexWindowMin - 60);

    const body = await adviseOk(run, draft);

    // The same plans as for 10 a.m. (one more hour changes no commute), each $1.00 dearer.
    expect(shape(body)).toStrictEqual(shape(tenAm));
    const priced = expectEnginePrices(run.store.get(), run.travel, draft, body);
    for (const { option, plan, flexible } of priced) {
      expect(flexible, option.label).toBe(false);
      expect(option.customerPriceCents, option.label).toBe(customerPriceCents(plan, draft, { ...settings, flexDiscountCents: 0 }));
      expect(option.customerPriceCents, option.label).toBe(1050);
    }
    // #959: the request as typed has plans, so no what-if is tried: no option moves a time.
    expect(body.options.every((o) => Object.keys(o.changes).length === 0)).toBe(true);
    expect(optionsExample).toContain(
      `With "by 9 a.m." in place of "by 10 a.m." the sentence leaves ${(draft.deadlineMin - draft.readyMin) / 60} hours, `
      + `one short of the flexibility discount, and the same two options cost ${money(body.options[0].customerPriceCents)}.`,
    );
    expect(optionsExample).toContain('`tests/api/v2-advise-readme-demo.test.ts` sends both sentences');
  }, T);

  it('on a run whose settings say 19 h, the demo request (18 h) has no discount on any option', async () => {
    const run = await freshRun();
    await run.store.mutate((r) => withFlexWindow(r, 1140));
    const { settings } = run.store.get().scenario;
    const draft = await demoDraft(run, DEMO_SENTENCE);
    expect(draft.deadlineMin - draft.readyMin).toBeLessThan(settings.flexWindowMin);

    const body = await adviseOk(run, draft);

    expect(body.options.length).toBeGreaterThan(0);
    const priced = expectEnginePrices(run.store.get(), run.travel, draft, body);
    expect(priced.map((p) => [p.option.changes, p.flexible, p.option.customerPriceCents]))
      .toStrictEqual(priced.map(() => [{}, false, 1050]));
  }, T);
});
