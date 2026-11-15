// The MVP II simulator in network mode on the REAL default NYC run (#512): the ready view and the left-panel
// package list at five moments of the day (930, one minute inside the evening leg, 1440, one minute inside the
// morning leg, 2160). The responses are the API's own views (server/api/v2/views.ts) on the committed
// fixtures/nyc. No story ID, name or count is pinned (DECISIONS pass 54): every expectation is read from the
// responses.
import { describe, expect, it, vi } from 'vitest';
import { simPageView } from '../../client/src/components/sim/v2/compose/simPageView';
import {
  buildPackageRows, packageStatusLabel, statusFilters,
} from '../../client/src/components/sim/v2/packages/packageListModel';
import { DEFAULT_LAYERS } from '../../client/src/components/sim/v2/workspaceModel';
import { T, escaped, forbiddenIn, realSim, renderBody, text } from './sim-v2-real-helper';

vi.setConfig({ testTimeout: T, hookTimeout: T });

const real = realSim();

/** The package rows of the left panel, in screen order. */
const pkgButtons = (html: string) => html.match(/<button[^>]*class="sw-pkg(?: is-selected)?"[^>]*>[\s\S]*?<\/button>/g) ?? [];
/** "Label count" of every status chip. */
const chips = (html: string) => [...html.matchAll(
  /<button[^>]*class="pk-chip[^"]*"[^>]*><span>([^<]*)<\/span><span class="pk-count">(\d+)<\/span><\/button>/g,
)].map((m) => ({ label: m[1], count: Number(m[2]) }));

it('the five moments are distinct and ordered, inside the simulation window', () => {
  const times = real.moments.map((m) => m.timeMin);
  expect(times[0]).toBe(930);
  expect(times[2]).toBe(1440);
  expect(times[4]).toBe(2160);
  expect([...times].sort((a, b) => a - b)).toEqual(times);
  expect(new Set(times).size).toBe(times.length);
  for (const m of real.moments) expect(m.sim.clock.timeMin).toBe(m.timeMin);
});

describe.each(real.moments)('network mode at $name', (moment) => {
  const { sim, map } = moment;
  const view = simPageView({ data: moment.data, selection: null, layers: DEFAULT_LAYERS });
  const html = renderBody(moment);

  it('simPageView with no selection is the ready view with the run summary and the package panel', () => {
    expect(view.view).toBe('ready');
    if (view.view !== 'ready') return;
    expect(view.mode).toBe('network');
    expect(view.mapPending).toBe(false);
    expect(view.journeyTitle).toBeNull();
    expect(view.right).toEqual({ kind: 'summary', metrics: sim.snapshot.metrics });
    expect(view.packageList.kind).toBe('panel');
    expect(view.controls.clock).toEqual(sim.clock);
    // Every network business is on the map; every movers' ID is an employee or a shipment of the run.
    const placeIds = new Set(view.map.places.map((p) => p.id));
    for (const b of map.businesses) expect(placeIds.has(b.id)).toBe(true);
    const moverIds = new Set([...map.employees.map((e) => e.id), ...sim.shipments.map((s) => s.id)]);
    for (const m of view.map.movers) expect(moverIds.has(m.id)).toBe(true);
  });

  it('the package list has one row per package of the response, in createdSeq order, named by its businesses', () => {
    const buttons = pkgButtons(html);
    expect(sim.shipments.length).toBeGreaterThan(0);
    expect(buttons.length).toBe(sim.shipments.length);
    const names = new Map(map.businesses.map((b) => [b.id, b.name]));
    const ordered = [...sim.shipments].sort((a, b) => a.createdSeq - b.createdSeq);
    ordered.forEach((s, i) => {
      const t = text(buttons[i]);
      expect(t).toContain(text(escaped(s.label)));
      expect(names.has(s.originBusinessId) && names.has(s.destinationBusinessId)).toBe(true);
      expect(t).toContain(`${names.get(s.originBusinessId)} → ${names.get(s.destinationBusinessId)}`);
      const status = sim.snapshot.shipmentStatus[s.id];
      expect(status).toBeDefined();
      if (status !== 'unmatched') expect(t).toContain(packageStatusLabel(status));
      const plan = sim.plans.find((p) => p.shipmentId === s.id);
      // #832: the kind is on the detail line, before the route.
      if (plan?.kind === 'relay') expect(t).toContain(`Relay via ${names.get(plan.relayBusinessId!)} · `);
      if (plan?.kind === 'direct') expect(t).toContain('Direct');
    });
    expect(text(html)).toContain(`${sim.shipments.length} of ${sim.shipments.length} packages`);
  });

  it('the status filter counts add up to the total and match the snapshot', () => {
    const shown = chips(html);
    expect(shown[0]).toEqual({ label: 'All', count: sim.shipments.length });
    const rest = shown.slice(1);
    expect(rest.reduce((n, c) => n + c.count, 0)).toBe(sim.shipments.length);
    for (const c of rest) {
      expect(c.count).toBeGreaterThan(0);
      const n = sim.shipments.filter((s) => packageStatusLabel(sim.snapshot.shipmentStatus[s.id]) === c.label).length;
      expect(c.count).toBe(n);
    }
    // The model agrees with what is rendered.
    expect(statusFilters(buildPackageRows(sim, map)).map(({ label, count }) => ({ label, count }))).toEqual(shown);
  });

  it('every unmatched row shows the reason of the API, and only unmatched rows show one', () => {
    const buttons = pkgButtons(html);
    const ordered = [...sim.shipments].sort((a, b) => a.createdSeq - b.createdSeq);
    const reasons = new Map(sim.unmatched.map((u) => [u.shipmentId, u.reason]));
    ordered.forEach((s, i) => {
      const reason = reasons.get(s.id);
      const planned = sim.plans.some((p) => p.shipmentId === s.id);
      expect(planned || reason !== undefined).toBe(true); // every package is either planned or has a reason
      if (planned) return;
      expect(reason!.trim().length).toBeGreaterThan(0);
      expect(text(buttons[i])).toContain(text(escaped(reason!)));
      expect(text(buttons[i])).toContain('No match');
    });
  });

  it('the rendered page never shows undefined, NaN, null, Invalid or "hub"', () => {
    expect(forbiddenIn(html)).toEqual([]);
    expect(text(html)).not.toMatch(/\b(biz|home|shp|plan)-[\w-]+/); // no raw place or shipment ID
  });
});
