// @vitest-environment jsdom
// #634: the Employee job screens in a real DOM. (1) Each of the four job screens has one h1, the
// employee's name, before the job's h2. (2) A delivery that was re-matched away or belongs to another
// carrier says so, without blaming a city change. (3) "Back to deliveries" on such a delivery leaves
// focus inside the page. (4) "Commute saved" goes when a job view opens, when the editor opens again
// and when the run is locked. State comes from the real workspace reducer, driven the way the poller
// drives it.
import { act, useCallback, useReducer, type Dispatch } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CommuteResponse, EmployeeDashboard, JobResponse } from '../../shared/v2/api';
import type { PutCommuteRequest } from '../../shared/v2/schemas';
import {
  JOB_MISSING_TEXT, JOB_MISSING_TITLE, JOB_OTHER_TEXT, JOB_OTHER_TITLE,
} from '../../client/src/components/employee/v2/jobDetailV2Model';
import {
  employeeWorkspaceReducer, initialWorkspaceState, type EmployeeWorkspaceState, type WorkspaceAction,
} from '../../client/src/components/employee/v2/live/employeeWorkspaceState';
import { EmployeePageView } from '../../client/src/components/employee/v2/page/EmployeePageView';
import { JOB_LOADING_TEXT, SAVED_TEXT } from '../../client/src/components/employee/v2/page/employeePageModel';
import { T, commuteAnswer, jobResponseFor } from './employee-v2-dom-helpers';
import { businesses, dashboard, directView, relayView } from './employee-v2-workspace-sample';
import { button, byLabel, click, flush, mount, textOf, typeInto } from './kitDom';

const NAME = dashboard.employee.name;
const OTHER_JOB: JobResponse = {
  ...jobResponseFor(directView),
  job: { ...directView.job, id: 'job-other', employeeId: 'emp-002' },
};

function ready(d: EmployeeDashboard = dashboard): EmployeeWorkspaceState {
  const s = employeeWorkspaceReducer(initialWorkspaceState, { type: 'dashboard', dashboard: d, runId: 'run-1' });
  return employeeWorkspaceReducer(s, { type: 'businesses', businesses });
}

type Api = {
  dispatch: Dispatch<WorkspaceAction>;
  saveCommute: (req: PutCommuteRequest) => Promise<CommuteResponse>;
  onCloseJob: () => void;
};

function Harness({ init, jobId, api }: { init: EmployeeWorkspaceState; jobId: string | null; api: Api }) {
  const [state, dispatch] = useReducer(employeeWorkspaceReducer, init);
  api.dispatch = dispatch;
  const markSeen = useCallback((id: string) => { dispatch({ type: 'seen', jobId: id }); }, []);
  return (
    <EmployeePageView
      state={state} jobId={jobId} saveCommute={(r) => api.saveCommute(r)} refetchNow={async () => {}}
      markSeen={markSeen} onCloseJob={() => api.onCloseJob()} search={async () => []}
      employeeHref={(id) => `/employee/${id}`}
    />
  );
}

function setup(init: EmployeeWorkspaceState = ready(), jobId: string | null = null) {
  const api: Api = {
    dispatch: () => { throw new Error('not mounted'); },
    saveCommute: vi.fn(async (req: PutCommuteRequest) => commuteAnswer(req, dashboard, ['shp-030'])),
    onCloseJob: vi.fn(),
  };
  const m = mount(<Harness init={init} jobId={jobId} api={api} />);
  const c = m.container;
  const page = () => c.querySelector<HTMLElement>('.ep')!;
  return {
    ...m, api, c, page,
    send: (a: WorkspaceAction) => act(() => { api.dispatch(a); }),
    poll: (d: EmployeeDashboard) => act(() => { api.dispatch({ type: 'dashboard', dashboard: d, runId: 'run-1' }); }),
    /** The router changing `?job=`. */
    setJob: (id: string | null) => m.rerender(<Harness init={init} jobId={id} api={api} />),
    /** "Back to deliveries": the button asks the router, the router drops `?job=`. */
    back() {
      click(button(c, 'Back to deliveries'));
      expect(api.onCloseJob).toHaveBeenCalledTimes(1);
      m.rerender(<Harness init={init} jobId={null} api={api} />);
    },
    headings: () => [...page().querySelectorAll('h1, h2')].map((h) => `${h.tagName} ${textOf(h)}`),
    h1s: () => [...c.querySelectorAll('h1')].map(textOf),
    row: (id: string) => c.querySelector(`[data-job-id="${id}"]`),
    form: () => c.querySelector<HTMLFormElement>('form[aria-label="Commute"]'),
    note: () => [...c.querySelectorAll('.ep-notice')].map(textOf).find((t) => t.startsWith(SAVED_TEXT)) ?? null,
    /** Edit, change the detour limit, Save; the fake answers with one re-matched delivery. */
    async save() {
      click(button(c, 'Edit commute'));
      const form = c.querySelector<HTMLFormElement>('form[aria-label="Commute"]')!;
      typeInto(byLabel(form, 'Maximum detour (minutes)'), '20');
      click(form.querySelector('button[type="submit"]')!);
      await flush();
    },
  };
}

const missing = () => employeeWorkspaceReducer(ready(), { type: 'jobMissing' });
const withJob = (job: JobResponse) => employeeWorkspaceReducer(ready(), { type: 'job', job });

describe('the name of the employee is the h1 of every job screen (#634)', () => {
  it('a job that is loading from ?job=', () => {
    const p = setup(ready(), directView.job.id);
    expect(textOf(p.page())).toContain(JOB_LOADING_TEXT);
    expect(p.headings()).toEqual([`H1 ${NAME}`]);
  }, T);

  it('an open job: the name, then the delivery', () => {
    const p = setup(withJob(jobResponseFor(directView)), directView.job.id);
    expect(p.h1s()).toEqual([NAME]);
    expect(p.headings().slice(0, 2)).toEqual([`H1 ${NAME}`, `H2 ${directView.shipment.label}`]);
  }, T);

  it('a delivery that is gone', () => {
    const p = setup(missing(), 'job-gone');
    expect(p.headings()).toEqual([`H1 ${NAME}`, `H2 ${JOB_MISSING_TITLE}`]);
  }, T);

  it("another carrier's delivery", () => {
    const p = setup(withJob(OTHER_JOB), OTHER_JOB.job.id);
    expect(p.headings()).toEqual([`H1 ${NAME}`, `H2 ${JOB_OTHER_TITLE}`]);
  }, T);

  it('stays one h1 from the list, through a job opening over the list, to the job and back', () => {
    const p = setup(ready(), null);
    expect(p.h1s()).toEqual([NAME]);
    p.setJob(relayView.job.id); // the list stays until the detail arrives (#584): the workspace's h1
    p.send({ type: 'jobCleared' });
    expect(p.row(relayView.job.id)).not.toBeNull();
    expect(p.h1s()).toEqual([NAME]);
    p.send({ type: 'job', job: jobResponseFor(relayView) });
    expect(p.row(relayView.job.id)).toBeNull();
    expect(p.h1s()).toEqual([NAME]);
    p.back();
    expect(p.h1s()).toEqual([NAME]);
  }, T);

  it('the job heading still takes focus when the job opens, not the name', () => {
    const p = setup(ready(), directView.job.id);
    p.send({ type: 'job', job: jobResponseFor(directView) });
    expect(document.activeElement).toBe(p.c.querySelector('#job-v2-title'));
  }, T);
});

describe('a delivery that is not mine any more says so (#634)', () => {
  const noCityNoJob = (t: string) => {
    expect(t).not.toMatch(/city/i);
    expect(t).not.toMatch(/\bjobs?\b/i);
    expect(t).toMatch(/delivery/);
  };

  it('a 404 for the job: "no longer assigned to you", no word about the city', () => {
    const p = setup(missing(), 'job-gone');
    const view = p.c.querySelector('.ep-job')!;
    expect(textOf(view.querySelector('h2')!)).toBe('This delivery is no longer assigned to you');
    expect(textOf(view)).toContain('It was re-matched or the run changed. Your current deliveries are on your page.');
    expect(textOf(view)).toContain(JOB_MISSING_TEXT);
    noCityNoJob(textOf(view));
    expect(button(view, 'Back to deliveries')).not.toBeNull();
  }, T);

  it("another carrier's delivery: \"assigned to another carrier\", with the link to its page", () => {
    const p = setup(withJob(OTHER_JOB), OTHER_JOB.job.id);
    const view = p.c.querySelector('.ep-job')!;
    expect(textOf(view.querySelector('h2')!)).toBe('This delivery is assigned to another carrier');
    expect(textOf(view)).toContain(JOB_OTHER_TEXT);
    expect(textOf(view)).not.toContain('own deliveries');
    noCityNoJob(textOf(view));
    expect(view.querySelector('a')!.getAttribute('href')).toBe(`/employee/emp-002?job=${OTHER_JOB.job.id}`);
    expect(button(view, 'Back to deliveries')).not.toBeNull();
  }, T);

  it('an open job that a re-match takes away turns into the same message', () => {
    const p = setup(withJob(jobResponseFor(relayView)), relayView.job.id);
    expect(p.c.querySelector('#job-v2-title')).not.toBeNull();
    // Recompute: the dashboard no longer lists the job and its request answers 404.
    p.poll({ ...dashboard, assigned: [directView], version: dashboard.version + 1 });
    p.send({ type: 'jobMissing' });
    expect(p.headings()).toEqual([`H1 ${NAME}`, `H2 ${JOB_MISSING_TITLE}`]);
  }, T);
});

describe('Back to deliveries keeps focus in the page when the job has no row (#634)', () => {
  function expectFocusInPage(p: ReturnType<typeof setup>) {
    const active = document.activeElement;
    expect(active).not.toBe(document.body);
    expect(active).not.toBeNull();
    expect(p.page().contains(active)).toBe(true);
    // It lands on the heading of the list the button leads to, which stays out of the tab order.
    expect(active).toBe(p.c.querySelector('#ew-assigned-heading'));
    expect(textOf(active!)).toBe('Assigned deliveries');
    expect(active!.getAttribute('tabindex')).toBe('-1');
  }

  it('a delivery that is gone', () => {
    const p = setup(missing(), 'job-gone');
    expect(textOf(document.activeElement!)).toBe(JOB_MISSING_TITLE); // focus was on the message's heading
    p.back();
    expect(p.row(directView.job.id)).not.toBeNull();
    expectFocusInPage(p);
    // The poller clearing the old job afterwards does not move it.
    p.send({ type: 'jobCleared' });
    expectFocusInPage(p);
  }, T);

  it("another carrier's delivery", () => {
    const p = setup(withJob(OTHER_JOB), OTHER_JOB.job.id);
    expect(textOf(document.activeElement!)).toBe(JOB_OTHER_TITLE);
    p.back();
    expectFocusInPage(p);
  }, T);

  it('a job opened from its row and then re-matched away', () => {
    const p = setup(ready(), null);
    p.row(relayView.job.id)!.querySelector<HTMLAnchorElement>('a')!.focus();
    p.setJob(relayView.job.id);
    p.send({ type: 'job', job: jobResponseFor(relayView) });
    p.poll({ ...dashboard, assigned: [directView], version: dashboard.version + 1 });
    p.send({ type: 'jobMissing' });
    p.back();
    expect(p.row(relayView.job.id)).toBeNull();
    expectFocusInPage(p);
  }, T);

  it('with no deliveries at all, focus still lands on the list heading', () => {
    const none = employeeWorkspaceReducer(ready({ ...dashboard, assigned: [], completed: [] }), { type: 'jobMissing' });
    const p = setup(none, 'job-gone');
    p.back();
    expectFocusInPage(p);
  }, T);

  it('a job that is still listed keeps the #550 rule: focus returns to its row', () => {
    const p = setup(withJob(jobResponseFor(directView)), directView.job.id);
    p.back();
    expect(p.row(directView.job.id)!.contains(document.activeElement)).toBe(true);
    expect(textOf(document.activeElement!)).toBe('View job');
  }, T);
});

describe('the "Commute saved" note goes away (#634)', () => {
  const SAVED = `${SAVED_TEXT}. 1 waiting delivery was matched.`;

  it('shows right after a save and survives a poll', async () => {
    const p = setup();
    expect(p.note()).toBeNull();
    await p.save();
    expect(p.form()).toBeNull();
    expect(p.note()).toBe(SAVED);
    p.poll({ ...dashboard, version: dashboard.version + 1 });
    expect(p.note()).toBe(SAVED);
  }, T);

  it('is gone when a job view opens, and does not come back when the job closes', async () => {
    const p = setup();
    await p.save();
    expect(p.note()).toBe(SAVED);
    p.setJob(directView.job.id); // the list is still on screen while the job loads
    expect(p.note()).toBeNull();
    p.send({ type: 'job', job: jobResponseFor(directView) });
    expect(p.c.querySelector('#job-v2-title')).not.toBeNull();
    expect(textOf(p.c)).not.toContain(SAVED_TEXT);
    p.back();
    expect(p.row(directView.job.id)).not.toBeNull();
    expect(textOf(p.c)).not.toContain(SAVED_TEXT);
  }, T);

  it('is gone when the editor opens again, and after it is closed', async () => {
    const p = setup();
    await p.save();
    expect(p.note()).toBe(SAVED);
    click(button(p.c, 'Edit commute'));
    expect(p.form()).not.toBeNull();
    expect(textOf(p.c)).not.toContain(SAVED_TEXT);
    click(button(p.c, 'Close'));
    expect(textOf(p.c)).not.toContain(SAVED_TEXT);
  }, T);

  it('is gone when the run is locked, and stays gone after the playback', async () => {
    const p = setup();
    await p.save();
    expect(p.note()).toBe(SAVED);
    p.poll({ ...dashboard, phase: 'locked', version: dashboard.version + 1 });
    expect(textOf(p.c)).not.toContain(SAVED_TEXT);
    expect(button(p.c, 'Edit commute').disabled).toBe(true);
    p.poll({ ...dashboard, phase: 'planning', version: dashboard.version + 2 });
    expect(textOf(p.c)).not.toContain(SAVED_TEXT);
  }, T);
});
