import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MetricsCards } from '../../client/src/components/sim/MetricsCards';
import { PackageDetail } from '../../client/src/components/sim/PackageDetail';
import { PackageQueue } from '../../client/src/components/sim/PackageQueue';
import { formatCents } from '../../client/src/components/sim/metricsModel';
import { STATUS_LABEL, STATUS_ORDER } from '../../client/src/components/sim/packageQueueModel';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { buildSimulatorResponse } from '../../server/api/simulator';
import { applyControl } from '../../server/clock';
import { jobIdFor } from '../../shared/types';
import type { Run } from '../../shared/types';

const base = createInitialRun(loadDefaultScenario());
const { scenario } = base;
const at = (timeMin: number): Run => ({ ...base, clock: { ...base.clock, timeMin } });

const relayPlan = base.assignments.plans.find((p) => p.kind === 'relay' && p.legs.length === 2)!;
const hub = scenario.hubs.find((h) => h.id === relayPlan.hubId)!;
const firstLegJob = jobIdFor(relayPlan.id, 0);
const lastDay1 = Math.max(...base.events.filter((e) => e.timeMin < 1440).map((e) => e.timeMin));
const firstDay2 = Math.min(...base.events.filter((e) => e.timeMin >= 1440).map((e) => e.timeMin));

const checkpoints: [string, Run][] = [
  ['start', at(scenario.settings.simStartMin)],
  ['after evening', at(lastDay1)],
  // jump_to_morning acts from the current clock, so start it from the evening checkpoint.
  ['jump to morning', { ...base, clock: applyControl(at(lastDay1).clock, { action: 'jump_to_morning' }, base.events, scenario.settings) }],
  ['finish', { ...base, clock: applyControl(base.clock, { action: 'finish' }, base.events, scenario.settings) }],
];

const visibleText = (html: string) =>
  html.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]*>/g, ' ');

function renderAll(run: Run) {
  const sim = buildSimulatorResponse(run);
  const props = { businesses: scenario.businesses };
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <MetricsCards metrics={sim.snapshot.metrics} />
      <PackageQueue shipments={sim.shipments} plans={sim.plans} snapshot={sim.snapshot} {...props}
        selectedId={relayPlan.shipmentId} onSelect={() => {}} />
      <PackageDetail sim={sim} {...props} hubs={scenario.hubs} employees={scenario.employees}
        selectedId={relayPlan.shipmentId} />
    </MemoryRouter>,
  );
  return { sim, html, text: visibleText(html) };
}

const section = (html: string, label: string) => {
  const i = html.indexOf(`aria-label="${label}"`);
  return html.slice(i);
};
const card = (html: string, key: string) =>
  visibleText(html.slice(html.indexOf(`data-testid="metric-${key}"`)).split('</div></div>')[0]);

describe('Simulator playback with real Demo-city snapshots', () => {
  it('jump_to_morning lands 5 min before the first Day 2 event', () => {
    expect(checkpoints[2][1].clock.timeMin).toBe(firstDay2 - 5);
    expect(lastDay1).toBeLessThan(firstDay2);
  });

  for (const [name, run] of checkpoints) {
    describe(name, () => {
      const { sim, html, text } = renderAll(run);
      const total = scenario.shipments.length;

      it('has clean text and no raw ids', () => {
        expect(text.match(/NaN|undefined|null/g) ?? []).toEqual([]);
        expect(text.match(/n-\d+-\d+/g) ?? []).toEqual([]);
        expect(text.match(/\b(shp|emp|biz|hub|plan|job)-[\w-]+/g) ?? []).toEqual([]);
      });

      it('status filter counts add up to the package count', () => {
        const q = section(html, 'Package queue');
        const counts = STATUS_ORDER.map((s) => {
          const m = new RegExp(`${STATUS_LABEL[s]} \\((\\d+)\\)`).exec(visibleText(q).replace(/\s+/g, ' '));
          expect(m).not.toBeNull();
          return Number(m![1]);
        });
        expect(counts.reduce((a, b) => a + b, 0)).toBe(total);
        expect(visibleText(q)).toContain(`All (${total})`);
        expect(sim.shipments).toHaveLength(total);
      });
    });
  }

  it('start: Projected values, 0 delivered', () => {
    const { sim, html } = renderAll(checkpoints[0][1]);
    const m = sim.snapshot.metrics;
    expect(m.delivered).toBe(0);
    expect(card(html, 'delivered')).toContain(`0 / ${m.requested}`);
    expect(card(html, 'matched')).toContain(`${m.matched} / ${m.requested}`);
    expect(html).toContain('aria-label="Projected"');
    expect(sim.snapshot.shipmentStatus[relayPlan.shipmentId]).toBe('scheduled');
    expect(section(html, 'Package detail')).toContain('Scheduled');
  });

  it('after evening: relay package is At hub and its first leg is completed', () => {
    const { sim, html } = renderAll(checkpoints[1][1]);
    expect(sim.snapshot.shipmentStatus[relayPlan.shipmentId]).toBe('at_hub');
    expect(sim.snapshot.jobStatus[firstLegJob]).toBe('completed');
    const detail = section(html, 'Package detail');
    expect(visibleText(detail)).toContain('At hub');
    expect(detail).toContain(hub.name);
    const firstCarrier = scenario.employees.find((e) => e.id === relayPlan.legs[0].employeeId)!;
    expect(detail).toContain(firstCarrier.name);
    expect(sim.jobs.find((j) => j.id === firstLegJob)!.employeeId).toBe(firstCarrier.id);
  });

  it('jump to morning: relay package still At hub, nothing from Day 2 delivered early', () => {
    const { sim, html } = renderAll(checkpoints[2][1]);
    expect(sim.snapshot.shipmentStatus[relayPlan.shipmentId]).toBe('at_hub');
    expect(visibleText(section(html, 'Package detail'))).toContain('At hub');
    expect(sim.snapshot.metrics.delivered).toBeLessThanOrEqual(sim.snapshot.metrics.matched);
  });

  it('finish: delivered = matched and earnings equal the API total', () => {
    const { sim, html } = renderAll(checkpoints[3][1]);
    const m = sim.snapshot.metrics;
    expect(m.delivered).toBe(m.matched);
    expect(card(html, 'delivered')).toContain(`${m.matched} / ${m.requested}`);
    const total = Object.values(sim.snapshot.earningsCents).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    expect(m.earnedRewardsCents).toBe(total);
    expect(card(html, 'rewards')).toContain(formatCents(total));
    expect(sim.snapshot.shipmentStatus[relayPlan.shipmentId]).toBe('delivered');
    const detail = section(html, 'Package detail');
    expect(visibleText(detail)).toContain('Delivered');
    expect(sim.snapshot.jobStatus[jobIdFor(relayPlan.id, 1)]).toBe('completed');
    const q = visibleText(section(html, 'Package queue')).replace(/\s+/g, ' ');
    expect(q).toContain(`Delivered (${m.delivered})`);
  });
});
