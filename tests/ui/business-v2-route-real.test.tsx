// The delivery route map on the REAL default NYC run (#549): the model for every delivery of every business,
// fed with the API's own dashboards and GET /api/v2/map body (server/api/v2/views.ts) on the committed
// fixtures/nyc. Rules only, no story ID, name or count pinned (DECISIONS pass 54).
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MapResponse, ShipmentView } from '../../shared/v2/api';
import { mapResponse } from '../../server/api/v2/views';
import { DeliveryRoutePreview } from '../../client/src/components/business/v2/route/DeliveryRoutePreview';
import { buildDeliveryRoute, mapCoversPlan } from '../../client/src/components/business/v2/route/deliveryRouteModel';
import { decodePath } from '../../client/src/components/map/layers';
import { T, forbiddenIn, realRun } from './business-v2-real-helper';

vi.setConfig({ testTimeout: T, hookTimeout: T });

// Generous box around the five boroughs.
const NYC = { south: 40.45, north: 40.95, west: -74.3, east: -73.65 };
const inNyc = (lat: number, lng: number) => lat >= NYC.south && lat <= NYC.north && lng >= NYC.west && lng <= NYC.east;

const real = realRun();
const { run } = real;
const map: MapResponse = JSON.parse(JSON.stringify(mapResponse(run, real.travel)));
const homeIds = new Set([...run.scenario.homes.map((h) => h.id), ...map.homes.map((h) => h.id)]);
const byId = new Map(map.businesses.map((b) => [b.id, b]));

/** Every delivery of every business, at the start and the end of the day (plans do not change with the clock). */
const deliveries: { business: string; view: ShipmentView }[] = [];
for (const t of [run.scenario.settings.simStartMin, run.scenario.settings.simEndMin]) {
  const moment = real.at(t);
  for (const b of run.scenario.businesses) {
    const d = moment.dashboard(b.id);
    for (const view of [...d.outgoing, ...d.incoming]) deliveries.push({ business: b.id, view });
  }
}

beforeAll(() => vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', ''));
afterAll(() => vi.unstubAllEnvs());

describe('delivery route map on the real NYC run', () => {
  it('has deliveries of every kind to check', () => {
    expect(deliveries.length).toBeGreaterThan(0);
    expect(deliveries.some((d) => d.view.plan?.kind === 'relay')).toBe(true);
    expect(deliveries.some((d) => d.view.plan?.kind === 'direct')).toBe(true);
  });

  it('follows the shape rules for every delivery of every business', () => {
    for (const { business, view } of deliveries) {
      const where = `${business} ${view.shipment.id}`;
      const r = buildDeliveryRoute(view, map);
      const { plan, shipment } = view;
      const ids = r.places.map((p) => p.id);
      const stopNames = r.stopTexts.map((s) => s.label);

      // Never a carrier home (SPEC MVP II rules 5 and 6).
      expect(ids.filter((id) => homeIds.has(id)), where).toEqual([]);
      expect(r.places.every((p) => p.kind === 'business'), where).toBe(true);

      if (!plan) {
        expect(ids, where).toEqual([shipment.originBusinessId, shipment.destinationBusinessId]);
        expect(r.routes, where).toEqual([]);
        expect(r.stops, where).toEqual([]);
      } else if (plan.kind === 'relay') {
        expect(new Set(ids), where).toEqual(new Set([shipment.originBusinessId, shipment.destinationBusinessId, plan.relayBusinessId]));
        expect(ids, where).toHaveLength(3);
        expect(r.routes.map((x) => [x.kind, x.tone]), where).toEqual([['leg', 'leg1'], ['leg', 'leg2']]);
        expect(r.stops.map((s) => s.n), where).toEqual([1, 2, 3, 4]);
        expect(stopNames, where).toEqual(['Pickup', 'Drop at relay point', 'Pickup next morning', 'Delivered']);
        const stopPlaces = plan.legs.flatMap((l) => l.stops.map((s) => s.placeId));
        expect(stopPlaces, where).toEqual([shipment.originBusinessId, plan.relayBusinessId, plan.relayBusinessId, shipment.destinationBusinessId]);
      } else {
        expect(ids, where).toEqual([shipment.originBusinessId, shipment.destinationBusinessId]);
        expect(r.routes.map((x) => [x.kind, x.tone]), where).toEqual([['leg', 'leg1']]);
        expect(stopNames, where).toEqual(['Pickup', 'Delivered']);
      }

      if (plan) {
        // Times and places are the plan's own, unchanged.
        const planStops = plan.legs.flatMap((l) => l.stops);
        r.stops.forEach((s, i) => {
          const b = byId.get(planStops[i].placeId)!;
          expect([s.lat, s.lng], where).toEqual([b.lat, b.lng]);
        });
        // The map lists every stop pair of the plan, so the page never refetches for a plan of this run.
        expect(mapCoversPlan(map, plan), where).toBe(true);
        // Each leg runs from its first stop to its last: the road line when cached, else the straight line.
        plan.legs.forEach((leg, i) => {
          const path = r.routes[i].path;
          const first = byId.get(leg.stops[0].placeId)!;
          const last = byId.get(leg.stops[leg.stops.length - 1].placeId)!;
          const cached = map.polylines.find((p) => p.from === first.id && p.to === last.id)?.encoded;
          if (cached) expect(path, where).toEqual(decodePath(cached));
          else expect(path, where).toEqual([[first.lng, first.lat], [last.lng, last.lat]]);
        });
      }

      // Every coordinate is inside NYC.
      for (const p of r.places) expect(inNyc(p.lat, p.lng), `${where} place ${p.id}`).toBe(true);
      for (const s of r.stops) expect(inNyc(s.lat, s.lng), `${where} stop ${s.n}`).toBe(true);
      for (const route of r.routes) for (const [lng, lat] of route.path) expect(inNyc(lat, lng), `${where} ${route.id}`).toBe(true);
      expect(r.fitTo, where).not.toBeNull();
    }
  });

  it('renders every delivery without a forbidden word and without the word "hub"', () => {
    for (const { view } of deliveries) {
      const html = renderToStaticMarkup(<DeliveryRoutePreview view={view} map={map} />);
      expect(forbiddenIn(html), view.shipment.id).toEqual([]);
    }
  });
});
