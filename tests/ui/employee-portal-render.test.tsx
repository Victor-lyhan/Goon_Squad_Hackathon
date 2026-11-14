import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmployeePortalView } from '../../client/src/components/employee/EmployeePortalView';
import type { EmployeeDashboard } from '../../shared/api';
import { sampleJob } from './jobDetailSample';

const j = sampleJob.at(0);
const dash = (over: Partial<EmployeeDashboard> = {}): EmployeeDashboard => ({
  employee: { id: 'emp-1', name: 'Ann', businessId: sampleJob.businesses[0].id, homeNodeId: '', eveningDepartureMin: 1020,
    morningDepartureMin: 1900, availableEvening: true, availableMorning: true, maxExtraMin: 8,
    eveningViaNodeIds: [], morningViaNodeIds: [] } as never,
  trips: [], assigned: [j], completed: [{ ...j, status: 'completed', job: { ...j.job, id: 'done-1' } }],
  earnedCents: 300, projectedCents: 900, notifications: [], phase: 'planning', version: 1, ...over,
});
const render = (d: EmployeeDashboard | null, error: string | null = null) =>
  renderToStaticMarkup(
    <EmployeePortalView dash={d} map={sampleJob.map} businesses={sampleJob.businesses} hubs={sampleJob.hubs}
      error={error} onSave={() => {}} onViewJob={() => {}} onCloseJob={() => {}} />,
  );

describe('EmployeePortalView', () => {
  it('renders earnings, feed, history and commute', () => {
    const html = render(dash());
    expect(html).toContain('Welcome, Ann');
    expect(html).toContain('Earned');
    expect(html).toContain('$3.00');
    expect(html).toContain('Projected');
    expect(html).toContain('$9.00');
    expect(html).toContain('History');
    expect(html).toContain('View job');
    expect(html).toContain('My commute');
    expect(html).not.toContain('Accept');
  });
  it('locked planning disables the editor', () => {
    expect(render(dash({ phase: 'locked' }))).toContain('Planning is locked');
  });
  it('empty, loading and error states', () => {
    expect(render(dash({ assigned: [], completed: [] }))).toContain('No jobs yet. Save your commute to get matched.');
    expect(render(null)).toContain('Loading');
    expect(render(null, 'boom')).toContain('boom');
  });
});
