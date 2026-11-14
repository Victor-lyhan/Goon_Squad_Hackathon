// The MVP II Business workspace rendered from the REAL default NYC run (#514): every business at five moments
// of the day (start, inside an evening leg, midnight, inside a morning leg, end). The dashboards are the
// API's own views (server/api/v2/views.ts) on the committed fixtures/nyc; the page state comes from the real
// reducer of useBusinessWorkspace. No story ID, name or count is pinned (DECISIONS pass 54): every
// expectation is read from the dashboard the API returns.
import { describe, expect, it, vi } from 'vitest';
import type { BusinessDashboard } from '../../shared/v2/api';
import { ROLE_LINE, headerModel } from '../../client/src/components/business/v2/activity/activityModel';
import { INITIAL_TABLE, type TableState } from '../../client/src/components/business/v2/page/businessPageModel';
import { NO_FILTERS } from '../../client/src/components/business/v2/shipmentsTableModel';
import { formatCents } from '../../client/src/ui/format';
import { T, elements, forbiddenIn, realRun, renderPage, text, workspaceState } from './business-v2-real-helper';

vi.setConfig({ testTimeout: T, hookTimeout: T });

const real = realRun();
const { run } = real;
const businesses = run.scenario.businesses;

const table = (filters: Partial<TableState['filters']>): TableState =>
  ({ ...INITIAL_TABLE, filters: { ...NO_FILTERS, ...filters } });

const rowsOf = (html: string) => elements(html, 'tr', 'class="bw-row"');
const rowIds = (html: string) => rowsOf(html).map((r) => /<td data-label="Shipment ID"[^>]*>([^<]*)</.exec(r)![1]);
/** "Label (count)" of every option of the Status select, first one is "All statuses (N)". */
const statusOptions = (html: string) => {
  const select = /<select[^>]*class="bw-input"[^>]*>([\s\S]*?)<\/select>/.exec(html)![1];
  return [...select.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => {
    const x = /^(.*) \((\d+)\)$/.exec(m[1])!;
    return { label: x[1], count: Number(x[2]) };
  });
};
const notesOf = (html: string) => elements(html, 'li', 'class="ba-note');

describe.each(real.moments)('every business at $name (minute $timeMin)', ({ timeMin }) => {
  const moment = real.at(timeMin);
  const pages = businesses.map((b) => {
    const dashboard: BusinessDashboard = moment.dashboard(b.id);
    const state = workspaceState(moment.run, dashboard);
    return { b, dashboard, state, html: renderPage(state) };
  });

  it('the run has every business and the moment is inside the simulation', () => {
    expect(pages.length).toBe(businesses.length);
    expect(pages.length).toBeGreaterThan(0);
    expect(moment.snapshot.timeMin).toBe(timeMin);
  });

  it('header: name, address, relay-point role and the totals line from the dashboard', () => {
    for (const { b, dashboard: d, html } of pages) {
      const head = elements(html, 'header', 'class="ba-header"')[0];
      expect(head, b.id).toBeTruthy();
      const t = text(head);
      expect(t).toContain(d.business.name);
      expect(t).toContain(d.business.address);
      expect(t).toContain(ROLE_LINE);
      const line = `${d.totals.sent} sent · ${d.totals.matched} matched · ${d.totals.delivered} delivered · ${formatCents(d.totals.spendCents)} spend`;
      expect(headerModel(d).totalsLine).toBe(line);
      expect(head).toContain(`aria-label="Totals: ${line}"`);
      // The totals agree with the lists the same answer carries.
      expect(d.totals.sent).toBe(d.outgoing.length);
    }
  });

  it('the table has one row per outgoing and incoming delivery of the dashboard', () => {
    for (const { b, dashboard: d, html } of pages) {
      const expected = [...d.outgoing, ...d.incoming].map((v) => v.shipment.id).sort();
      if (expected.length === 0) {
        expect(text(html), b.id).toContain('No shipments yet');
        continue;
      }
      expect(rowIds(html).sort(), b.id).toEqual(expected);
      for (const v of [...d.outgoing, ...d.incoming]) {
        const row = rowsOf(html).find((r) => r.includes(`>${v.shipment.id}<`))!;
        expect(text(row)).toContain(v.shipment.label);
      }
    }
  });

  it('direction and status filter counts add up to the rows', () => {
    for (const { b, dashboard: d, state } of pages) {
      const total = d.outgoing.length + d.incoming.length;
      if (total === 0) continue;
      const all = renderPage(state);
      const [first, ...rest] = statusOptions(all);
      expect(first, b.id).toEqual({ label: 'All statuses', count: total });
      expect(rest.reduce((sum, o) => sum + o.count, 0), b.id).toBe(total);
      for (const o of rest) expect(o.count).toBeGreaterThan(0);

      const out = d.outgoing.length === 0 ? 0 : rowsOf(renderPage(state, { initialTable: table({ direction: 'outgoing' }) })).length;
      const inc = d.incoming.length === 0 ? 0 : rowsOf(renderPage(state, { initialTable: table({ direction: 'incoming' }) })).length;
      expect(out, b.id).toBe(d.outgoing.length);
      expect(inc, b.id).toBe(d.incoming.length);
      expect(out + inc).toBe(total);

      // Every status of the dashboard, filtered alone, shows exactly that many rows.
      for (const status of new Set([...d.outgoing, ...d.incoming].map((v) => v.status))) {
        const n = [...d.outgoing, ...d.incoming].filter((v) => v.status === status).length;
        expect(rowsOf(renderPage(state, { initialTable: table({ status }) })).length, `${b.id} ${status}`).toBe(n);
      }
    }
  });

  it('a search for a real package label finds its row', () => {
    for (const { b, dashboard: d, state } of pages) {
      for (const v of [...d.outgoing, ...d.incoming]) {
        const html = renderPage(state, { initialTable: table({ query: v.shipment.label }) });
        expect(rowIds(html), `${b.id} "${v.shipment.label}"`).toContain(v.shipment.id);
        // Upper case finds it too (the search is case-insensitive).
        const upper = renderPage(state, { initialTable: table({ query: v.shipment.label.toUpperCase() }) });
        expect(rowIds(upper)).toContain(v.shipment.id);
      }
    }
  });

  it('the activity list shows the server messages, relay-point ones included, each with its link', () => {
    for (const { b, dashboard: d, html } of pages) {
      const notes = notesOf(html);
      expect(notes.length, b.id).toBe(Math.min(d.notifications.length, 20));
      for (const [i, n] of d.notifications.slice(0, 20).entries()) {
        expect(text(notes[i])).toContain(n.message);
        if (n.shipmentId) expect(text(notes[i])).toContain(`Open ${n.shipmentId}`);
      }
      for (const n of d.notifications.filter((x) => x.message.includes('(relay point)'))) {
        const plan = run.assignments.plans.find((p) => p.shipmentId === n.shipmentId)!;
        const relay = businesses.find((x) => x.id === plan.relayBusinessId)!;
        expect(n.message).toContain(`via ${relay.name} (relay point)`);
        const note = notes.find((x) => text(x).includes(n.message));
        if (note) expect(note).toMatch(/<button type="button" class="ba-note__btn"/);
      }
    }
  });

  it('the real run has relay-point messages, and they reach the page', () => {
    const relayPlans = run.assignments.plans.filter((p) => p.kind === 'relay');
    const shown = pages.flatMap((p) => notesOf(p.html).map(text)).filter((t) => t.includes('(relay point)'));
    expect(shown.length > 0).toBe(relayPlans.length > 0);
  });

  it('never shows undefined, NaN, null, Invalid, "hub" or "synthetic"', () => {
    for (const { b, html } of pages) expect(forbiddenIn(html), b.id).toEqual([]);
    for (const { b, state } of pages) {
      const open = renderPage(state, { initialNewOpen: true });
      expect(forbiddenIn(open), `${b.id} with New delivery open`).toEqual([]);
    }
  });
});

describe('a relay point sees the packages it holds', () => {
  // BUG (#514): a business that is only the relay point of a plan gets no notification and no row, so its
  // workspace never shows that it holds a package overnight (DECISIONS pass 50 says the notifications panel
  // is where it sees this role). The business notifications are emitted in server/api/v2/pipeline.ts
  // (`materializeAssignment`: only the sender and the recipient get one). Outside this issue's files.
  it.fails('every relay business has a notification about each package it relays', () => {
    const moment = real.at(run.scenario.settings.simEndMin);
    const relayPlans = run.assignments.plans.filter((p) => p.kind === 'relay' && p.relayBusinessId);
    expect(relayPlans.length).toBeGreaterThan(0);
    for (const plan of relayPlans) {
      const d = moment.dashboard(plan.relayBusinessId!);
      const html = renderPage(workspaceState(moment.run, d));
      expect(d.notifications.map((n) => n.shipmentId), plan.relayBusinessId).toContain(plan.shipmentId);
      expect(text(html)).toContain('Relay point');
    }
  });
});
