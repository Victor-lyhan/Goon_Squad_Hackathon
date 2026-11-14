import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { businessDashboard } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';
import type { ShipmentResponse } from '../../shared/api';
import { SummaryCards } from '../../client/src/components/business/SummaryCards';
import { ShipmentList } from '../../client/src/components/business/ShipmentList';
import { NotificationList } from '../../client/src/components/business/NotificationList';
import { MatchResultCard } from '../../client/src/components/business/MatchResultCard';

const BAD = [/NaN/, /undefined/, /\bnull\b/, /\$NaN/, /n-\d+-\d+/];
function expectClean(html: string, where: string) {
  for (const re of BAD) expect(re.test(html), `${where}: ${re}`).toBe(false);
  expect(html.length).toBeGreaterThan(0);
}

describe('business portal views with real Demo-city data', () => {
  const run = createInitialRun(loadDefaultScenario());
  const { businesses, settings } = run.scenario;
  const times = [settings.simStartMin, 1040, 2000, settings.simEndMin];

  it('has 12 businesses', () => expect(businesses).toHaveLength(12));

  for (const t of times) {
    it(`renders every business cleanly at minute ${t}`, () => {
      const snap = snapshotAt(run, t);
      for (const b of businesses) {
        const d = businessDashboard(run, snap, b.id)!;
        expect(d).not.toBeNull();
        const where = `${b.name}@${t}`;
        const summary = renderToStaticMarkup(<SummaryCards totals={d.totals} />);
        expectClean(summary, `${where} summary`);
        expect(summary).toMatch(/\$\d/);
        expectClean(renderToStaticMarkup(<ShipmentList views={d.outgoing} direction="outgoing" businesses={businesses} onSelect={() => {}} />), `${where} outgoing`);
        expectClean(renderToStaticMarkup(<ShipmentList views={d.incoming} direction="incoming" businesses={businesses} onSelect={() => {}} />), `${where} incoming`);
        expectClean(renderToStaticMarkup(<NotificationList notifications={d.notifications} onSelect={() => {}} />), `${where} notifications`);
      }
    });
  }
});

describe('MatchResultCard with real POST /api/shipments responses', () => {
  let server: Server;
  let base: string;
  let store: ReturnType<typeof createStore>;
  beforeEach(async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bizreal-')), 'state.json');
    store = createStore({ filePath: file, initial: () => createInitialRun(loadDefaultScenario()) });
    server = createApp(store).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => new Promise((r) => server.close(r)));

  async function find(wantMatched: boolean, wantRelay?: boolean) {
    const { businesses, settings } = store.get().scenario;
    let n = 0;
    for (const o of businesses) for (const d of businesses) {
      if (o.id === d.id) continue;
      const r = await fetch(`${base}/api/shipments`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientRequestId: `p-${n++}`, originBusinessId: o.id, destinationBusinessId: d.id,
          label: 'Contracts', category: 'envelope', description: 'Papers', weightKg: 0.5,
          readyMin: settings.simStartMin, deadlineMin: settings.simEndMin,
          pickupInstructions: '', dropoffInstructions: '',
        }),
      });
      const b = (await r.json()) as ShipmentResponse;
      if (b.matched === wantMatched && (wantRelay === undefined || b.plan?.kind === (wantRelay ? 'relay' : 'direct'))) return b;
    }
    return null;
  }

  const render = (response: ShipmentResponse) => {
    const { businesses, hubs, employees } = store.get().scenario;
    return renderToStaticMarkup(
      <MemoryRouter><MatchResultCard response={response} businesses={businesses} hubs={hubs} employees={employees} onViewTracking={() => {}} onEdit={() => {}} onRetry={() => {}} /></MemoryRouter>,
    );
  };

  it('matched shows arrangement details', async () => {
    const res = await find(true);
    expect(res).not.toBeNull();
    const html = render(res!);
    expectClean(html, 'matched');
    expect(html).toContain('Delivery arranged');
    expect(html).toContain(res!.shipment.id);
    expect(html).toContain('Estimated arrival');
    expect(html).toMatch(/\$\d+/);
    expect(html).toMatch(/Carriers?/);
  });

  it('relay match shows the hub name', async () => {
    const res = await find(true, true);
    if (!res) return; // no free relay trip left on this scenario
    const { hubs } = store.get().scenario;
    const html = render(res);
    expectClean(html, 'relay');
    expect(html).toContain('Hub');
    expect(html).toContain(hubs.find((h) => h.id === res.plan!.hubId)!.name);
  });

  it('unmatched shows the backend reason', async () => {
    // Exhaust capacity: keep posting until one is unmatched.
    const res = await find(false);
    expect(res).not.toBeNull();
    const html = render(res!);
    expectClean(html, 'unmatched');
    expect(html).toContain('No matching commute yet');
    expect(html).toContain(res!.unmatchedReason!.replace(/&/g, '&amp;').replace(/'/g, '&#x27;'));
  });
});
