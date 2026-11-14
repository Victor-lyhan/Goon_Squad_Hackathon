// The simulator's right-panel inspector on the REAL default NYC run (#512): every business and every employee of
// the default run, selected, at five moments of the day. The inspector renders real names, and every number it
// shows is a field of SimulatorResponse or MapResponse (DECISIONS pass 46): the test builds the expected labels
// from the API fields alone, removes them from the rendered text and requires that no digit is left.
// No story ID, name or count is pinned (DECISIONS pass 54).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MapResponse, SimulatorResponse } from '../../shared/v2/api';
import { simPageView } from '../../client/src/components/sim/v2/compose/simPageView';
import { BusinessInspector } from '../../client/src/components/sim/v2/inspector/BusinessInspector';
import { EmployeeInspector } from '../../client/src/components/sim/v2/inspector/EmployeeInspector';
import {
  JOB_STATUS_LABEL, SHIPMENT_STATUS_LABEL,
  type BusinessInspectorModel, type EmployeeInspectorModel,
} from '../../client/src/components/sim/v2/inspector/inspectorModel';
import { DEFAULT_LAYERS } from '../../client/src/components/sim/v2/workspaceModel';
import { formatCents, formatMin } from '../../client/src/ui/format';
import { T, escaped, forbiddenIn, realSim, renderBody, text } from './sim-v2-real-helper';

vi.setConfig({ testTimeout: T, hookTimeout: T });

const real = realSim();
const noop = () => {};

const renderBusiness = (model: BusinessInspectorModel) => renderToStaticMarkup(createElement(BusinessInspector, {
  model, onFocus: noop, onClear: noop, onSelectPackage: noop, onSelectEmployee: noop, onSelectBusiness: noop,
}));
const renderEmployee = (model: EmployeeInspectorModel) => renderToStaticMarkup(createElement(EmployeeInspector, {
  model, onFocus: noop, onClear: noop, onSelectPackage: noop, onSelectBusiness: noop,
}));

/** The `<span class="insp-count">N</span>` of each section, keyed by the section's test ID. */
function sectionCounts(html: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of html.matchAll(/data-testid="(insp-[a-z]+)"><h3 class="insp-section-title">[^<]*<span class="insp-count">(\d+)<\/span>/g)) {
    out[m[1]] = Number(m[2]);
  }
  return out;
}

/**
 * The visible text with every allowed string removed (longest first). A digit left over is a number that does
 * not come from an API field.
 */
function leftover(html: string, allowed: Iterable<string>): string {
  let t = text(html.replace(/<span class="insp-count">\d+<\/span>/g, ''));
  const list = [...new Set([...allowed].map((a) => text(escaped(a))).filter((a) => a.length > 0))]
    .sort((a, b) => b.length - a.length);
  for (const a of list) t = t.split(a).join(' ');
  return t;
}

/** Strings any inspector may show that carry digits: names, labels and addresses from the responses. */
function namesOf(sim: SimulatorResponse, map: MapResponse): string[] {
  return [
    ...map.businesses.flatMap((b) => [b.name, b.address, b.neighborhood, b.borough]),
    ...map.employees.map((e) => e.name),
    ...map.homes.map((h) => h.neighborhood),
    ...sim.shipments.map((s) => s.label),
    ...sim.unmatched.map((u) => u.reason),
  ];
}

describe.each(real.moments)('every business inspector at $name', (moment) => {
  const { sim, map } = moment;
  const plans = new Map(sim.plans.map((p) => [p.shipmentId, p]));
  const cases = map.businesses.map((b) => {
    const view = simPageView({ data: moment.data, selection: { kind: 'business', id: b.id }, layers: DEFAULT_LAYERS });
    if (view.view !== 'ready' || view.right.kind !== 'business') throw new Error(`${b.id}: no business inspector`);
    const model = view.right.model;
    return { b, model, html: renderBusiness(model), page: renderBody(moment, { kind: 'business', id: b.id }) };
  });

  it('renders for every business, in network mode, with its real name and address', () => {
    expect(cases.length).toBe(map.businesses.length);
    expect(cases.length).toBeGreaterThan(0);
    for (const { b, model, html, page } of cases) {
      expect(model.name).toBe(b.name);
      expect(model.address).toBe(b.address);
      expect(b.name.trim().length).toBeGreaterThan(0);
      expect(html).toContain(`<h2 class="insp-title">${escaped(b.name)}</h2>`);
      expect(text(html)).toContain(text(escaped(b.address)));
      expect(text(html)).toContain(`${b.neighborhood}, ${b.borough}`);
      expect(page).toContain('data-testid="insp-business"');
      expect(forbiddenIn(page)).toEqual([]);
    }
  });

  it('the sent, received and held lists are the API\'s shipments and plans', () => {
    for (const { b, model, html } of cases) {
      const sent = sim.shipments.filter((s) => s.originBusinessId === b.id).map((s) => s.id);
      const received = sim.shipments.filter((s) => s.destinationBusinessId === b.id).map((s) => s.id);
      const held = sim.plans
        .filter((p) => p.kind === 'relay' && p.relayBusinessId === b.id)
        .map((p) => p.shipmentId);
      expect(sorted(model.sent.map((r) => r.shipmentId))).toEqual(sorted(sent));
      expect(sorted(model.received.map((r) => r.shipmentId))).toEqual(sorted(received));
      expect(sorted(model.held.map((r) => r.shipmentId))).toEqual(sorted(held));
      expect(sectionCounts(html)).toEqual({ 'insp-sent': sent.length, 'insp-received': received.length, 'insp-held': held.length });
      const commuters = map.employees.filter((e) => e.businessId === b.id).length;
      expect(model.commuters).toBe(commuters);
    }
  });

  it('every number shown is a field of the API response', () => {
    for (const { b, model, html } of cases) {
      const rows = [...model.sent, ...model.received, ...model.held];
      for (const r of rows) {
        const plan = plans.get(r.shipmentId);
        const delivered = sim.snapshot.deliveredAtMin[r.shipmentId];
        const expected = delivered !== undefined ? `Delivered ${formatMin(delivered)}`
          : plan ? `ETA ${formatMin(plan.deliveryMin)}` : null;
        expect(r.timeLabel).toBe(expected);
        expect(r.statusLabel).toBe(SHIPMENT_STATUS_LABEL[sim.snapshot.shipmentStatus[r.shipmentId]]);
        expect(r.carriers.map((c) => c.id)).toEqual(plan ? plan.legs.map((l) => l.employeeId) : []);
        expect(r.reason).toBe(plan ? null : sim.unmatched.find((u) => u.shipmentId === r.shipmentId)!.reason);
      }
      const commuters = map.employees.filter((e) => e.businessId === b.id).length;
      const allowed = [
        ...namesOf(sim, map),
        `${commuters} ${commuters === 1 ? 'commuter works' : 'commuters work'} here`,
        ...rows.map((r) => r.timeLabel ?? ''),
        ...rows.flatMap((r) => r.carriers.map((_, i) => `Leg ${i + 1}`)),
      ];
      expect({ business: b.id, left: leftover(html, allowed).match(/\d+/g) ?? [] }).toEqual({ business: b.id, left: [] });
    }
  });
});

describe.each(real.moments)('every employee inspector at $name', (moment) => {
  const { sim, map } = moment;
  const businesses = new Map(map.businesses.map((b) => [b.id, b]));
  const cases = map.employees.map((e) => {
    const view = simPageView({ data: moment.data, selection: { kind: 'employee', id: e.id }, layers: DEFAULT_LAYERS });
    if (view.view !== 'ready' || view.right.kind !== 'employee') throw new Error(`${e.id}: no employee inspector`);
    const model = view.right.model;
    return { e, model, html: renderEmployee(model), page: renderBody(moment, { kind: 'employee', id: e.id }) };
  });
  const legsOf = (employeeId: string) => sim.plans.flatMap((plan) =>
    plan.legs.map((leg, legIndex) => ({ plan, leg, legIndex })).filter((x) => x.leg.employeeId === employeeId));

  it('renders for every employee with their real name, workplace and home neighborhood', () => {
    expect(cases.length).toBe(map.employees.length);
    expect(cases.length).toBeGreaterThan(0);
    for (const { e, model, html, page } of cases) {
      expect(model.name).toBe(e.name);
      expect(e.name.trim().length).toBeGreaterThan(0);
      expect(html).toContain(`<h2 class="insp-title">${escaped(e.name)}</h2>`);
      expect(businesses.has(e.businessId)).toBe(true);
      expect(model.workplace).toEqual({ id: e.businessId, name: businesses.get(e.businessId)!.name });
      const home = map.homes.find((h) => h.id === e.homeId);
      expect(home).toBeDefined();
      expect(model.homeNeighborhood).toBe(home!.neighborhood);
      expect(page).toContain('data-testid="insp-employee"');
      expect(forbiddenIn(page)).toEqual([]);
    }
  });

  it('the legs are the plan legs this employee drives, with the API\'s stops', () => {
    for (const { e, model, html } of cases) {
      const legs = legsOf(e.id);
      expect(model.legs.length).toBe(legs.length);
      expect(sectionCounts(html)).toEqual({ 'insp-legs': legs.length });
      expect(model.emptyMessage === null).toBe(legs.length > 0);
      for (const block of model.legs) {
        const hit = legs.find((x) => x.plan.shipmentId === block.shipmentId && block.jobId.startsWith(x.plan.id));
        expect(hit).toBeDefined();
        const { leg } = hit!;
        const job = sim.jobs.find((j) => j.id === block.jobId);
        expect(job).toBeDefined();
        expect(job!.employeeId).toBe(e.id);
        expect(block.stops.map((s) => s.place.id)).toEqual(leg.stops.map((s) => s.placeId));
        expect(block.stops.every((s) => s.place.id !== null && businesses.has(s.place.id))).toBe(true);
      }
    }
  });

  it('every number shown is a field of the API response', () => {
    for (const { e, model, html } of cases) {
      const legs = legsOf(e.id);
      const allowed: string[] = [...namesOf(sim, map), e.id.toUpperCase()];
      for (const { plan, leg, legIndex } of legs) {
        const block = model.legs.find((l) => l.jobId.startsWith(plan.id) && l.shipmentId === plan.shipmentId
          && l.stops.length === leg.stops.length && l.finishLabel === formatMin(leg.finishMin));
        expect(block).toBeDefined();
        expect(block!.stops.map((s) => s.timeLabel)).toEqual(leg.stops.map((s) => formatMin(s.serviceStartMin)));
        expect(block!.extraLabel).toBe(`+${leg.extraMin} min`);
        expect(block!.rewardLabel).toBe(formatCents(leg.rewardCents));
        const job = sim.jobs.find((j) => j.id === block!.jobId)!;
        expect(block!.statusLabel).toBe(JOB_STATUS_LABEL[sim.snapshot.jobStatus[job.id]]);
        const legLabel = plan.kind === 'relay' ? `Relay leg ${legIndex + 1} of ${plan.legs.length}` : 'Direct';
        expect(block!.legLabel).toBe(legLabel);
        allowed.push(legLabel, formatMin(leg.finishMin), `+${leg.extraMin} min`, formatCents(leg.rewardCents),
          ...leg.stops.map((s) => formatMin(s.serviceStartMin)));
      }
      const earned = sim.snapshot.earningsCents[e.id] ?? 0;
      expect(model.earnedLabel).toBe(formatCents(earned));
      // "Reward of all legs" is the sum of the API's leg rewards (each an API field).
      const total = legs.reduce((n, x) => n + x.leg.rewardCents, 0);
      expect(model.totalRewardLabel).toBe(formatCents(total));
      expect(earned).toBeLessThanOrEqual(total);
      allowed.push(formatCents(earned), formatCents(total));
      expect({ employee: e.id, left: leftover(html, allowed).match(/\d+/g) ?? [] }).toEqual({ employee: e.id, left: [] });
    }
  });
});

it('at the end of the day every completed leg has been paid: earned so far equals the reward of the completed legs', () => {
  const end = real.moments[real.moments.length - 1];
  const { sim, map } = end;
  for (const e of map.employees) {
    const completed = sim.jobs
      .filter((j) => j.employeeId === e.id && sim.snapshot.jobStatus[j.id] === 'completed')
      .reduce((n, j) => n + j.rewardCents, 0);
    expect({ id: e.id, earned: sim.snapshot.earningsCents[e.id] ?? 0 }).toEqual({ id: e.id, earned: completed });
  }
});

function sorted(xs: string[]): string[] {
  return [...xs].sort();
}
