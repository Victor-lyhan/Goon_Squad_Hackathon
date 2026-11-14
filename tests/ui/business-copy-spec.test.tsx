// Spec §3A copy audit with real Demo-city data (DECISIONS pass 7).
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { businessDashboard, shipmentView } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';
import type { ShipmentResponse, ShipmentView } from '../../shared/api';
import { MatchResultCard } from '../../client/src/components/business/MatchResultCard';
import { TrackingDetail } from '../../client/src/components/business/TrackingDetail';
import { SummaryCards } from '../../client/src/components/business/SummaryCards';
import { NotificationList } from '../../client/src/components/business/NotificationList';

const BAD = [/NaN/, /undefined/, /\bnull\b/, /n-\d+-\d+/];
const clean = (html: string, where: string) => {
  for (const re of BAD) expect(re.test(html), `${where}: ${re}`).toBe(false);
  expect(html.length).toBeGreaterThan(0);
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');

describe('spec §3A copy on real packages', () => {
  const run = createInitialRun(loadDefaultScenario());
  const { businesses, hubs, employees, settings } = run.scenario;
  const lookups = { businesses, hubs, employees };
  const end = snapshotAt(run, settings.simEndMin);
  const viewOf = (kind: 'direct' | 'relay') => {
    const plan = run.assignments.plans.find((p) => p.kind === kind);
    expect(plan, `a ${kind} plan exists in the Demo city`).toBeDefined();
    return { plan: plan!, view: shipmentView(run, end, plan!.shipmentId)! };
  };
  const card = (response: ShipmentResponse) => renderToStaticMarkup(
    <MemoryRouter><MatchResultCard response={response} {...lookups} onViewTracking={() => {}} onEdit={() => {}} onRetry={() => {}} /></MemoryRouter>,
  );
  const track = (view: ShipmentView) => renderToStaticMarkup(
    <MemoryRouter><TrackingDetail view={view} {...lookups} /></MemoryRouter>,
  );
  const matched = (v: ShipmentView): ShipmentResponse => ({ ...v, matched: true });

  for (const kind of ['direct', 'relay'] as const) {
    it(`${kind}: Delivery arranged card has every §3A item`, () => {
      const { plan, view } = viewOf(kind);
      const s = view.shipment;
      const html = card(matched(shipmentView(run, snapshotAt(run, settings.simStartMin), s.id)!));
      clean(html, kind);
      expect(html).toContain('Delivery arranged');
      expect(html).toContain(s.id);
      expect(html).toContain(esc(s.label));
      expect(html).toMatch(/Small box|Envelope/);
      expect(html).toContain(esc(businesses.find((b) => b.id === s.destinationBusinessId)!.name));
      expect(html).toContain('Collection');
      expect(html).toContain('Estimated arrival');
      expect(html).toContain('Requested deadline');
      expect(html).toMatch(/\$\d+\.\d\d/);
      for (const leg of plan.legs) expect(html).toContain(esc(employees.find((e) => e.id === leg.employeeId)!.name));
      expect(html).toContain('match-card__timeline');
      expect(html).toContain('View tracking');
      if (kind === 'relay') expect(html).toContain(esc(hubs.find((h) => h.id === plan.hubId)!.name));
      else expect(html).not.toContain('Hub');
    });

    it(`${kind}: tracking detail has contents, times, map, legs, ETA and steps`, () => {
      const { plan, view } = viewOf(kind);
      const html = track(shipmentView(run, snapshotAt(run, settings.simStartMin), plan.shipmentId)!);
      clean(html, `${kind} tracking`);
      expect(html).toContain('Contents');
      expect(html).toContain('Requested ready time');
      expect(html).toContain('Requested deadline');
      expect(html).toContain('Calculated arrival');
      expect(html).toContain('Route');
      expect(html).toContain('Carriers');
      const steps = [...html.matchAll(/trk-step trk-step--\w+"[^>]*>([^<]+)</g)].map((m) => m[1].trim());
      expect(steps).toEqual(kind === 'relay'
        ? ['Scheduled', 'Picked up', 'At hub', 'Out for delivery', 'Delivered']
        : ['Scheduled', 'Picked up', 'Delivered']);
      expect(view.status).toBe('delivered');
    });

    it(`${kind}: sender and recipient see the same delivered time at 2160`, () => {
      const { plan } = viewOf(kind);
      const s = plan && run.scenario.shipments.find((x) => x.id === plan.shipmentId)!;
      const sender = businessDashboard(run, end, s.originBusinessId)!.outgoing.find((v) => v.shipment.id === s.id)!;
      const recip = businessDashboard(run, end, s.destinationBusinessId)!.incoming.find((v) => v.shipment.id === s.id)!;
      expect(sender.deliveredAtMin).not.toBeNull();
      expect(recip.deliveredAtMin).toBe(sender.deliveredAtMin);
      const a = track(sender), b = track(recip);
      const pick = (h: string) => h.match(/<dt>Delivered<\/dt><dd>([^<]+)<\/dd>/)?.[1];
      expect(pick(a)).toBeTruthy();
      expect(pick(a)).toBe(pick(b));
      clean(a, 'sender'); clean(b, 'recipient');
    });
  }

  it('summary and notifications render cleanly for every business at 2160', () => {
    for (const b of businesses) {
      const d = businessDashboard(run, end, b.id)!;
      const sum = renderToStaticMarkup(<SummaryCards totals={d.totals} />);
      clean(sum, `${b.name} summary`);
      for (const l of ['Packages sent', 'Matched', 'Delivered', 'Spend']) expect(sum).toContain(l);
      const note = renderToStaticMarkup(<NotificationList notifications={d.notifications} onSelect={() => {}} />);
      clean(note, `${b.name} notifications`);
      expect(note).toContain('Notifications');
      expect(d.notifications.length).toBeGreaterThan(0);
    }
  });
});

describe('unmatched package via the API', () => {
  let server: Server; let base: string; let store: ReturnType<typeof createStore>;
  beforeAll(async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bizcopy-')), 'state.json');
    store = createStore({ filePath: file, initial: () => createInitialRun(loadDefaultScenario()) });
    server = createApp(store).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  it('says No matching commute yet, shows the reason, Edit request and Try again', async () => {
    const { businesses, hubs, employees, settings } = store.get().scenario;
    let res: ShipmentResponse | null = null;
    let n = 0;
    outer: for (let round = 0; round < 3; round++) for (const o of businesses) for (const d of businesses) {
      if (o.id === d.id) continue;
      const r = await fetch(`${base}/api/shipments`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientRequestId: `c-${n++}`, originBusinessId: o.id, destinationBusinessId: d.id, label: 'Contracts',
          category: 'envelope', description: 'Papers', weightKg: 0.5, readyMin: settings.simStartMin,
          deadlineMin: settings.simEndMin, pickupInstructions: '', dropoffInstructions: '',
        }),
      });
      const b = (await r.json()) as ShipmentResponse;
      if (!b.matched) { res = b; break outer; }
    }
    expect(res).not.toBeNull();
    const html = renderToStaticMarkup(
      <MemoryRouter><MatchResultCard response={res!} businesses={businesses} hubs={hubs} employees={employees} onViewTracking={() => {}} onEdit={() => {}} onRetry={() => {}} /></MemoryRouter>,
    );
    clean(html, 'unmatched');
    expect(html).toContain('No matching commute yet');
    expect(html).toContain(esc(res!.unmatchedReason!));
    expect(html).toContain('Edit request');
    expect(html).toContain('Try again');
    const t = renderToStaticMarkup(<MemoryRouter><TrackingDetail view={res!} businesses={businesses} hubs={hubs} employees={employees} /></MemoryRouter>);
    clean(t, 'unmatched tracking');
    expect(t).toContain(esc(res!.unmatchedReason!));
    expect(t).toContain('Requested deadline');
  }, 60000);
});
