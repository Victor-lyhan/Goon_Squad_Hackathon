import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { businessDashboard } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';
import type { ShipmentView } from '../../shared/api';
import { TrackingDetail } from '../../client/src/components/business/TrackingDetail';

const run = createInitialRun(loadDefaultScenario());
const { businesses, hubs, employees, shipments, settings } = run.scenario;
const BAD = [/NaN/, /undefined/, /\bnull\b/, /n-\d+-\d+/, /\bemp-[\w-]+/, /\bhub-[\w-]+/, /\bbiz-[\w-]+/, /\btrip-[\w-]+/];

function drawer(view: ShipmentView) {
  return renderToStaticMarkup(
    <MemoryRouter><TrackingDetail view={view} businesses={businesses} hubs={hubs} employees={employees} /></MemoryRouter>,
  );
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
/** Drawer text excluding link hrefs (those legitimately hold ids). */
function views(t: number) {
  const snap = snapshotAt(run, t);
  const all = new Map<string, { out: ShipmentView; inc: ShipmentView }>();
  for (const b of businesses) {
    const d = businessDashboard(run, snap, b.id)!;
    for (const v of d.outgoing) all.set(v.shipment.id, { ...(all.get(v.shipment.id) as any), out: v });
    for (const v of d.incoming) all.set(v.shipment.id, { ...(all.get(v.shipment.id) as any), inc: v });
  }
  return [...all.values()];
}
const overnight = (() => {
  for (let t = settings.simStartMin; t <= settings.simEndMin; t += 10) {
    const snap = snapshotAt(run, t);
    if (shipments.some((s) => snap.shipmentStatus[s.id] === 'at_hub')) return t;
  }
  throw new Error('no at_hub moment');
})();
const moments: [string, number][] = [['start', settings.simStartMin], ['overnight', overnight], ['finish', settings.simEndMin]];

describe('tracking drawer vs spec 3A with Demo-city data', () => {
  for (const [name, t] of moments) {
    describe(name, () => {
      const pairs = views(t);
      it('covers direct, relay and unmatched', () => {
        const kinds = new Set(pairs.map((p) => p.out.plan?.kind ?? 'unmatched'));
        expect([...kinds].sort()).toEqual(['direct', 'relay', 'unmatched']);
      });
      for (const side of ['out', 'inc'] as const) {
        it(`${side}: contents, times, ETA, carriers, no junk`, () => {
          for (const p of pairs) {
            const v = p[side];
            const html = drawer(v);
            const tx = text(html);
            for (const re of BAD) expect(re.test(tx), `${v.shipment.id} ${re} in ${tx}`).toBe(false);
            expect(tx).toContain(v.shipment.description);
            expect(tx).toContain('Requested ready time');
            expect(tx).toContain('Requested deadline');
            expect(html).toContain('route-mini-map');
            const steps = [...html.matchAll(/trk-step trk-step--(\w+)/g)].map((m) => m[1]);
            if (!v.plan) {
              expect(tx).toContain(v.unmatchedReason!);
              expect(steps.every((s) => s === 'upcoming')).toBe(true);
              expect(html).not.toContain('trk-step--done');
              expect(tx).not.toContain('Calculated arrival');
            } else {
              expect(tx).toContain('Calculated arrival');
              expect(steps).toHaveLength(v.plan.kind === 'relay' ? 5 : 3);
              expect(tx.includes('At hub')).toBe(v.plan.kind === 'relay');
              for (const leg of v.plan.legs) expect(tx).toContain(employees.find((e) => e.id === leg.employeeId)!.name);
            }
            // deadline is visibly distinct from the calculated arrival
            expect(html).toContain('trk-requested');
            if (v.plan) expect(html).toContain('trk-calculated');
          }
        });
      }
      it('sender and recipient show the same delivered time', () => {
        for (const p of pairs) {
          const get = (v: ShipmentView) => drawer(v).match(/<dt>Delivered<\/dt><dd[^>]*>([^<]*)</)?.[1];
          if (p.out.status === 'delivered') {
            expect(p.out.deliveredAtMin).toBe(p.inc.deliveredAtMin);
            expect(get(p.out), p.out.shipment.id).toBeTruthy();
            expect(get(p.out)).toBe(get(p.inc));
          } else {
            expect(drawer(p.out)).not.toContain('<dt>Delivered</dt>');
          }
        }
      });
    });
  }
});
