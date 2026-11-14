import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmployeePortalView } from '../../client/src/components/employee/EmployeePortalView';
import {
  diffNewJobs, nextArrivals, NEW_BADGE_MS, stepBaseline, toastText, arrivalsFor, dashboardJobIds,
} from '../../client/src/components/employee/newJobsModel';
import { Toast } from '../../client/src/ui';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import type { EmployeeDashboard, MapResponse, ShipmentResponse } from '../../shared/api';

let server: Server;
let base: string;
let store: ReturnType<typeof createStore>;

beforeAll(async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'newjob-')), 'state.json');
  store = createStore({ filePath: file, initial: () => createInitialRun(loadDefaultScenario()) });
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

const dashOf = async (id: string) =>
  (await (await fetch(`${base}/api/employees/${id}/dashboard`)).json()) as EmployeeDashboard;

async function postShipment() {
  const { businesses, settings } = store.get().scenario;
  let n = 0;
  for (const o of businesses) for (const d of businesses) {
    if (o.id === d.id) continue;
    const r = await fetch(`${base}/api/shipments`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientRequestId: `nj-${n++}`, originBusinessId: o.id, destinationBusinessId: d.id,
        label: 'Contracts', category: 'envelope', description: 'Signed papers', weightKg: 0.5,
        readyMin: settings.simStartMin, deadlineMin: settings.simEndMin, pickupInstructions: '', dropoffInstructions: '',
      }),
    });
    const b = (await r.json()) as ShipmentResponse;
    if (b.matched) return b;
  }
  throw new Error('no matchable pair');
}

describe('new job arrives by polling', () => {
  it('diffs, badges, toasts and lists the notification using the real pipeline', async () => {
    const { employees, businesses, hubs, graph } = store.get().scenario;
    const before = new Map<string, EmployeeDashboard>();
    for (const e of employees) before.set(e.id, await dashOf(e.id));

    const res = await postShipment();
    const carrier = res.plan!.legs[0].employeeId;
    const prev = before.get(carrier)!;
    const next = await dashOf(carrier);
    const newJobId = res.jobIds[0];

    // Pure diff
    const prevIds = dashboardJobIds(prev);
    expect(diffNewJobs(null, next)).toEqual([]);
    expect(diffNewJobs(prevIds, next)).toContain(newJobId);
    expect(diffNewJobs(prevIds, prev)).toEqual([]);
    expect(diffNewJobs(prevIds, next).every((id) => !prevIds.has(id))).toBe(true);

    // Baseline: first load silent, runId change / version drop resets
    const first = stepBaseline(null, 'run-1', prev);
    expect(first.newIds).toEqual([]);
    const second = stepBaseline(first.baseline, 'run-1', next);
    expect(second.newIds).toContain(newJobId);
    expect(stepBaseline(first.baseline, 'run-2', next).newIds).toEqual([]);
    expect(stepBaseline(second.baseline, 'run-1', { ...prev, version: next.version - 1 }).newIds).toEqual([]);

    // New city, same emp id, stale run id, higher version: nothing is new
    const otherCity: EmployeeDashboard = {
      ...next, version: next.version + 5,
      employee: { ...next.employee, homeNodeId: 'other-home', name: 'Someone Else' },
      assigned: next.assigned.map((v) => ({ ...v, job: { ...v.job, id: `new-${v.job.id}` } })),
      completed: [],
    };
    expect(stepBaseline(second.baseline, 'run-1', otherCity).newIds).toEqual([]);
    // Same employee but none of the old jobs survive (job ids changed): also a reset
    const noOverlap: EmployeeDashboard = { ...otherCity, employee: next.employee };
    expect(stepBaseline(second.baseline, 'run-1', noOverlap).newIds).toEqual([]);

    // Badge lifetime
    const arr = nextArrivals({}, second.newIds, next, 1000);
    expect(Object.keys(arr)).toContain(newJobId);
    expect(nextArrivals(arr, [], next, 1000 + NEW_BADGE_MS - 1)[newJobId]).toBe(1000);
    expect(nextArrivals(arr, [], next, 1000 + NEW_BADGE_MS)[newJobId]).toBeUndefined();

    // Rendered view
    const map: MapResponse = {
      runId: 'run-1', graph, businesses, hubs,
      homes: employees.map((e) => ({ employeeId: e.id, nodeId: e.homeNodeId })),
    };
    const render = (ids: string[]) => renderToStaticMarkup(
      <EmployeePortalView dash={next} map={map} businesses={businesses} hubs={hubs} error={null}
        newJobIds={new Set(ids)} onSave={() => {}} onViewJob={() => {}} onCloseJob={() => {}} />,
    );
    const html = render(second.newIds);
    expect(html.match(/emp-portal__new-badge/g)?.length).toBe(second.newIds.length);
    expect(html).toContain('>New<');
    expect(render([])).not.toContain('emp-portal__new-badge');

    // Notification entry from the API
    const ntf = next.notifications.find((n) => n.id === `ntf-${newJobId}`);
    expect(ntf?.kind).toBe('job_assigned');
    expect(html).toContain(ntf!.message.replace(/&/g, '&amp;').replace(/"/g, '&quot;'));

    // Toast
    const [arrival] = arrivalsFor(next, [newJobId]);
    expect(arrival.packageName).toBe('Contracts');
    const toast = renderToStaticMarkup(
      <Toast toasts={[{ id: 1, kind: 'info', message: toastText(arrival.packageName) }]} onDismiss={() => {}} />,
    );
    expect(toast).toContain('New delivery job: Contracts');
  }, 30_000); // ~0.5 s locally (HTTP round trips for every employee); 30 s for slower CI runners
});
