import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { businessDashboard } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';
import type { DeliveryPlan } from '../../shared/types';
import { SummaryCards } from '../../client/src/components/business/SummaryCards';
import { ShipmentList } from '../../client/src/components/business/ShipmentList';
import { formatMin } from '../../client/src/ui';

const BAD = [/NaN/, /undefined/, /\bnull\b/, /n-\d+-\d+/];
const run = createInitialRun(loadDefaultScenario());
const { businesses, settings } = run.scenario;
const noop = () => {};

function render(businessId: string, t: number, shipmentId: string, dir: 'outgoing' | 'incoming') {
  const d = businessDashboard(run, snapshotAt(run, t), businessId)!;
  const list = (dir: 'outgoing' | 'incoming') =>
    renderToStaticMarkup(<ShipmentList views={d[dir]} direction={dir} businesses={businesses} onSelect={noop} />);
  const summary = renderToStaticMarkup(<SummaryCards totals={d.totals} />);
  for (const html of [summary, list('outgoing'), list('incoming')]) for (const re of BAD) expect(html).not.toMatch(re);
  // Isolate the one <li> for this shipment.
  const lab = label(shipmentId);
  const row = (html: string) => {
    const rows = html.split('<li').filter((li) => li.includes('>' + lab + '<'));
    expect(rows, `row for ${shipmentId} (label must be unique in the list)`).toHaveLength(1);
    return rows[0];
  };
  return row(list(dir));
}
function label(shipmentId: string) {
  return run.scenario.shipments.find((s) => s.id === shipmentId)!.label;
}

function pick(kind: 'relay' | 'direct'): DeliveryPlan {
  const p = run.assignments.plans.find((x) => x.kind === kind && x.shipmentId);
  expect(p).toBeDefined();
  return p!;
}
const stopEnd = (p: DeliveryPlan, kind: string) => p.legs.flatMap((l) => l.stops).find((s) => s.kind === kind)!.serviceEndMin;

function expectSame(plan: DeliveryPlan, t: number, text: string) {
  const s = run.scenario.shipments.find((x) => x.id === plan.shipmentId)!;
  expect(render(s.originBusinessId, t, s.id, 'outgoing'), `sender@${t}`).toContain(text);
  expect(render(s.destinationBusinessId, t, s.id, 'incoming'), `recipient@${t}`).toContain(text);
}

describe('business playback: sender and recipient agree as the clock moves', () => {
  it('relay: Scheduled → Picked up → At hub → Out for delivery → Delivered', () => {
    const p = pick('relay');
    expect(p.legs.length).toBe(2);
    const pickup = stopEnd(p, 'pickup');
    const drop = stopEnd(p, 'hub_drop');
    const hubPickup = stopEnd(p, 'hub_pickup');
    expectSame(p, settings.simStartMin, 'Scheduled');
    expectSame(p, 930, 'Scheduled');
    expectSame(p, pickup, 'Picked up');
    expectSame(p, drop, 'At hub');
    expectSame(p, Math.floor((drop + hubPickup) / 2), 'At hub'); // overnight
    expectSame(p, hubPickup, 'Out for delivery');
    expectSame(p, settings.simEndMin, 'Delivered');
    expectSame(p, settings.simEndMin, `Delivered ${formatMin(p.deliveryMin)}`);
  });

  it('direct: Scheduled → Picked up → Delivered (no hub/out-for-delivery)', () => {
    const p = pick('direct');
    const pickup = stopEnd(p, 'pickup');
    expectSame(p, 930, 'Scheduled');
    expectSame(p, pickup, 'Picked up');
    const mid = render(run.scenario.shipments.find((x) => x.id === p.shipmentId)!.originBusinessId, pickup, p.shipmentId, 'outgoing');
    expect(mid).not.toContain('Out for delivery');
    expectSame(p, settings.simEndMin, `Delivered ${formatMin(p.deliveryMin)}`);
  });

  it('end of run: identical delivered string for sender and recipient; summary is clean', () => {
    for (const kind of ['relay', 'direct'] as const) {
      const p = pick(kind);
      const s = run.scenario.shipments.find((x) => x.id === p.shipmentId)!;
      const end = settings.simEndMin;
      const sv = businessDashboard(run, snapshotAt(run, end), s.originBusinessId)!.outgoing.find((v) => v.shipment.id === s.id)!;
      const rv = businessDashboard(run, snapshotAt(run, end), s.destinationBusinessId)!.incoming.find((v) => v.shipment.id === s.id)!;
      expect(sv.deliveredAtMin).not.toBeNull();
      expect(rv.deliveredAtMin).toBe(sv.deliveredAtMin);
      const re = /Delivered [^<]*/;
      const sr = render(s.originBusinessId, end, s.id, 'outgoing').match(re)?.[0];
      const rr = render(s.destinationBusinessId, end, s.id, 'incoming').match(re)?.[0];
      expect(sr).toBeTruthy();
      expect(rr).toBe(sr);
      const d = businessDashboard(run, snapshotAt(run, end), s.originBusinessId)!;
      const html = renderToStaticMarkup(<SummaryCards totals={d.totals} />);
      expect(html).toMatch(/\$\d/);
      for (const b of BAD) expect(html).not.toMatch(b);
    }
  });
});
