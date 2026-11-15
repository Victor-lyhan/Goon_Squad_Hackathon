// @vitest-environment jsdom
// #581 in a real DOM with a fake API: the real page (pages/v2/BusinessV2.tsx, its router wiring, the data hook
// and client/src/api/v2) against a `fetch` that answers like /api/v2.
// - A business that is only the relay point of a package clicks its notification and gets the normal delivery
//   details (sender, recipient, both carriers) with the "held here overnight" line; the package is read with
//   GET /api/v2/shipments/:id, refreshed with the page poll, and its notification shows a real time.
// - A delivery this business has no part in keeps the "another business" message.
// - A locked dashboard closes New delivery, with the reason as text, until the run is back in planning
//   (the simulator's "Back to start", DECISIONS pass 74).
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BusinessDashboard, MapResponse, ShipmentView } from '../../shared/v2/api';
import { getShipment } from '../../client/src/api/v2';
import { defaultBusinessWorkspaceDeps } from '../../client/src/components/business/v2/live/useBusinessWorkspace';
import {
  DELIVERY_MISSING_TEXT, DELIVERY_MISSING_TITLE, NEW_DELIVERY_CLOSED_TEXT, heldHereText,
} from '../../client/src/components/business/v2/page/businessPageModel';
import BusinessV2 from '../../client/src/pages/v2/BusinessV2';
import {
  ACME, ATLAS, ATLAS_DASHBOARD, BAKERY, BUSINESSES, DASHBOARD, DIRECT, EMPLOYEES, RELAY,
} from './business-v2-page-sample';
import { button, buttons, click, mount, textOf } from './kitDom';

const T = 20_000;

const MAP: MapResponse = {
  runId: 'run-1', businesses: BUSINESSES, homes: [], employees: [],
  polylines: [
    { from: ACME.id, to: ATLAS.id, encoded: null },
    { from: ATLAS.id, to: BAKERY.id, encoded: null },
    { from: ACME.id, to: BAKERY.id, encoded: null },
  ],
};

// ---------- The fake API ----------

type FakeServer = {
  dashboards: Map<string, BusinessDashboard>;
  /** Every shipment of the run, as GET /shipments/:id answers it (any business's). */
  shipments: Map<string, ShipmentView>;
  /** `METHOD /api/...` of every request. */
  requests: string[];
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function fakeServer(): FakeServer {
  const s: FakeServer = {
    dashboards: new Map([[ATLAS.id, ATLAS_DASHBOARD], [ACME.id, DASHBOARD]]),
    shipments: new Map([[RELAY.shipment.id, RELAY], [DIRECT.shipment.id, DIRECT]]),
    requests: [],
  };
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? 'GET';
    s.requests.push(`${method} ${url}`);
    if (method !== 'GET') return json(405, { error: 'This test only reads' });
    const dash = /^\/api\/v2\/businesses\/([^/]+)\/dashboard$/.exec(url);
    if (dash) {
      const d = s.dashboards.get(decodeURIComponent(dash[1]));
      return d ? json(200, d) : json(404, { error: 'Unknown business' });
    }
    const shp = /^\/api\/v2\/shipments\/([^/]+)$/.exec(url);
    if (shp) {
      const v = s.shipments.get(decodeURIComponent(shp[1]));
      return v ? json(200, { ...v, matched: v.plan !== null }) : json(404, { error: 'Unknown shipment' });
    }
    if (url === '/api/v2/businesses') return json(200, { businesses: BUSINESSES });
    if (url === '/api/v2/employees') return json(200, { employees: EMPLOYEES });
    if (url === '/api/v2/map') return json(200, MAP);
    return json(404, { error: `No such route: ${url}` });
  });
  return s;
}

// ---------- The page ----------

type Where = { path: string; search: string };
function Probe({ out }: { out: Where }) {
  const { pathname, search } = useLocation();
  out.path = pathname;
  out.search = search;
  return null;
}

function open(path: string) {
  const where: Where = { path: '', search: '' };
  const m = mount(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/business/:id" element={<BusinessV2 />} /></Routes>
      <Probe out={where} />
    </MemoryRouter>,
  );
  const c = m.container;
  /** Waits (real time: the page polls every second) until `ok()` holds. */
  const until = async (ok: () => boolean, what: string, ms = 5000) => {
    const end = Date.now() + ms;
    while (!ok() && Date.now() < end) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    if (!ok()) throw new Error(`timed out waiting for ${what}; page: ${textOf(c).slice(0, 400)}`);
  };
  return {
    ...m, where, until,
    details: () => c.querySelector('section.bd-panel'),
    notes: () => [...c.querySelectorAll('li.ba-note')],
    text: () => textOf(c),
  };
}

let server: FakeServer;
beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
  server = fakeServer();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const shipmentReads = (id: string) => server.requests.filter((r) => r === `GET /api/v2/shipments/${id}`).length;

describe('a business that is only the relay point of a package', () => {
  it('uses getShipment from client/src/api/v2', () => {
    expect(defaultBusinessWorkspaceDeps.getShipment).toBe(getShipment);
  });

  it('clicks its notification and sees sender, recipient, both carriers and the relay line', async () => {
    const p = open(`/business/${ATLAS.id}`);
    await p.until(() => p.notes().length === 1, 'the notification');
    // The dashboard lists no delivery of its own, and nothing was read for a closed page.
    expect(p.text()).toContain('No deliveries yet');
    expect(textOf(p.notes()[0].querySelector('.ba-note__time')!)).toBe('—');
    expect(textOf(p.notes()[0])).toContain('Relay point');
    expect(shipmentReads('shp-8')).toBe(0);

    // What the page says between the click and the answer: never the "another business" message.
    const seen: string[] = [];
    const watch = new MutationObserver(() => { seen.push(p.text()); });
    watch.observe(p.container, { childList: true, subtree: true, characterData: true });

    click(button(p.notes()[0], /Open shp-8$/));
    expect(p.where.search).toBe('?shipment=shp-8');
    expect(p.text()).toContain('Loading this delivery');
    await p.until(() => p.details() !== null, 'the delivery details');
    watch.disconnect();
    expect(seen.join('\n')).not.toContain(DELIVERY_MISSING_TITLE);
    expect(shipmentReads('shp-8')).toBeGreaterThanOrEqual(1);

    // The normal details: package, both businesses, both carriers and their stops.
    const d = textOf(p.details()!);
    expect(d).toContain(RELAY.shipment.label);
    expect(d).not.toContain('shp-8'); // no raw ID in the panel's text (#881)
    expect(textOf(p.details()!.querySelector('.bd-parties')!)).toBe(`From${ACME.name}, ${ACME.neighborhood}To${BAKERY.name}, ${BAKERY.neighborhood}`);
    for (const e of EMPLOYEES) expect(d).toContain(e.name);
    expect(p.details()!.querySelectorAll('.bd-legs tbody tr')).toHaveLength(2);
    expect(d).toContain(`Relay point: ${ATLAS.name}`);
    expect(d).toContain('At relay point');
    // It is neither incoming nor outgoing here, and the sender's price is not this business's to see.
    expect(textOf(p.details()!.querySelector('.bd-eyebrow')!)).toBe('Relay point');
    expect(d).not.toMatch(/\$\d/);

    // The one line that says why this business sees it.
    const line = p.container.querySelector('.bp-held')!;
    expect(textOf(line)).toBe(heldHereText(ATLAS.name));
    expect(textOf(line)).toBe('Held here overnight: Atlas Books is the relay point for this package.');
    // Above the details, in the details column.
    expect(line.compareDocumentPosition(p.details()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.closest('.bp-details')).not.toBeNull();
    // The delivery's route map opens for it too.
    await p.until(() => p.container.querySelector('section.bdr') !== null, 'the route map');

    // Its notification now shows the package's time, not a dash.
    expect(textOf(p.notes()[0].querySelector('.ba-note__time')!)).toBe('5:00 PM');
    expect(p.text()).not.toContain(DELIVERY_MISSING_TITLE);
    expect(p.text()).not.toMatch(/undefined|NaN|\bhub\b/i);
  }, T);

  it('refreshes the open package with the page poll and stops when it is closed', async () => {
    const p = open(`/business/${ATLAS.id}?shipment=shp-8`); // straight from a link
    await p.until(() => p.details() !== null, 'the delivery details');
    const current = () => textOf(p.details()!.querySelector('[aria-current="step"]')!);
    expect(current()).toContain('At relay point');

    // The clock moved on the server: the next poll brings the new status, with no click.
    const before = shipmentReads('shp-8');
    server.shipments.set('shp-8', { ...RELAY, status: 'out_for_delivery' });
    await p.until(() => current().includes('Out for delivery'), 'the refreshed status');
    expect(shipmentReads('shp-8')).toBeGreaterThan(before);
    expect(p.container.querySelector('.bp-held')).not.toBeNull();

    click(button(p.details()!, 'Close'));
    expect(p.where.search).toBe('');
    expect(p.details()).toBeNull();
    expect(p.container.querySelector('.bp-held')).toBeNull();
    // The notification keeps the time it got; nothing more is read for a closed package.
    expect(textOf(p.notes()[0].querySelector('.ba-note__time')!)).toBe('5:00 PM');
    const closed = shipmentReads('shp-8');
    const polls = () => server.requests.filter((r) => r.endsWith('/dashboard')).length;
    const at = polls();
    await p.until(() => polls() >= at + 2, 'two more polls');
    expect(shipmentReads('shp-8')).toBe(closed);
  }, T);

  it('keeps the "another business" message for a delivery it has no part in', async () => {
    // shp-7 goes directly from Acme Studio to Bakery Row; the server knows it, but Atlas Books holds nothing of it.
    const p = open(`/business/${ATLAS.id}?shipment=shp-7`);
    await p.until(() => p.text().includes(DELIVERY_MISSING_TITLE), 'the message');
    expect(shipmentReads('shp-7')).toBeGreaterThanOrEqual(1);
    expect(p.text()).toContain(DELIVERY_MISSING_TEXT);
    expect(p.text()).toContain('another business');
    expect(p.details()).toBeNull();
    expect(p.container.querySelector('.bp-held')).toBeNull();
    expect(textOf(p.notes()[0].querySelector('.ba-note__time')!)).toBe('—');
    // Nothing of the other businesses' delivery is shown.
    expect(p.text()).not.toContain(DIRECT.shipment.label);
    expect(p.text()).not.toContain('$12.50');
    p.unmount();

    // A relay through another business, and an ID the server does not know.
    server.shipments.set('shp-8', { ...RELAY, plan: { ...RELAY.plan!, relayBusinessId: 'biz-elsewhere' } });
    for (const id of ['shp-8', 'shp-404']) {
      const q = open(`/business/${ATLAS.id}?shipment=${id}`);
      await q.until(() => q.text().includes(DELIVERY_MISSING_TITLE), `the message for ${id}`);
      expect(q.details()).toBeNull();
      expect(button(q.container, 'Back to deliveries')).toBeTruthy();
      q.unmount();
    }
  }, T);

  it('a sender opens its own delivery without the extra request and without the relay line', async () => {
    const p = open(`/business/${ACME.id}?shipment=shp-8`);
    await p.until(() => p.details() !== null, 'the delivery details');
    const polls = () => server.requests.filter((r) => r.endsWith('/dashboard')).length;
    const at = polls();
    await p.until(() => polls() >= at + 1, 'one more poll');
    expect(server.requests.filter((r) => r.includes('/shipments/'))).toEqual([]);
    expect(p.container.querySelector('.bp-held')).toBeNull();
    expect(textOf(p.details()!.querySelector('.bd-eyebrow')!)).toBe('Outgoing');
    expect(textOf(p.details()!)).toContain('$16.00');
  }, T);

  it('the page has no <main> of its own in any state', async () => {
    const p = open(`/business/${ATLAS.id}?shipment=shp-8`);
    expect(p.container.querySelector('main')).toBeNull(); // loading
    await p.until(() => p.details() !== null, 'the delivery details');
    expect(p.container.querySelector('main')).toBeNull();
    expect(p.container.querySelector('div.bp')).not.toBeNull();
    p.unmount();
    const gone = open('/business/biz-gone');
    await gone.until(() => gone.text().includes('This business is not in the current city'), 'the stale-link state');
    expect(gone.container.querySelector('main')).toBeNull();
  }, T);
});

describe('New delivery while the run is locked', () => {
  it('is disabled with the reason as text, and opens again once the run is back in planning', async () => {
    server.dashboards.set(ACME.id, { ...DASHBOARD, phase: 'locked' });
    const p = open(`/business/${ACME.id}`);
    await p.until(() => buttons(p.container, 'New delivery').length === 1, 'the toolbar');
    const btn = () => button(p.container, 'New delivery');
    expect(btn().disabled).toBe(true);
    const reason = p.container.querySelector('.bp-closed')!;
    expect(textOf(reason)).toBe(NEW_DELIVERY_CLOSED_TEXT);
    expect(textOf(reason)).toMatch(/simulation has started.*closed\. Press Back to start in the simulator to reopen them\.$/);
    expect(textOf(reason)).not.toMatch(/planning cycle/i);
    click(btn());
    expect(p.container.querySelector('form.nd')).toBeNull();
    expect(p.container.querySelector('form.nd-request')).toBeNull();
    // The rest of the page still works: a delivery opens.
    click(p.container.querySelector('tr.bw-row')!);
    expect(p.details()).not.toBeNull();

    // Back to start in the simulator returns the run to planning: the next poll opens it again.
    server.dashboards.set(ACME.id, { ...DASHBOARD, phase: 'planning', version: DASHBOARD.version + 1 });
    await p.until(() => !btn().disabled, 'New delivery to open again');
    expect(p.container.querySelector('.bp-closed')).toBeNull();
    click(btn());
    // New delivery opens on the request text box (#786); the form is one more press away.
    expect(p.container.querySelector('form.nd-request')).not.toBeNull();
    click(button(p.container, 'Fill in the form instead'));
    expect(p.container.querySelector('form.nd')).not.toBeNull();

    // Locked again with the form open: the form says why itself, so the line is not shown twice.
    server.dashboards.set(ACME.id, { ...DASHBOARD, phase: 'locked', version: DASHBOARD.version + 2 });
    await p.until(() => btn().disabled, 'New delivery to close again');
    expect(p.container.querySelector('.bp-closed')).toBeNull();
    expect(p.text().split(NEW_DELIVERY_CLOSED_TEXT).length - 1).toBe(1);
  }, T);

  it('the empty table\'s New delivery button is closed too', async () => {
    server.dashboards.set(ACME.id, { ...DASHBOARD, outgoing: [], incoming: [], phase: 'locked' });
    const p = open(`/business/${ACME.id}`);
    await p.until(() => buttons(p.container, 'New delivery').length === 2, 'both buttons');
    for (const b of buttons(p.container, 'New delivery')) expect(b.disabled).toBe(true);
    expect(textOf(p.container.querySelector('.bp-closed')!)).toBe(NEW_DELIVERY_CLOSED_TEXT);
  }, T);
});
