import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Header } from '../../client/src/App';
import { SimulatorView } from '../../client/src/components/sim/SimulatorView';
import { computeViewBox } from '../../client/src/components/sim/mapGeometry';
import { formatMin } from '../../client/src/ui/format';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { buildSimulatorResponse } from '../../server/api/simulator';
import { applyControl } from '../../server/clock';
import type { MapResponse } from '../../shared/api';
import type { Run } from '../../shared/types';

const base = createInitialRun(loadDefaultScenario());
const { scenario } = base;
const map: MapResponse = {
  runId: base.runId, graph: scenario.graph, businesses: scenario.businesses, hubs: scenario.hubs,
  homes: scenario.employees.map((e) => ({ employeeId: e.id, nodeId: e.homeNodeId })),
};
const noop = () => {};

const at = (run: Run, timeMin: number): Run => ({ ...run, clock: { ...run.clock, timeMin } });
const control = (run: Run, req: Parameters<typeof applyControl>[1]): Run =>
  ({ ...run, clock: applyControl(run.clock, req, run.events, run.scenario.settings) });

const relayPlan = base.assignments.plans.find((p) => p.kind === 'relay' && p.legs.length === 2)!;
const hubDropMin = base.events.find((e) => e.kind === 'hub_drop' && e.shipmentId === relayPlan.shipmentId)!.timeMin;
const hubPickMin = base.events.find((e) => e.kind === 'hub_pickup' && e.shipmentId === relayPlan.shipmentId)!.timeMin;
const eveningMin = Math.min(...base.events.filter((e) => e.kind === 'pickup').map((e) => e.timeMin)) + 2;

function render(run: Run, selectedId?: string) {
  const sim = buildSimulatorResponse(run);
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <Header initial={{ businesses: scenario.businesses, employees: scenario.employees }} />
      <SimulatorView sim={sim} map={map} employees={scenario.employees} selectedId={selectedId}
        onSelect={noop} onControl={noop} />
    </MemoryRouter>,
  );
  return { html, sim };
}

const visibleText = (html: string) =>
  html.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]*>/g, ' ');

const moments: [string, () => Run][] = [
  ['sim start', () => base],
  ['mid evening leg', () => at(base, eveningMin)],
  ['overnight (relay package at hub)', () => at(base, Math.floor((hubDropMin + hubPickMin) / 2))],
  ['after jump_to_morning', () => control(base, { action: 'jump_to_morning' })],
  ['after finish', () => control(base, { action: 'finish' })],
];

describe('Simulator with real Demo-city data', { timeout: 15_000 }, () => {
  it('has a relay package that waits at a hub overnight', () => {
    expect(hubPickMin).toBeGreaterThan(hubDropMin);
    const { sim } = render(at(base, Math.floor((hubDropMin + hubPickMin) / 2)));
    expect(sim.snapshot.shipmentStatus[relayPlan.shipmentId]).toBe('at_hub');
  });

  for (const [name, make] of moments) {
    it(`renders clean markup: ${name}`, () => {
      const run = make();
      const { html, sim } = render(run, relayPlan.shipmentId);
      const text = visibleText(html);
      expect(text.match(/NaN|undefined|null/g) ?? []).toEqual([]);
      expect(html.match(/NaN|undefined/g) ?? []).toEqual([]);
      expect(text.match(/n-\d+-\d+/g) ?? []).toEqual([]);
      expect(text.match(/\b(shp|emp|biz|hub|plan)-[\w-]+/g) ?? []).toEqual([]);

      const vb = computeViewBox(scenario.graph.nodes, 90);
      const marks = [...html.matchAll(/<(?:circle|rect)[^>]*class="marker-[^"]*"[^>]*>/g)].map((m) => m[0]);
      for (const tag of marks) {
        const cx = Number(/ c?x="([^"]+)"/.exec(tag)?.[1]);
        const cy = Number(/ c?y="([^"]+)"/.exec(tag)?.[1]);
        expect(Number.isFinite(cx) && Number.isFinite(cy)).toBe(true);
        expect(cx).toBeGreaterThanOrEqual(vb.x);
        expect(cx).toBeLessThanOrEqual(vb.x + vb.width);
        expect(cy).toBeGreaterThanOrEqual(vb.y);
        expect(cy).toBeLessThanOrEqual(vb.y + vb.height);
      }
      expect(marks.length).toBeGreaterThanOrEqual(
        sim.snapshot.markers.length + Object.keys(sim.snapshot.packagePositions).length > 0 ? 1 : 0);

      expect(html).toContain('aria-label="Legend"');
      expect(text).toContain(formatMin(run.clock.timeMin));
      expect(text).toContain('Synthetic city');
    });
  }

  it('PackageDetail names the hub and both carriers for the selected relay package', () => {
    const { html } = render(at(base, Math.floor((hubDropMin + hubPickMin) / 2)), relayPlan.shipmentId);
    const hub = scenario.hubs.find((h) => h.id === relayPlan.hubId)!;
    const names = relayPlan.legs.map((l) => scenario.employees.find((e) => e.id === l.employeeId)!.name);
    const detail = html.slice(html.indexOf('aria-label="Package detail"'));
    expect(detail).toContain(hub.name);
    for (const n of names) expect(detail).toContain(n);
  });
});
