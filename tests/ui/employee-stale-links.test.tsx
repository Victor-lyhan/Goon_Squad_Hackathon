import { describe, expect, it } from 'vitest';
import {
  employeeJobHref, employeeLookup, jobLinkState, EMPLOYEE_MISSING_TITLE,
} from '../../client/src/components/employee/jobDetailModel';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { jobResponse } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';

const run = createInitialRun(loadDefaultScenario());
const { employees } = run.scenario;
const snap = snapshotAt(run, run.scenario.settings.simStartMin);
const job = jobResponse(run, snap, run.jobs[0].id)!;
const owner = job.job.employeeId;
const other = employees.find((e) => e.id !== owner)!.id;

// The MVP 1 EmployeeNotFound / JobLinkNotice render cases were deleted with JobDetail.tsx (#566);
// the jobDetailModel rules stay.
describe('stale employee deep links', () => {
  it('employeeLookup uses API data, not hardcoded IDs', () => {
    expect(employeeLookup(employees, owner)).toEqual({ kind: 'found' });
    expect(employeeLookup(employees, 'emp-gone')).toEqual({ kind: 'unknown', firstId: employees[0].id });
    expect(employeeLookup([], 'x')).toEqual({ kind: 'unknown', firstId: null });
    expect(EMPLOYEE_MISSING_TITLE).toContain('find that employee');
  });

  it('jobLinkState covers none / ok / missing / other', () => {
    expect(jobLinkState(null, null, false, owner)).toEqual({ kind: 'none' });
    expect(jobLinkState(job.job.id, job, false, owner)).toEqual({ kind: 'ok' });
    expect(jobLinkState(job.job.id, null, false, owner)).toEqual({ kind: 'ok' }); // still loading
    expect(jobLinkState('job-gone', null, true, owner)).toEqual({ kind: 'missing' });
    // job vanished after a runId change: stale job object is dropped, 404 flagged
    expect(jobLinkState(job.job.id, null, true, owner)).toEqual({ kind: 'missing' });
    expect(jobLinkState(job.job.id, job, false, other)).toEqual({
      kind: 'other', ownerId: owner, href: employeeJobHref(owner, job.job.id),
    });
  });
});
