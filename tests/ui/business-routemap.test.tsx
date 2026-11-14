import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { snapshotAt } from '../../server/domain/simulation';
import { shipmentView } from '../../server/api/views';
import type { MapResponse } from '../../shared/api';
import { RouteMiniMap } from '../../client/src/components/business/RouteMiniMap';
import { buildRouteMap } from '../../client/src/components/business/routeMapModel';

const run = createInitialRun(loadDefaultScenario());
const { graph, businesses, hubs, employees } = run.scenario;
const map: MapResponse = {
  runId: run.runId, graph, businesses, hubs,
  homes: employees.map((e) => ({ employeeId: e.id, nodeId: e.homeNodeId })),
};
const snap = snapshotAt(run, run.scenario.settings.simStartMin);
const plans = run.assignments.plans;
const views = plans.map((p) => shipmentView(run, snap, p.shipmentId)!);
const bizNode = (id: string) => businesses.find((b) => b.id === id)!.nodeId;
const inputOf = (v: (typeof views)[number]) => ({
  originNodeId: bizNode(v.shipment.originBusinessId),
  destinationNodeId: bizNode(v.shipment.destinationBusinessId),
  hubId: v.plan?.kind === 'relay' ? v.plan.hubId : undefined,
  legRoutes: v.plan!.legs.map((l) => l.routeNodeIds),
});
const direct = views.find((v) => v.plan?.kind === 'direct');
const relay = views.find((v) => v.plan?.kind === 'relay');

describe('business route map with real Demo-city plans', () => {
  it('the demo city has a direct and a relay plan', () => {
    expect(direct).toBeTruthy();
    expect(relay).toBeTruthy();
  });

  it('direct: one route, no hub, summary in words', () => {
    const html = renderToStaticMarkup(<RouteMiniMap {...inputOf(direct!)} map={map} />);
    expect((html.match(/class="route-hi /g) ?? []).length).toBe(1);
    expect(html).not.toContain('class="hub"');
    expect(html).toMatch(/aria-label="Direct route: 1 leg, /);
    expect(html).toContain('<title>Direct route');
  });

  it('relay: two legs distinguishable by dash and number, hub marked and named', () => {
    const input = inputOf(relay!);
    const hubName = hubs.find((h) => h.id === input.hubId)!.name;
    const html = renderToStaticMarkup(<RouteMiniMap {...input} map={map} />);
    expect((html.match(/class="route-hi /g) ?? []).length).toBe(2);
    expect(html).toContain('route-hi-alt'); // second leg is dashed
    expect(html).toContain('class="hub"');
    expect(html).toContain(`>${hubName}</text>`);
    expect(html).toContain(`Relay via ${hubName}: 2 legs`);
    expect(html).toMatch(/class="leg-badge-text"[^>]*>1</);
    expect(html).toMatch(/class="leg-badge-text"[^>]*>2</);
  });

  it('draws exactly the API routes (no browser pathfinding)', () => {
    const r = buildRouteMap(map, inputOf(relay!));
    if (!r.ok) throw new Error('expected a model');
    expect(r.model.legs).toHaveLength(relay!.plan!.legs.length);
    r.model.legs.forEach((l, i) => expect(l.points).toHaveLength(relay!.plan!.legs[i].routeNodeIds.length));
  });

  it('scales with a viewBox, no fixed size, markers >= 8 px at 390 px', () => {
    for (const v of [direct!, relay!]) {
      const r = buildRouteMap(map, inputOf(v));
      if (!r.ok) throw new Error('expected a model');
      const html = renderToStaticMarkup(<RouteMiniMap {...inputOf(v)} map={map} />);
      expect(html).toMatch(/viewBox="/);
      expect(html).not.toMatch(/<svg[^>]*\s(width|height)=/);
      const px = 390 / r.model.viewBox.width;
      expect(48 * px).toBeGreaterThanOrEqual(8); // business marker
      expect(60 * px).toBeGreaterThanOrEqual(8); // hub marker diameter
    }
  });

  it('shows no raw node ids or NaN', () => {
    const html = renderToStaticMarkup(<RouteMiniMap {...inputOf(relay!)} map={map} />);
    const text = html.replace(/<[^>]*>/g, ' ');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
    for (const n of graph.nodes) expect(text).not.toContain(n.id);
  });

  it('a stale plan (unknown node id) renders a fallback instead of throwing', () => {
    const input = inputOf(relay!);
    const html = renderToStaticMarkup(
      <RouteMiniMap {...input} legRoutes={[[input.originNodeId, 'n-gone-99'], ...input.legRoutes.slice(1)]} map={map} />);
    expect(html).toContain('out of date');
    expect(html).not.toContain('<svg');
    const noHub = renderToStaticMarkup(<RouteMiniMap {...input} hubId="hub-gone" map={map} />);
    expect(noHub).toContain('out of date');
  });

  it('send form preview (no legs) shows both businesses without routes', () => {
    const html = renderToStaticMarkup(<RouteMiniMap originNodeId={businesses[0].nodeId} destinationNodeId={businesses[1].nodeId} map={map} />);
    expect(html).toContain(businesses[0].name);
    expect(html).not.toContain('class="route-hi');
  });
});
