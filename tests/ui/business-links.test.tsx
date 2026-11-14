import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { shipmentView } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';
import type { ShipmentResponse, ShipmentView } from '../../shared/api';
import { jobIdFor } from '../../shared/types';
import { MatchResultCard } from '../../client/src/components/business/MatchResultCard';
import { TrackingDetail } from '../../client/src/components/business/TrackingDetail';

const run = createInitialRun(loadDefaultScenario());
const { businesses, hubs, employees, settings } = run.scenario;
const snap = snapshotAt(run, settings.simStartMin);
const views = run.scenario.shipments.map((s) => shipmentView(run, snap, s.id)!).filter((v) => v.plan);
const direct = views.find((v) => v.plan!.kind === 'direct')!;
const relay = views.find((v) => v.plan!.kind === 'relay')!;
const noop = () => {};

const card = (v: ShipmentView) => renderToStaticMarkup(
  <MemoryRouter>
    <MatchResultCard response={{ ...v, matched: true } as ShipmentResponse} businesses={businesses} hubs={hubs} employees={employees}
      onViewTracking={noop} onEdit={noop} onRetry={noop} />
  </MemoryRouter>);
const drawer = (v: ShipmentView) => renderToStaticMarkup(
  <MemoryRouter><TrackingDetail view={v} businesses={businesses} hubs={hubs} employees={employees} /></MemoryRouter>);

const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));

describe('carrier and simulator links with real Demo-city data', () => {
  it('has a direct and a relay shipment', () => {
    expect(direct).toBeTruthy();
    expect(relay.plan!.legs.length).toBeGreaterThan(1);
  });

  for (const [name, v] of [['direct', direct], ['relay', relay]] as const) {
    const expected = v.plan!.legs.map((l, i) => `/employee/${l.employeeId}?job=${jobIdFor(v.plan!.id, i)}`);
    for (const [where, render] of [['card', card], ['drawer', drawer]] as const) {
      it(`${where} (${name}) links each leg and the simulator`, () => {
        const html = render(v);
        const h = hrefs(html);
        for (const e of expected) expect(h).toContain(e);
        expect(h).toContain(`/simulator?package=${v.shipment.id}`);
        for (const l of v.plan!.legs) {
          const nm = employees.find((e) => e.id === l.employeeId)!.name;
          expect(html).toContain(`>${nm}</a>`);
        }
        expect(html).toContain('Watch in simulator');
      });
    }
  }

  it('unmatched card and drawer show no links', () => {
    const v: ShipmentView = { ...direct, plan: null, jobIds: [], status: 'unmatched', unmatchedReason: 'None fits' };
    const c = renderToStaticMarkup(
      <MemoryRouter>
        <MatchResultCard response={{ ...v, matched: false }} businesses={businesses} hubs={hubs} employees={employees}
          onViewTracking={noop} onEdit={noop} onRetry={noop} />
      </MemoryRouter>);
    for (const html of [c, drawer(v)]) {
      expect(html).not.toContain('Watch in simulator');
      expect(hrefs(html).filter((x) => x.startsWith('/employee') || x.startsWith('/simulator'))).toEqual([]);
    }
  });
});
