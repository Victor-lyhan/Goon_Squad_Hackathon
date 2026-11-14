import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JobDetail } from '../../client/src/components/employee/JobDetail';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { jobResponse } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';
import type { MapResponse } from '../../shared/api';

const run = createInitialRun(loadDefaultScenario());
const { graph, businesses, hubs, employees } = run.scenario;
const map: MapResponse = {
  runId: run.runId, graph, businesses, hubs,
  homes: employees.map((e) => ({ employeeId: e.id, nodeId: e.homeNodeId })),
};
const snap = snapshotAt(run, run.scenario.settings.simStartMin);
const render = (jobId: string) => {
  const job = jobResponse(run, snap, jobId)!;
  const html = renderToStaticMarkup(<JobDetail job={job} map={map} businesses={businesses} hubs={hubs} />);
  return { job, html };
};
const find = (pred: (j: (typeof run.jobs)[number], kind: string) => boolean) =>
  run.jobs.find((j) => pred(j, run.assignments.plans.find((p) => p.id === j.planId)!.kind))!;
const clean = (html: string) => {
  expect(html).not.toMatch(/NaN|undefined|\bnull\b/);
  expect(html).not.toMatch(/n-\d+-\d+/);
};

describe('employee job links and progress', () => {
  it('first-leg relay job links to tracking and simulator', () => {
    const { job, html } = render(find((j, k) => k === 'relay' && j.legIndex === 0).id);
    expect(html).toContain(`href="/business/${job.shipment.originBusinessId}?shipment=${job.shipment.id}"`);
    expect(html).toContain(`href="/simulator?package=${job.shipment.id}"`);
    expect(html).toContain('Track package');
    expect(html).toContain('Watch in simulator');
    const sender = businesses.find((b) => b.id === job.shipment.originBusinessId)!.name;
    expect(html).toContain(`Package is waiting at ${sender} for pickup`);
    clean(html.replace(/href="[^"]*"/g, ''));
  });
  it('direct job links and progress', () => {
    const { job, html } = render(find((_j, k) => k === 'direct').id);
    expect(html).toContain(`href="/business/${job.shipment.originBusinessId}?shipment=${job.shipment.id}"`);
    expect(html).toContain(`href="/simulator?package=${job.shipment.id}"`);
    expect(html).toContain('Package is waiting at');
    clean(html.replace(/href="[^"]*"/g, ''));
  });
  it('uses the shipment progress from the API when given', () => {
    const job = jobResponse(run, snap, find((j, k) => k === 'relay' && j.legIndex === 0).id)!;
    const html = renderToStaticMarkup(
      <JobDetail job={job} map={map} businesses={businesses} hubs={hubs} progress="at_hub" />);
    const hub = hubs.find((h) => h.id === job.plan.hubId)!.name;
    expect(html).toContain(`Package is at ${hub}, waiting for the next leg`);
  });
});
