// #596: when the Employee page asks for the map again within one run. Pure rules, tested in Node.
import { describe, expect, it } from 'vitest';
import {
  MAP_LINE_RETRY_MS, jobLegMissingLine, jobSetChanged, lineRetryDelayMs, lineRetryDue, mapJobsKey,
} from '../../client/src/components/employee/v2/route/mapRefreshModel';
import type { EmployeeJobView } from '../../shared/v2/api';
import { DASHBOARD, HOME, JOB, MAP, PLAN, RELAY, SENDER, WORK, withLine } from './employee-v2-route-sample';

const view = (id: string): EmployeeJobView => ({ ...JOB, job: { ...JOB.job, id } });
const key = (runId: string | null, d = DASHBOARD) => mapJobsKey(runId, d);

describe('jobSetChanged: the set of job IDs within one employee and run', () => {
  it('is false for the first dashboard and for an equal poll', () => {
    expect(jobSetChanged(null, key('run-1'))).toBe(false);
    expect(jobSetChanged(key('run-1'), key('run-1'))).toBe(false);
    expect(jobSetChanged(key('run-1'), key('run-1', { ...DASHBOARD }))).toBe(false);
    expect(jobSetChanged(key('run-1'), null)).toBe(false);
  });

  it('is true for one more job, one job less and a replaced job', () => {
    const more = { ...DASHBOARD, assigned: [JOB, view('job-new')] };
    expect(jobSetChanged(key('run-1'), key('run-1', more))).toBe(true);
    expect(jobSetChanged(key('run-1', more), key('run-1'))).toBe(true);
    expect(jobSetChanged(key('run-1'), key('run-1', { ...DASHBOARD, assigned: [view('job-other')] }))).toBe(true);
  });

  it('ignores the order of the jobs and a job that moves from assigned to completed', () => {
    const a = { ...DASHBOARD, assigned: [view('job-a'), view('job-b')], completed: [] };
    const reordered = { ...DASHBOARD, assigned: [view('job-b'), view('job-a')], completed: [] };
    const done = { ...DASHBOARD, assigned: [view('job-b')], completed: [view('job-a')] };
    expect(jobSetChanged(key('run-1', a), key('run-1', reordered))).toBe(false);
    expect(jobSetChanged(key('run-1', a), key('run-1', done))).toBe(false);
  });

  it('compares IDs only: another version, status or reward is no change', () => {
    const later = { ...DASHBOARD, version: 99, earnedCents: 600, assigned: [{ ...JOB, status: 'in_progress' as const }] };
    expect(jobSetChanged(key('run-1'), key('run-1', later))).toBe(false);
  });

  it('leaves another run and another employee to the loader, also when the jobs differ', () => {
    const more = { ...DASHBOARD, assigned: [JOB, view('job-new')] };
    expect(jobSetChanged(key('run-1'), key('run-2', more))).toBe(false);
    expect(jobSetChanged(key(null), key('run-1', more))).toBe(false); // the run ID became known
    const other = { ...more, employee: { ...DASHBOARD.employee, id: 'emp-2' } };
    expect(jobSetChanged(key('run-1'), key('run-1', other))).toBe(false);
  });
});

describe('jobLegMissingLine: the open job\'s own leg', () => {
  it('is false when every neighbouring pair of the leg has a line', () => {
    expect(jobLegMissingLine(JOB, MAP)).toBe(false);
  });

  it('is true for a pair that is absent, null or empty', () => {
    const without = { ...MAP, polylines: MAP.polylines.filter((p) => !(p.from === SENDER.id && p.to === RELAY.id)) };
    expect(jobLegMissingLine(JOB, without)).toBe(true);
    expect(jobLegMissingLine(JOB, withLine(SENDER.id, RELAY.id, null))).toBe(true);
    expect(jobLegMissingLine(JOB, withLine(RELAY.id, HOME.id, ''))).toBe(true);
  });

  it('needs the line in the leg\'s direction', () => {
    const reversed = { ...MAP, polylines: MAP.polylines.map((p) => (p.from === WORK.id && p.to === SENDER.id ? { ...p, from: SENDER.id, to: WORK.id } : p)) };
    expect(jobLegMissingLine(JOB, reversed)).toBe(true);
  });

  it('looks at this job\'s leg only, not at the other leg of a relay or at the commute', () => {
    // Leg 1 of the sample plan (another employee) has no lines in MAP at all.
    expect(jobLegMissingLine(JOB, MAP)).toBe(false);
    expect(jobLegMissingLine({ ...JOB, job: { ...JOB.job, legIndex: 1 } }, MAP)).toBe(true);
    expect(jobLegMissingLine(JOB, withLine(WORK.id, HOME.id, null))).toBe(false);
  });

  it('is false without a job, a map or a leg', () => {
    expect(jobLegMissingLine(null, MAP)).toBe(false);
    expect(jobLegMissingLine(JOB, null)).toBe(false);
    expect(jobLegMissingLine({ ...JOB, job: { ...JOB.job, legIndex: 5 } }, MAP)).toBe(false);
    expect(jobLegMissingLine({ ...JOB, plan: { ...PLAN, legs: [] } }, MAP)).toBe(false);
  });
});

describe('lineRetryDue and lineRetryDelayMs: the slow timer', () => {
  const missing = withLine(SENDER.id, RELAY.id, null);
  const base = { job: JOB, map: missing, status: 'ready' as const, reconnecting: false };

  it('runs while the open job has a leg without a line and a map answer is in', () => {
    expect(lineRetryDue(base)).toBe(true);
    expect(lineRetryDue({ ...base, status: 'failed' })).toBe(true); // a failed refresh keeps the old map
  });

  it('stops when the line is there or the job is closed', () => {
    expect(lineRetryDue({ ...base, map: MAP })).toBe(false);
    expect(lineRetryDue({ ...base, job: null })).toBe(false);
  });

  it('never runs while a request is open, before the first map, without travel data or while reconnecting', () => {
    expect(lineRetryDue({ ...base, status: 'loading' })).toBe(false);
    expect(lineRetryDue({ ...base, status: 'idle', map: null })).toBe(false);
    expect(lineRetryDue({ ...base, status: 'unavailable', map: null })).toBe(false);
    expect(lineRetryDue({ ...base, reconnecting: true })).toBe(false);
  });

  it('waits about 5 s after the last answer, and not at all for a map that is already older', () => {
    expect(MAP_LINE_RETRY_MS).toBe(5000);
    expect(lineRetryDelayMs(0)).toBe(5000);
    expect(lineRetryDelayMs(1200)).toBe(3800);
    expect(lineRetryDelayMs(5000)).toBe(0);
    expect(lineRetryDelayMs(60_000)).toBe(0);
    expect(lineRetryDelayMs(-50)).toBe(5000); // a clock that went backwards
    expect(lineRetryDelayMs(Number.NaN)).toBe(5000);
  });
});
