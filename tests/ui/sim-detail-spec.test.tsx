import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PackageDetail } from '../../client/src/components/sim/PackageDetail';
import { formatCents, formatMin } from '../../client/src/ui/format';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { buildSimulatorResponse } from '../../server/api/simulator';
import type { Run } from '../../shared/types';

const demo = loadDefaultScenario();
const probe = demo.shipments[0];
const bad = {
  ...probe, id: 'shp-impossible', clientRequestId: 'impossible', label: 'Impossible rush',
  deadlineMin: probe.readyMin + 1, createdSeq: demo.shipments.length + 1000,
};
const base = createInitialRun({ ...demo, shipments: [...demo.shipments, bad] });
const { scenario } = base;
const direct = base.assignments.plans.find((p) => p.kind === 'direct')!;
const relay = base.assignments.plans.find((p) => p.kind === 'relay' && p.legs.length === 2)!;
const dropMin = base.events.find((e) => e.kind === 'hub_drop' && e.shipmentId === relay.shipmentId)!.timeMin;
const pickMin = base.events.find((e) => e.kind === 'hub_pickup' && e.shipmentId === relay.shipmentId)!.timeMin;
const at = (run: Run, t: number): Run => ({ ...run, clock: { ...run.clock, timeMin: t } });
const times: [string, number][] = [
  ['start', 930], ['overnight', Math.floor((dropMin + pickMin) / 2)], ['finish', 2160],
];

function panel(t: number, id: string) {
  const sim = buildSimulatorResponse(at(base, t));
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <PackageDetail sim={sim} businesses={scenario.businesses} hubs={scenario.hubs}
        employees={scenario.employees} selectedId={id} />
    </MemoryRouter>,
  );
  return { html, text: html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&'), sim };
}
const biz = (id: string) => scenario.businesses.find((b) => b.id === id)!;
const emp = (id: string) => scenario.employees.find((e) => e.id === id)!;

describe('selected package panel (spec §3C)', () => {
  it('has an overnight moment between hub drop and pickup', () => expect(pickMin).toBeGreaterThan(dropMin));

  for (const [name, t] of times) {
    for (const [kind, plan] of [['direct', direct], ['relay', relay]] as const) {
      it(`${kind} package at ${name}`, () => {
        const { html, text, sim } = panel(t, plan.shipmentId);
        const s = sim.shipments.find((x) => x.id === plan.shipmentId)!;
        expect(text).toContain(biz(s.originBusinessId).name);
        expect(text).toContain(biz(s.destinationBusinessId).name);
        expect(html).toContain(`href="/business/${s.originBusinessId}?shipment=${s.id}"`);
        expect(text).toContain(formatCents(plan.customerPriceCents));
        plan.legs.forEach((leg, i) => {
          expect(text).toContain(emp(leg.employeeId).name);
          expect(html).toContain(`href="/employee/${leg.employeeId}?job=${plan.id}-L${i}"`);
          expect(text).toContain(`+${Math.round(leg.extraMin)} min added`);
          for (const st of leg.stops) expect(text).toContain(formatMin(st.serviceStartMin));
        });
        expect(text).toMatch(/Evening, Day 1|Morning, Day 2/);
        if (kind === 'relay') {
          const hub = scenario.hubs.find((h) => h.id === plan.hubId)!;
          expect(text).toContain(hub.name);
        }
        // status by text, not colour
        const states = [...text.matchAll(/\b(Done|Next|Upcoming)\b/g)].map((m) => m[1]);
        const occurred = sim.snapshot.occurredEvents.filter((e) => e.shipmentId === s.id).length;
        expect(states.filter((x) => x === 'Done')).toHaveLength(occurred);
        expect(states.filter((x) => x === 'Next').length).toBe(occurred < states.length ? 1 : 0);
        if (name === 'finish') expect(text).toContain('Delivered');
        expect(text.match(/NaN|undefined|null/g) ?? []).toEqual([]);
        expect(text.match(/\b(n-\d+-\d+|shp-[\w-]+|emp-[\w-]+|biz-[\w-]+|hub-[\w-]+|plan-[\w-]+)/g) ?? []).toEqual([]);
      });
    }
    it(`unmatched package at ${name}`, () => {
      const { text, sim } = panel(t, bad.id);
      const reason = sim.unmatched.find((u) => u.shipmentId === bad.id)!.reason;
      expect(reason.length).toBeGreaterThan(0);
      expect(text).toContain('Unmatched');
      expect(text).toContain(reason);
      expect(text).not.toMatch(/Carriers|Customer price|\$\d/);
      expect(text.match(/NaN|undefined|null/g) ?? []).toEqual([]);
    });
  }

  it('relay at overnight shows hub drop done and hub pickup next', () => {
    const { text } = panel(times[1][1], relay.shipmentId);
    expect(text).toMatch(/Done\s+Dropped at hub/);
    expect(text).toMatch(/Next\s+Picked up from hub/);
  });

  it('direct package never shows Out for delivery', () => {
    expect(panel(2160, direct.shipmentId).text).not.toContain('Out for delivery');
  });

  it('CSS has no fixed widths', async () => {
    const fs = await import('node:fs');
    const css = fs.readFileSync('client/src/components/sim/PackageDetail.css', 'utf8');
    expect(css).not.toMatch(/(^|[^-])width:\s*\d+px/);
  });
});
