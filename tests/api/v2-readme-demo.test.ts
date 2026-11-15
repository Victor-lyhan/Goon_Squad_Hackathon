// #569: the README's 2-minute demo, proven over HTTP (DECISIONS pass 59).
// The ```demo-request block of README.md is the single source of the live demo request. This file reads
// it, sends it the way the New delivery form does, and follows the six demo steps on the default run.
// The server is the real one with no key (v2-e2e-nyc-helper.ts), booted from a temp copy of fixtures/nyc
// (pass 56), with `globalThis.fetch` as a recorder: a call that is not to the test server fails the test.
// With the story test this is the only test that may pin a story name (pass 54): every name, URL and
// price asserted here is read from the README, so a story retune changes the README and nothing in here.
// The tests run in order on one server; each continues from the state the one before left.
// #703: the README's 30-second demo ("Watch a package") runs first on the same server, so the 2-minute
// demo is proven to work after it without a reset.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { deliveryDetails } from '../../client/src/components/business/v2/deliveryDetailsModel';
import { emptyDraft, RESULT_COPY, toRequest, validate } from '../../client/src/components/business/v2/newDeliveryModel';
import { dayNightAt } from '../../client/src/components/map/dayNight';
import { PLAY_LABEL } from '../../client/src/components/sim/v2/compose/journeyPlay';
import { WATCH_PACKAGE_LABEL, watchPackageHref, watchPackageId } from '../../client/src/pages/landingModel';
import { formatCents, formatMin } from '../../client/src/ui/format';
import type { BusinessDashboard, EmployeeDashboard, ShipmentResponse, SimulatorResponse } from '../../shared/v2/api';
import type { DeliveryPlan, Employee, NetworkBusiness } from '../../shared/v2/types';
import { jobIdFor } from '../../shared/v2/types';
import {
  copyNycFixtures, DAY_2_MIN, nycFilesState, readCity, recordFetch, REPO_ROOT, startNycApi, T,
  type City, type NycApi,
} from './v2-e2e-nyc-helper';

// ---------- the README ----------

const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');

const FIELDS = [
  'employee', 'employee_url', 'sender', 'sender_url', 'recipient', 'recipient_url', 'package', 'type', 'weight_kg',
  'contents', 'ready', 'deliver_by', 'relay_point', 'evening_carrier', 'morning_carrier', 'price',
] as const;
type Demo = Record<(typeof FIELDS)[number], string>;

const block = /```demo-request\n([\s\S]*?)```/.exec(readme)?.[1];
if (!block) throw new Error('README.md has no ```demo-request block');
const demo = Object.fromEntries(
  block.trim().split('\n').map((line) => {
    const colon = line.indexOf(':');
    return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  }),
) as Demo;

/** The "2-minute demo" section, and its numbered steps as one string each. */
const demoStart = readme.indexOf('\n## 2-minute demo\n');
const demoEnd = readme.indexOf('\n## ', demoStart + 1);
const demoSection = demoStart === -1 ? '' : readme.slice(demoStart, demoEnd === -1 ? undefined : demoEnd);
const steps = demoSection.split('\n').filter((line) => /^\d+\. /.test(line));
/** The "30-second demo" section (#703), up to the next `## ` heading. */
const watchStart = readme.indexOf('\n## 30-second demo\n');
const watchSection = watchStart === -1 ? '' : readme.slice(watchStart, readme.indexOf('\n## ', watchStart + 1));
const step = (n: number) => steps[n - 1] ?? '';

const source = (file: string) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
const TYPE_OF: Record<string, 'envelope' | 'small_box'> = { Envelope: 'envelope', 'Small box': 'small_box' };

// ---------- the server ----------

const net = recordFetch();
let fixturesDir = '';
let api: NycApi;
let city: City;

let sender: NetworkBusiness;
let recipient: NetworkBusiness;
let relayPoint: NetworkBusiness;
let employee: Employee;
let eveningCarrier: Employee;
let morningCarrier: Employee;
/** The named employee's job IDs before the request (step 1). */
let jobsBefore: string[] = [];
/** The delivery of steps 2 and 3. */
let created: ShipmentResponse;

beforeAll(async () => {
  fixturesDir = copyNycFixtures();
  api = await startNycApi(net, { fixturesDir });
  if (api.runtime.status === 'ready') city = await readCity(api);
}, T);
afterEach(() => net.expectNoOutgoing());
afterAll(async () => {
  await api?.close();
  net.restore();
  if (fixturesDir) fs.rmSync(fixturesDir, { recursive: true, force: true });
}, T);

/** The one entry of the default run with this name. A name the run does not have, or has twice, fails. */
function byName<V extends { name: string }>(list: V[], name: string, what: string): V {
  const found = list.filter((entry) => entry.name === name);
  if (found.length !== 1) throw new Error(`README names the ${what} "${name}", and the default run has ${found.length} of them`);
  return found[0];
}

const ok = async <B>(url: string): Promise<B> => {
  const res = await api.get<B>(url);
  expect(`${url} ${res.status}`).toBe(`${url} 200`);
  return res.body;
};
const employeeDashboard = (id: string) => ok<EmployeeDashboard>(`/employees/${id}/dashboard`);
const businessDashboard = (id: string) => ok<BusinessDashboard>(`/businesses/${id}/dashboard`);
const plan = () => created.plan as DeliveryPlan;
/** The delivery as a business sees it in its dashboard. */
const inDashboard = async (businessId: string, list: 'outgoing' | 'incoming') =>
  (await businessDashboard(businessId))[list].find((view) => view.shipment.id === created.shipment.id);

describe('README demo request on the default NYC run, no key', () => {
  it('the block has exactly the fields this test reads, and six numbered steps follow it', () => {
    expect(Object.keys(demo)).toStrictEqual([...FIELDS]);
    for (const field of FIELDS) expect(demo[field], field).not.toBe('');
    expect(demoSection.indexOf('```demo-request')).toBeGreaterThan(0);
    expect(steps).toHaveLength(6); // SPEC "The 2-minute demo"
    expect(demoSection.indexOf(steps[0])).toBeGreaterThan(demoSection.indexOf('```demo-request'));
    expect(demoSection).toContain('tests/api/v2-readme-demo.test.ts');
  });

  it('the server is loaded from the copy of fixtures/nyc, with the counts the README gives', async () => {
    expect(api.runtime.reason).toBeUndefined();
    expect(api.runtime.status).toBe('ready');
    const sim = await api.simulator();
    expect(sim.clock).toMatchObject({ phase: 'planning', playing: false });
    const counts = /The default run has (\d+) businesses, (\d+) employees and (\d+) packages\./.exec(readme);
    expect(counts?.slice(1).map(Number)).toStrictEqual([city.businesses.length, city.employees.length, sim.shipments.length]);
  }, T);

  it('every business, employee and URL the README names exists in the default run', async () => {
    sender = byName(city.businesses, demo.sender, 'sender');
    recipient = byName(city.businesses, demo.recipient, 'recipient');
    relayPoint = byName(city.businesses, demo.relay_point, 'relay point');
    employee = byName(city.employees, demo.employee, 'employee');
    eveningCarrier = byName(city.employees, demo.evening_carrier, 'evening carrier');
    morningCarrier = byName(city.employees, demo.morning_carrier, 'morning carrier');
    expect(new Set([sender.id, recipient.id, relayPoint.id]).size).toBe(3);
    expect(eveningCarrier.id).not.toBe(morningCarrier.id);

    expect(demo.employee_url).toBe(`/employee/${employee.id}`);
    expect(demo.sender_url).toBe(`/business/${sender.id}`);
    expect(demo.recipient_url).toBe(`/business/${recipient.id}`);
    // The employee opened first carries one of the two legs, so step 4 has something to show.
    expect([eveningCarrier.id, morningCarrier.id]).toContain(employee.id);

    // Every account URL anywhere in the README (the examples of the path table and "What you see" too)
    // answers with a dashboard. `<id>` placeholders are not URLs.
    const urls = [...new Set(readme.match(/\/(?:business|employee)\/[a-z0-9-]+/g))];
    expect(urls).toEqual(expect.arrayContaining([demo.employee_url, demo.sender_url, demo.recipient_url]));
    for (const url of urls) {
      const [, kind, id] = url.split('/');
      const body = kind === 'business' ? (await businessDashboard(id)).business : (await employeeDashboard(id)).employee;
      expect(body.id).toBe(id);
    }

    // The steps name the same accounts as the block.
    expect(step(1)).toContain(demo.employee_url);
    expect(step(1)).toContain(demo.employee);
    expect(step(2)).toContain(demo.sender_url);
    expect(step(2)).toContain(demo.sender);
    expect(step(2)).toContain(demo.recipient);
    expect(step(3)).toContain(demo.relay_point);
    expect(step(3)).toContain(demo.price);
    for (const name of [demo.evening_carrier, demo.morning_carrier]) expect(step(3)).toContain(name);
    expect(step(4)).toContain(demo.employee);
    for (const name of [demo.sender, demo.relay_point, demo.recipient]) expect(step(5)).toContain(name);
    for (const text of [demo.sender_url, demo.recipient_url, demo.evening_carrier, demo.morning_carrier]) expect(step(6)).toContain(text);
  }, T);

  it('30-second demo: Watch a package opens the package the README names, a relay through the businesses it names, and playing it does not lock the run', async () => {
    // The README's section comes before the 2-minute demo and names the package by its label, never by an ID (pass 63).
    expect(watchStart).toBeGreaterThan(0);
    expect(watchStart).toBeLessThan(demoStart);
    expect(watchSection).toContain(`"${WATCH_PACKAGE_LABEL}"`);
    expect(watchSection).not.toMatch(/\bshp-\d+/);

    // The homepage's link, built by the page's own model from the simulator answer.
    const sim = await api.simulator();
    const id = watchPackageId(sim);
    const shipment = sim.shipments.find((s) => s.id === id);
    expect(shipment?.label).toBe(WATCH_PACKAGE_LABEL);
    const href = watchPackageHref({
      status: 'ready', businesses: 0, commuters: 0, matched: 0, requested: 0, businessIds: [], employeeIds: [], watchPackageId: id,
    });
    expect(href).toBe(`/simulator?package=${id}&play=1`);

    // What the section says the journey shows: sender, the night at the relay point, recipient, two carriers.
    const watched = sim.plans.find((p) => p.shipmentId === id);
    expect(watched?.kind).toBe('relay');
    if (!watched || !shipment) return;
    const name = (businessId: string | null | undefined) => city.business.get(businessId ?? '')?.name ?? `no business ${businessId}`;
    const relayName = name(watched.relayBusinessId);
    expect(watchSection).toContain(`a square marks ${name(shipment.originBusinessId)}`);
    expect(watchSection).toContain(`the relay point, ${relayName},`);
    expect(watchSection).toContain(`"Overnight at ${relayName}" card`);
    expect(watchSection).toContain(`the delivery at ${name(shipment.destinationBusinessId)}`);
    expect(watched.legs).toHaveLength(2);
    expect(new Set(watched.legs.map((leg) => leg.employeeId)).size).toBe(2); // carrier A and carrier B
    // "the map is dark" for the evening leg, "the map is light" for the morning leg (pass 63).
    expect(watched.legs[0].finishMin).toBeLessThan(DAY_2_MIN);
    for (const stop of watched.legs[0].stops) expect(dayNightAt(stop.serviceStartMin)).toBe('night');
    for (const stop of watched.legs[1].stops) expect(dayNightAt(stop.serviceStartMin)).toBe('day');

    // The journey plays with seeks (journeyPlay.ts): the run stays in planning, so the 2-minute demo
    // below follows on the same run, as the section says.
    expect(watchSection).toMatch(/does not lock the run, so the 2-minute demo below can follow at once, without a reset/);
    const evening = await api.control({ action: 'seek', timeMin: watched.legs[0].finishMin });
    expect(evening.snapshot.shipmentStatus[shipment.id]).toBe('at_hub');
    const end = await api.control({ action: 'seek', timeMin: watched.deliveryMin });
    expect(end.snapshot.shipmentStatus[shipment.id]).toBe('delivered');
    expect(end.clock).toMatchObject({ phase: 'planning', playing: false });
  }, T);

  it('step 1: the employee page has the saved commute the README describes', async () => {
    const dash = await employeeDashboard(employee.id);
    expect(dash.trips).toHaveLength(2);
    expect(dash.employee.availableEvening && dash.employee.availableMorning).toBe(true);
    // "between <home neighborhood> and <workplace>"
    expect(step(1)).toContain(dash.home.neighborhood);
    expect(step(1)).toContain(city.business.get(dash.employee.businessId)!.name);
    jobsBefore = [...dash.assigned, ...dash.completed].map((view) => view.job.id);
  }, T);

  it('steps 2 and 3: the request, sent as the New delivery form sends it, is the relay the block names', async () => {
    // The draft a user has after typing the block into the form: everything else is the form's default.
    const draft = {
      ...emptyDraft(),
      recipientId: recipient.id,
      label: demo.package,
      category: TYPE_OF[demo.type],
      weightKg: demo.weight_kg,
      description: demo.contents,
    };
    expect(draft.category, `type "${demo.type}"`).toBeDefined();
    expect(validate(draft, sender.id)).toStrictEqual({});
    const request = toRequest(draft, sender.id, 'readme-demo');
    // The block's times are the form's defaults, written the way the pages show a time.
    const defaults = toRequest(emptyDraft(), sender.id, 'defaults');
    expect([request.readyMin, request.deadlineMin]).toStrictEqual([defaults.readyMin, defaults.deadlineMin]);
    expect(demo.ready).toBe(formatMin(request.readyMin));
    expect(demo.deliver_by).toBe(formatMin(request.deadlineMin));

    const versionBefore = (await api.simulator()).version;
    const res = await api.post<ShipmentResponse>('/shipments', request);
    expect(res.status).toBe(201);
    created = res.body;
    expect(created.unmatchedReason).toBeNull();
    expect(created.matched).toBe(true);
    expect(created.status).toBe('scheduled');
    expect((await api.simulator()).version).toBeGreaterThan(versionBefore);

    // A relay through the named relay point, with the named carriers, at the price in the block.
    expect(plan().kind).toBe('relay');
    expect(plan().relayBusinessId).toBe(relayPoint.id);
    expect(plan().legs.map((leg) => leg.employeeId)).toStrictEqual([eveningCarrier.id, morningCarrier.id]);
    expect(formatCents(plan().customerPriceCents)).toBe(demo.price);
    expect(plan().legs.map((leg) => leg.stops.map((stop) => `${stop.kind} ${stop.placeId}`))).toStrictEqual([
      [`pickup ${sender.id}`, `hub_drop ${relayPoint.id}`],
      [`hub_pickup ${relayPoint.id}`, `delivery ${recipient.id}`],
    ]);
    // Dropped on Day 1, collected on Day 2: the package stays at the relay point overnight.
    expect(plan().legs[0].finishMin).toBeLessThan(DAY_2_MIN);
    expect(plan().legs[1].stops[0].serviceStartMin).toBeGreaterThanOrEqual(DAY_2_MIN);
    expect(plan().deliveryMin).toBeLessThanOrEqual(request.deadlineMin);
    expect(created.jobIds).toStrictEqual([jobIdFor(plan().id, 0), jobIdFor(plan().id, 1)]);

    // Step 3 quotes the sender's delivery details: built here by the page's own model from the answer.
    const card = deliveryDetails(created, { businesses: city.businesses, employees: city.employees, viewerBusinessId: sender.id });
    expect(card.result).toMatchObject({ kind: 'matched', title: 'Delivery arranged', priceText: demo.price });
    expect(RESULT_COPY.matched).toBe('Delivery arranged.');
    if (card.result.kind !== 'matched') return;
    expect(step(3)).toContain(`**${card.result.planText}**`);
    expect(card.legs.map((leg) => leg.carrierName)).toStrictEqual([demo.evening_carrier, demo.morning_carrier]);
    card.legs.forEach((leg, i) => {
      const text = leg.tripText.charAt(0).toLowerCase() + leg.tripText.slice(1); // "evening commute, Day 1"
      expect(step(3)).toContain(`${[demo.evening_carrier, demo.morning_carrier][i]} (${text})`);
    });
    // Step 5's link is the one the details show (the Employee page builds the same path).
    expect(card.journeyLabel).toBe('View journey');
    expect(card.journeyHref).toBe(`/simulator?package=${created.shipment.id}&play=1`); // the page's link also plays (#660)
    expect(step(5)).toContain('`/simulator?package=<shipment ID>&play=1`');
    expect(source('client/src/components/employee/v2/jobDetailV2Model.ts')).toContain('`/simulator?package=${encodeURIComponent(shipmentId)}&play=1`');
  }, T);

  it('step 4: the employee page lists the new job at once, on the same server', async () => {
    const dash = await employeeDashboard(employee.id);
    const mine = plan().legs.findIndex((leg) => leg.employeeId === employee.id);
    const jobId = created.jobIds[mine];
    expect(jobsBefore).not.toContain(jobId);
    const view = dash.assigned.find((entry) => entry.job.id === jobId);
    expect(view, `job ${jobId} in the assigned deliveries of ${employee.name}`).toBeDefined();
    expect(view!.shipment.id).toBe(created.shipment.id);
    expect(view!.shipment.label).toBe(demo.package);
    expect(view!.job.rewardCents).toBe(plan().legs[mine].rewardCents);
    expect(view!.job.rewardCents).toBeGreaterThan(0);
    expect(dash.projectedCents).toBeGreaterThanOrEqual(view!.job.rewardCents);
    // The other carrier has the other leg.
    const other = await employeeDashboard(plan().legs[1 - mine].employeeId);
    expect(other.assigned.map((entry) => entry.job.id)).toContain(created.jobIds[1 - mine]);
  }, T);

  it('step 5: after the evening leg the package is at the relay point, and it is still there in the morning', async () => {
    // Play journey steps the clock with seeks (journeyPlay.ts), which do not lock the run.
    const evening = await api.control({ action: 'seek', timeMin: plan().legs[0].finishMin });
    expect(evening.clock.phase).toBe('planning');
    expect(evening.snapshot.shipmentStatus[created.shipment.id]).toBe('at_hub');
    expect((await inDashboard(sender.id, 'outgoing'))?.status).toBe('at_hub');
    const carrier = await employeeDashboard(eveningCarrier.id);
    expect(carrier.completed.map((entry) => entry.job.id)).toContain(created.jobIds[0]);

    const morning: SimulatorResponse = await api.control({ action: 'jump_to_morning' });
    expect(morning.clock.timeMin).toBeGreaterThanOrEqual(DAY_2_MIN);
    expect(morning.clock.timeMin).toBeLessThan(plan().legs[1].stops[0].serviceStartMin);
    expect(morning.snapshot.shipmentStatus[created.shipment.id]).toBe('at_hub');
    // The package is where the relay point is.
    expect(morning.snapshot.packagePositions[created.shipment.id]).toMatchObject({ lat: relayPoint.lat, lng: relayPoint.lng });
  }, T);

  /** Step 6: delivered for the sender and the recipient, and each carrier has earned its leg's reward. */
  async function expectDeliveredAndPaid(): Promise<void> {
    const outgoing = await inDashboard(sender.id, 'outgoing');
    const incoming = await inDashboard(recipient.id, 'incoming');
    for (const view of [outgoing, incoming]) {
      expect(view?.status).toBe('delivered');
      expect(view?.deliveredAtMin).toBe(plan().deliveryMin);
    }
    for (const [i, leg] of plan().legs.entries()) {
      const dash = await employeeDashboard(leg.employeeId);
      expect(dash.completed.map((entry) => entry.job.id)).toContain(created.jobIds[i]);
      expect(dash.assigned.map((entry) => entry.job.id)).not.toContain(created.jobIds[i]);
      expect(leg.rewardCents).toBeGreaterThan(0);
      expect(dash.earnedCents).toBeGreaterThanOrEqual(leg.rewardCents);
      // Earned is the sum of the completed jobs' rewards, this leg's among them.
      expect(dash.earnedCents).toBe(dash.completed.reduce((total, entry) => total + entry.job.rewardCents, 0));
    }
  }

  it('steps 5 and 6: where Play journey ends, the delivery is delivered for sender and recipient and both carriers have earnings', async () => {
    // Play journey's last seek is the end of the last stop (journeyModel `playPlan`), the plan's delivery minute.
    const delivered = await api.control({ action: 'seek', timeMin: plan().deliveryMin });
    expect(delivered.clock.phase).toBe('planning');
    expect(delivered.snapshot.shipmentStatus[created.shipment.id]).toBe('delivered');
    await expectDeliveredAndPaid();
  }, T);

  it('steps 5 and 6: after playback to the end (Play, Jump to morning, Finish) the same holds', async () => {
    expect((await api.control({ action: 'play' })).clock).toMatchObject({ phase: 'locked', playing: true });
    const end = await api.control({ action: 'finish' });
    expect(end.clock.timeMin).toBe(city.settings.simEndMin);
    expect(end.clock.playing).toBe(false);
    expect(end.snapshot.shipmentStatus[created.shipment.id]).toBe('delivered');
    await expectDeliveredAndPaid();
    // Play locked the run: a new request is refused until Start new planning cycle (README "State file and reset").
    const refused = await api.post('/shipments', toRequest({ ...emptyDraft(), recipientId: recipient.id, label: 'x', description: 'y' }, sender.id, 'readme-demo-locked'));
    expect(refused.status).toBe(409);
    const reset = await api.post<SimulatorResponse>('/planning/reset');
    expect(reset.status).toBe(200);
    expect(reset.body.clock).toMatchObject({ phase: 'planning', playing: false, timeMin: city.settings.simStartMin });
  }, T);

  it('nothing was written to the repo, the copy of fixtures/nyc is unchanged, and no call left the machine', () => {
    api.expectRepoFilesUntouched();
    const copy = fs.readdirSync(fixturesDir).sort().map((name) => `${name} ${fs.readFileSync(path.join(fixturesDir, name)).length}`);
    const repo = nycFilesState().map((line) => line.split(' ')[0]).sort();
    expect(copy.map((line) => line.split(' ')[0])).toStrictEqual(repo);
    for (const line of copy) {
      const [name, size] = line.split(' ');
      expect(`${name} ${size}`).toBe(`${name} ${fs.statSync(path.join(REPO_ROOT, 'fixtures', 'nyc', name)).size}`);
    }
    expect(net.localCalls()).toBeGreaterThan(0);
    net.expectNoOutgoing();
  });
});

// ---------- the words of the pages ----------

/** Every control or heading the demo names in bold, with the client file that holds the text. */
const PAGE_WORDS: [label: string, file: string][] = [
  ['Employee', 'client/src/ui/shellModel.ts'],
  ['Business', 'client/src/ui/shellModel.ts'],
  ['Simulator', 'client/src/ui/shellModel.ts'],
  ['Demo account', 'client/src/App.tsx'],
  ['Saved commute', 'client/src/components/employee/v2/CommuteSummary.tsx'],
  ['Detour limit', 'client/src/components/employee/v2/CommuteSummary.tsx'],
  ['New delivery', 'client/src/components/business/v2/NewDeliveryForm.tsx'],
  // #786 (MVP IV F1): New delivery opens on the request text box; this button of it opens the form.
  ['Fill in the form instead', 'client/src/components/business/v2/requestTextModel.ts'],
  // #815: the demo types the request as a sentence; this button of the text box reads it into the form.
  ['Read my request', 'client/src/components/business/v2/requestTextModel.ts'],
  ['Find a delivery match', 'client/src/components/business/v2/NewDeliveryForm.tsx'],
  ['Delivery arranged', 'client/src/components/business/v2/deliveryDetailsModel.ts'],
  ['View delivery', 'client/src/components/business/v2/NewDeliveryForm.tsx'],
  ['Assigned deliveries', 'client/src/components/employee/v2/EmployeeWorkspace.tsx'],
  ['Watch in simulator', 'client/src/components/employee/v2/DeliveryList.tsx'],
  ['View journey', 'client/src/components/business/v2/deliveryDetailsModel.ts'],
  // #648: the simulator has one Play/Pause button and "Back to start"; Play journey, Jump to morning,
  // Finish and Start new planning cycle are gone from the page, so the demo no longer names them.
  ['Play', 'client/src/components/sim/v2/controls/controlsModel.ts'],
  ['Pause', 'client/src/components/sim/v2/controls/controlsModel.ts'],
  ['Back to start', 'client/src/components/sim/v2/controls/controlsModel.ts'],
  ['Delivered', 'client/src/components/business/v2/shipmentsTableModel.ts'],
  ['Earnings', 'client/src/components/employee/v2/EmployeeWorkspace.tsx'],
  ['Earned', 'client/src/components/employee/v2/EmployeeWorkspace.tsx'],
  // #815: the demo ends on the homepage's link to the study page (STUDY_LABEL).
  ['The numbers', 'client/src/pages/Landing.tsx'],
];

describe('README demo steps, in the words of the pages', () => {
  it('follows SPEC\'s six steps: New delivery, Find a delivery match, Delivery arranged, relay point, a journey that plays by itself and skips the night', () => {
    expect(step(1)).toMatch(/^1\. \*\*Employee\*\*/);
    expect(step(2)).toMatch(/^2\. \*\*Business\*\*/);
    expect(step(2)).toContain('**New delivery**');
    expect(step(2)).toContain('choose **Find a delivery match**'); // the button's own label (#703)
    expect(step(3)).toContain('**Delivery arranged**');
    expect(step(3)).toContain('relay point');
    expect(step(4)).toMatch(/^4\. Back in \*\*Employee\*\*/);
    expect(step(4)).toMatch(/without refreshing/);
    expect(step(5)).toMatch(/^5\. \*\*Simulator\*\*/);
    // #660, #703: the Watch links carry `play=1`, so nobody presses Play to start; Play resumes after Pause.
    expect(step(5)).toMatch(/starts playing by itself/);
    expect(step(5)).not.toMatch(/, then \*\*Play\*\*/);
    expect(PLAY_LABEL).toBe('Play');
    expect(step(5)).toContain(`**${PLAY_LABEL}** goes on from there`);
    expect(step(5)).toMatch(/relay point .*overnight/);
    expect(step(5)).toContain('"Overnight at Etsy" card'); // the relay point of the demo request
    for (const gone of ['Play journey', 'Jump to morning', 'Finish', 'Start new planning cycle']) {
      expect(demoSection, `"${gone}" is no longer on the simulator page`).not.toContain(gone);
    }
    expect(step(6)).toContain('**Delivered**');
    expect(step(6)).toContain('**Earned**');
    expect(demoSection).not.toMatch(/\bhubs?\b/i);
  });

  it('every bold word of the demo is a text of the page it names, or a value of the block', () => {
    const bold = [...new Set([...demoSection.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]))];
    const words = new Map(PAGE_WORDS);
    const values = new Set<string>(Object.values(demo));
    const unknown = bold.filter((text) => !words.has(text) && !values.has(text) && !text.startsWith('Relay via '));
    expect(unknown, 'bold text in the demo that no page file and no block value backs').toStrictEqual([]);
    for (const [label, file] of PAGE_WORDS) {
      expect(demoSection, `"${label}" in the demo`).toContain(`**${label}**`);
      // As a JSX text or a string of the file: >Label<, 'Label', "Label".
      const text = new RegExp(`[>'"\`]\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[<'"\`]`);
      expect(text.test(source(file)), `"${label}" in ${file}`).toBe(true);
    }
  });

  // SPEC demo step 2 and docs/relay-spec.md name the button "Find a delivery match", and since #703 the
  // New delivery form does too (DECISIONS pass 62 and 67). The old label is spelled in two parts here, so
  // a search of client/, tests/ and README.md for it finds nothing.
  it('the New delivery form\'s submit button reads "Find a delivery match", and the README names neither the old label nor Help', () => {
    const oldLabel = ['Send', 'request'].join(' ');
    const form = source('client/src/components/business/v2/NewDeliveryForm.tsx');
    expect(form).toContain("'Find a delivery match'");
    expect(form).not.toContain(oldLabel);
    expect(source('SPEC.md')).toContain('**Find a delivery match**');
    expect(readme).not.toContain(oldLabel);
    // The Help page is deleted (#623): no `/help` path and no Help workspace in the README.
    expect(readme).not.toMatch(/\/help\b|Help page|, Help,|Guided demo/);
  });

  it('30-second demo: the button and the controls are named in the words of the pages', () => {
    expect(watchSection).toMatch(/^\n## 30-second demo\nOpen `\/` and choose \*\*Watch a package\*\*\./);
    expect(source('client/src/pages/Landing.tsx')).toContain("WATCH_LABEL = 'Watch a package'");
    const controls = source('client/src/components/sim/v2/controls/controlsModel.ts');
    for (const label of ['Pause', 'Play', 'Back to start']) {
      expect(watchSection).toContain(`**${label}**`);
      expect(controls).toContain(`'${label}'`);
    }
    // Carrier letters and colours as the map draws them (docs/mvp3.md P4): A blue, B green.
    expect(watchSection).toMatch(/Carrier \*\*A\*\* \(blue\)/);
    expect(watchSection).toMatch(/carrier \*\*B\*\* \(green\)/);
    // The four symbols of the map and the journey panel (map/layers.ts SYMBOL_GLYPH), in journey order.
    const glyphs = ['\u25A0', '\u25C6', '\u21C4', '\u2691'].map((glyph) => watchSection.indexOf(glyph));
    expect(glyphs.every((index) => index > 0)).toBe(true);
    expect(glyphs).toStrictEqual([...glyphs].sort((a, b) => a - b));
    // With no browser key the section says what still works; the sentence is the page's.
    const keyMissing = /KEY_MISSING_TEXT = '([^']+)'/.exec(source('client/src/components/map/mapModel.ts'))?.[1];
    expect(keyMissing).toBeTruthy();
    expect(watchSection).toContain(`"${keyMissing}"`);
    expect(watchSection).not.toMatch(/\bhubs?\b/i);
  });
});
