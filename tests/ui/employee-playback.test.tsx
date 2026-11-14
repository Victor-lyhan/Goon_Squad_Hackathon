import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmployeePortalView } from '../../client/src/components/employee/EmployeePortalView';
import { formatCents } from '../../client/src/ui/format';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { employeeDashboard, shipmentView } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';
import type { MapResponse } from '../../shared/api';

const run = createInitialRun(loadDefaultScenario());
const { graph, businesses, hubs, employees, settings } = run.scenario;
const map: MapResponse = {
  runId: run.runId, graph, businesses, hubs,
  homes: employees.map((e) => ({ employeeId: e.id, nodeId: e.homeNodeId })),
};

const relay = run.assignments.plans.find((p) => p.kind === 'relay')!;
const direct = run.assignments.plans.find((p) => p.kind === 'direct')!;
const [firstId, secondId] = relay.legs.map((l) => l.employeeId);
const directId = direct.legs[0].employeeId;
const jobId = (planId: string, i: number) => `${planId}-L${i}`;
const evs = run.events.filter((e) => e.planId === relay.id);
const dropMin = evs.find((e) => e.kind === 'hub_drop')!.timeMin;
const pickupMin = evs.find((e) => e.kind === 'hub_pickup')!.timeMin;
const hubName = hubs.find((h) => h.id === relay.hubId)!.name;

function page(empId: string, t: number) {
  const snap = snapshotAt(run, t);
  const dash = employeeDashboard(run, snap, empId)!;
  const html = renderToStaticMarkup(
    <EmployeePortalView dash={dash} map={map} businesses={businesses} hubs={hubs} error={null}
      onSave={() => {}} onViewJob={() => {}} onCloseJob={() => {}} />,
  );
  return { dash, html, snap };
}
const status = (d: ReturnType<typeof page>['dash'], id: string) =>
  [...d.assigned, ...d.completed].find((v) => v.job.id === id)!.status;
const feed = (html: string) => {
  const i = html.indexOf('<h2>History</h2>');
  return i < 0 ? { active: html, history: '' } : { active: html.slice(0, i), history: html.slice(i) };
};
const clean = (html: string) => {
  expect(html).not.toMatch(/NaN|undefined|>null<|\bnull\b/);
  const text = html.replace(/<[^>]*>/g, " "); // attribute values (e.g. option value) are not visible
  expect(text).not.toMatch(/\bn-\d+-\d+\b/);
};

describe('employee portal playback with real Demo-city data', () => {
  it('has a relay shipment and a direct carrier to test', () => {
    expect(firstId).not.toBe(secondId);
    expect(dropMin).toBeLessThan(1440);
    expect(pickupMin).toBeGreaterThan(1440);
  });

  it('at start every job is Assigned with zero earnings and copy per spec', () => {
    const t = settings.simStartMin;
    const a = page(firstId, t), b = page(secondId, t), d = page(directId, t);
    expect(status(a.dash, jobId(relay.id, 0))).toBe('assigned');
    expect(status(b.dash, jobId(relay.id, 1))).toBe('assigned');
    expect(status(d.dash, jobId(direct.id, 0))).toBe('assigned');
    expect(a.dash.earnedCents).toBe(0);
    expect(a.html).toContain(`Drop at ${hubName}; another employee completes delivery`);
    expect(b.html).toMatch(new RegExp(`Collect from ${hubName} and deliver to `));
    for (const p of [a, b, d]) clean(p.html);
  });

  it('first leg: In progress after pickup, Completed and paid at the hub drop while shipment is At hub', () => {
    const mid = page(firstId, 1031);
    expect(status(mid.dash, jobId(relay.id, 0))).toBe('in_progress');
    expect(mid.dash.earnedCents).toBe(0);
    expect(mid.html).toContain('In progress');

    const after = page(firstId, dropMin); // at the drop event
    const reward = run.jobs.find((j) => j.id === jobId(relay.id, 0))!.rewardCents;
    expect(status(after.dash, jobId(relay.id, 0))).toBe('completed');
    expect(after.dash.earnedCents).toBeGreaterThanOrEqual(reward);
    expect(after.html).toContain(formatCents(after.dash.earnedCents));
    const { active, history } = feed(after.html);
    expect(history).toContain('Completed');
    expect(history).toContain(`Drop at ${hubName}; another employee completes delivery`);
    expect(active).not.toContain(`Drop at ${hubName}`);
    const ship = shipmentView(run, after.snap, relay.shipmentId)!;
    expect(ship.status).toBe('at_hub');
    // the second carrier has not started
    const second = page(secondId, dropMin);
    expect(status(second.dash, jobId(relay.id, 1))).toBe('assigned');
    expect(second.dash.earnedCents).toBe(0);
    clean(after.html); clean(second.html);
  });

  it('overnight: leg 1 stays in history, leg 2 still Assigned', () => {
    const t = 1200;
    const a = page(firstId, t), b = page(secondId, t);
    expect(status(a.dash, jobId(relay.id, 0))).toBe('completed');
    expect(status(b.dash, jobId(relay.id, 1))).toBe('assigned');
    expect(b.dash.earnedCents).toBe(0);
    clean(a.html); clean(b.html);
  });

  it('morning: second leg goes In progress then Completed and pays', () => {
    const during = page(secondId, pickupMin);
    expect(status(during.dash, jobId(relay.id, 1))).toBe('in_progress');
    expect(during.dash.earnedCents).toBe(0);
    const done = page(secondId, evs.find((e) => e.kind === 'delivered')!.timeMin);
    expect(status(done.dash, jobId(relay.id, 1))).toBe('completed');
    expect(done.dash.earnedCents).toBeGreaterThan(0);
    expect(feed(done.html).history).toMatch(/Collect from .* and deliver to /);
    expect(feed(done.html).active).not.toContain('Collect from');
    clean(during.html); clean(done.html);
  });

  it('direct carrier: Assigned → In progress → Completed', () => {
    const ev = run.events.filter((e) => e.planId === direct.id);
    const pk = ev.find((e) => e.kind === 'pickup')!.timeMin;
    const dl = ev.find((e) => e.kind === 'delivered')!.timeMin;
    expect(status(page(directId, pk - 1).dash, jobId(direct.id, 0))).toBe('assigned');
    const mid = page(directId, pk);
    expect(status(mid.dash, jobId(direct.id, 0))).toBe('in_progress');
    const done = page(directId, dl);
    expect(status(done.dash, jobId(direct.id, 0))).toBe('completed');
    expect(done.dash.earnedCents).toBeGreaterThan(0);
    expect(feed(done.html).history).toContain('Completed');
    clean(mid.html); clean(done.html);
  });

  it('simEndMin: everything completed, nothing active, earnings equal projected', () => {
    for (const id of [firstId, secondId, directId]) {
      const p = page(id, settings.simEndMin);
      expect(p.dash.assigned).toHaveLength(0);
      expect(p.dash.earnedCents).toBe(p.dash.projectedCents);
      expect(p.html).toContain(formatCents(p.dash.earnedCents));
      expect(p.html).toContain('No active jobs right now.');
      clean(p.html);
    }
  });
});
