import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/relayFixture.json';
import type { MapResponse, ShipmentView } from '../../shared/api';
import type { Business, DeliveryPlan, Employee, Graph, Hub, Leg } from '../../shared/types';
import { RouteMiniMap } from '../../client/src/components/business/RouteMiniMap';
import { TrackingDetail } from '../../client/src/components/business/TrackingDetail';
import { miniMapProps, routeMapFromView } from '../../client/src/components/business/routeMapModel';
import { mk, directPlan, relayPlan } from './business-tracking.test';

const graph = fixture.graph as unknown as Graph;
const businesses = fixture.businesses as Business[];
const hubs = fixture.hubs as Hub[];
const map: MapResponse = { runId: 'run-1', graph, businesses, hubs, homes: [] };
const ids = graph.nodes.map((n) => n.id);
const [A, B, H] = [businesses[0].nodeId, businesses[1].nodeId, hubs[0].nodeId];

const withRoutes = (p: DeliveryPlan, routes: string[][]): DeliveryPlan =>
  ({ ...p, hubId: p.kind === 'relay' ? hubs[0].id : undefined, legs: p.legs.map((l, i) => ({ ...l, routeNodeIds: routes[i] }) as Leg) });
const relay = withRoutes(relayPlan, [[A, H], [H, B]]);
const direct = withRoutes(directPlan, [[A, B]]);
const fix = (v: ShipmentView): ShipmentView => ({
  ...v, shipment: { ...v.shipment, originBusinessId: 'biz-a', destinationBusinessId: 'biz-b' },
});
const employees: Employee[] = [];

function expectClean(html: string) {
  expect(html).not.toContain('NaN');
  const text = html.replace(/<[^>]*>/g, ' ');
  for (const id of [...ids.filter((i) => i.length > 2), 'biz-a', 'biz-b', 'hub-h']) expect(text).not.toMatch(new RegExp(`(^|\\s)${id}(\\s|$)`));
}

describe('routeMapFromView', () => {
  it('direct: two businesses, one route, no hub', () => {
    const p = routeMapFromView(fix(mk(direct, 'scheduled')), map);
    expect(p.businesses.map((b) => b.nodeId).sort()).toEqual([A, B].sort());
    expect(p.hubs).toEqual([]);
    expect(p.highlightRoutes).toEqual([[A, B]]);
  });
  it('relay: hub plus one route per leg', () => {
    const p = routeMapFromView(fix(mk(relay, 'scheduled')), map);
    expect(p.hubs.map((h) => h.id)).toEqual(['hub-h']);
    expect(p.highlightRoutes).toEqual([[A, H], [H, B]]);
  });
  it('unmatched: no legs, no hub, no routes', () => {
    const p = routeMapFromView(fix(mk(null, 'unmatched')), map);
    expect(p.highlightRoutes).toEqual([]);
    expect(p.hubs).toEqual([]);
    expect(p.businesses).toHaveLength(2);
  });
  it('drops empty or unknown routes', () => {
    const p = miniMapProps(map, { originNodeId: A, destinationNodeId: B, legRoutes: [[], ['zzz', A]] });
    expect(p.highlightRoutes).toEqual([]);
  });
});

describe('map rendering', () => {
  it('RouteMiniMap renders the map with names only', () => {
    const html = renderToStaticMarkup(<RouteMiniMap originNodeId={A} destinationNodeId={B} map={map} />);
    expect(html).toContain('Business A');
    expect(html).toContain('Business B');
    expectClean(html);
  });
  it('RouteMiniMap shows a loading note without a map', () => {
    expect(renderToStaticMarkup(<RouteMiniMap originNodeId={A} destinationNodeId={B} />)).toContain('Loading map');
  });
  for (const [name, v, polylines, hub] of [
    ['direct', mk(direct, 'picked_up'), 1, false],
    ['relay', mk(relay, 'at_hub'), 2, true],
    ['unmatched', mk(null, 'unmatched'), 0, false],
  ] as const) {
    it(`TrackingDetail ${name}`, () => {
      const html = renderToStaticMarkup(
        <MemoryRouter><TrackingDetail view={fix(v)} businesses={businesses} hubs={hubs} employees={employees} map={map} /></MemoryRouter>);
      expect((html.match(/class="route-hi /g) ?? []).length).toBe(polylines);
      expect(/class="hub"[^>]*><title>/.test(html)).toBe(hub);
      expectClean(html);
    });
  }
});
