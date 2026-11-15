// #878: the API half of the demo walk after the freeze, so a later PR cannot silently break the path.
// The walk itself was done in headless Chrome at 1440 px and 390 px against `npm run build && npm start`
// with a fresh RELAY_STATE_PATH, no Gemini key and no Maps browser key (the PR body has one row per step and
// width). It replaces the PR #857 walk (tests/ui/demo-walk-mvp4.test.ts), which predates per-plan pricing
// (#861) and the advisor's Options card (#862, #863). This file replays what the Business page sent to the
// server in that walk, in the same order, on ONE server:
//
//   1. the README demo sentence -> "Read my request"            POST /api/v2/parse-request (offline)
//   2. the Options card above the filled form                    POST /api/v2/advise (offline)
//      -> the first row is the request as typed, "In the form", $9.50 (950 cents)
//   3. "Find a delivery match" with that option's times          POST /api/v2/shipments
//      -> the delivery has the plan and the price the card showed
//   4. the new delivery is in the simulator answer, in the sender's Shipments table and on the evening
//      carrier's Employee page
//
// The server is the real one of tests/ui/demo-rehearse-twice-helper.ts (PR #818): `createV2Runtime` on a temp
// copy of fixtures/nyc with a temp state file and no Google or Gemini key, listening on 127.0.0.1 only. The
// requests go through client/src/api, and the page's own models decide what is sent and what is shown: the
// draft the form opens with (newDeliveryModel, requestTextModel), the draft the card asks options for and
// its rows (adviceModel), and the request the form sends.
//
// Not in this file, because other tests pin them: the journey of the new delivery and Elena Rossi's
// "Leave work" / "Arrive home" ticks while it plays (tests/ui/demo-walk-mvp4.test.ts, steps 3 and 4), that
// every /advise price is the engine's (tests/api/v2-advise-readme-demo.test.ts), and `/study.html`
// (tests/api/production-mvp4.test.ts).
//
// Written here are the sentence and the price the issue names (950 cents). Every name is read from the
// README's ```demo-request block and found in the run.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AdviseResponse, ShipmentResponse, SimulatorResponse } from '../../shared/v2/api';
import type { ParseRequestResponse } from '../../shared/v2/parseRequest';
import type { Employee, NetworkBusiness } from '../../shared/v2/types';
import {
  advise, createShipment, getBusinessDashboard, getBusinesses, getEmployeeDashboard, getEmployees, getSimulator,
  parseRequest,
} from '../../client/src/api/v2';
import {
  ADVICE_COPY, MAX_OPTIONS, adviceCard, adviseDraft, chosenKey, type AdviceCard, type AdviseDraft,
} from '../../client/src/components/business/v2/adviceModel';
import {
  draftFromParsed, toRequest, validate, type NewDeliveryDraft,
} from '../../client/src/components/business/v2/newDeliveryModel';
import { parsedFields } from '../../client/src/components/business/v2/requestTextModel';
import { formatCents } from '../../client/src/ui/format';
import { nycFilesState } from '../api/v2-e2e-nyc-helper';
import { T, byName, readmeDemo, startRehearsalApi, type RehearsalApi } from './demo-rehearse-twice-helper';

vi.setConfig({ testTimeout: T, hookTimeout: T });

/** The sentence of the demo (README "2-minute demo"), typed on the Business page of the README's sender. */
const SENTENCE = 'Send a 0.5 kg envelope of espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow, ready at 4 p.m.';
/**
 * The demo price (DECISIONS pass 102): a relay, 2 x $3.00 carrier pay + $0.50 relay fee + $4.00 platform fee,
 * less the $1.00 flexibility discount (ready 4 p.m., due 10 a.m. the next day: exactly the 18-hour window).
 */
const PRICE_CENTS = 950;

const demo = readmeDemo();

let api: RehearsalApi;
let nycBefore: string[];
let businesses: NetworkBusiness[];
let employees: Employee[];
let sender: NetworkBusiness;
let recipient: NetworkBusiness;
/** The run before anything was sent. */
let fresh: SimulatorResponse;
/** Each step's answer, for the steps after it. */
let parsed: ParseRequestResponse;
/** The form as "Read my request" opens it, and the draft the Options card asks for. */
let form: NewDeliveryDraft;
let asked: AdviseDraft;
let advice: AdviseResponse;
let card: AdviceCard;
let arranged: ShipmentResponse;

const businessName = (id: string | undefined) => businesses.find((b) => b.id === id)?.name;
const employeeName = (id: string) => employees.find((e) => e.id === id)?.name;
/** `METHOD /path` of every write since `from`: what a step changed on the server. */
const writesSince = (from: number) => api.log.slice(from).filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`);

beforeAll(async () => {
  nycBefore = nycFilesState();
  api = await startRehearsalApi();
  businesses = (await getBusinesses()).businesses;
  employees = (await getEmployees()).employees;
  sender = byName(businesses, demo.sender, 'sender');
  recipient = byName(businesses, demo.recipient, 'recipient');
  fresh = await getSimulator();
});
afterAll(async () => {
  const { outgoing, googleCalls } = api;
  await api.close();
  expect(outgoing).toStrictEqual([]);     // nothing left the test server
  expect(googleCalls).toStrictEqual([]);  // no Google call and no Gemini call: there is no key
  expect(nycFilesState()).toStrictEqual(nycBefore); // nothing was written to the committed fixtures/nyc
});

describe('the demo walk after the freeze, over the API on one server with no key (#878)', () => {
  it('starts on a fresh run: planning, paused, the README sender has sent nothing, and the README names the demo price', () => {
    expect(fresh.clock.phase).toBe('planning');
    expect(fresh.clock.playing).toBe(false);
    expect(fresh.unmatched).toStrictEqual([]);
    expect(fresh.shipments.filter((s) => s.originBusinessId === sender.id)).toStrictEqual([]);
    expect(demo.price).toBe(formatCents(PRICE_CENTS));
    expect(SENTENCE).toContain(demo.recipient);
  });

  it('1. Read my request: the sentence is parsed offline to a complete draft, and nothing is stored', async () => {
    const from = api.log.length;
    parsed = await parseRequest(SENTENCE);

    expect(parsed.source).toBe('offline');
    expect(parsed.rejected).toBeNull();
    // The sender is not in the sentence: a request is sent from the business whose page it is typed on.
    expect(parsed.missing).toStrictEqual(['originBusinessId']);
    expect(parsed.draft).toMatchObject({
      destinationBusinessId: recipient.id, label: demo.package, description: demo.contents,
      weightKg: Number(demo.weight_kg),
      readyMin: 16 * 60,            // "ready at 4 p.m.": Day 1, 4:00 PM
      deadlineMin: 1440 + 10 * 60,  // "by 10 a.m. tomorrow": Day 2, 10:00 AM
    });

    // The card to check: the New delivery form filled from the draft, with nothing left to fill in.
    const opened = draftFromParsed(parsedFields(parsed), { originId: sender.id, businesses });
    expect(opened.needsInput).toStrictEqual([]);
    expect(validate(opened.draft, sender.id)).toStrictEqual({});
    form = opened.draft;

    expect(writesSince(from)).toStrictEqual(['POST /api/v2/parse-request']);
    const after = await getSimulator();
    expect(after.version).toBe(fresh.version);
    expect(after.shipments.map((s) => s.id)).toStrictEqual(fresh.shipments.map((s) => s.id));
  });

  it(`2. the Options card: computed offline, and its first row is the request as typed, in the form, at ${formatCents(PRICE_CENTS)}`, async () => {
    // What the page asks options for: the form's own draft, with the page's business as the sender.
    const draft = adviseDraft(form, sender.id);
    expect(draft).not.toBeNull();
    asked = draft!;
    expect(asked).toMatchObject({
      originBusinessId: sender.id, destinationBusinessId: recipient.id,
      readyMin: parsed.draft.readyMin, deadlineMin: parsed.draft.deadlineMin,
    });

    const from = api.log.length;
    advice = await advise(asked);
    expect(writesSince(from)).toStrictEqual(['POST /api/v2/advise']);

    expect(advice.source).toBe('offline');
    expect(advice.options.length).toBeGreaterThanOrEqual(1);
    expect(advice.options.length).toBeLessThanOrEqual(MAX_OPTIONS);
    const [asTyped] = advice.options;
    expect(asTyped.changes).toStrictEqual({});
    expect(asTyped.customerPriceCents).toBe(PRICE_CENTS);
    expect(asTyped.kind).toBe('relay');
    expect(businessName(asTyped.relayBusinessId)).toBe(demo.relay_point);
    expect(asTyped.carrierNames).toStrictEqual([demo.evening_carrier, demo.morning_carrier]);
    expect(asTyped.deliveryMin).toBeLessThanOrEqual(asked.deadlineMin);

    // The card as the page draws it: every option is a row, the first one holds the form's times ("In the
    // form") and shows the README's price; the label says nobody but the server computed it.
    const drawn = adviceCard(advice, { draft: asked, businesses });
    expect(drawn).not.toBeNull();
    card = drawn!;
    expect(card.sourceLabel).toBe(ADVICE_COPY.offline);
    expect(card.rows).toHaveLength(advice.options.length);
    expect(card.rows[0]).toMatchObject({
      priceText: demo.price, routeText: `Via ${demo.relay_point}`,
      carriersText: `${demo.evening_carrier}, ${demo.morning_carrier}`,
      times: { readyTime: form.readyTime, deadlineDay: form.deadlineDay, deadlineTime: form.deadlineTime },
    });
    expect(chosenKey(card, form)).toBe(card.rows[0].key);
    // No row is cheaper than the request as typed: it already has the flexibility discount.
    expect(card.rows.filter((r) => r.cheapest && r.key !== card.rows[0].key)).toStrictEqual([]);

    // Options are read-only: the run is as it was, and nothing is reserved.
    const after = await getSimulator();
    expect(after.version).toBe(fresh.version);
    expect(after.shipments.map((s) => s.id)).toStrictEqual(fresh.shipments.map((s) => s.id));
    expect(after.plans).toStrictEqual(fresh.plans);
  });

  it('3. Find a delivery match: the delivery made from that option has the plan and the price the card showed', async () => {
    // "Choose this option" puts the row's times in the form (here they are the form's own), then the form sends.
    const sent = { ...form, ...card.rows[0].times };
    expect(sent).toStrictEqual(form);
    expect(validate(sent, sender.id)).toStrictEqual({});

    const from = api.log.length;
    arranged = await createShipment(toRequest(sent, sender.id, 'demo-walk-postfreeze'));
    expect(writesSince(from)).toStrictEqual(['POST /api/v2/shipments']);

    expect(arranged.matched).toBe(true);
    expect(arranged.unmatchedReason).toBeNull();
    expect(arranged.status).toBe('scheduled');
    expect(arranged.shipment).toMatchObject({
      originBusinessId: sender.id, destinationBusinessId: recipient.id, label: demo.package, description: demo.contents,
      weightGrams: 500, readyMin: asked.readyMin, deadlineMin: asked.deadlineMin,
    });

    const [asTyped] = advice.options;
    const plan = arranged.plan!;
    expect(plan.customerPriceCents).toBe(PRICE_CENTS);
    expect(plan.customerPriceCents).toBe(asTyped.customerPriceCents);
    expect(plan).toMatchObject({ kind: asTyped.kind, relayBusinessId: asTyped.relayBusinessId, deliveryMin: asTyped.deliveryMin });
    expect(plan.legs.map((leg) => employeeName(leg.employeeId))).toStrictEqual(asTyped.carrierNames);
    expect(arranged.jobIds).toHaveLength(plan.legs.length);
  });

  it('4. the new delivery is in the simulator answer, in the sender\'s Shipments table and on the evening carrier\'s page', async () => {
    const id = arranged.shipment.id;

    // The simulator: one more delivery than before, with the same plan and price, scheduled; nothing unmatched.
    const sim = await getSimulator();
    expect(sim.clock).toMatchObject({ phase: 'planning', playing: false, timeMin: fresh.clock.timeMin });
    expect(sim.shipments.map((s) => s.id)).toStrictEqual([...fresh.shipments.map((s) => s.id), id]);
    expect(sim.shipments.find((s) => s.id === id)).toStrictEqual(arranged.shipment);
    const plan = sim.plans.find((p) => p.shipmentId === id);
    expect(plan).toStrictEqual(arranged.plan);
    expect(plan!.customerPriceCents).toBe(PRICE_CENTS);
    expect(sim.snapshot.shipmentStatus[id]).toBe('scheduled');
    expect(sim.unmatched).toStrictEqual([]);
    // The deliveries that were there keep their plans.
    expect(sim.plans.filter((p) => p.shipmentId !== id)).toStrictEqual(fresh.plans);

    // The sender's Business page: the row, and the spend is this one price.
    const sending = await getBusinessDashboard(sender.id);
    const row = sending.outgoing.filter((v) => v.shipment.id === id);
    expect(row).toHaveLength(1);
    expect(row[0].plan?.customerPriceCents).toBe(PRICE_CENTS);
    expect(row[0].status).toBe('scheduled');
    expect(sending.totals).toMatchObject({ sent: 1, matched: 1, delivered: 0, spendCents: PRICE_CENTS });
    // The recipient's page lists it as incoming.
    const receiving = await getBusinessDashboard(recipient.id);
    expect(receiving.incoming.map((v) => v.shipment.id)).toContain(id);

    // The evening carrier's Employee page has the job at once, not started.
    const evening = byName(employees, demo.evening_carrier, 'evening carrier');
    const dashboard = await getEmployeeDashboard(evening.id);
    const jobs = dashboard.assigned.filter((j) => j.shipment.id === id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: 'assigned', departed: false, stopsDone: 0, arrived: false });
    expect(dashboard.completed.filter((j) => j.shipment.id === id)).toStrictEqual([]);

    // Asked again, the card no longer offers the commutes this delivery took: the option of step 2 is gone
    // or has other carriers (one run arranges the README request as written once, DECISIONS pass 79).
    const again = await advise(asked);
    expect(again.source).toBe('offline');
    for (const option of again.options) expect(option.carrierNames).not.toStrictEqual(advice.options[0].carrierNames);
  });
});
