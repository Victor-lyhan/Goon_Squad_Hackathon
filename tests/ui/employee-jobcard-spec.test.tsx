import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JobCard } from '../../client/src/components/JobCard';
import { formatCents } from '../../client/src/ui/format';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { employeeDashboard } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';

const run = createInitialRun(loadDefaultScenario());
const { businesses, hubs, employees } = run.scenario;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');

describe('Demo-city job cards match spec §3B', () => {
  const snap = snapshotAt(run, run.scenario.settings.simStartMin);
  const views = employees.flatMap((e) => employeeDashboard(run, snap, e.id)!.assigned);
  it('has direct and both relay legs', () => {
    expect(views.some((v) => v.plan.kind === 'direct')).toBe(true);
    expect(views.some((v) => v.job.legIndex === 0 && v.plan.kind === 'relay')).toBe(true);
    expect(views.some((v) => v.job.legIndex === 1)).toBe(true);
  });
  for (const v of views.length ? views : []) {
    it(`renders ${v.job.id}`, () => {
      const html = renderToStaticMarkup(<JobCard view={v} businesses={businesses} hubs={hubs} />);
      const text = html.replace(/<[^>]+>/g, ' ');
      const name = (id: string) => businesses.find((b) => b.id === id)!.name;
      const has = (s: string) => expect(html).toContain(esc(s));
      has('New delivery job');
      has(v.shipment.label);
      expect(text).toMatch(/kg/);
      has(name(v.shipment.originBusinessId));
      has(name(v.shipment.destinationBusinessId));
      has(formatCents(v.job.rewardCents));
      expect(text).toMatch(/\+\d+ min added/);
      expect(text).toMatch(/Pickup[^]*Drop-off/);
      expect(html).toContain(`href="/employee/${v.job.employeeId}?job=${v.job.id}"`);
      expect(html).toContain('View job');
      expect(html).not.toMatch(/Accept/i);
      expect(html).not.toMatch(/NaN|undefined|\bnull\b/);
      expect(html).not.toMatch(/n-\d+-\d+/);
      if (v.plan.kind === 'direct') {
        has('Direct');
      } else {
        const hub = hubs.find((h) => h.id === v.plan.hubId)!.name;
        const dest = name(v.shipment.destinationBusinessId);
        has(`Relay leg ${v.job.legIndex + 1} of 2`);
        if (v.job.legIndex === 0) {
          has(`Drop at ${hub}; another employee completes delivery to ${dest}`);
          expect(text).toMatch(new RegExp(`Drop-off\\s+${esc(hub)},`));
        } else {
          has(`Collect from ${hub} and deliver to ${dest}`);
          expect(text).toMatch(new RegExp(`Pickup\\s+${esc(hub)},`));
        }
      }
    });
  }
});
