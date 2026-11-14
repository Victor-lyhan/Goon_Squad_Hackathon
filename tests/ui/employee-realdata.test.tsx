import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JobCard } from '../../client/src/components/JobCard';
import { JobDetail } from '../../client/src/components/employee/JobDetail';
import { EarningsSummary } from '../../client/src/components/employee/EarningsSummary';
import { formatCents } from '../../client/src/ui/format';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { employeeDashboard, jobResponse } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';
import type { MapResponse } from '../../shared/api';

const run = createInitialRun(loadDefaultScenario());
const { graph, businesses, hubs, employees } = run.scenario;
const map: MapResponse = {
  runId: run.runId, graph, businesses, hubs,
  homes: employees.map((e) => ({ employeeId: e.id, nodeId: e.homeNodeId })),
};

function renderAll(timeMin: number) {
  const snap = snapshotAt(run, timeMin);
  const out: { html: string; kind: string; legIndex: number; jobId: string; status: string }[] = [];
  const earnings: { html: string; earned: number; carrier: boolean }[] = [];
  for (const e of employees) {
    const d = employeeDashboard(run, snap, e.id)!;
    earnings.push({
      html: renderToStaticMarkup(<EarningsSummary earnedCents={d.earnedCents} assigned={d.assigned} completed={d.completed} />),
      earned: d.earnedCents, carrier: d.assigned.length + d.completed.length > 0,
    });
    for (const v of [...d.assigned, ...d.completed]) {
      const card = renderToStaticMarkup(<JobCard view={v} businesses={businesses} hubs={hubs} />);
      const jr = jobResponse(run, snap, v.job.id)!;
      const detail = renderToStaticMarkup(<JobDetail job={jr} map={map} businesses={businesses} hubs={hubs} />);
      out.push({ html: card + detail, kind: v.plan.kind, legIndex: v.job.legIndex, jobId: v.job.id, status: v.status });
      if (v.plan.kind === 'relay') {
        const hub = hubs.find((h) => h.id === v.plan.hubId)!.name;
        const dest = businesses.find((b) => b.id === v.shipment.destinationBusinessId)!.name;
        if (v.job.legIndex === 0) expect(detail).toContain(`Drop at ${hub}; another employee completes delivery`);
        else expect(detail).toContain(`Collect from ${hub} and deliver to ${dest}`);
      } else {
        const o = businesses.find((b) => b.id === v.shipment.originBusinessId)!.name;
        const dn = businesses.find((b) => b.id === v.shipment.destinationBusinessId)!.name;
        expect(card).toContain(o);
        expect(card).toContain(dn);
        expect(detail).not.toContain('another employee');
      }
    }
  }
  return { out, earnings };
}

const clean = (html: string) => {
  expect(html).not.toMatch(/NaN|undefined|>null<|\bnull\b/);
  expect(html).not.toMatch(/n-\d+-\d+/);
};

describe('employee portal with real Demo-city data', () => {
  it('renders every job at start with relay/direct copy and no junk', () => {
    const { out, earnings } = renderAll(run.scenario.settings.simStartMin);
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((o) => o.kind === 'relay' && o.legIndex === 0)).toBe(true);
    expect(out.some((o) => o.kind === 'relay' && o.legIndex === 1)).toBe(true);
    expect(out.some((o) => o.kind === 'direct')).toBe(true);
    out.forEach((o) => clean(o.html));
    earnings.forEach((e) => clean(e.html));
  });

  it('after simEndMin jobs are completed and carriers have formatted earnings', () => {
    const { out, earnings } = renderAll(run.scenario.settings.simEndMin);
    expect(out.every((o) => o.status === 'completed')).toBe(true);
    out.forEach((o) => clean(o.html));
    const carriers = earnings.filter((e) => e.carrier);
    expect(carriers.length).toBeGreaterThan(0);
    for (const e of carriers) {
      expect(e.earned).toBeGreaterThan(0);
      expect(e.html).toContain(formatCents(e.earned));
      clean(e.html);
    }
  });
});
