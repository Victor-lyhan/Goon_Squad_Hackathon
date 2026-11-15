// @vitest-environment jsdom
// Issue #720: the commute save of the demo ("commute -> job -> watch it") with the REAL data hook in a real
// DOM. The page tests of #518 drive the reducer by hand, so they could not see the order of the PUT's answer
// and the dashboard that follows it. Here `useEmployeeWorkspace` runs its poller against a fake server whose
// answers the test can hold back, as a slow connection does.
//   - Found in headless Chrome with 700 ms latency: the editor closed on the PUT's answer and "Commute saved."
//     stood above the old departure and the old pickup times until the next dashboard arrived.
//   - Pressing Save twice sends one PUT and ends with the saved values and the same job list.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommuteResponse, EmployeeDashboard } from '../../shared/v2/api';
import type { PutCommuteRequest } from '../../shared/v2/schemas';
import {
  useEmployeeWorkspace, type EmployeeWorkspaceDeps,
} from '../../client/src/components/employee/v2/live/useEmployeeWorkspace';
import { EmployeePageView } from '../../client/src/components/employee/v2/page/EmployeePageView';
import { SAVED_TEXT, SAVING_TEXT } from '../../client/src/components/employee/v2/page/employeePageModel';
import { formatClock } from '../../client/src/ui/format';
import { T, advance, commuteAnswer, jobResponseFor, settle, useFakeTimers } from './employee-v2-dom-helpers';
import { businesses, dashboard } from './employee-v2-workspace-sample';
import { button, byLabel, click, deferred, mount, textOf, typeInto } from './kitDom';

const EVENING = 'Evening departure (Day 1, work to home)';
const DETOUR = 'Maximum detour (minutes)';

/**
 * A server with one employee. A PUT stores the commute at once (new departures on the trips, one version up);
 * a dashboard request answers with what was stored when it was SENT, like a request that the server handled
 * before the PUT. `holdDashboards` and `holdPuts` keep answers back until the test releases them.
 */
function fakeServer() {
  let stored: EmployeeDashboard = dashboard;
  const s = {
    holdDashboards: false,
    holdPuts: false,
    puts: [] as PutCommuteRequest[],
    dashboardsSent: 0,
    heldDashboards: [] as (() => void)[],
    heldPuts: [] as (() => void)[],
    stored: () => stored,
    deps: {} as EmployeeWorkspaceDeps,
  };
  const wait = (hold: boolean, held: (() => void)[]) => {
    if (!hold) return Promise.resolve();
    const d = deferred<void>();
    held.push(() => d.resolve());
    return d.promise;
  };
  s.deps = {
    getEmployeeDashboard: async () => {
      s.dashboardsSent += 1;
      const answer = stored;
      await wait(s.holdDashboards, s.heldDashboards);
      return answer;
    },
    putCommute: async (_id, req): Promise<CommuteResponse> => {
      s.puts.push(req);
      await wait(s.holdPuts, s.heldPuts);
      const res = commuteAnswer(req, stored);
      const trips = stored.trips.map((t) => ({
        ...t, departureMin: t.direction === 'evening' ? req.eveningDepartureMin : req.morningDepartureMin,
      }));
      stored = { ...stored, employee: res.employee, home: res.home, trips, version: stored.version + 1 };
      return { ...res, trips };
    },
    getBusinesses: async () => ({ businesses }),
    getEmployees: async () => ({ employees: [stored.employee] }),
    getMap: async () => ({ runId: 'run-1' }) as never,
    getJob: async (id) => jobResponseFor([...stored.assigned, ...stored.completed].find((v) => v.job.id === id)!),
  };
  return s;
}

function Page({ deps }: { deps: EmployeeWorkspaceDeps }) {
  const ws = useEmployeeWorkspace(dashboard.employee.id, null, deps);
  return (
    <EmployeePageView
      state={ws} jobId={null} saveCommute={ws.saveCommute} refetchNow={ws.refetchNow} markSeen={ws.markSeen}
      onCloseJob={() => {}} search={async () => []} employeeHref={(id) => `/employee/${id}`}
    />
  );
}

async function open() {
  const server = fakeServer();
  const m = mount(<Page deps={server.deps} />);
  const c = m.container;
  for (let i = 0; i < 10 && !c.querySelector('.ew-commute'); i++) await settle();
  const page = {
    server, c,
    form: () => c.querySelector<HTMLFormElement>('form[aria-label="Commute"]'),
    summary: () => textOf(c.querySelector('.ew-commute')!),
    rows: () => [...c.querySelectorAll('#ew-assigned-heading')]
      .flatMap((h) => [...h.closest('section')!.querySelectorAll<HTMLElement>('[data-job-id]')])
      .map((r) => r.dataset.jobId),
    release: async (held: (() => void)[]) => {
      const next = held.shift();
      if (!next) throw new Error('no held answer to release');
      next();
      await settle();
      await advance(0); // the poller starts the waiting refetch with a 0 ms timer
    },
  };
  if (!c.querySelector('.ew-commute')) throw new Error(`the workspace did not load: ${textOf(c)}`);
  return page;
}

const departs = (min: number) => `Departs ${formatClock(min)}`;

beforeEach(() => { useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('Employee page with the real data hook: a commute save on a slow connection (#720)', () => {
  it('keeps the editor in "Saving" until the dashboard asked for after the PUT is in, then shows the saved departure', async () => {
    const p = await open();
    const { server } = p;
    const oldDeparture = departs(dashboard.employee.eveningDepartureMin);
    expect(p.summary()).toContain(oldDeparture);

    click(button(p.c, 'Edit commute'));
    typeInto(byLabel(p.form()!, EVENING), '18:00');

    // A poll goes out and stays open: the server handled it before the PUT, so it carries the old commute.
    server.holdDashboards = true;
    const sentBefore = server.dashboardsSent;
    await advance(1000);
    expect(server.dashboardsSent).toBe(sentBefore + 1);

    click(p.form()!.querySelector('button[type="submit"]')!);
    await settle();
    expect(server.puts).toHaveLength(1);
    expect(server.stored().employee.eveningDepartureMin).toBe(18 * 60); // the PUT has answered
    // The editor is still open and saving: nothing on the page says "saved" above an old value.
    expect(p.form()).not.toBeNull();
    expect(textOf(p.c)).toContain(SAVING_TEXT);
    expect(textOf(p.c)).not.toContain(SAVED_TEXT);

    // The poll that was in flight answers with the old commute: still not "saved".
    await p.release(server.heldDashboards);
    expect(server.dashboardsSent).toBe(sentBefore + 2); // the refetch of the save, sent after the PUT
    expect(p.form()).not.toBeNull();
    expect(textOf(p.c)).not.toContain(SAVED_TEXT);

    // The refetch answers: the editor closes and the note stands above the saved values.
    await p.release(server.heldDashboards);
    expect(p.form()).toBeNull();
    expect(textOf(p.c)).toContain(`${SAVED_TEXT}.`);
    expect(p.summary()).toContain(departs(18 * 60));
    expect(p.summary()).not.toContain(oldDeparture);
    expect(document.activeElement).toBe(button(p.c, 'Edit commute'));
    expect(server.puts).toHaveLength(1);
  }, T);

  it('a refetch that fails still closes the editor with the saved note, and the next poll shows the values', async () => {
    const p = await open();
    const { server } = p;
    click(button(p.c, 'Edit commute'));
    typeInto(byLabel(p.form()!, EVENING), '18:00');

    const real = server.deps.getEmployeeDashboard;
    server.deps.getEmployeeDashboard = async () => { throw new Error('offline'); };
    click(p.form()!.querySelector('button[type="submit"]')!);
    await settle();
    await settle();
    expect(server.puts).toHaveLength(1);
    expect(p.form()).toBeNull(); // the save is not held back by a dashboard that cannot be read
    expect(textOf(p.c)).toContain(`${SAVED_TEXT}.`);

    server.deps.getEmployeeDashboard = real;
    await advance(1000);
    await settle();
    expect(p.summary()).toContain(departs(18 * 60));
  }, T);
});

describe('Employee page with the real data hook: Save pressed twice (#720)', () => {
  it('sends one PUT and ends with the saved detour limit, the same departures and the same job list', async () => {
    const p = await open();
    const { server } = p;
    const rowsBefore = p.rows();
    expect(rowsBefore.length).toBeGreaterThan(0);
    const departure = departs(dashboard.employee.eveningDepartureMin);

    click(button(p.c, 'Edit commute'));
    const form = p.form()!;
    typeInto(byLabel(form, DETOUR), '12'); // only the detour limit changes
    server.holdPuts = true;
    const save = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    click(save);
    click(save); // the second press: the button is disabled by now
    act(() => { form.requestSubmit(); }); // and Enter in a field
    await settle();
    expect(server.puts).toHaveLength(1);
    expect(save.disabled).toBe(true);
    expect(textOf(save)).toBe('Saving…');

    await p.release(server.heldPuts);
    await settle();
    expect(server.puts).toHaveLength(1);
    expect(server.puts[0]).toMatchObject({
      maxExtraMin: 12,
      eveningDepartureMin: dashboard.employee.eveningDepartureMin,
      morningDepartureMin: dashboard.employee.morningDepartureMin,
      home: { homeId: dashboard.home.id },
    });
    expect(p.form()).toBeNull();
    expect(textOf(p.c)).toContain(`${SAVED_TEXT}.`);
    expect(p.summary()).toContain('Up to 12 min extra per trip');
    expect(p.summary()).toContain(departure);
    expect(p.rows()).toStrictEqual(rowsBefore);

    // The editor opens again on the saved values, with nothing to save.
    click(button(p.c, 'Edit commute'));
    expect((byLabel(p.form()!, DETOUR) as HTMLInputElement).value).toBe('12');
    expect(p.form()!.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  }, T);
});
