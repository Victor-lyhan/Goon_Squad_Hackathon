import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CityMap } from '../../client/src/components/CityMap';
import { MapMarkers } from '../../client/src/components/sim/MapMarkers';
import { estimateTextWidth, LABEL_FONT, placeLabels, projectNodes } from '../../client/src/components/sim/mapGeometry';
import { selectedRoutes } from '../../client/src/components/sim/simPageModel';
import { createInitialRun } from '../../server/api/initialRun';
import { buildSimulatorResponse } from '../../server/api/simulator';
import { generateScenario } from '../../server/domain/generator';

const run = createInitialRun(generateScenario({
  preset: 'random', seed: 7, employees: 200, packages: 60, hubs: 10, maxExtraMin: 8,
}));
const s = run.scenario;
const times: [string, number][] = [
  ['simStartMin', s.settings.simStartMin],
  ['Day 1 evening', 1080],
  ['overnight', 1440 + 60],
  ['simEndMin', s.settings.simEndMin],
];

function render(t: number, selectedId?: string) {
  const sim = buildSimulatorResponse({ ...run, clock: { ...run.clock, timeMin: t } });
  const routes = selectedRoutes(sim, selectedId);
  const t0 = performance.now();
  const html = renderToStaticMarkup(
    <CityMap graph={s.graph} businesses={s.businesses} hubs={s.hubs}
      homes={s.employees.map((e) => ({ employeeId: e.id, nodeId: e.homeNodeId }))}
      highlightRoutes={routes.legs} baselineRoutes={routes.baselines}>
      <MapMarkers graph={s.graph} snapshot={sim.snapshot} clock={sim.clock} />
    </CityMap>,
  );
  return { html, sim, ms: performance.now() - t0 };
}
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe('largest random city map', () => {
  it('has the expected size', () => {
    expect(s.employees.length).toBe(200);
    expect(s.hubs.length).toBe(10);
    expect(s.shipments.length).toBe(60);
  });

  describe.each(times)('at %s', (_n, t) => {
    it('draws no highlighted route with nothing selected', () => {
      const { html } = render(t);
      expect(html).not.toContain('route-hi');
      expect(html).not.toContain('hub-ring');
    });

    it('highlights only the selected package legs; relay legs differ and the hub is marked', () => {
      const sim = buildSimulatorResponse({ ...run, clock: { ...run.clock, timeMin: t } });
      const relay = sim.plans.find((p) => p.legs.length === 2);
      const direct = sim.plans.find((p) => p.legs.length === 1);
      expect(relay).toBeTruthy();
      expect(direct).toBeTruthy();
      const r = render(t, relay!.shipmentId).html;
      expect(count(r, /route-hi-leg/g)).toBe(2);
      expect(r).toContain('route-hi-alt');
      expect(r).toContain('hub-ring');
      const d = render(t, direct!.shipmentId).html;
      expect(count(d, /route-hi-leg/g)).toBe(1);
      expect(d).not.toContain('route-hi-alt');
    });

    it('draws exactly the snapshot markers, no NaN/undefined/raw node ids, under 200 ms', () => {
      const { html, sim, ms } = render(t);
      expect(count(html, /class="marker-vehicle/g)).toBe(sim.snapshot.markers.length);
      expect(count(html, /class="marker-package"/g)).toBe(Object.keys(sim.snapshot.packagePositions).length);
      expect(html).not.toMatch(/NaN|undefined|Infinity/);
      const text = html.replace(/<[^>]*>/g, ' ');
      for (const n of s.graph.nodes) expect(text).not.toMatch(new RegExp(`(^|\\s)${n.id}(\\s|$)`));
      expect(ms).toBeLessThan(200);
    });
  });

  it('keeps roads subtle: thinner and lighter than any highlighted route', async () => {
    const css = (await import('node:fs')).readFileSync('client/src/components/sim/CityMap.css', 'utf8');
    const w = (sel: string) => Number(new RegExp(`\\.${sel}\\s*\\{[^}]*stroke-width:\\s*([\\d.]+)`).exec(css)?.[1]);
    expect(w('road')).toBeLessThan(w('route-hi'));
    expect(w('road')).toBeLessThanOrEqual(6);
  });

  it('places business and hub labels without overlapping each other', () => {
    const pos = projectNodes(s.graph.nodes);
    const items = [
      ...s.hubs.map((h) => ({ id: h.id, ...pos.get(h.nodeId)!, text: h.name })),
      ...s.businesses.map((b) => ({ id: b.id, ...pos.get(b.nodeId)!, text: b.name })),
    ];
    const placed = placeLabels(items);
    const boxes = placed.map((l, i) => {
      const w = estimateTextWidth(items[i].text);
      const x0 = l.anchor === 'middle' ? l.x - w / 2 : l.anchor === 'start' ? l.x : l.x - w;
      return { x0, x1: x0 + w, y0: l.y - LABEL_FONT, y1: l.y + LABEL_FONT * 0.25 };
    });
    const bad: string[] = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) bad.push(`${items[i].text} / ${items[j].text}`);
    }
    expect(bad).toEqual([]);
  });
});
