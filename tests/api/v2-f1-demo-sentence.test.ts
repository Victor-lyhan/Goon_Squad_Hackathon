// #798 (docs/mvp4.md F1): the README's demo delivery, typed as ONE SENTENCE, with no Gemini key.
// The demo types the package of the README's ```demo-request block into the Business page's text box. This
// file proves over HTTP that the sentence is parsed offline to a draft with every field of the block, and
// that the draft, once sent, is the delivery the form demo arranges: the same relay point, carriers and price.
// The server is the real one (v2-e2e-nyc-helper.ts: `createV2Runtime` with no Google key and no Gemini
// settings), booted from a temp copy of fixtures/nyc, with `globalThis.fetch` as a recorder: a call that is
// not to the test server (to Gemini, say) fails the test. Nobody signs in: the API is page-agnostic.
// Every test starts a fresh run, because one run arranges the demo request as the block says only once
// (DECISIONS pass 79). The expected businesses, carriers, times and price are read from the README, as in
// v2-readme-demo.test.ts, and found in the run by name, never by ID. Only the sentences are written here:
// they have to name the block's businesses, so the first test fails with the reason when the block changes.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { deliveryDetails } from '../../client/src/components/business/v2/deliveryDetailsModel';
import { draftFromParsed, emptyDraft, toRequest, validate } from '../../client/src/components/business/v2/newDeliveryModel';
import { formatCents, formatMin } from '../../client/src/ui/format';
import type { ShipmentResponse } from '../../shared/v2/api';
import type { ParseDraft, ParseRequestResponse } from '../../shared/v2/parseRequest';
import type { CreateShipmentRequest } from '../../shared/v2/schemas';
import type { Employee, NetworkBusiness } from '../../shared/v2/types';
import {
  copyNycFixtures, DAY_2_MIN, readCity, recordFetch, REPO_ROOT, startNycApi, T, type City, type NycApi,
} from './v2-e2e-nyc-helper';

// ---------- the sentences ----------

/** The sentence to type in the demo, on the Business page of the block's sender. */
const DEMO_SENTENCE = 'Send a 0.5 kg envelope of espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow, ready at 4 p.m.';
/** The same request for a page that is not the sender's: it names the sender too, so nothing is missing. */
const FULL_SENTENCE = 'Send a 0.5 kg envelope of espresso blend samples from Brooklyn Roasting Company to Blue Bottle Coffee by 10 a.m. tomorrow, ready at 4 p.m.';
/** Without the ready time: ready is then the run clock's minute. */
const SHORT_SENTENCE = 'Send a 0.5 kg envelope of espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow';

/** Other ways to say DEMO_SENTENCE. Each must give the same draft; the last two also name the sender. */
const OTHER_WORDINGS: string[] = [
  'Send a 0.5 kg envelope of espresso blend samples to Blue Bottle by 10am tomorrow, ready at 4pm',
  'send a 0.5 kg envelope of espresso blend samples to blue bottle coffee by 10 am tomorrow, ready at 4 pm',
  'Please deliver an envelope with espresso blend samples (0.5 kg) to Blue Bottle by 10am tomorrow. Ready at 4pm.',
  'Send an envelope (0.5 kg) of espresso blend samples to Blue Bottle Coffee tomorrow by 10 a.m.; it is ready for pickup at 4 p.m. today',
  'Envelope of espresso blend samples, 500 g, ready at 16:00, to Blue Bottle by tomorrow at 10',
  'An envelope of espresso blend samples for Blue Bottle Coffee, 0.5 kg, due tomorrow 10 am, pickup at 4 pm',
  'We need a 0.5 kg envelope of espresso blend samples delivered to Blue Bottle Coffee before 10 tomorrow morning. Ready from 4 pm.',
  'Send a 0.5 kg envelope of espresso blend samples to Blue Bottle Coffee in the Financial District by 10:00 AM on Day 2, ready at 4:00 PM',
  'Brooklyn Roasting to Blue Bottle: 0.5kg envelope of espresso blend samples, ready 4pm, deliver by 10am tomorrow',
  'From Brooklyn Roasting Company, a 0.5 kg envelope of espresso blend samples for Blue Bottle Coffee by 10 a.m. tomorrow, ready at 4 p.m. today',
];

// ---------- the README ----------

const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
const block = /```demo-request\n([\s\S]*?)```/.exec(readme)?.[1];
if (!block) throw new Error('README.md has no ```demo-request block');
/** The block's lines as `key: value`. The keys are checked by v2-readme-demo.test.ts. */
const demo: Record<string, string> = Object.fromEntries(
  block.trim().split('\n').map((line) => {
    const colon = line.indexOf(':');
    return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  }),
);
const TYPE_OF: Record<string, 'envelope' | 'small_box'> = { Envelope: 'envelope', 'Small box': 'small_box' };

// ---------- the server ----------

const net = recordFetch();
type Run = {
  api: NycApi; city: City; fixturesDir: string;
  sender: NetworkBusiness; recipient: NetworkBusiness; relayPoint: NetworkBusiness;
  eveningCarrier: Employee; morningCarrier: Employee;
};
let open: Run[] = [];

/** The one entry of the run with this name. A name the run does not have, or has twice, fails. */
function byName<V extends { name: string }>(list: V[], name: string, what: string): V {
  const found = list.filter((entry) => entry.name === name);
  if (found.length !== 1) throw new Error(`README names the ${what} "${name}", and the default run has ${found.length} of them`);
  return found[0];
}

/** A new server on a new copy of fixtures/nyc: the default run, with nothing requested yet. */
async function freshRun(): Promise<Run> {
  const fixturesDir = copyNycFixtures();
  const api = await startNycApi(net, { fixturesDir });
  const run = { api, fixturesDir } as Run;
  open.push(run);
  expect(api.runtime.reason).toBeUndefined();
  expect(api.runtime.status).toBe('ready');
  const city = await readCity(api);
  return Object.assign(run, {
    city,
    sender: byName(city.businesses, demo.sender, 'sender'),
    recipient: byName(city.businesses, demo.recipient, 'recipient'),
    relayPoint: byName(city.businesses, demo.relay_point, 'relay point'),
    eveningCarrier: byName(city.employees, demo.evening_carrier, 'evening carrier'),
    morningCarrier: byName(city.employees, demo.morning_carrier, 'morning carrier'),
  });
}

afterEach(async () => {
  for (const run of open) {
    run.api.expectRepoFilesUntouched();
    await run.api.close();
    fs.rmSync(run.fixturesDir, { recursive: true, force: true });
  }
  open = [];
  net.expectNoOutgoing(); // no key, so nothing was sent to Gemini (or anywhere else)
}, T);
afterAll(() => net.restore());

/** POST /parse-request, which must answer 200 from the offline parser with nothing refused. */
async function parseSentence(run: Run, text: string): Promise<ParseRequestResponse> {
  const version = (await run.api.simulator()).version;
  const res = await run.api.post<ParseRequestResponse>('/parse-request', { text });
  expect(res.status, text).toBe(200);
  expect(res.body.source, text).toBe('offline');
  expect(res.body.rejected, text).toBeNull();
  expect((await run.api.simulator()).version).toBe(version); // a draft only: nothing is stored
  return res.body;
}

/** What DEMO_SENTENCE must give, built from the README block; the sender is not in that sentence. */
function expectDemoDraft(run: Run, draft: ParseDraft, what = DEMO_SENTENCE): void {
  expect(draft.destinationBusinessId, what).toBe(run.recipient.id);
  expect(draft.category, what).toBe(TYPE_OF[demo.type]);
  expect(draft.weightKg, what).toBe(Number(demo.weight_kg));
  expect(formatMin(draft.readyMin ?? Number.NaN), what).toBe(demo.ready);
  expect(formatMin(draft.deadlineMin ?? Number.NaN), what).toBe(demo.deliver_by);
  // The package name and the contents are the sentence's own words: the item word and what it holds.
  expect(draft.label, what).toBe('Envelope');
  expect(draft.description, what).toBe('Espresso blend samples');
}

/** The request the Business page of the sender sends for a draft: the prefilled New delivery form, unchanged. */
function throughTheForm(run: Run, draft: ParseDraft, clientRequestId: string) {
  const prefilled = draftFromParsed(draft, { originId: run.sender.id, businesses: run.city.businesses });
  expect(validate(prefilled.draft, run.sender.id)).toStrictEqual({});
  return { needsInput: prefilled.needsInput, request: toRequest(prefilled.draft, run.sender.id, clientRequestId) };
}

/** The request of the form demo (v2-readme-demo.test.ts): the block typed into the New delivery form. */
function formDemoRequest(run: Run): CreateShipmentRequest {
  return toRequest({
    ...emptyDraft(), recipientId: run.recipient.id, label: demo.package, category: TYPE_OF[demo.type],
    weightKg: demo.weight_kg, description: demo.contents,
  }, run.sender.id, 'form-demo');
}

/** What decides the match: everything of a request but its name, its contents and its ID. */
const matchingFields = ({ originBusinessId, destinationBusinessId, category, weightKg, readyMin, deadlineMin }: CreateShipmentRequest) =>
  ({ originBusinessId, destinationBusinessId, category, weightKg, readyMin, deadlineMin });

/** Sends the request and checks the answer against the block: relay point, carriers in order, price. */
async function expectDemoMatch(run: Run, request: unknown): Promise<ShipmentResponse> {
  const res = await run.api.post<ShipmentResponse>('/shipments', request);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const created = res.body;
  expect(created.unmatchedReason).toBeNull();
  expect(created.matched).toBe(true);
  expect(created.status).toBe('scheduled');
  const plan = created.plan;
  if (!plan) throw new Error('a matched delivery has a plan');

  expect(plan.kind).toBe('relay');
  expect(plan.relayBusinessId).toBe(run.relayPoint.id);
  expect(plan.legs.map((leg) => leg.employeeId)).toStrictEqual([run.eveningCarrier.id, run.morningCarrier.id]);
  expect(formatCents(plan.customerPriceCents)).toBe(demo.price);
  expect(plan.legs.map((leg) => leg.stops.map((stop) => `${stop.kind} ${stop.placeId}`))).toStrictEqual([
    [`pickup ${run.sender.id}`, `hub_drop ${run.relayPoint.id}`],
    [`hub_pickup ${run.relayPoint.id}`, `delivery ${run.recipient.id}`],
  ]);
  // Dropped on Day 1, collected on Day 2, delivered by the deadline of the sentence.
  expect(plan.legs[0].finishMin).toBeLessThan(DAY_2_MIN);
  expect(plan.legs[1].stops[0].serviceStartMin).toBeGreaterThanOrEqual(DAY_2_MIN);
  expect(plan.deliveryMin).toBeLessThanOrEqual(created.shipment.deadlineMin);

  // The delivery details of the sender, in the words of README step 3.
  const card = deliveryDetails(created, {
    businesses: run.city.businesses, employees: run.city.employees, viewerBusinessId: run.sender.id,
  });
  expect(card.result).toMatchObject({
    kind: 'matched', title: 'Delivery arranged', planText: `Relay via ${demo.relay_point} (relay point)`, priceText: demo.price,
  });
  expect(card.legs.map((leg) => leg.carrierName)).toStrictEqual([demo.evening_carrier, demo.morning_carrier]);
  return created;
}

describe('F1: the README demo delivery from one sentence, parsed offline', () => {
  it('the block is the one these sentences were written for', () => {
    // The sentences name the recipient and say the type, the weight and the two times of the block.
    expect(DEMO_SENTENCE).toContain(`to ${demo.recipient} `);
    expect(FULL_SENTENCE).toContain(`from ${demo.sender} to ${demo.recipient} `);
    expect(DEMO_SENTENCE).toContain(`${demo.weight_kg} kg ${demo.type.toLowerCase()} `);
    expect(demo.ready).toBe('Day 1, 4:00 PM');      // "ready at 4 p.m."
    expect(demo.deliver_by).toBe('Day 2, 10:00 AM'); // "by 10 a.m. tomorrow"
    expect(new Set([DEMO_SENTENCE, FULL_SENTENCE, SHORT_SENTENCE, ...OTHER_WORDINGS]).size).toBe(OTHER_WORDINGS.length + 3);
  });

  it('the demo sentence gives a draft with every field of the block; only the sender, which it does not name, is missing', async () => {
    const run = await freshRun();
    const { draft, missing } = await parseSentence(run, DEMO_SENTENCE);

    expectDemoDraft(run, draft);
    expect(draft.originBusinessId).toBeNull();
    expect(missing).toStrictEqual(['originBusinessId']);
    // The exact draft, so a change of the parser shows here first.
    expect(draft).toStrictEqual({
      originBusinessId: null, destinationBusinessId: run.recipient.id, label: 'Envelope', category: 'envelope',
      description: 'Espresso blend samples', weightKg: 0.5, readyMin: 960, deadlineMin: 2040,
    });
  }, T);

  it('sent from the sender\'s Business page with nothing filled in by hand, it is the relay the block names', async () => {
    const run = await freshRun();
    const { draft } = await parseSentence(run, DEMO_SENTENCE);

    // The page sends as the signed-in business (DECISIONS pass 81) through the prefilled New delivery form:
    // no field is left to fill or check.
    const { needsInput, request } = throughTheForm(run, draft, 'f1-demo-sentence');
    expect(needsInput).toStrictEqual([]);
    expect(request).toStrictEqual({
      ...draft, originBusinessId: run.sender.id, clientRequestId: 'f1-demo-sentence', pickupInstructions: '', dropoffInstructions: '',
    });
    // It is the form demo's request in everything that decides the match.
    expect(matchingFields(request)).toStrictEqual(matchingFields(formDemoRequest(run)));

    const created = await expectDemoMatch(run, request);
    expect(created.shipment).toMatchObject({
      originBusinessId: run.sender.id, destinationBusinessId: run.recipient.id, label: 'Envelope', category: 'envelope',
      description: 'Espresso blend samples', weightGrams: 500, readyMin: 960, deadlineMin: 2040,
    });
  }, T);

  it('with the sender in the sentence nothing is missing, and the draft itself is the request', async () => {
    const run = await freshRun();
    const { draft, missing } = await parseSentence(run, FULL_SENTENCE);

    expect(missing).toStrictEqual([]);
    expect(draft.originBusinessId).toBe(run.sender.id);
    expectDemoDraft(run, draft, FULL_SENTENCE);

    await expectDemoMatch(run, { ...draft, clientRequestId: 'f1-demo-sentence-full' });
  }, T);

  it('without "ready at 4 p.m." the package is ready at the clock\'s minute, and the match is the same', async () => {
    const run = await freshRun();
    const clock = (await run.api.simulator()).clock.timeMin;
    expect(clock).toBe(run.city.settings.simStartMin);
    const { draft, missing } = await parseSentence(run, SHORT_SENTENCE);

    expect(missing).toStrictEqual(['originBusinessId']);
    expect(draft.readyMin).toBe(clock);
    const said = (await parseSentence(run, DEMO_SENTENCE)).draft;
    expect(draft).toStrictEqual({ ...said, readyMin: clock });

    const { needsInput, request } = throughTheForm(run, draft, 'f1-demo-sentence-short');
    expect(needsInput).toStrictEqual([]);
    await expectDemoMatch(run, request);
  }, T);

  it.each(OTHER_WORDINGS)('another wording gives the same draft: "%s"', async (text) => {
    const run = await freshRun();
    const said = await parseSentence(run, DEMO_SENTENCE);
    const { draft, missing } = await parseSentence(run, text);

    // A wording that names the sender fills it in; everything else is the demo sentence's draft.
    expect([null, run.sender.id]).toContain(draft.originBusinessId);
    expect(missing).toStrictEqual(draft.originBusinessId === null ? ['originBusinessId'] : []);
    expect({ ...draft, originBusinessId: null }).toStrictEqual(said.draft);
    // So the page sends the same request for it.
    expect(throughTheForm(run, draft, 'same')).toStrictEqual(throughTheForm(run, said.draft, 'same'));
  }, T);

  it('the wordings that name the sender do fill it in', async () => {
    const run = await freshRun();
    const origins = [];
    for (const text of OTHER_WORDINGS) origins.push((await parseSentence(run, text)).draft.originBusinessId);
    expect(origins).toStrictEqual([...Array(OTHER_WORDINGS.length - 2).fill(null), run.sender.id, run.sender.id]);
  }, T);

  it('a sentence that leaves a field out lists it as missing, and the form keeps its default there', async () => {
    const run = await freshRun();
    const { draft, missing } = await parseSentence(run, 'Send an envelope of espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow, ready at 4 p.m.');

    expect(missing).toStrictEqual(['originBusinessId', 'weightKg']);
    expect(draft.weightKg).toBeNull();
    // The form marks the weight "Check this" and holds its default, which is the block's weight.
    const { needsInput, request } = throughTheForm(run, draft, 'f1-demo-sentence-no-weight');
    expect(needsInput).toStrictEqual(['weightKg']);
    expect(matchingFields(request)).toStrictEqual(matchingFields(formDemoRequest(run)));
  }, T);
});
