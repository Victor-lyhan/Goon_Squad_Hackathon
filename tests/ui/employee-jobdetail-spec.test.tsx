import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JobDetail } from '../../client/src/components/employee/JobDetail';
import { formatMin } from '../../client/src/ui/format';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { jobResponse } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';
import type { MapResponse } from '../../shared/api';

const run = createInitialRun(loadDefaultScenario());
const { scenario } = run;
const map: MapResponse = {
  runId: run.runId, graph: scenario.graph, businesses: scenario.businesses, hubs: scenario.hubs,
  homes: scenario.employees.map((e) => ({ employeeId: e.id, nodeId: e.homeNodeId })),
};
const planOf = (id: string) => run.assignments.plans.find((p) => p.id === id)!;
const pick = (kind: 'direct' | 'relay', leg: number) =>
  run.jobs.find((j) => planOf(j.planId).kind === kind && j.legIndex === leg)!;
const at = (jobId: string, t: number) => jobResponse(run, snapshotAt(run, t), jobId)!;
const html = (j: ReturnType<typeof at>) =>
  renderToStaticMarkup(<JobDetail job={j} map={map} businesses={scenario.businesses} hubs={scenario.hubs} />);

const KINDS = [['direct', 0], ['relay', 0], ['relay', 1]] as const;

describe('job detail vs spec 3B', () => {
  for (const [kind, leg] of KINDS) {
    const label = `${kind} leg ${leg + 1}`;
    it(`${label}: stops, names, times, reward, added minutes, trip, links`, () => {
      const job = pick(kind, leg);
      const start = at(job.id, 0);
      const out = html(start);
      for (const s of start.plan.legs[leg].stops) {
        expect(out).toContain(formatMin(s.arrivalMin));
      }
      const names = [...scenario.businesses.map((b) => b.name), ...scenario.hubs.map((h) => h.name)];
      expect(names.some((n) => out.includes(n))).toBe(true);
      expect(out).toContain(`+${start.plan.legs[leg].extraMin} min`);
      expect(out).toContain(start.trip.direction === 'evening' ? 'Evening commute, Day 1' : 'Morning commute, Day 2');
      expect(out).toContain(`href="/simulator?package=${start.shipment.id}"`);
      expect(out).not.toMatch(/NaN|undefined|null/);
      for (const n of scenario.graph.nodes) expect(out).not.toContain(`>${n.id}<`);
    });

    it(`${label}: status follows the API at start, mid-trip and finish`, () => {
      const job = pick(kind, leg);
      const stops = at(job.id, 0).plan.legs[leg].stops;
      const times: [number, string, number][] = [
        [0, 'Assigned', 0],
        [job.pickup.serviceEndMin, 'In progress', 1],
        [job.dropoff.serviceEndMin + 1, 'Completed', stops.length],
      ];
      for (const [t, label2, doneCount] of times) {
        const v = at(job.id, t);
        const out = html(v);
        expect(out).toContain(label2);
        expect((out.match(/data-done="true"/g) ?? []).length).toBe(Math.min(doneCount, stops.length));
        if (label2 === 'In progress') expect(out).toMatch(/data-done="true"[^>]*><strong>✓ (Pick up|Collect from)/);
      }
    });
  }

  it('relay leg 1 ends at the hub, leg 2 starts there, direct says neither', () => {
    const hub = (j: ReturnType<typeof pick>) => scenario.hubs.find((h) => h.id === planOf(j.planId).hubId)!.name;
    const l1 = pick('relay', 0);
    const l2 = pick('relay', 1);
    expect(html(at(l1.id, 0))).toContain(`Your leg ends at ${hub(l1)}. The package waits there overnight.`);
    expect(html(at(l2.id, 0))).toContain(`Your leg starts at ${hub(l2)}`);
    const d = html(at(pick('direct', 0).id, 0));
    expect(d).not.toContain('overnight');
  });
});
