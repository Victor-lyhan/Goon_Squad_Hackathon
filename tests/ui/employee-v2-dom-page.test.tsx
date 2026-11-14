// @vitest-environment jsdom
// The MVP II Employee page in a real DOM (#518): Edit opens the commute form and a save shows the new
// commute (demo step 1), Close/Esc and focus, the "New" mark of a job that arrives with a later poll
// (demo step 4), and a job opened from `?job=`. State comes from the real workspace reducer, driven by
// the test the way the poller drives it; the page only renders what the fake answers contain.
import { act, useCallback, useReducer, type Dispatch } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CommuteResponse, EmployeeDashboard } from '../../shared/v2/api';
import type { PutCommuteRequest } from '../../shared/v2/schemas';
import { commuteSummary } from '../../client/src/components/employee/v2/employeeWorkspaceModel';
import {
  employeeWorkspaceReducer, initialWorkspaceState, type EmployeeWorkspaceState, type WorkspaceAction,
} from '../../client/src/components/employee/v2/live/employeeWorkspaceState';
import { EmployeePageView } from '../../client/src/components/employee/v2/page/EmployeePageView';
import { SAVED_TEXT, SAVING_TEXT } from '../../client/src/components/employee/v2/page/employeePageModel';
import { businesses, dashboard, directView, relayView } from './employee-v2-workspace-sample';
import type { SearchFn } from '../../client/src/components/employee/v2/addressSearchModel';
import {
  HAMILTON, HARLEM, T, advance, commuteAnswer, dashboardAfter, fakeSearch, jobResponseFor, settle, useFakeTimers,
} from './employee-v2-dom-helpers';
import { button, byLabel, click, deferred, flush, mount, press, textOf, typeInto } from './kitDom';
import { DEFAULT_DEBOUNCE_MS } from '../../client/src/components/employee/v2/addressSearchModel';

function ready(d: EmployeeDashboard = dashboard): EmployeeWorkspaceState {
  const s = employeeWorkspaceReducer(initialWorkspaceState, { type: 'dashboard', dashboard: d, runId: 'run-1' });
  return employeeWorkspaceReducer(s, { type: 'businesses', businesses });
}

type Api = {
  dispatch: Dispatch<WorkspaceAction>;
  saveCommute: (req: PutCommuteRequest) => Promise<CommuteResponse>;
  onCloseJob: () => void;
  markSeen: (jobId: string) => void;
  search?: SearchFn;
};

/** The page with the real reducer; `api.dispatch` stands in for the poller. */
function Harness({ init, jobId, api }: { init: EmployeeWorkspaceState; jobId: string | null; api: Api }) {
  const [state, dispatch] = useReducer(employeeWorkspaceReducer, init);
  api.dispatch = dispatch;
  const markSeen = useCallback((id: string) => { api.markSeen(id); dispatch({ type: 'seen', jobId: id }); }, [api]);
  return (
    <EmployeePageView
      state={state} jobId={jobId} saveCommute={(r) => api.saveCommute(r)} refetchNow={async () => {}}
      markSeen={markSeen} onCloseJob={() => api.onCloseJob()} search={(q, sig) => (api.search ? api.search(q, sig) : Promise.resolve([]))}
      employeeHref={(id) => `/nyc/employee/${id}`}
    />
  );
}

function setup(init: EmployeeWorkspaceState = ready(), jobId: string | null = null) {
  const api: Api = {
    dispatch: () => { throw new Error('not mounted'); },
    saveCommute: vi.fn(async (_req: PutCommuteRequest): Promise<CommuteResponse> => { throw new Error('not set'); }),
    onCloseJob: vi.fn(),
    markSeen: vi.fn(),
  };
  const m = mount(<Harness init={init} jobId={jobId} api={api} />);
  const c = m.container;
  return {
    ...m, api, c,
    /** A poll answer (or any poller action) arriving. */
    send: (a: WorkspaceAction) => act(() => { api.dispatch(a); }),
    poll: (d: EmployeeDashboard) => act(() => { api.dispatch({ type: 'dashboard', dashboard: d, runId: 'run-1' }); }),
    /** The router changing `?job=`. */
    setJob: (id: string | null) => m.rerender(<Harness init={init} jobId={id} api={api} />),
    form: () => c.querySelector<HTMLFormElement>('form[aria-label="Commute"]'),
    edit: () => button(c, 'Edit commute'),
    newMarks: () => [...c.querySelectorAll('.ew-new')],
    row: (jobId: string) => c.querySelector(`[data-job-id="${jobId}"]`),
  };
}

describe('Employee page in a real DOM: commute', () => {
  it('Edit opens the form, a save goes through the fake and the summary shows the new commute', async () => {
    const p = setup();
    expect(p.form()).toBeNull();
    expect(textOf(p.c)).toContain(commuteSummary(dashboard, businesses).detourLimit);

    click(p.edit());
    const form = p.form()!;
    expect(form).not.toBeNull();
    expect(textOf(p.c)).toContain('Edit commute');

    const pending = deferred<CommuteResponse>();
    p.api.saveCommute = vi.fn(() => pending.promise);
    typeInto(byLabel(form, 'Maximum detour (minutes)'), '20');
    typeInto(byLabel(form, 'Evening departure (Day 1, work to home)'), '18:00');
    click(form.querySelector('button[type="submit"]')!);

    expect(p.api.saveCommute).toHaveBeenCalledTimes(1);
    const req = vi.mocked(p.api.saveCommute).mock.calls[0][0];
    expect(req).toMatchObject({ home: { homeId: dashboard.home.id }, maxExtraMin: 20, eveningDepartureMin: 18 * 60 });
    expect(textOf(p.c)).toContain(SAVING_TEXT);
    // A poll while the save is pending (same version, new objects) changes nothing.
    p.poll({ ...dashboard, employee: { ...dashboard.employee } });
    expect((byLabel(p.form()!, 'Maximum detour (minutes)') as HTMLInputElement).value).toBe('20');

    const res = commuteAnswer(req, dashboard, ['shp-030']);
    pending.resolve(res);
    await flush();
    expect(p.form()).toBeNull();
    expect(textOf(p.c)).toContain(`${SAVED_TEXT}. 1 waiting delivery was matched.`);

    // The refetch after a save brings the new dashboard: the summary shows the server's new commute.
    const next = dashboardAfter(res, dashboard.version + 1);
    p.poll(next);
    const summary = commuteSummary(next, businesses);
    const section = p.c.querySelector('.ew-commute')!;
    expect(textOf(section)).toContain(summary.detourLimit);
    expect(textOf(section)).toContain(`Departs ${summary.trips.find((t) => t.direction === 'evening')!.departure}`);
    expect(textOf(section)).not.toContain(commuteSummary(dashboard, businesses).detourLimit);
  }, T);

  it('Close closes the form without saving and shows the saved commute again', () => {
    const p = setup();
    click(p.edit());
    typeInto(byLabel(p.form()!, 'Maximum detour (minutes)'), '20');
    click(button(p.c, 'Close'));
    expect(p.form()).toBeNull();
    expect(p.api.saveCommute).not.toHaveBeenCalled();
    expect(textOf(p.c)).toContain(commuteSummary(dashboard, businesses).detourLimit);
  }, T);

  // Fixed in #550 (found by #518): Close used to drop focus to <body>.
  it('Close returns focus to the Edit commute button', () => {
    const p = setup();
    click(p.edit());
    click(button(p.c, 'Close'));
    expect(document.activeElement).toBe(p.edit());
  }, T);

  // Fixed in #550 (found by #518): Esc in the editor used to do nothing.
  it('Esc in the commute editor closes it and returns focus to the Edit commute button', () => {
    const p = setup();
    click(p.edit());
    const detour = byLabel(p.form()!, 'Maximum detour (minutes)');
    typeInto(detour, '20');
    press('Escape', detour);
    expect(p.form()).toBeNull();
    expect(document.activeElement).toBe(p.edit());
    expect(p.api.saveCommute).not.toHaveBeenCalled();
    expect(textOf(p.c)).toContain(commuteSummary(dashboard, businesses).detourLimit);
  }, T);

  it('Esc in the open address list closes only the list, not the editor (#550)', async () => {
    useFakeTimers();
    try {
      const s = fakeSearch();
      const p = setup();
      p.api.search = s.fn;
      click(p.edit());
      click(button(p.form()!, 'Change'));
      const input = byLabel(p.form()!, 'Home address') as HTMLInputElement;
      typeInto(input, 'W 14');
      await advance(DEFAULT_DEBOUNCE_MS);
      s.calls[s.calls.length - 1].resolve([HARLEM, HAMILTON]);
      await settle();
      expect(input.getAttribute('aria-expanded')).toBe('true');

      press('Escape', input);
      expect(p.form()).not.toBeNull();
      expect(input.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(input);
    } finally {
      vi.useRealTimers();
    }
  }, T);

  it('a save with an invalid value sends nothing and focuses the first invalid field (#550)', () => {
    const p = setup();
    click(p.edit());
    const detour = byLabel(p.form()!, 'Maximum detour (minutes)') as HTMLInputElement;
    const evening = byLabel(p.form()!, 'Evening departure (Day 1, work to home)') as HTMLInputElement;
    typeInto(evening, '');
    typeInto(detour, '45');
    const save = p.form()!.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(save.disabled).toBe(false);
    click(save);
    expect(p.api.saveCommute).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(evening);
    expect(evening.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(evening.getAttribute('aria-describedby')!)?.textContent).toBeTruthy();
    expect(p.form()).not.toBeNull();
  }, T);

  it('a locked run keeps Edit commute disabled, so no form opens (#550)', () => {
    const p = setup(ready({ ...dashboard, phase: 'locked' }));
    expect(p.edit().disabled).toBe(true);
    click(p.edit());
    expect(p.form()).toBeNull();
    expect(p.api.saveCommute).not.toHaveBeenCalled();
  }, T);
});

describe('Employee page in a real DOM: a new job from a later poll', () => {
  const one: EmployeeDashboard = { ...dashboard, assigned: [directView] };
  const two = (version: number): EmployeeDashboard => ({ ...dashboard, assigned: [directView, relayView], version });

  it('is marked New once, keeps one mark over later polls, and loses it for good once opened', () => {
    const p = setup(ready(one));
    expect(p.newMarks()).toHaveLength(0); // the first load flags nothing (pass 9)

    p.poll(two(4));
    expect(p.newMarks()).toHaveLength(1);
    expect(p.row(relayView.job.id)!.querySelector('.ew-new')).not.toBeNull();
    expect(p.row(directView.job.id)!.querySelector('.ew-new')).toBeNull();

    // More polls with the same jobs (a newer version and new objects) neither add nor drop a mark.
    p.poll(two(5));
    p.poll({ ...two(5) });
    expect(p.newMarks()).toHaveLength(1);

    // Opening it (`?job=`) marks it seen; back on the list it is no longer New, and a later poll keeps it so.
    p.setJob(relayView.job.id);
    expect(p.api.markSeen).toHaveBeenCalledWith(relayView.job.id);
    p.send({ type: 'job', job: jobResponseFor(relayView) });
    p.setJob(null);
    expect(p.row(relayView.job.id)).not.toBeNull();
    expect(p.newMarks()).toHaveLength(0);
    p.poll(two(6));
    expect(p.newMarks()).toHaveLength(0);
  }, T);
});

describe('Employee page in a real DOM: a job from ?job=', () => {
  it('opens with focus on the job heading, and Back asks the router to drop ?job=', () => {
    const p = setup(ready(), directView.job.id);
    expect(p.c.textContent).toContain('Loading delivery');
    p.send({ type: 'job', job: jobResponseFor(directView) });
    const heading = p.c.querySelector('#job-v2-title')!;
    expect(heading).not.toBeNull();
    expect(document.activeElement).toBe(heading);
    expect(p.api.markSeen).toHaveBeenCalledWith(directView.job.id);

    click(button(p.c, 'Back to deliveries'));
    expect(p.api.onCloseJob).toHaveBeenCalledTimes(1);
    p.setJob(null);
    expect(p.row(directView.job.id)).not.toBeNull();
  }, T);

  // Fixed in #550 (found by #518): closing a job used to drop focus to <body>.
  it('closing a job opened from ?job= returns focus to its row', () => {
    const p = setup(ready(), directView.job.id);
    p.send({ type: 'job', job: jobResponseFor(directView) });
    click(button(p.c, 'Back to deliveries'));
    p.setJob(null);
    const row = p.row(directView.job.id)!;
    expect(row.contains(document.activeElement)).toBe(true);
  }, T);

  it('closing a job opened from its row returns focus to that row (#550)', () => {
    const p = setup(ready(), null);
    const target = relayView.job.id;
    p.row(target)!.querySelector<HTMLAnchorElement>('a')!.focus();
    p.setJob(target); // the row link changes `?job=`
    p.send({ type: 'job', job: jobResponseFor(relayView) });
    click(button(p.c, 'Back to deliveries'));
    p.setJob(null);
    expect(p.row(target)!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toBe('View job');
  }, T);
});
