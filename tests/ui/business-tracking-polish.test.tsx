// @vitest-environment jsdom
// Business deliveries list and delivery details, design audit (#881). Pins the list's three states
// (loading, no deliveries yet, error with a retry), and each fix of the audit: plain words ("deliveries",
// never a raw ID, "hub" or "trip id"), the simulator's status words, sentence-case labels, the heading order,
// Enter / Space on a row, Close right after the heading, the journey link at the top of a matched delivery,
// and the CSS rules behind the 390 px and 900 px layouts.
import { readFileSync } from 'node:fs';
import { act, useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentProgress } from '../../shared/v2/types';
import { DeliveryDetails } from '../../client/src/components/business/v2/DeliveryDetails';
import { UNTITLED_PACKAGE, deliveryDetails } from '../../client/src/components/business/v2/deliveryDetailsModel';
import { simulatorHref } from '../../client/src/components/business/v2/links';
import { initialBusinessWorkspaceState } from '../../client/src/components/business/v2/live/businessWorkspaceState';
import { BusinessPageView } from '../../client/src/components/business/v2/page/BusinessPageView';
import {
  ShipmentsListLoadContext, ShipmentsTable, useShipmentsListLoad, type ShipmentsListLoad,
} from '../../client/src/components/business/v2/ShipmentsTable';
import { ShipmentsToolbar } from '../../client/src/components/business/v2/ShipmentsToolbar';
import {
  LIST_EMPTY_TEXT, LIST_EMPTY_TITLE, LIST_ERROR_TEXT, LIST_ERROR_TITLE, LIST_LOADING_TEXT, LIST_STALE_TEXT,
  NAMES_WAIT_MS, NO_MATCH, STATUS_ORDER, buildRows, listLoadKind, namesMissing, shipmentCountText, shipmentStatusLabel,
  statusCounts,
} from '../../client/src/components/business/v2/shipmentsTableModel';
import {
  NO_MATCH as SIM_NO_MATCH, SHIPMENT_STATUS_TEXT, UNTITLED_PACKAGE as SIM_UNTITLED,
} from '../../client/src/components/sim/v2/packages/statusText';
import BusinessV2 from '../../client/src/pages/v2/BusinessV2';
import { BUSINESSES as DETAIL_BUSINESSES, EMPLOYEES, relayPlan, shipment as detailShipment, unmatchedView, view as detailView } from './business-v2-details-sample';
import { BUSINESSES as PAGE_BUSINESSES, DASHBOARD as PAGE_DASHBOARD, EMPLOYEES as PAGE_EMPLOYEES, ready } from './business-v2-page-sample';
import { BUSINESSES, DASHBOARD, EMPTY_DASHBOARD } from './business-v2-table-sample';
import { button, click, deferred, flush, mount, press, tabOrder, textOf } from './kitDom';

const T = 10_000;
const DIR = 'client/src/components/business/v2';
const css = (file: string) => readFileSync(`${DIR}/${file}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const WORKSPACE_CSS = css('businessWorkspace.css');
const DETAILS_CSS = css('deliveryDetails.css');
/** The body of the first `@media (<query>) { … }` block of a stylesheet. */
function media(sheet: string, query: string): string {
  const start = sheet.indexOf(`@media (${query})`);
  expect(start, `@media (${query})`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = sheet.indexOf('{', start); i < sheet.length; i += 1) {
    if (sheet[i] === '{') depth += 1;
    else if (sheet[i] === '}' && (depth -= 1) === 0) return sheet.slice(sheet.indexOf('{', start) + 1, i);
  }
  throw new Error(`unclosed @media (${query})`);
}

/** What a person sees: the text outside `[hidden]` elements and the screen-reader-only spans. */
function shownText(root: Element): string {
  const copy = root.cloneNode(true) as Element;
  copy.querySelectorAll('[hidden], .bw-visually-hidden, .bd-visually-hidden').forEach((e) => e.remove());
  return textOf(copy);
}
/** Raw IDs and the words the polish backlog rules out. */
const JARGON = /\b(?:shp|plan|emp|biz|home|job|ntf)-[\w-]+|\bhub\b|trip ?id/i;

const ROWS = buildRows(DASHBOARD, BUSINESSES);
const noop = () => {};

function list(over: Partial<Parameters<typeof ShipmentsTable>[0]> = {}) {
  return mount(
    <ShipmentsTable rows={ROWS} totalCount={ROWS.length} sort={{ key: 'ready', dir: 'asc' }} onSort={noop}
      selectedId={null} onSelect={noop} onNewDelivery={noop} onClearFilters={noop} {...over} />,
  ).container;
}

const RELAY_VIEW = detailView(relayPlan, 'at_hub');
function details(view = RELAY_VIEW, onClose: () => void = noop) {
  return mount(
    <DeliveryDetails view={view} businesses={DETAIL_BUSINESSES} employees={EMPLOYEES} viewerBusinessId="biz-acme"
      phase="planning" onClose={onClose} onRetryMatch={noop} />,
  ).container;
}

describe('the list\'s three states, in plain words (#881)', () => {
  it('loading: one line, no table, nothing to press', () => {
    const c = list({ load: { kind: 'loading' } });
    const box = c.querySelector('.bw-empty')!;
    expect(box.getAttribute('role')).toBe('status');
    expect(textOf(box)).toBe(LIST_LOADING_TEXT);
    expect(LIST_LOADING_TEXT).toBe('Loading deliveries…');
    expect(c.querySelector('table')).toBeNull();
    expect(c.querySelectorAll('button')).toHaveLength(0);
  }, T);

  it('empty: "No deliveries yet", what to do, and the New delivery button', () => {
    let opened = 0;
    const c = list({ rows: [], totalCount: 0, onNewDelivery: () => { opened += 1; } });
    const box = c.querySelector('.bw-empty')!;
    expect(box.getAttribute('role')).toBe('status');
    expect(textOf(box.querySelector('h2')!)).toBe('No deliveries yet');
    expect(LIST_EMPTY_TITLE).toBe('No deliveries yet');
    expect(textOf(box.querySelector('.bw-empty__text')!)).toBe(LIST_EMPTY_TEXT);
    expect(LIST_EMPTY_TEXT).toMatch(/^Choose New delivery\b.*\bRelay matches it to an employee’s commute\.$/);
    click(button(box, 'New delivery'));
    expect(opened).toBe(1);
    expect(c.querySelector('table')).toBeNull();
  }, T);

  it('error with nothing loaded: says what happened and what to do, with a retry that runs once per press', async () => {
    const pending = deferred<void>();
    let calls = 0;
    const c = list({ rows: [], totalCount: 0, load: { kind: 'error', onRetry: () => { calls += 1; return pending.promise; } } });
    const box = c.querySelector('.bw-empty')!;
    expect(box.getAttribute('role')).toBe('alert');
    expect(textOf(box.querySelector('h2')!)).toBe(LIST_ERROR_TITLE);
    expect(textOf(box)).toContain(LIST_ERROR_TEXT);
    // Not the empty state: nobody knows yet whether there are deliveries.
    expect(textOf(box)).not.toContain(LIST_EMPTY_TITLE);
    expect(c.querySelector('table')).toBeNull();

    click(button(box, 'Try again'));
    expect(calls).toBe(1);
    const busy = button(box, 'Trying again…');
    expect(busy.disabled).toBe(true);
    click(busy);
    expect(calls).toBe(1);
    pending.resolve();
    await flush();
    expect(button(box, 'Try again').disabled).toBe(false);
  }, T);

  it('error with rows on screen: the rows stay, under one line with the retry', async () => {
    let calls = 0;
    const c = list({ load: { kind: 'error', onRetry: () => { calls += 1; } } });
    expect(c.querySelectorAll('tr.bw-row')).toHaveLength(ROWS.length);
    const line = c.querySelector('.bw-stale')!;
    expect(line.getAttribute('role')).toBe('status');
    expect(textOf(line.querySelector('span')!)).toBe(LIST_STALE_TEXT);
    // The line comes before the table, so it is read and reached first.
    expect(line.compareDocumentPosition(c.querySelector('table')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    click(button(line, 'Try again'));
    await flush();
    expect(calls).toBe(1);
    // A failed retry leaves the button usable.
    const failing = list({ load: { kind: 'error', onRetry: () => Promise.reject(new Error('down')) } });
    click(button(failing, 'Try again'));
    await flush();
    expect(button(failing, 'Try again').disabled).toBe(false);
  }, T);

  it('the state words say what is wrong and how to go on, without jargon or an apology', () => {
    for (const text of [LIST_LOADING_TEXT, LIST_EMPTY_TITLE, LIST_EMPTY_TEXT, LIST_ERROR_TITLE, LIST_ERROR_TEXT, LIST_STALE_TEXT]) {
      expect(text).not.toMatch(JARGON);
      expect(text).not.toMatch(/sorry|oops|shipment|request failed|\b\d{3}\b/i);
    }
    expect(shipmentCountText(1)).toBe('1 delivery');
    expect(shipmentCountText(3)).toBe('3 deliveries');
  });
});

describe('which state the page gives the list (#881)', () => {
  const base = { ...initialBusinessWorkspaceState, view: 'ready' as const, dashboard: DASHBOARD, businesses: BUSINESSES };

  it('ready with deliveries and names; loading before the first answer and while the names are missing', () => {
    expect(listLoadKind(base)).toBe('ready');
    expect(listLoadKind(initialBusinessWorkspaceState)).toBe('loading');
    // Deliveries without the business directory would read "Unknown business": still loading.
    expect(listLoadKind({ ...base, businesses: [] })).toBe('loading');
    // No deliveries: nothing needs a name, so the empty state shows at once.
    expect(listLoadKind({ ...base, dashboard: EMPTY_DASHBOARD, businesses: [] })).toBe('ready');
    expect(namesMissing({ ...base, businesses: [] })).toBe(true);
    for (const s of [base, initialBusinessWorkspaceState, { ...base, dashboard: EMPTY_DASHBOARD, businesses: [] }]) {
      expect(namesMissing(s)).toBe(false);
    }
  });

  it('names that stay missing: the list stops waiting and keeps its rows under the line with the retry', () => {
    expect(listLoadKind({ ...base, businesses: [] }, true)).toBe('error');
    // Only that one state changes: the others do not depend on the wait.
    expect(listLoadKind(base, true)).toBe('ready');
    expect(listLoadKind(initialBusinessWorkspaceState, true)).toBe('loading');
    expect(listLoadKind({ ...base, dashboard: EMPTY_DASHBOARD, businesses: [] }, true)).toBe('ready');
    // About three polls of one second each.
    expect(NAMES_WAIT_MS).toBe(3000);
  });

  it('the hook: "Loading deliveries…" for the wait, then rows with the retry; names that arrive clear it', async () => {
    function Harness({ businesses, onRetry }: { businesses: typeof BUSINESSES; onRetry: () => void }) {
      const load = useShipmentsListLoad({ ...base, businesses }, onRetry);
      const rows = buildRows(DASHBOARD, businesses);
      return (
        <ShipmentsTable rows={rows} totalCount={rows.length} sort={{ key: 'ready', dir: 'asc' }} onSort={noop} selectedId={null}
          onSelect={noop} onNewDelivery={noop} onClearFilters={noop} load={load} />
      );
    }
    vi.useFakeTimers();
    try {
      let retries = 0;
      const retry = () => { retries += 1; };
      const m = mount(<Harness businesses={[]} onRetry={retry} />);
      const c = m.container;
      expect(textOf(c.querySelector('.bw-empty')!)).toBe(LIST_LOADING_TEXT);
      act(() => { vi.advanceTimersByTime(NAMES_WAIT_MS - 1); });
      expect(c.querySelector('table')).toBeNull();
      act(() => { vi.advanceTimersByTime(1); });
      // The rows, as they read without the names, under the line that offers the retry.
      expect(c.querySelectorAll('tr.bw-row')).toHaveLength(ROWS.length);
      expect([...c.querySelectorAll('td[data-label="Business"]')].map(textOf)).toEqual(ROWS.map(() => 'Unknown business'));
      expect(textOf(c.querySelector('.bw-stale span')!)).toBe(LIST_STALE_TEXT);
      click(button(c.querySelector('.bw-stale')!, 'Try again'));
      await act(async () => {});
      expect(retries).toBe(1);

      // The names arrive: the line goes and every row has its business.
      m.rerender(<Harness businesses={BUSINESSES} onRetry={retry} />);
      expect(c.querySelector('.bw-stale')).toBeNull();
      expect(textOf(c)).not.toContain('Unknown business');
      act(() => { vi.advanceTimersByTime(NAMES_WAIT_MS * 2); });
      expect(c.querySelector('.bw-stale')).toBeNull();

      // Names that arrive inside the wait never show the line; a new wait starts from zero.
      const quick = mount(<Harness businesses={[]} onRetry={retry} />);
      act(() => { vi.advanceTimersByTime(NAMES_WAIT_MS - 1); });
      quick.rerender(<Harness businesses={BUSINESSES} onRetry={retry} />);
      act(() => { vi.advanceTimersByTime(NAMES_WAIT_MS); });
      expect(quick.container.querySelectorAll('tr.bw-row')).toHaveLength(ROWS.length);
      expect(quick.container.querySelector('.bw-stale')).toBeNull();
      quick.rerender(<Harness businesses={[]} onRetry={retry} />);
      expect(textOf(quick.container.querySelector('.bw-empty')!)).toBe(LIST_LOADING_TEXT);
    } finally {
      vi.useRealTimers();
    }
  }, T);

  it('error when the deliveries could not be read or the last update failed', () => {
    expect(listLoadKind({ ...base, reconnecting: true })).toBe('error');
    expect(listLoadKind({ ...initialBusinessWorkspaceState, view: 'error' })).toBe('error');
    expect(listLoadKind({ ...initialBusinessWorkspaceState, view: 'unavailable' })).toBe('error');
    // A stale business link has no list; the page shows its own screen.
    expect(listLoadKind({ ...initialBusinessWorkspaceState, view: 'not_found' })).toBe('ready');
  });

  it('the page reads it from the hook state and hands it to the list through the context', () => {
    const src = readFileSync('client/src/pages/v2/BusinessV2.tsx', 'utf8');
    expect(src).toContain('const listLoad = useShipmentsListLoad(ws, ws.refetchNow);');
    expect(src).toMatch(/<ShipmentsListLoadContext\.Provider value=\{listLoad\}>\s*<BusinessPageView/);
  });

  it('through the page view: the context reaches the list, rows stay, and Try again runs the page\'s retry', async () => {
    let retries = 0;
    const load: ShipmentsListLoad = { kind: 'error', onRetry: () => { retries += 1; } };
    const c = mount(
      <ShipmentsListLoadContext.Provider value={load}>
        <BusinessPageView state={{ ...ready(), reconnecting: true }} shipmentId={null}
          createShipment={async () => { throw new Error('not called'); }} matchShipment={async () => { throw new Error('not called'); }}
          refetchNow={async () => {}} dismissRunChanged={noop} onOpenShipment={noop} onCloseShipment={noop}
          businessHref={(b) => `/business/${b}`} />
      </ShipmentsListLoadContext.Provider>,
    ).container;
    const rows = PAGE_DASHBOARD.outgoing.length + PAGE_DASHBOARD.incoming.length;
    expect(c.querySelectorAll('tr.bw-row')).toHaveLength(rows);
    click(button(c.querySelector('.bw-stale')!, 'Try again'));
    await flush();
    expect(retries).toBe(1);
    // Without a provider the list is ready: no line, no box.
    const plain = list();
    expect(plain.querySelector('.bw-stale')).toBeNull();
    // The `load` prop wins over the context.
    const both = mount(
      <ShipmentsListLoadContext.Provider value={{ kind: 'loading' }}>
        <ShipmentsTable rows={ROWS} totalCount={ROWS.length} sort={{ key: 'ready', dir: 'asc' }} onSort={noop} selectedId={null}
          onSelect={noop} onNewDelivery={noop} onClearFilters={noop} load={{ kind: 'ready' }} />
      </ShipmentsListLoadContext.Provider>,
    ).container;
    expect(both.querySelectorAll('tr.bw-row')).toHaveLength(ROWS.length);
  }, T);
});

describe('the real page when the business names never load (#881)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('"Loading deliveries…" first, then the rows under the line with the retry; Try again brings the names', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
    const me = PAGE_DASHBOARD.business.id;
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    // /api/v2 with a dashboard that answers and two directories that do not.
    let namesDown = true;
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === `/api/v2/businesses/${me}/dashboard`) return json(200, PAGE_DASHBOARD);
      if (url === '/api/v2/businesses') return namesDown ? json(500, { error: 'down' }) : json(200, { businesses: PAGE_BUSINESSES });
      if (url === '/api/v2/employees') return namesDown ? json(500, { error: 'down' }) : json(200, { employees: PAGE_EMPLOYEES });
      if (url === '/api/v2/map') return json(200, { runId: 'run-1', businesses: PAGE_BUSINESSES, homes: [], employees: [], polylines: [] });
      return json(404, { error: `No such route: ${url}` });
    });
    const c = mount(
      <MemoryRouter initialEntries={[`/business/${me}`]}>
        <Routes><Route path="/business/:id" element={<BusinessV2 />} /></Routes>
      </MemoryRouter>,
    ).container;
    /** Waits in real time (the page polls every second) until `ok()` holds. */
    const until = async (ok: () => boolean, what: string, ms: number) => {
      const end = Date.now() + ms;
      while (!ok() && Date.now() < end) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      if (!ok()) throw new Error(`timed out waiting for ${what}; page: ${textOf(c).slice(0, 400)}`);
    };
    const total = PAGE_DASHBOARD.outgoing.length + PAGE_DASHBOARD.incoming.length;

    await until(() => textOf(c).includes(LIST_LOADING_TEXT), 'the loading line', 10_000);
    expect(c.querySelector('tr.bw-row')).toBeNull();
    // Not for good: after the wait the deliveries show without the names, and the line offers the retry.
    await until(() => c.querySelector('.bw-stale') !== null, 'the rows and the line with the retry', NAMES_WAIT_MS + 15_000);
    expect(textOf(c)).not.toContain(LIST_LOADING_TEXT);
    expect(c.querySelectorAll('tr.bw-row')).toHaveLength(total);
    expect([...c.querySelectorAll('td[data-label="Business"]')].map(textOf)).toEqual(Array.from({ length: total }, () => 'Unknown business'));

    namesDown = false;
    click(button(c.querySelector('.bw-stale')!, 'Try again'));
    await until(() => c.querySelector('.bw-stale') === null, 'the names', 10_000);
    expect(c.querySelectorAll('tr.bw-row')).toHaveLength(total);
    expect(textOf(c.querySelector('table')!)).not.toContain('Unknown business');
  }, 60_000);
});

describe('plain words on the list and the details (#881)', () => {
  it('status words are the simulator\'s, one for one, and so are "No match" and the untitled package', () => {
    for (const status of Object.keys(SHIPMENT_STATUS_TEXT) as ShipmentProgress[]) {
      expect(shipmentStatusLabel(status), status).toBe(SHIPMENT_STATUS_TEXT[status]);
    }
    expect([...STATUS_ORDER].sort()).toEqual(Object.keys(SHIPMENT_STATUS_TEXT).sort());
    expect(statusCounts(ROWS).map((c) => c.label)).toEqual(STATUS_ORDER.map((s) => SHIPMENT_STATUS_TEXT[s]));
    // The details' progress steps use the same words.
    const steps = deliveryDetails(RELAY_VIEW, { businesses: DETAIL_BUSINESSES, employees: EMPLOYEES, viewerBusinessId: 'biz-acme' }).steps;
    for (const s of steps) expect(s.label).toBe(SHIPMENT_STATUS_TEXT[s.key]);
    expect(NO_MATCH).toBe(SIM_NO_MATCH);
    expect(ROWS.find((r) => r.planKind === null)!.planLabel).toBe('No match');
    expect(UNTITLED_PACKAGE).toBe(SIM_UNTITLED);
    const untitled = detailView(relayPlan, 'scheduled', {}, { label: '  ' });
    expect(deliveryDetails(untitled, { businesses: DETAIL_BUSINESSES, employees: EMPLOYEES, viewerBusinessId: 'biz-acme' }).header.label)
      .toBe('Untitled package');
  });

  it('the list shows no raw ID, "hub" or "trip id"; the ID stays in a hidden cell as the row\'s key', () => {
    const c = list();
    expect(shownText(c)).not.toMatch(JARGON);
    expect(shownText(c)).toContain('At relay point');
    const hidden = [...c.querySelectorAll('[hidden]')];
    expect(hidden.map((e) => e.tagName)).toEqual(['TH', ...ROWS.map(() => 'TD')]);
    expect(hidden.slice(1).map(textOf).sort()).toEqual(ROWS.map((r) => r.id).sort());
    // The hidden header's sort button is not a tab stop.
    expect(tabOrder(c).map(textOf)).not.toContain('Shipment ID');
    // No layout may bring the column back (the stacked rows set `display` on every cell).
    expect(WORKSPACE_CSS).toMatch(/\.bw-table tr > \[hidden\]\s*\{\s*display: none !important;\s*\}/);
  }, T);

  it('the toolbar says "Deliveries" and its search hint names no ID', () => {
    const c = mount(
      <ShipmentsToolbar onQueryChange={noop} direction="all" onDirectionChange={noop} status="all" onStatusChange={noop}
        counts={statusCounts(ROWS)} total={ROWS.length} onNewDelivery={noop} />,
    ).container;
    expect(c.querySelector('[role="search"]')!.getAttribute('aria-label')).toBe('Deliveries');
    expect(c.querySelector('input[type="search"]')!.getAttribute('placeholder')).toBe('Package, business or relay point');
    expect(shownText(c)).not.toMatch(/shipment|\bID\b/i);
  }, T);

  it('the details show no raw ID, "hub" or "trip id", for a relay, a delivered and an unmatched delivery', () => {
    for (const v of [RELAY_VIEW, detailView(relayPlan, 'delivered', { deliveredAtMin: 1985 }), unmatchedView()]) {
      const panel = details(v).querySelector('.bd-panel')!;
      expect(shownText(panel), v.status).not.toMatch(JARGON);
      expect(shownText(panel)).not.toMatch(/Shipment ID/);
    }
    // Sender and recipient: name, then the neighbourhood after a comma (no middle dot).
    const parties = textOf(details().querySelector('.bd-parties')!);
    expect(parties).toBe('FromAcme Studio, ChelseaToBakery Row, Williamsburg');
  }, T);

  it('times and prices are in mono elements, words are not', () => {
    const c = list();
    for (const label of ['Ready', 'Deadline', 'Delivery', 'Price']) {
      for (const td of c.querySelectorAll(`td[data-label="${label}"]`)) expect(td.classList.contains('bw-mono'), label).toBe(true);
    }
    for (const label of ['Package', 'Direction', 'Business', 'Status', 'Plan']) {
      for (const td of c.querySelectorAll(`td[data-label="${label}"]`)) expect(td.classList.contains('bw-mono'), label).toBe(false);
    }
    const panel = details().querySelector('.bd-panel')!;
    const mono = [...panel.querySelectorAll('.bd-mono')].map(textOf);
    expect(mono).toContain('$16.00');
    expect(mono.filter((t) => /^Day \d, \d{1,2}:\d{2} [AP]M$/.test(t)).length).toBeGreaterThanOrEqual(5); // ETA, stops, ready, deadline
    // Every time and price the panel shows is inside a mono element.
    const outside = panel.cloneNode(true) as Element;
    outside.querySelectorAll('.bd-mono').forEach((e) => e.remove());
    expect(textOf(outside)).not.toMatch(/\d{1,2}:\d{2} [AP]M|\$\d/);
  }, T);
});

describe('hierarchy and consistent controls (#881)', () => {
  it('the list has an h2 in every state: "Deliveries" in the caption, the state\'s title in a box', () => {
    const table = list();
    const caption = table.querySelector('caption')!;
    expect([...table.querySelectorAll('h2')].map(textOf)).toEqual(['Deliveries']);
    expect(caption.querySelector('h2.bw-table__title')).not.toBeNull();
    // "Deliveries 4": the number alone on screen, the word for a screen reader.
    expect(textOf(caption.querySelector('.bw-table__count')!)).toBe(`${ROWS.length} deliveries`);
    expect(shownText(caption)).toBe(`Deliveries ${ROWS.length}`);
    for (const c of [list({ load: { kind: 'loading' } }), list({ rows: [], totalCount: 0 }), list({ rows: [] }),
      list({ rows: [], totalCount: 0, load: { kind: 'error', onRetry: noop } })]) {
      expect(c.querySelectorAll('h2')).toHaveLength(1);
      expect(c.querySelector('h2')!.getAttribute('tabindex')).toBe('-1'); // focus lands here when a delivery closes
    }
  }, T);

  it('the details: h2 name, then Close, then the direction as a plain line; h3 for each section', () => {
    const panel = details().querySelector('.bd-panel')!;
    const head = panel.querySelector('.bd-head__top')!;
    expect([...head.children].map((e) => e.tagName)).toEqual(['H2', 'BUTTON']);
    expect(textOf(panel.querySelector('.bd-kind')!)).toBe('Outgoing');
    expect(panel.querySelector('.bd-head__top .bd-eyebrow')).toBeNull();
    expect([...panel.querySelectorAll('h3')].map(textOf)).toEqual(['Progress', 'Carriers', 'Package']);
    expect(panel.querySelectorAll('h1, h4')).toHaveLength(0);
  }, T);

  it('no tracked capitals: labels, column headers and section titles are sentence case', () => {
    for (const sheet of [WORKSPACE_CSS, DETAILS_CSS]) {
      expect(sheet).not.toMatch(/text-transform:\s*uppercase/);
      expect(sheet).not.toMatch(/letter-spacing:\s*0\.\d+em/);
    }
  });

  it('one focus ring: every :focus-visible rule of both files is the 2 px ink outline (#956), never a shadow', () => {
    for (const sheet of [WORKSPACE_CSS, DETAILS_CSS]) {
      const rules = [...sheet.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g)];
      expect(rules.length).toBeGreaterThanOrEqual(3);
      for (const [, selector, body] of rules) {
        expect(body, selector.trim()).toMatch(/outline: 2px solid var\(--ns-ink, #0B0F17\)/);
        expect(body, selector.trim()).not.toMatch(/box-shadow|outline: none/);
      }
    }
  });

  it('the state boxes are left-aligned like the page, and an error box carries the danger edge', () => {
    const box = /\.bw-empty\s*\{([^}]*)\}/.exec(WORKSPACE_CSS)![1];
    expect(box).not.toMatch(/text-align/);
    expect(WORKSPACE_CSS).toMatch(/\.bw-empty\[role='alert'\]\s*\{\s*border-left: 2px solid var\(--danger, #A4322A\);\s*\}/);
    expect(/\.bw-stale\s*\{([^}]*)\}/.exec(WORKSPACE_CSS)![1]).toMatch(/border-left: 2px solid var\(--danger, #A4322A\)/);
  });
});

describe('keyboard and screen reader (#881)', () => {
  it('rows are tab stops; Enter and Space open the delivery and Space does not scroll the page', () => {
    const opened: string[] = [];
    const c = list({ onSelect: (id) => opened.push(id) });
    const rows = [...c.querySelectorAll<HTMLElement>('tr.bw-row')];
    expect(tabOrder(c).filter((e) => e.tagName === 'TR')).toEqual(rows);
    rows[0].focus();
    press('Enter');
    press(' ');
    expect(opened).toEqual([ROWS[0].id, ROWS[0].id]);
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    rows[1].dispatchEvent(space);
    expect(space.defaultPrevented).toBe(true);
    // Any other key is left alone.
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    rows[1].dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(opened).toHaveLength(3);
  }, T);

  it('the panel is named by its heading, the heading takes focus when it opens, and the next Tab stop is Close', () => {
    const c = details();
    const panel = c.querySelector('.bd-panel')!;
    const heading = panel.querySelector('h2')!;
    expect(panel.tagName).toBe('SECTION');
    expect(panel.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
    const stops = tabOrder(panel);
    expect(stops[0].getAttribute('aria-label')).toBe('Close delivery details');
    // Close comes after the heading in the document, so Tab from the focused heading reaches it first.
    expect(heading.compareDocumentPosition(stops[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }, T);

  it('Esc closes the panel and focus returns to the delivery\'s row', () => {
    function Page() {
      const [id, setId] = useState<string | null>(null);
      return (
        <>
          <ShipmentsTable rows={ROWS} totalCount={ROWS.length} sort={{ key: 'ready', dir: 'asc' }} onSort={noop}
            selectedId={id} onSelect={setId} onNewDelivery={noop} onClearFilters={noop} />
          {id && <DeliveryDetails view={{ ...RELAY_VIEW, shipment: detailShipment({ id }) }} businesses={DETAIL_BUSINESSES}
            employees={EMPLOYEES} viewerBusinessId="biz-acme" phase="planning" onClose={() => setId(null)} />}
        </>
      );
    }
    const c = mount(<Page />).container;
    const row = c.querySelectorAll<HTMLElement>('tr.bw-row')[1];
    row.focus();
    press(' ');
    expect(document.activeElement).toBe(c.querySelector('.bd-panel h2'));
    expect(row.getAttribute('aria-selected')).toBe('true');
    press('Escape');
    expect(c.querySelector('.bd-panel')).toBeNull();
    expect(document.activeElement).toBe(row);
  }, T);
});

describe('the journey link of a delivery (#881)', () => {
  it('a matched delivery: one link, in the result at the top, that opens this package\'s journey playing', () => {
    const panel = details().querySelector('.bd-panel')!;
    const links = [...panel.querySelectorAll<HTMLAnchorElement>('a[href^="/simulator"]')];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe(`/simulator?package=${RELAY_VIEW.shipment.id}&play=1`);
    expect(links[0].getAttribute('href')).toBe(simulatorHref(RELAY_VIEW.shipment.id));
    expect(links[0].closest('.bd-result')).not.toBeNull();
    expect(panel.querySelector('.bd-footer')).toBeNull();
    // It comes before the carrier links, right after Close.
    expect(tabOrder(panel)[1]).toBe(links[0]);
    // README step 5 quotes this label in bold (tests/api/v2-readme-demo.test.ts), so it stays.
    expect(textOf(links[0])).toBe('View journey');
  }, T);

  it('an unmatched delivery: the link stays at the end, after the retry', () => {
    const panel = details(unmatchedView()).querySelector('.bd-panel')!;
    const links = [...panel.querySelectorAll<HTMLAnchorElement>('a[href^="/simulator"]')];
    expect(links).toHaveLength(1);
    expect(links[0].closest('.bd-footer')).not.toBeNull();
    expect(tabOrder(panel).map((e) => e.getAttribute('aria-label') ?? textOf(e))).toEqual(['Close delivery details', 'Try matching again', 'View journey']);
  }, T);

  it('an ID with odd characters is encoded, never cut', () => {
    expect(simulatorHref('shp 1&x=2')).toBe('/simulator?package=shp%201%26x%3D2&play=1');
  });
});

describe('390 px and 900 px (#881)', () => {
  it('390 px: rows stack inside the box, the package name is the card\'s title, controls are 44 px', () => {
    const narrow = media(WORKSPACE_CSS, 'max-width: 640px');
    expect(narrow).toMatch(/\.bw-table-wrap\s*\{\s*overflow-x: hidden;\s*\}/);
    expect(narrow).toMatch(/\.bw-table td\s*\{[^}]*display: grid;[^}]*overflow-wrap: anywhere;/);
    expect(narrow).toMatch(/\.bw-table td\.bw-cell--primary\s*\{[^}]*display: block;/);
    expect(narrow).toMatch(/\.bw-table td\.bw-cell--primary::before\s*\{\s*content: none;\s*\}/);
    expect(narrow).toMatch(/\.bw-input, \.bw-btn, \.bw-segmented__btn\s*\{\s*height: 44px;\s*\}/);
    // The package cell is the first cell of every row, so the card starts with the name.
    for (const row of list().querySelectorAll('tr.bw-row')) expect(row.firstElementChild!.className).toBe('bw-cell--primary');
    const phone = media(DETAILS_CSS, 'max-width: 480px');
    expect(phone).toMatch(/\.bd-btn\s*\{\s*height: 44px;\s*\}/);
  });

  it('above 640 px a table that does not fit scrolls inside its own box; "Outgoing" is never broken', () => {
    expect(media(WORKSPACE_CSS, 'min-width: 641px')).toMatch(/\.bw-table-wrap\s*\{\s*overflow-x: auto;\s*\}/);
    expect(WORKSPACE_CSS).toMatch(/\.bw-table td\[data-label='Direction'\]\s*\{\s*white-space: nowrap;\s*\}/);
  });

  it('900 px: the details panel fills the one-column page, and long names wrap instead of pushing Close out', () => {
    expect(media(DETAILS_CSS, 'max-width: 1160px')).toMatch(/\.bd-panel\s*\{\s*max-width: none;\s*\}/);
    const title = /\.bd-title\s*\{([^}]*)\}/.exec(DETAILS_CSS)![1];
    expect(title).toMatch(/min-width: 0;/);
    expect(title).toMatch(/overflow-wrap: anywhere;/);
    // A stop's time keeps its own column; the place wraps under the place.
    expect(/\.bd-stop\s*\{([^}]*)\}/.exec(DETAILS_CSS)![1]).toMatch(/grid-template-columns: auto minmax\(0, 1fr\);/);
    const stop = details().querySelector('.bd-stop')!;
    expect([...stop.children].map((e) => e.className)).toEqual(['bd-mono', 'bd-stop__what']);
  }, T);
});
