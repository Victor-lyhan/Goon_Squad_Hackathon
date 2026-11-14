// The MVP II delivery details panel for EVERY delivery of the real default NYC run (#514), opened through the
// page with `?shipment=` from the sender's and from the recipient's workspace, at five moments of the day.
// Every expectation is read from the API's own ShipmentView (server/api/v2/views.ts): no story ID, name or
// count is pinned (DECISIONS pass 54).
import { describe, expect, it, vi } from 'vitest';
import type { ShipmentView } from '../../shared/v2/api';
import { shipmentStatusLabel } from '../../client/src/components/business/v2/shipmentsTableModel';
import { formatCents, formatDuration, formatMin } from '../../client/src/ui/format';
import { T, elements, forbiddenIn, realRun, renderPage, text, workspaceState } from './business-v2-real-helper';

vi.setConfig({ testTimeout: T, hookTimeout: T });

const real = realRun();
const { run } = real;
const nameOf = (id: string) => run.scenario.businesses.find((b) => b.id === id)!.name;
const employeeName = (id: string) => run.scenario.employees.find((e) => e.id === id)!.name;

const panelOf = (html: string) => elements(html, 'section', 'class="bd-panel"')[0];
const resultOf = (panel: string) => /<div class="bd-result[\s\S]*?<\/dl>|<div class="bd-result bd-result--none[\s\S]*?<\/div>/.exec(panel)![0];
/** "<dt>X</dt><dd ...>Y</dd>" pairs of the result card. */
const facts = (html: string) =>
  Object.fromEntries([...html.matchAll(/<dt>([^<]*)<\/dt><dd[^>]*>([^<]*)<\/dd>/g)].map((m) => [m[1], text(m[2])]));

type Side = 'sender' | 'recipient';
function open(timeMin: number, shipmentId: string, side: Side) {
  const moment = real.at(timeMin);
  const api = moment.shipment(shipmentId);
  const viewer = side === 'sender' ? api.shipment.originBusinessId : api.shipment.destinationBusinessId;
  const dashboard = moment.dashboard(viewer);
  const html = renderPage(workspaceState(moment.run, dashboard), { shipmentId });
  const panel = panelOf(html);
  return { api, dashboard, html, panel };
}

/** What the panel must say about one delivery, read from the API's ShipmentView. */
function checkPanel(api: ShipmentView, panel: string, side: Side) {
  const t = text(panel);
  const id = api.shipment.id;
  expect(t).toContain(api.shipment.label);
  expect(t).toContain(id);
  expect(t).toContain(nameOf(api.shipment.originBusinessId));
  expect(t).toContain(nameOf(api.shipment.destinationBusinessId));
  expect(panel).toContain(`href="/simulator?package=${encodeURIComponent(id)}&amp;play=1"`);
  expect(forbiddenIn(panel), id).toEqual([]);

  if (!api.plan) {
    expect(api.status).toBe('unmatched');
    expect(t).toContain('No matching commute yet');
    expect(api.unmatchedReason, `${id} has no plan and no reason`).toBeTruthy();
    expect(text(resultOf(panel))).toContain(api.unmatchedReason!);
    expect(panel).not.toContain('class="bd-steps"');
    expect(panel).not.toContain('class="bd-legs"');
    // Retry is offered to the sender only, while planning.
    expect(t.includes('Try matching again')).toBe(side === 'sender' && real.run.clock.phase === 'planning');
    return;
  }

  const plan = api.plan;
  const result = facts(resultOf(panel));
  expect(t).toContain('Delivery arranged');

  // Plan and relay point by name.
  if (plan.kind === 'relay') {
    expect(plan.relayBusinessId).toBeTruthy();
    expect(result.Plan).toBe(`Relay via ${nameOf(plan.relayBusinessId!)} (relay point)`);
  } else {
    expect(result.Plan).toBe('Direct');
  }

  // ETA, or the delivered time once delivered: exactly the API's minute.
  if (api.status === 'delivered') {
    expect(api.deliveredAtMin).not.toBeNull();
    expect(result.Delivered).toBe(formatMin(api.deliveredAtMin!));
  } else {
    expect(result.ETA).toBe(formatMin(plan.deliveryMin));
  }

  // Price for the sender only.
  if (side === 'sender') expect(result.Price).toBe(formatCents(plan.customerPriceCents));
  else expect(result.Price).toBeUndefined();

  // Status steps: the API's status is the current step (or every step is done once delivered).
  const steps = elements(panel, 'li', 'class="bd-step ');
  const expectedSteps = plan.kind === 'relay' ? 5 : 4;
  expect(steps.length).toBe(expectedSteps);
  const current = steps.filter((s) => s.includes('bd-step--current'));
  if (api.status === 'delivered') {
    expect(current).toEqual([]);
    expect(steps.every((s) => s.includes('bd-step--done'))).toBe(true);
  } else {
    expect(current.length).toBe(1);
    expect(text(current[0])).toContain(shipmentStatusLabel(api.status));
  }

  // Carriers: one row per leg, the employee by name, the job link with the API's job ID, every stop.
  const legRows = elements(elements(panel, 'table', 'class="bd-legs"')[0], 'tr', '').slice(1);
  expect(legRows.length).toBe(plan.legs.length);
  plan.legs.forEach((leg, i) => {
    const row = legRows[i];
    expect(text(row)).toContain(employeeName(leg.employeeId));
    expect(row).toContain(`href="/employee/${encodeURIComponent(leg.employeeId)}?job=${encodeURIComponent(api.jobIds[i])}"`);
    expect(text(row)).toContain(`+${formatDuration(leg.extraMin)}`);
    const stops = elements(row, 'li', 'class="bd-stop');
    expect(stops.length).toBe(leg.stops.length);
    leg.stops.forEach((stop, j) => {
      const s = text(stops[j]);
      expect(s).toContain(formatMin(stop.serviceStartMin));
      expect(s).toContain(nameOf(stop.placeId));
      if (stop.kind === 'hub_drop' || stop.kind === 'hub_pickup') expect(s).toContain(`Relay point: ${nameOf(stop.placeId)}`);
    });
  });
}

const shipments = run.scenario.shipments;

describe.each(real.moments)('every delivery at $name (minute $timeMin)', ({ timeMin }) => {
  it('the run has deliveries, and each one is in its sender\'s and recipient\'s lists', () => {
    expect(shipments.length).toBeGreaterThan(0);
    const moment = real.at(timeMin);
    for (const s of shipments) {
      expect(moment.dashboard(s.originBusinessId).outgoing.map((v) => v.shipment.id)).toContain(s.id);
      expect(moment.dashboard(s.destinationBusinessId).incoming.map((v) => v.shipment.id)).toContain(s.id);
    }
  });

  it.each(['sender', 'recipient'] as const)('the %s\'s details panel shows exactly what the API gives', (side) => {
    for (const s of shipments) {
      const { api, panel, html } = open(timeMin, s.id, side);
      expect(panel, `${s.id} panel missing for the ${side}`).toBeTruthy();
      checkPanel(api, panel, side);
      expect(forbiddenIn(html), s.id).toEqual([]);
      // The selected row is marked in the table.
      expect(html).toMatch(new RegExp(`<tr[^>]*aria-selected="true"[^>]*>(?:(?!</tr>)[\\s\\S])*>${s.id}<`));
    }
  });
});

describe('both sides agree', () => {
  it('at the end, the sender and the recipient see the same delivered time for each delivered package', () => {
    const end = run.scenario.settings.simEndMin;
    const delivered = shipments.filter((s) => real.at(end).shipment(s.id).status === 'delivered');
    expect(delivered.length).toBeGreaterThan(0);
    for (const s of delivered) {
      const a = open(end, s.id, 'sender');
      const b = open(end, s.id, 'recipient');
      const da = facts(resultOf(a.panel)).Delivered;
      const db = facts(resultOf(b.panel)).Delivered;
      expect(da, s.id).toBe(formatMin(a.api.deliveredAtMin!));
      expect(db).toBe(da);
      // And the table rows of both workspaces say the same.
      const rowA = elements(a.html, 'tr', 'aria-selected="true"')[0];
      const rowB = elements(b.html, 'tr', 'aria-selected="true"')[0];
      expect(text(rowA)).toContain(`Delivered ${da}`);
      expect(text(rowB)).toContain(`Delivered ${da}`);
    }
  });

  it('an unmatched delivery shows the API\'s reason on both sides at every moment', () => {
    const unmatched = run.assignments.unmatched;
    for (const { timeMin } of real.moments) {
      for (const u of unmatched) {
        for (const side of ['sender', 'recipient'] as const) {
          const { panel } = open(timeMin, u.shipmentId, side);
          expect(text(panel)).toContain('No matching commute yet');
          expect(text(panel)).toContain(u.reason);
        }
      }
    }
  });
});
