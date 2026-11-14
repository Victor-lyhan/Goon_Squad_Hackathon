import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmployeeNotFound, JobLinkNotice } from '../../client/src/components/employee/JobDetail';
import {
  employeeJobHref, employeeLookup, jobLinkState,
  EMPLOYEE_MISSING_TITLE, JOB_MISSING_TITLE, JOB_OTHER_TITLE,
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
const noop = () => {};

describe('stale employee deep links', () => {
  it('employeeLookup uses API data, not hardcoded IDs', () => {
    expect(employeeLookup(employees, owner)).toEqual({ kind: 'found' });
    expect(employeeLookup(employees, 'emp-gone')).toEqual({ kind: 'unknown', firstId: employees[0].id });
    expect(employeeLookup([], 'x')).toEqual({ kind: 'unknown', firstId: null });
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

  it('renders the unknown-employee page with links from the API list', () => {
    const html = renderToStaticMarkup(<EmployeeNotFound firstId={employees[0].id} />);
    expect(html).toContain('We couldn&#x27;t find that employee');
    expect(html).toContain(`href="/employee/${employees[0].id}"`);
    expect(html).toContain('href="/"');
    expect(EMPLOYEE_MISSING_TITLE).toContain('find that employee');
  });

  it('renders the missing-job message with Back to my jobs', () => {
    const html = renderToStaticMarkup(<JobLinkNotice state={{ kind: 'missing' }} onBack={noop} />);
    expect(html).toContain(JOB_MISSING_TITLE.replace("'", '&#x27;'));
    expect(html).toContain('Back to my jobs');
  });

  it("renders someone else's job without leaking earnings", () => {
    const state = jobLinkState(job.job.id, job, false, other);
    const html = renderToStaticMarkup(<JobLinkNotice state={state} onBack={noop} />);
    expect(html).toContain(JOB_OTHER_TITLE);
    expect(html).toContain(`href="/employee/${owner}?job=${job.job.id}"`);
    expect(html).not.toMatch(/\$\d|Reward/);
  });
});
