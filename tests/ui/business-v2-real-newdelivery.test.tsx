// @vitest-environment jsdom
// MVP II New delivery against the REAL server (#514): createV2Runtime on a COPY of fixtures/nyc in a temp
// folder, no key, no network. The form runs in a real DOM (tests/ui/kitDom.ts, #505) and sends its request
// through client/src/api/v2.ts. A delivery that finds no match is a 201 with `matched: false` (DECISIONS
// pass 50), so both answers are fine here; the result card must show whichever one the server gave.
// No story ID, name or count is pinned (DECISIONS pass 54).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ShipmentResponse } from '../../shared/v2/api';
import type { CreateShipmentRequest } from '../../shared/v2/schemas';
import type { Employee, NetworkBusiness } from '../../shared/v2/types';
import { NYC_FIXTURES_DIR } from '../../server/api/v2/bootRun';
import { createShipment, getBusinessDashboard, getBusinesses, getEmployees, getMap, getSimulator } from '../../client/src/api/v2';
import { NewDeliveryForm } from '../../client/src/components/business/v2/NewDeliveryForm';
import BusinessV2 from '../../client/src/pages/v2/BusinessV2';
import { formatCents, formatMin } from '../../client/src/ui/format';
import {
  RESULT_COPY, emptyDraft, recipientOptions, toRequest, validate,
} from '../../client/src/components/business/v2/newDeliveryModel';
import {
  T, elements, forbiddenIn, renderPage, text, workspaceState, startRealApi, type RealApi,
} from './business-v2-real-helper';
import { button, buttons, byLabel, click, flush, mount, select, textOf, typeInto } from './kitDom';

vi.setConfig({ testTimeout: T, hookTimeout: T });

const hashes = () => Object.fromEntries(fs.readdirSync(NYC_FIXTURES_DIR).map((name) =>
  [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(NYC_FIXTURES_DIR, name))).digest('hex')]));

let api: RealApi;
let businesses: NetworkBusiness[];
let employees: Employee[];
const before = hashes();

beforeAll(async () => {
  api = await startRealApi();
  businesses = (await getBusinesses()).businesses;
  employees = (await getEmployees()).employees;
});
afterAll(async () => {
  await api?.close();
  expect(hashes()).toEqual(before); // nothing was written to fixtures/nyc
});

const optionLabel = (b: NetworkBusiness) => (b.neighborhood ? `${b.name} · ${b.neighborhood}` : b.name);
const noop = () => {};

/** A sender and a recipient that already have a delivery in the real run (read, not pinned). */
async function storyPair() {
  const sim = await getSimulator();
  const s = sim.shipments[0];
  const origin = businesses.find((b) => b.id === s.originBusinessId)!;
  const recipient = businesses.find((b) => b.id === s.destinationBusinessId)!;
  return { origin, recipient };
}

/** The Delivery arranged card of a real answer (#582): its values, formatted, and its carriers and relay business by name. */
function expectArrangedCard(cardText: string, res: ShipmentResponse) {
  const plan = res.plan!;
  expect(cardText).toContain(plan.kind === 'relay' ? 'Relay' : 'Direct');
  expect(cardText).toContain(formatMin(plan.deliveryMin));
  expect(cardText).toContain(formatCents(plan.customerPriceCents));
  for (const leg of plan.legs) expect(cardText).toContain(employees.find((e) => e.id === leg.employeeId)!.name);
  if (plan.kind === 'relay') expect(cardText).toContain(businesses.find((b) => b.id === plan.relayBusinessId)!.name);
  expect(cardText).toContain('Watch in simulator');
  expect(cardText).not.toMatch(/\b(biz|emp|home|plan)-[a-z0-9]/i);
}

describe('New delivery on the real server', () => {
  it('serves the real run from the temp copy, with no key and no Google call', () => {
    expect(api.runtime.status).toBe('ready');
    expect(businesses.length).toBeGreaterThan(1);
    expect(api.fixturesDir.startsWith(api.root)).toBe(true);
    expect(api.googleCalls).toEqual([]);
  });

  it('the recipient list is every other business and never the sender, for every business', () => {
    for (const origin of businesses) {
      const options = recipientOptions(businesses, origin.id);
      expect(options.map((o) => o.id).sort()).toEqual(businesses.filter((b) => b.id !== origin.id).map((b) => b.id).sort());
      expect(options.map((o) => o.id)).not.toContain(origin.id);

      const m = mount(<NewDeliveryForm origin={origin} businesses={businesses} phase="planning"
        onSubmit={async () => { throw new Error('not sent'); }} onOpenDelivery={noop} onCancel={noop} />);
      const shown = [...(byLabel(m.container, 'Recipient') as HTMLSelectElement).options]
        .filter((o) => o.value !== '').map((o) => o.text.trim());
      expect(shown.sort(), origin.id).toEqual(businesses.filter((b) => b.id !== origin.id).map(optionLabel).sort());
      expect(forbiddenIn(m.container.innerHTML), origin.id).toEqual([]);
      m.unmount();
    }
  });

  it('toRequest of a filled draft is accepted by POST /api/v2/shipments through client/src/api/v2.ts', async () => {
    const { origin, recipient } = await storyPair();
    const draft = {
      ...emptyDraft(), recipientId: recipient.id, label: 'Signed contract', description: 'One envelope, two copies',
      weightKg: '0.4', pickupInstructions: 'Front desk',
    };
    expect(validate(draft, origin.id)).toEqual({});
    const req: CreateShipmentRequest = toRequest(draft, origin.id, `req-514-model-${origin.id}`);
    const before = api.requests.length;
    const res: ShipmentResponse = await createShipment(req);
    expect(api.requests.slice(before)).toEqual(['POST /api/v2/shipments']);
    expect(typeof res.matched).toBe('boolean');
    expect(res.shipment.originBusinessId).toBe(origin.id);
    expect(res.shipment.destinationBusinessId).toBe(recipient.id);
    expect(res.shipment.label).toBe('Signed contract');
    expect(res.shipment.readyMin).toBe(req.readyMin);
    expect(res.shipment.deadlineMin).toBe(req.deadlineMin);
    expect(res.matched).toBe(res.plan !== null);
    if (!res.matched) expect(res.unmatchedReason).toBeTruthy();

    // The same clientRequestId again is the same delivery (a retry), not a second one.
    const again = await createShipment(req);
    expect(again.shipment.id).toBe(res.shipment.id);
  });

  it('the form, typed in a real DOM, sends one real request and renders the server\'s answer', async () => {
    const { origin, recipient } = await storyPair();
    const answers: ShipmentResponse[] = [];
    const opened: string[] = [];
    const onSubmit = vi.fn(async (req: CreateShipmentRequest) => {
      const res = await createShipment(req);
      answers.push(res);
      return res;
    });
    const m = mount(<NewDeliveryForm origin={origin} businesses={businesses} employees={employees} phase="planning"
      onSubmit={onSubmit} onOpenDelivery={(id) => opened.push(id)} onCancel={noop} />);
    const c = m.container;
    select(byLabel(c, 'Recipient'), optionLabel(recipient));
    typeInto(byLabel(c, 'Package name'), 'Proof prints');
    typeInto(byLabel(c, 'Weight (kg)'), '0.8');
    typeInto(byLabel(c, 'Contents'), 'Three proof prints in a sleeve');
    const before = api.requests.length;
    click(button(c, 'Find a delivery match'));
    for (let i = 0; i < 200 && answers.length === 0; i++) await flush();
    await flush();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(api.requests.slice(before)).toEqual(['POST /api/v2/shipments']);
    const sent = onSubmit.mock.calls[0][0];
    expect(sent.originBusinessId).toBe(origin.id);
    expect(sent.destinationBusinessId).toBe(recipient.id);
    expect(sent.clientRequestId).toBeTruthy();

    const res = answers[0];
    const status = textOf(c.querySelector('.nd-result')!);
    expect(status).toContain(res.shipment.id);
    if (res.matched) {
      expect(status).toContain(RESULT_COPY.matched);
      expectArrangedCard(status, res);
    } else {
      expect(status).toContain(RESULT_COPY.unmatched);
      expect(status).toContain(res.unmatchedReason!);
    }
    expect(textOf(c.querySelector('[role="alert"]')!)).toBe('');
    expect(forbiddenIn(c.innerHTML)).toEqual([]);
    click(button(c, 'View delivery'));
    expect(opened).toEqual([res.shipment.id]);

    // The sender's next dashboard poll has the new delivery, and the page shows it with the same answer.
    const dashboard = await getBusinessDashboard(origin.id);
    const view = dashboard.outgoing.find((v) => v.shipment.id === res.shipment.id);
    expect(view).toBeTruthy();
    expect(view!.plan !== null).toBe(res.matched);
    const [{ businesses: list }, { employees: staff }, map] = await Promise.all([getBusinesses(), getEmployees(), getMap()]);
    const html = renderPage(workspaceState({ runId: map.runId, businesses: list, employees: staff }, dashboard), { shipmentId: res.shipment.id });
    const panel = text(elements(html, 'section', 'class="bd-panel"')[0]);
    expect(panel).toContain('Proof prints');
    expect(panel).toContain(res.matched ? 'Delivery arranged' : 'No matching commute yet');
    if (!res.matched) expect(panel).toContain(res.unmatchedReason!);
    expect(forbiddenIn(html)).toEqual([]);
    expect(api.googleCalls).toEqual([]);
  });

  it('on the real Business route: a request that cannot match is retried as the same delivery; a match names its carriers', async () => {
    const { origin, recipient } = await storyPair();
    const m = mount(
      <MemoryRouter initialEntries={[`/business/${origin.id}`]}>
        <Routes><Route path="/business/:id" element={<BusinessV2 />} /></Routes>
      </MemoryRouter>,
    );
    const c = m.container;
    for (let i = 0; i < 200 && buttons(c, 'New delivery').length === 0; i++) await flush();
    click(buttons(c, 'New delivery')[0]);
    const form = () => c.querySelector('form.nd')!;
    // The business and employee lists arrive on their own request.
    const listed = () => [...(byLabel(form(), 'Recipient') as HTMLSelectElement).options].some((o) => o.text.trim() === optionLabel(recipient));
    for (let i = 0; i < 200 && !listed(); i++) await flush();
    const posts = () => api.requests.slice(start).filter((r) => r.startsWith('POST '));
    const answered = async (n: number) => {
      for (let i = 0; i < 200 && (posts().length < n || form().querySelector('fieldset:disabled')); i++) await flush();
      await flush();
    };
    const mine = async (label: string) =>
      (await getBusinessDashboard(origin.id)).outgoing.find((v) => v.shipment.label === label)!;

    // Five minutes between ready and deliver-by: whatever the server answers, the form must show it.
    select(byLabel(form(), 'Recipient'), optionLabel(recipient));
    typeInto(byLabel(form(), 'Package name'), 'Rush folder 582');
    typeInto(byLabel(form(), 'Contents'), 'One folder');
    select(byLabel(form(), 'Deliver by: day'), 'Day 1');
    typeInto(byLabel(form(), 'Deliver by: time'), '16:05');
    const start = api.requests.length;
    click(button(form(), 'Find a delivery match'));
    await answered(1);
    expect(posts()).toEqual(['POST /api/v2/shipments']);
    const rush = await mine('Rush folder 582');
    const status = () => textOf(form().querySelector('.nd-result')!);
    expect(status()).toContain(rush.shipment.id);
    if (rush.plan === null) {
      expect(status()).toContain(rush.unmatchedReason!);
      click(button(form(), 'Try matching again'));
      await answered(2);
      // The second click re-matched the saved delivery: no second POST /shipments, no second delivery.
      expect(posts()).toEqual(['POST /api/v2/shipments', `POST /api/v2/shipments/${rush.shipment.id}/match`]);
      expect((await getBusinessDashboard(origin.id)).outgoing.filter((v) => v.shipment.label === 'Rush folder 582')).toHaveLength(1);
      expect(status()).toContain(rush.shipment.id);
    } else {
      expectArrangedCard(status(), { ...rush, matched: true });
    }

    // Default times again, one recipient after the other, until the server arranges one (read from the run, not
    // pinned). Each answer is on screen; the arranged one names its carriers from the workspace's employee list,
    // which reaches the form through the services the route page provides.
    select(byLabel(form(), 'Deliver by: day'), 'Day 2');
    typeInto(byLabel(form(), 'Deliver by: time'), '10:00');
    let arranged: ShipmentResponse | null = null;
    for (const [i, to] of businesses.filter((b) => b.id !== origin.id).entries()) {
      const sent = posts().length;
      const label = `Sample tray 582-${i}`;
      select(byLabel(form(), 'Recipient'), optionLabel(to));
      typeInto(byLabel(form(), 'Package name'), label);
      typeInto(byLabel(form(), 'Contents'), 'One tray');
      click(button(form(), 'Find a delivery match'));
      await answered(sent + 1);
      expect(posts().slice(sent)).toEqual(['POST /api/v2/shipments']);
      const tray = await mine(label);
      expect(status()).toContain(tray.shipment.id);
      if (tray.plan) { arranged = { ...tray, matched: true }; break; }
      expect(status()).toContain(tray.unmatchedReason!);
    }
    expect(arranged, `no recipient of ${origin.name} could be matched on the default run`).not.toBeNull();
    expectArrangedCard(status(), arranged!);
    expect(form().querySelector('.nd-arranged a')!.getAttribute('href')).toBe(`/simulator?package=${encodeURIComponent(arranged!.shipment.id)}&play=1`);
    expect(forbiddenIn(form().innerHTML)).toEqual([]);
    expect(api.googleCalls).toEqual([]);
    m.unmount();
  });
});
