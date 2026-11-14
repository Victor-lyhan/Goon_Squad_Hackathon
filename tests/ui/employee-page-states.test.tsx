import { describe, expect, it } from 'vitest';
import { dashReducer, initialDashState, isReconnecting, type DashState } from '../../client/src/components/employee/dashboardState';
import { portalView } from '../../client/src/components/employee/employeePortalModel';
import { stepBaseline } from '../../client/src/components/employee/newJobsModel';
import type { EmployeeDashboard } from '../../shared/api';

const dash = (version: number, jobIds: string[] = []): EmployeeDashboard => ({
  employee: { id: 'e1', name: 'Ana', homeNodeId: 'n1', businessId: 'b1' },
  trips: [],
  assigned: jobIds.map((id) => ({ job: { id }, shipment: { label: id } })),
  completed: [], earnedCents: 0, projectedCents: 0, notifications: [], phase: 'planning', version,
} as unknown as EmployeeDashboard);

const fail = (status: number) => ({ type: 'failure' as const, message: 'boom', status });

describe('dashReducer', () => {
  it('first load has no data and no error: spinner, not empty', () => {
    expect(portalView(initialDashState.dash, initialDashState.error)).toBe('loading');
    expect(isReconnecting(initialDashState)).toBe(false);
  });

  it('success -> error -> error -> success keeps data and toggles Reconnecting', () => {
    const d1 = dash(1);
    let s: DashState = dashReducer(initialDashState, { type: 'success', dash: d1, runId: 'run-1' });
    expect(isReconnecting(s)).toBe(false);
    s = dashReducer(s, fail(0));
    expect(s.dash).toBe(d1);
    expect(isReconnecting(s)).toBe(true);
    s = dashReducer(s, fail(503));
    expect(s.dash).toBe(d1);
    expect(isReconnecting(s)).toBe(true);
    const d2 = dash(2);
    s = dashReducer(s, { type: 'success', dash: d2, runId: 'run-1' });
    expect(s.dash).toBe(d2);
    expect(s.error).toBeNull();
    expect(isReconnecting(s)).toBe(false);
  });

  it('first-load failure shows the error state, not Reconnecting', () => {
    const s = dashReducer(initialDashState, fail(500));
    expect(isReconnecting(s)).toBe(false);
    expect(portalView(s.dash, s.error)).toBe('error');
  });

  it('a 404 drops the data (not-in-city state), never Reconnecting', () => {
    let s = dashReducer(initialDashState, { type: 'success', dash: dash(1), runId: 'run-1' });
    s = dashReducer(s, fail(404));
    expect(s.dash).toBeNull();
    expect(isReconnecting(s)).toBe(false);
    expect(s.status).toBe(404);
  });

  it('run change drops stale data, and the New baseline resets', () => {
    let s = dashReducer(initialDashState, { type: 'success', dash: dash(5, ['j1']), runId: 'run-1' });
    const b1 = stepBaseline(null, 'run-1', s.dash!).baseline;
    s = dashReducer(s, { type: 'runChanged', runId: 'run-2' });
    expect(s.dash).toBeNull();
    expect(s.runId).toBe('run-2');
    expect(portalView(s.dash, s.error)).toBe('loading');
    s = dashReducer(s, { type: 'success', dash: dash(6, ['j1', 'j2']), runId: 'run-2' });
    expect(s.dash?.assigned).toHaveLength(2);
    // Baseline from run-1 must not flag run-2 jobs as New.
    expect(stepBaseline(b1, 'run-2', s.dash!).newIds).toEqual([]);
  });

  it('reset (employee change) returns to the loading state', () => {
    const s = dashReducer(dashReducer(initialDashState, { type: 'success', dash: dash(1), runId: 'r' }), { type: 'reset' });
    expect(s).toEqual(initialDashState);
  });
});
