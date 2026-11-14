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
import type { ShipmentResponse } from '../../shared/v2/api';
import type { CreateShipmentRequest } from '../../shared/v2/schemas';
import type { NetworkBusiness } from '../../shared/v2/types';
import { NYC_FIXTURES_DIR } from '../../server/api/v2/bootRun';
import { createShipment, getBusinessDashboard, getBusinesses, getEmployees, getMap, getSimulator } from '../../client/src/api/v2';
import { NewDeliveryForm } from '../../client/src/components/business/v2/NewDeliveryForm';
import {
  RESULT_COPY, emptyDraft, recipientOptions, toRequest, validate,
} from '../../client/src/components/business/v2/newDeliveryModel';
import {
  T, elements, forbiddenIn, renderPage, text, workspaceState, startRealApi, type RealApi,
} from './business-v2-real-helper';
import { button, byLabel, click, flush, mount, select, textOf, typeInto } from './kitDom';

vi.setConfig({ testTimeout: T, hookTimeout: T });

const hashes = () => Object.fromEntries(fs.readdirSync(NYC_FIXTURES_DIR).map((name) =>
  [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(NYC_FIXTURES_DIR, name))).digest('hex')]));

let api: RealApi;
let businesses: NetworkBusiness[];
const before = hashes();

beforeAll(async () => {
  api = await startRealApi();
  businesses = (await getBusinesses()).businesses;
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
    const m = mount(<NewDeliveryForm origin={origin} businesses={businesses} phase="planning"
      onSubmit={onSubmit} onOpenDelivery={(id) => opened.push(id)} onCancel={noop} />);
    const c = m.container;
    select(byLabel(c, 'Recipient'), optionLabel(recipient));
    typeInto(byLabel(c, 'Package name'), 'Proof prints');
    typeInto(byLabel(c, 'Weight (kg)'), '0.8');
    typeInto(byLabel(c, 'Contents'), 'Three proof prints in a sleeve');
    const before = api.requests.length;
    click(button(c, 'Send request'));
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
    const [{ businesses: list }, { employees }, map] = await Promise.all([getBusinesses(), getEmployees(), getMap()]);
    const html = renderPage(workspaceState({ runId: map.runId, businesses: list, employees }, dashboard), { shipmentId: res.shipment.id });
    const panel = text(elements(html, 'section', 'class="bd-panel"')[0]);
    expect(panel).toContain('Proof prints');
    expect(panel).toContain(res.matched ? 'Delivery arranged' : 'No matching commute yet');
    if (!res.matched) expect(panel).toContain(res.unmatchedReason!);
    expect(forbiddenIn(html)).toEqual([]);
    expect(api.googleCalls).toEqual([]);
  });
});
