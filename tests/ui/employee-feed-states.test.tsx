import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmployeePortalView } from '../../client/src/components/employee/EmployeePortalView';
import { feedGroups } from '../../client/src/components/employee/employeePortalModel';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { employeeDashboard } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';
import type { MapResponse } from '../../shared/api';
import { readFileSync } from 'node:fs';

const run = createInitialRun(loadDefaultScenario());
const { graph, businesses, hubs, employees, settings } = run.scenario;
const map: MapResponse = {
  runId: run.runId, graph, businesses, hubs,
  homes: employees.map((e) => ({ employeeId: e.id, nodeId: e.homeNodeId })),
};
const relay = run.assignments.plans.find((p) => p.kind === 'relay')!;
const firstId = relay.legs[0].employeeId;
const secondId = relay.legs[1].employeeId;
const evs = run.events.filter((e) => e.planId === relay.id);
const dropMin = evs.find((e) => e.kind === 'hub_drop')!.timeMin;
const pickupMin = evs.find((e) => e.kind === 'hub_pickup')!.timeMin;

function page(empId: string, t: number) {
  const dash = employeeDashboard(run, snapshotAt(run, t), empId)!;
  const html = renderToStaticMarkup(
    <EmployeePortalView dash={dash} map={map} businesses={businesses} hubs={hubs} error={null}
      onSave={() => {}} onViewJob={() => {}} onCloseJob={() => {}} />,
  );
  return { dash, html };
}
const text = (html: string) => html.replace(/<[^>]*>/g, ' ');
const jobStatus = (d: ReturnType<typeof page>['dash'], id: string) =>
  [...d.assigned, ...d.completed].find((v) => v.job.id === id)!.status;

describe('employee feed grouping across the run', () => {
  it('groups by API status with counts, in trip order, with clean text at four clock times', () => {
    for (const t of [settings.simStartMin, 1060, 1500, settings.simEndMin]) {
      for (const e of employees) {
        const { dash, html } = page(e.id, t);
        const groups = feedGroups(dash);
        const total = dash.assigned.length + dash.completed.length;
        expect(groups.reduce((n, g) => n + g.views.length, 0)).toBe(total);
        for (const g of groups) {
          expect(g.views.every((v) => v.status === g.status)).toBe(true);
          const dep = g.views.map((v) => dash.trips.find((x) => x.id === v.job.tripId)!.departureMin);
          expect(dep).toEqual([...dep].sort((a, b) => a - b));
          const label = { assigned: 'Upcoming', in_progress: 'In progress', completed: 'Completed' }[g.status];
          expect(html).toContain(`${label} (${g.views.length})`);
        }
        if (total === 0) expect(html).toContain('Matched packages appear here automatically');
        expect(html).not.toMatch(/NaN|undefined|>null<|\bnull\b/);
        expect(text(html)).not.toMatch(/\bn-\d+-\d+\b/);
      }
    }
  }, 30_000); // ~0.7 s locally: 4 clock times x every employee; 30 s for slower CI runners

  it('relay first leg is Completed after the hub drop while the second leg is still Upcoming', () => {
    expect(pickupMin).toBeGreaterThan(dropMin);
    const t = dropMin;
    const first = page(firstId, t);
    const second = page(secondId, t);
    expect(jobStatus(first.dash, `${relay.id}-L0`)).toBe('completed');
    expect(jobStatus(second.dash, `${relay.id}-L1`)).toBe('assigned');
    expect(text(first.html)).toContain('Completed (');
    expect(text(second.html)).toContain('Upcoming (');
  });

  it('at 1500 (overnight) the evening first leg is completed and the morning leg is Upcoming', () => {
    const first = page(firstId, 1500).dash;
    const second = page(secondId, 1500).dash;
    expect(jobStatus(first, `${relay.id}-L0`)).toBe('completed');
    if (pickupMin > 1500) expect(jobStatus(second, `${relay.id}-L1`)).toBe('assigned');
  });

  it('a commuter with no jobs sees the empty state and still sees the commute', () => {
    const none = employees.find((e) => employeeDashboard(run, snapshotAt(run, 930), e.id)!.assigned.length === 0
      && employeeDashboard(run, snapshotAt(run, 930), e.id)!.completed.length === 0);
    const id = none?.id ?? employees[0].id;
    const dash = { ...employeeDashboard(run, snapshotAt(run, 930), id)!, assigned: [], completed: [] };
    const html = renderToStaticMarkup(
      <EmployeePortalView dash={dash} map={map} businesses={businesses} hubs={hubs} error={null}
        onSave={() => {}} onViewJob={() => {}} onCloseJob={() => {}} />,
    );
    expect(html).toContain('Matched packages appear here automatically');
    expect(html).toContain('My commute');
  });

  it('New badge still shows for highlighted jobs', () => {
    const { dash } = page(firstId, 930);
    const v = [...dash.assigned, ...dash.completed][0];
    const html = renderToStaticMarkup(
      <EmployeePortalView dash={dash} map={map} businesses={businesses} hubs={hubs} error={null}
        newJobIds={new Set([v.job.id])}
        onSave={() => {}} onViewJob={() => {}} onCloseJob={() => {}} />,
    );
    expect(html).toContain('emp-portal__new-badge');
  });

  it('390 px: no fixed widths over 358 px in employee.css', () => {
    const css = readFileSync('client/src/components/employee/employee.css', 'utf8');
    for (const m of css.matchAll(/(?<![-a-z])(?:min-)?width:\s*(\d+)px/g)) expect(Number(m[1])).toBeLessThanOrEqual(358);
    expect(css).toMatch(/max-width:\s*100%/);
  });
});
