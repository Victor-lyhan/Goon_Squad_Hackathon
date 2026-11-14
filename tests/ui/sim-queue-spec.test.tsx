import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PackageQueue } from '../../client/src/components/sim/PackageQueue';
import { STATUS_ORDER, countByStatus, emptyCopy, toQueueRows } from '../../client/src/components/sim/packageQueueModel';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { buildSimulatorResponse } from '../../server/api/simulator';
import { applyControl } from '../../server/clock';
import { generateScenario } from '../../server/domain/generator';
import type { Run } from '../../shared/types';

const cities: [string, Run][] = [
  ['Demo', createInitialRun(loadDefaultScenario())],
  ['random 200/60/10', createInitialRun(generateScenario({ preset: 'random', seed: 3, employees: 200, packages: 60, hubs: 10, maxExtraMin: 8 }))],
  ['zero hubs', createInitialRun(generateScenario({ preset: 'random', seed: 5, employees: 200, packages: 60, hubs: 0, maxExtraMin: 8 }))],
];

function times(run: Run): [string, number][] {
  const { simStartMin, simEndMin } = run.scenario.settings;
  const day1 = run.events.map((e) => e.timeMin).filter((t) => t < 1440);
  const night = run.events.length ? Math.max(...day1, simStartMin) + 1 : simStartMin;
  return [['start', simStartMin], ['overnight', night], ['finish', simEndMin]];
}

describe.each(cities)('package queue spec (%s)', (_n, run) => {
  const { businesses } = run.scenario;
  for (const [label, t] of times(run)) {
    const sim = buildSimulatorResponse({ ...run, clock: { ...run.clock, timeMin: t } });
    const props = { shipments: sim.shipments, plans: sim.plans, snapshot: sim.snapshot, businesses, unmatched: sim.unmatched, onSelect: () => {} };

    it(`counts match API statuses at ${label}`, () => {
      const rows = toQueueRows(sim.shipments, sim.plans, sim.snapshot.shipmentStatus, businesses, sim.unmatched);
      const counts = countByStatus(rows);
      expect(counts.all).toBe(sim.shipments.length);
      for (const s of STATUS_ORDER) {
        expect(counts[s]).toBe(sim.shipments.filter((x) => (sim.snapshot.shipmentStatus[x.id] ?? 'unmatched') === s).length);
      }
      const html = renderToStaticMarkup(<PackageQueue {...props} />);
      expect(html).toContain(`All (${sim.shipments.length})`);
      for (const s of STATUS_ORDER) expect(html).toContain(`(${counts[s]})`);
    });

    it(`renders cleanly with reasons and text tags at ${label}`, () => {
      const html = renderToStaticMarkup(<PackageQueue {...props} />);
      expect(html).not.toMatch(/NaN|undefined|\[object/);
      for (const n of run.scenario.graph.nodes) expect(html).not.toContain(`>${n.id}<`);
      for (const u of sim.unmatched) expect(html).toContain(u.reason.replace(/&/g, '&amp;').replace(/'/g, '&#x27;'));
      for (const p of sim.plans) expect(html).toContain(p.kind === 'relay' ? '>Relay<' : '>Direct<');
    });

    it(`keeps createdSeq order and selection across polls at ${label}`, () => {
      const rows = toQueueRows(sim.shipments, sim.plans, sim.snapshot.shipmentStatus, businesses, sim.unmatched);
      const seq = new Map(sim.shipments.map((s) => [s.id, s.createdSeq]));
      expect(rows.map((r) => seq.get(r.id)!)).toEqual([...seq.values()].sort((a, b) => a - b));
      const shuffled = [...sim.shipments].reverse();
      const again = toQueueRows(shuffled, sim.plans, sim.snapshot.shipmentStatus, businesses, sim.unmatched);
      expect(again.map((r) => r.id)).toEqual(rows.map((r) => r.id));
      const selected = sim.shipments[sim.shipments.length - 1].id;
      const next = buildSimulatorResponse({ ...run, clock: { ...run.clock, timeMin: t } });
      const html = renderToStaticMarkup(<PackageQueue {...props} shipments={next.shipments} snapshot={next.snapshot} selectedId={selected} />);
      expect(html.match(/aria-current="true"/g)).toHaveLength(1);
      expect(html).toMatch(new RegExp(`aria-current="true"[^>]*data-id="${selected}"|data-id="${selected}"[^>]*aria-current="true"`));
    });
  }
});

describe('empty states', () => {
  it('uses friendly copy for empty filters and searches', () => {
    expect(emptyCopy(24, 'at_hub', '').title).toBe('No at hub packages');
    expect(emptyCopy(24, 'all', 'zzz').title).toMatch(/search/);
    expect(emptyCopy(0, 'all', '').title).toBe('No packages yet');
  });
  it('shows the unmatched reason from the backend', () => {
    const run = cities[0][1];
    const sim = buildSimulatorResponse(run);
    const s = sim.shipments[0];
    const html = renderToStaticMarkup(
      <PackageQueue shipments={[s]} plans={[]} snapshot={{ shipmentStatus: {} }} businesses={run.scenario.businesses}
        unmatched={[{ shipmentId: s.id, reason: 'No trip fits the deadline' }]} onSelect={() => {}} />,
    );
    expect(html).toContain('No trip fits the deadline');
  });
  it('can seek past the end without breaking (finish)', () => {
    const run = cities[0][1];
    const clock = applyControl(run.clock, { action: 'finish' }, run.events, run.scenario.settings);
    expect(clock.timeMin).toBe(run.scenario.settings.simEndMin);
  });
});
