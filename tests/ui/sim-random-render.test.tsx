import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CityMap } from '../../client/src/components/CityMap';
import { computeViewBox, pointProjector } from '../../client/src/components/sim/mapGeometry';
import { createInitialRun } from '../../server/api/initialRun';
import { buildSimulatorResponse } from '../../server/api/simulator';
import { snapshotAt } from '../../server/domain/simulation';
import { generateScenario } from '../../server/domain/generator';

/** The selected package's legs, as the deleted MVP 1 page passed them to CityMap. */
function selectedRoutes(sim: { plans: { shipmentId: string; legs: { routeNodeIds: string[] }[] }[] }, id?: string) {
  const plan = id ? sim.plans.find((p) => p.shipmentId === id) : undefined;
  return { legs: plan ? plan.legs.map((l) => l.routeNodeIds) : [], baselines: [] as string[][] };
}

const cities: [string, number, number][] = [['seed 3', 3, 4], ['seed 11', 11, 4], ['zero hubs', 5, 0]];

const built = new Map<string, ReturnType<typeof buildCity>>();
/** Each city is generated once per file and shared by every test. */
function build(seed: number, hubs: number) {
  const key = `${seed}/${hubs}`;
  if (!built.has(key)) built.set(key, buildCity(seed, hubs));
  return built.get(key)!;
}

function buildCity(seed: number, hubs: number) {
  const run = createInitialRun(generateScenario({
    preset: 'random', seed, employees: 200, packages: 60, hubs, maxExtraMin: 8,
  }));
  const s = run.scenario;
  const pickups = run.events.filter((e) => e.kind === 'pickup').map((e) => e.timeMin);
  const evening = Math.min(...pickups) + 2;
  const times = run.events.map((e) => e.timeMin).sort((a, b) => a - b);
  const morning = (times.find((t) => t >= 1440) ?? times[times.length - 1]) + 1; // Day 2 peak
  return { run, s, evening, morning };
}

const sims = new WeakMap<object, Map<number, ReturnType<typeof buildSimulatorResponse>>>();
/** API view model per (city, time), built once per file. */
function simAt(run: ReturnType<typeof build>['run'], t: number) {
  const m = sims.get(run) ?? new Map();
  sims.set(run, m);
  if (!m.has(t)) m.set(t, buildSimulatorResponse({ ...run, clock: { ...run.clock, timeMin: t } }));
  return m.get(t)!;
}

function renderAt(run: ReturnType<typeof build>['run'], t: number, selectedId?: string, fresh = false) {
  const s = run.scenario;
  // The budget test passes fresh=true so its timing still includes building the view model.
  const sim = fresh ? buildSimulatorResponse({ ...run, clock: { ...run.clock, timeMin: t } }) : simAt(run, t);
  const routes = selectedRoutes(sim, selectedId);
  const html = renderToStaticMarkup(
    <CityMap graph={s.graph} businesses={s.businesses} hubs={s.hubs}
      homes={s.employees.map((e) => ({ employeeId: e.id, nodeId: e.homeNodeId }))}
      highlightRoutes={routes.legs} baselineRoutes={routes.baselines} />,
  );
  return { html, sim };
}

describe.each(cities)('random city render (%s)', (_n, seed, hubs) => {
  const { run, s, evening, morning } = build(seed, hubs);
  const vb = computeViewBox(s.graph.nodes, 90);

  for (const [label, t] of [['evening', evening], ['morning', morning]] as const) {
    it(`has no NaN/undefined and keeps markers in the viewBox at the ${label} peak`, () => {
      const { html, sim } = renderAt(run, t);
      expect(html).not.toMatch(/NaN|undefined|Infinity/);
      const snap = snapshotAt(run, t);
      const project = pointProjector(s.graph.nodes);
      const pts = [...snap.markers, ...Object.values(snap.packagePositions)].map(project);
      expect(pts.length).toBeGreaterThan(0);
      for (const p of pts) {
        expect(p.x).toBeGreaterThanOrEqual(vb.x);
        expect(p.x).toBeLessThanOrEqual(vb.x + vb.width);
        expect(p.y).toBeGreaterThanOrEqual(vb.y);
        expect(p.y).toBeLessThanOrEqual(vb.y + vb.height);
      }
      expect(sim.snapshot.markers.length).toBe(snap.markers.length);
      // DECISIONS pass 4: markers only for employees with a planned leg.
      expect(snap.markers.length).toBeLessThan(200);
    });
  }

  it('highlights no routes without a selection and only the selected legs with one', () => {
    const none = renderAt(run, evening).html;
    expect(none).not.toMatch(/class="route-hi/);
    const plan = run.assignments.plans[0];
    const sel = renderAt(run, evening, plan.shipmentId).html;
    expect(sel.match(/class="route-hi/g) ?? []).toHaveLength(plan.legs.length);
  });

  it('describes hubs in the legend without a broken entry', () => {
    const { html } = renderAt(run, evening);
    const legend = html.slice(html.indexOf('aria-label="Legend"'));
    if (hubs === 0) {
      expect(s.hubs).toHaveLength(0);
      expect(legend).toContain('No hubs in this city');
      expect(legend).not.toMatch(/>Hub</);
    } else {
      expect(legend).toMatch(/>Hub</);
    }
    for (const m of legend.matchAll(/<(?:rect|circle|text)[^>]*>/g)) expect(m[0]).not.toMatch(/NaN/);
  });
});

// Budget stays 500 ms. The generous timeout only covers the warm-up render on a slow runner.
describe('render budget', () => {
  it('renders the 200-employee city to static markup in under 500 ms', { timeout: 15_000 }, () => {
    const { run, evening } = build(3, 4);
    renderAt(run, evening, undefined, true); // warm up
    const t0 = performance.now();
    renderAt(run, evening, undefined, true);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
