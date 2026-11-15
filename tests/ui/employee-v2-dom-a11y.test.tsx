// @vitest-environment jsdom
// #735: the Employee page by keyboard and screen reader, in a real DOM. One test per focus move of the
// demo (into the editor, back to Edit commute on Esc, Close and Save, to the job heading, back to the
// job's row), the moves found missing in headless Chrome (Save while it is pending and after it fails,
// a locked run, the home address search), and one per announcement ("Commute saved.", a save error,
// a new delivery): each is said once, in a polite live region that was in the page before its text.
// State comes from the real workspace reducer, driven the way the poller drives it.
import { readFileSync } from 'node:fs';
import { act, useCallback, useReducer, type Dispatch } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommuteResponse, EmployeeDashboard } from '../../shared/v2/api';
import type { PutCommuteRequest } from '../../shared/v2/schemas';
import type { Notification } from '../../shared/v2/types';
import { ApiRequestError } from '../../client/src/api/v2';
import { DEFAULT_DEBOUNCE_MS, type SearchFn } from '../../client/src/components/employee/v2/addressSearchModel';
import {
  employeeWorkspaceReducer, initialWorkspaceState, type EmployeeWorkspaceState, type WorkspaceAction,
} from '../../client/src/components/employee/v2/live/employeeWorkspaceState';
import { EmployeePageView } from '../../client/src/components/employee/v2/page/EmployeePageView';
import { NETWORK_TEXT, SAVED_TEXT, SAVING_TEXT } from '../../client/src/components/employee/v2/page/employeePageModel';
import {
  HAMILTON, HARLEM, T, advance, commuteAnswer, dashboardAfter, fakeSearch, jobResponseFor, settle, useFakeTimers,
} from './employee-v2-dom-helpers';
import { businesses, dashboard, directView, relayView } from './employee-v2-workspace-sample';
import { button, byLabel, click, deferred, flush, mount, press, textOf, typeInto } from './kitDom';

afterEach(() => { vi.useRealTimers(); });

const DETOUR = 'Maximum detour (minutes)';
const DIRECT = directView.job.id;
const RELAY = relayView.job.id;

function ready(d: EmployeeDashboard = dashboard): EmployeeWorkspaceState {
  const s = employeeWorkspaceReducer(initialWorkspaceState, { type: 'dashboard', dashboard: d, runId: 'run-1' });
  return employeeWorkspaceReducer(s, { type: 'businesses', businesses });
}

type Api = {
  dispatch: Dispatch<WorkspaceAction>;
  saveCommute: (req: PutCommuteRequest) => Promise<CommuteResponse>;
  search?: SearchFn;
};

/** The page with the real reducer; `api.dispatch` stands in for the poller, `jobId` for the router. */
function Harness({ init, jobId, api }: { init: EmployeeWorkspaceState; jobId: string | null; api: Api }) {
  const [state, dispatch] = useReducer(employeeWorkspaceReducer, init);
  api.dispatch = dispatch;
  const markSeen = useCallback((id: string) => dispatch({ type: 'seen', jobId: id }), []);
  return (
    <EmployeePageView
      state={state} jobId={jobId} saveCommute={(r) => api.saveCommute(r)} refetchNow={async () => {}}
      markSeen={markSeen} onCloseJob={() => {}} search={(q, sig) => (api.search ? api.search(q, sig) : Promise.resolve([]))}
      employeeHref={(id) => `/employee/${id}`}
    />
  );
}

function setup(init: EmployeeWorkspaceState = ready(), jobId: string | null = null) {
  const api: Api = {
    dispatch: () => { throw new Error('not mounted'); },
    saveCommute: vi.fn(async (_req: PutCommuteRequest): Promise<CommuteResponse> => { throw new Error('not set'); }),
  };
  const m = mount(<Harness init={init} jobId={jobId} api={api} />);
  const c = m.container;
  const form = () => c.querySelector<HTMLFormElement>('form[aria-label="Commute"]');
  return {
    ...m, api, c, form,
    poll: (d: EmployeeDashboard) => act(() => { api.dispatch({ type: 'dashboard', dashboard: d, runId: 'run-1' }); }),
    send: (a: WorkspaceAction) => act(() => { api.dispatch(a); }),
    /** The router changing `?job=`. */
    setJob: (id: string | null) => m.rerender(<Harness init={init} jobId={id} api={api} />),
    edit: () => button(c, 'Edit commute'),
    editor: () => c.querySelector<HTMLElement>('.ep-editor'),
    heading: () => c.querySelector<HTMLElement>('#ep-editor-heading'),
    save: () => form()!.querySelector<HTMLButtonElement>('button[type="submit"]')!,
    detour: () => byLabel(form()!, DETOUR) as HTMLInputElement,
    row: (jobId: string) => c.querySelector<HTMLElement>(`[data-job-id="${jobId}"]`),
    /** The page's region for the commute save. */
    saveRegion: () => c.querySelector<HTMLElement>('.ep-announce')!,
    /** Every region for new deliveries in the page (there must be one). */
    jobRegions: () => [...c.querySelectorAll<HTMLElement>('.ew-announce')],
  };
}
type Page = ReturnType<typeof setup>;

/** Focus is on something a keyboard user can use: not <body>, not a control the browser switched off. */
function expectFocusKept(p: Page) {
  const active = document.activeElement as HTMLElement | null;
  expect(active, 'focus fell to <body>').not.toBe(document.body);
  expect(active).not.toBeNull();
  expect(p.c.contains(active)).toBe(true);
  expect((active as HTMLButtonElement).disabled === true || active!.closest('fieldset[disabled]') !== null,
    `focus is on a disabled control: ${active!.outerHTML.slice(0, 80)}`).toBe(false);
}

/** Every live region (role or aria-live) whose text contains `text`. A text said once is in exactly one. */
function liveRegionsWith(root: ParentNode, text: string): HTMLElement[] {
  const live = [...root.querySelectorAll<HTMLElement>('[role="status"], [role="alert"], [role="log"], [aria-live]')]
    .filter((el) => el.getAttribute('aria-live') !== 'off' && (el.textContent ?? '').includes(text));
  // An outer region that only contains an inner one would be the same announcement; there are none nested.
  for (const el of live) expect(live.some((o) => o !== el && o.contains(el)), 'nested live regions').toBe(false);
  return live;
}

/** Records what is added to or changed in a live region: what a screen reader is told about. */
function watch(region: HTMLElement) {
  const texts = (records: MutationRecord[]) => records.flatMap((r) => r.type === 'characterData'
    ? [r.target.textContent ?? '']
    : [...r.addedNodes].map((n) => n.textContent ?? '')).filter((t) => t !== '');
  // Records are handed to the callback once the test awaits; the rest is still queued in the observer.
  let seen: string[] = [];
  const o = new MutationObserver((records) => { seen.push(...texts(records)); });
  o.observe(region, { subtree: true, childList: true, characterData: true });
  return {
    /** The texts added or changed since the last call, in order. */
    said: () => {
      const all = [...seen, ...texts(o.takeRecords())];
      seen = [];
      return all;
    },
  };
}

/** Opens the editor and makes it dirty: the detour limit goes to 20. */
function openAndEdit(p: Page) {
  click(p.edit());
  typeInto(p.detour(), '20');
}

describe('#735 focus: the commute editor', () => {
  it('Edit commute moves focus into the editor, onto its heading; the next Esc closes it at once', () => {
    const p = setup();
    click(p.edit()); // the button is unmounted with the summary it was in
    expect(p.editor()).not.toBeNull();
    expect(document.activeElement).toBe(p.heading());
    expect(p.editor()!.contains(document.activeElement)).toBe(true);
    expect(p.heading()!.tabIndex).toBe(-1); // focusable, but not a tab stop
    expect(textOf(p.heading()!)).toBe('Edit commute');

    press('Escape'); // on the focused heading: no Tab needed first
    expect(p.editor()).toBeNull();
    expect(document.activeElement).toBe(p.edit());
    expect(p.api.saveCommute).not.toHaveBeenCalled();
  }, T);

  it('a poll while the editor is open does not pull focus back to the heading', () => {
    const p = setup();
    click(p.edit());
    p.detour().focus();
    p.poll({ ...dashboard, version: dashboard.version + 1 });
    p.poll({ ...dashboard, employee: { ...dashboard.employee }, version: dashboard.version + 2 });
    expect(document.activeElement).toBe(p.detour());
  }, T);

  it('Close and Esc return focus to Edit commute', () => {
    const p = setup();
    click(p.edit());
    click(button(p.c, 'Close'));
    expect(document.activeElement).toBe(p.edit());

    click(p.edit());
    p.detour().focus();
    press('Escape');
    expect(p.editor()).toBeNull();
    expect(document.activeElement).toBe(p.edit());
  }, T);

  it('Save keeps focus on the Save button while the save is pending, then gives it to Edit commute', async () => {
    const p = setup();
    openAndEdit(p);
    const pending = deferred<CommuteResponse>();
    p.api.saveCommute = vi.fn(() => pending.promise);
    click(p.save());

    // Pending: the button says "Saving…" and is aria-disabled, not disabled, so focus stays on it.
    expect(textOf(p.save())).toBe('Saving…');
    expect(p.save().disabled).toBe(false);
    expect(p.save().getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(p.save());
    expectFocusKept(p);
    // It cannot be pressed a second time, by click or by Enter.
    click(p.save());
    act(() => { p.form()!.requestSubmit(); });
    expect(p.api.saveCommute).toHaveBeenCalledTimes(1);
    // A poll in between changes nothing.
    p.poll({ ...dashboard, version: dashboard.version + 1 });
    expect(document.activeElement).toBe(p.save());

    pending.resolve(commuteAnswer(vi.mocked(p.api.saveCommute).mock.calls[0][0]));
    await flush();
    expect(p.editor()).toBeNull();
    expect(document.activeElement).toBe(p.edit());
  }, T);

  it('Enter in a field hands focus to Save before the fields are disabled', async () => {
    const p = setup();
    openAndEdit(p);
    const pending = deferred<CommuteResponse>();
    p.api.saveCommute = vi.fn(() => pending.promise);
    expect(document.activeElement).toBe(p.detour());
    act(() => { p.form()!.requestSubmit(); }); // what Enter in the number field does
    expect(p.api.saveCommute).toHaveBeenCalledTimes(1);
    expect(p.detour().disabled).toBe(true);
    expect(document.activeElement).toBe(p.save());
    expectFocusKept(p);
    pending.resolve(commuteAnswer(vi.mocked(p.api.saveCommute).mock.calls[0][0]));
    await flush();
    expect(document.activeElement).toBe(p.edit());
  }, T);

  it('a save that fails leaves focus on Save, and the next press tries again', async () => {
    const p = setup();
    openAndEdit(p);
    p.api.saveCommute = vi.fn(async () => { throw new ApiRequestError(0, 'Failed to fetch'); });
    click(p.save());
    await flush();
    expect(p.editor()).not.toBeNull();
    expect(textOf(p.editor()!)).toContain(NETWORK_TEXT);
    expect(textOf(p.save())).toBe('Save commute');
    expect(p.save().hasAttribute('aria-disabled')).toBe(false);
    expect(document.activeElement).toBe(p.save());
    expectFocusKept(p);
    expect(p.detour().value).toBe('20'); // the input is kept

    const second = vi.fn(async (req: PutCommuteRequest) => commuteAnswer(req));
    p.api.saveCommute = second;
    click(p.save());
    await flush();
    expect(second).toHaveBeenCalledTimes(1);
    expect(p.editor()).toBeNull();
    expect(document.activeElement).toBe(p.edit());
  }, T);

  it('a save the server refuses because the run is locked: focus goes to the heading, not to a disabled button', async () => {
    const p = setup();
    openAndEdit(p);
    p.api.saveCommute = vi.fn(async () => { throw new ApiRequestError(409, 'Planning is locked while the run plays.'); });
    click(p.save());
    await flush();
    expect(p.save().disabled).toBe(true); // every control of the form is off now
    expect(document.activeElement).toBe(p.heading());
    expectFocusKept(p);
    press('Escape');
    expect(p.editor()).toBeNull();
  }, T);

  it('a poll that locks the run while a field has focus: focus goes to the heading', () => {
    const p = setup();
    click(p.edit());
    p.detour().focus();
    p.poll({ ...dashboard, phase: 'locked', version: dashboard.version + 1 });
    expect(p.detour().disabled).toBe(true);
    expect(document.activeElement).toBe(p.heading());
    expectFocusKept(p);
  }, T);
});

describe('#735 focus: the home address search in the editor', () => {
  async function searching() {
    useFakeTimers();
    const s = fakeSearch();
    const p = setup();
    p.api.search = s.fn;
    click(p.edit());
    click(button(p.form()!, 'Change'));
    const input = byLabel(p.form()!, 'Home address') as HTMLInputElement;
    expect(document.activeElement).toBe(input); // Change hands focus to the input it opens
    typeInto(input, 'W 14');
    await advance(DEFAULT_DEBOUNCE_MS);
    s.calls[s.calls.length - 1].resolve([HARLEM, HAMILTON]);
    await settle();
    return { p, input, change: () => button(p.form()!, 'Change') };
  }

  it('Enter on a result: the input goes away and Change has the focus', async () => {
    const { p, input, change } = await searching();
    press('ArrowDown', input);
    press('Enter', input);
    expect(p.form()!.querySelector('[role="combobox"]')).toBeNull();
    expect(textOf(p.form()!)).toContain(`Home: ${HARLEM.neighborhood}`);
    expect(document.activeElement).toBe(change());
    expectFocusKept(p);
    expect(p.api.saveCommute).not.toHaveBeenCalled();
  }, T);

  it('a click on a result does the same', async () => {
    const { p, change } = await searching();
    const option = p.form()!.querySelectorAll<HTMLElement>('[role="option"]')[1];
    act(() => { option.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); });
    expect(textOf(p.form()!)).toContain(`Home: ${HAMILTON.neighborhood}`);
    expect(document.activeElement).toBe(change());
  }, T);

  it('Esc closes the list, the second Esc leaves the search with focus on Change, the third closes the editor', async () => {
    const { p, input, change } = await searching();
    press('Escape', input);
    expect(document.activeElement).toBe(input);
    press('Escape', input);
    expect(p.form()!.querySelector('[role="combobox"]')).toBeNull();
    expect(p.editor()).not.toBeNull();
    expect(document.activeElement).toBe(change());
    expectFocusKept(p);
    press('Escape');
    expect(p.editor()).toBeNull();
    expect(document.activeElement).toBe(p.edit());
  }, T);

  it('Cancel leaves the search with focus on Change', async () => {
    const { p, change } = await searching();
    click(button(p.form()!, 'Cancel'));
    expect(p.form()!.querySelector('[role="combobox"]')).toBeNull();
    expect(document.activeElement).toBe(change());
    expectFocusKept(p);
  }, T);
});

describe('#735 focus: a job from the list and back', () => {
  it('opening a job moves focus to its heading; Back returns it to that job\'s row', () => {
    const p = setup();
    const viewJob = p.row(RELAY)!.querySelector<HTMLAnchorElement>('[data-row-focus]')!;
    viewJob.focus();
    p.setJob(RELAY); // Enter on "View job": the router sets ?job=
    p.send({ type: 'jobCleared' });
    expect(document.activeElement).toBe(viewJob); // the list stays until the job is in
    p.send({ type: 'job', job: jobResponseFor(relayView) });
    const heading = p.c.querySelector<HTMLElement>('#job-v2-title')!;
    expect(document.activeElement).toBe(heading);
    expect(heading.tabIndex).toBe(-1);
    expectFocusKept(p);

    click(button(p.c, 'Back to deliveries'));
    p.setJob(null);
    expect(p.row(RELAY)!.contains(document.activeElement)).toBe(true);
    expect(textOf(document.activeElement!)).toBe('View job');
    expect(p.row(DIRECT)!.contains(document.activeElement)).toBe(false);
    expectFocusKept(p);
  }, T);

  it('the open job has its Watch link and Back as the two tab stops, both named', () => {
    const p = setup(ready(), DIRECT);
    p.send({ type: 'job', job: jobResponseFor(directView) });
    const job = p.c.querySelector('.job-v2')!;
    const stops = [...job.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
    expect(stops.map(textOf)).toStrictEqual(['Watch this package', 'Back to deliveries']);
    expect(stops[0].getAttribute('href')).toBe(`/simulator?package=${encodeURIComponent(directView.shipment.id)}&play=1`);
  }, T);
});

describe('#735 announcements: the commute save', () => {
  it('the save region is in the page before any save: one hidden polite region, empty', () => {
    const p = setup();
    const region = p.saveRegion();
    expect(p.c.querySelectorAll('.ep-announce')).toHaveLength(1);
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.classList.contains('ew-sr')).toBe(true); // hidden from sight, not from the screen reader
    expect(region.textContent).toBe('');
    click(p.edit());
    expect(p.saveRegion()).toBe(region);
    expect(region.textContent).toBe('');
  }, T);

  it('"Commute saved." is said once: by that region, not by the visible note, and not again by a poll', async () => {
    const p = setup();
    const region = p.saveRegion();
    const heard = watch(region);
    openAndEdit(p);
    const pending = deferred<CommuteResponse>();
    p.api.saveCommute = vi.fn(() => pending.promise);
    click(p.save());
    expect(heard.said()).toStrictEqual([SAVING_TEXT]);
    // While saving, nothing else in the page is a live region with that text (the form's own message is plain).
    expect(liveRegionsWith(p.c, 'Saving')).toStrictEqual([region]);

    const res = commuteAnswer(vi.mocked(p.api.saveCommute).mock.calls[0][0]);
    pending.resolve(res);
    await flush();
    expect(p.saveRegion()).toBe(region); // the same element as before the save
    expect(heard.said()).toStrictEqual([`${SAVED_TEXT}.`]);
    expect(region.textContent).toBe(`${SAVED_TEXT}.`);
    expect(liveRegionsWith(p.c, SAVED_TEXT)).toStrictEqual([region]);
    // The note a sighted user reads is there, as plain text.
    const note = [...p.c.querySelectorAll<HTMLElement>('.ep-notice')].find((n) => textOf(n) === `${SAVED_TEXT}.`)!;
    expect(note).toBeDefined();
    expect(note.hasAttribute('role')).toBe(false);
    expect(note.hasAttribute('aria-live')).toBe(false);

    // The next polls: the dashboard asked for after the save, an equal one, and a later version.
    const text = region.firstChild;
    const next = dashboardAfter(res, dashboard.version + 1);
    p.poll(next);
    p.poll(next);
    p.poll({ ...next, version: next.version + 1 });
    expect(heard.said()).toStrictEqual([]);
    expect(region.firstChild).toBe(text);
    expect(region.textContent).toBe(`${SAVED_TEXT}.`);
  }, T);

  it('a second save is said again, each state once', async () => {
    const p = setup();
    const heard = watch(p.saveRegion());
    p.api.saveCommute = vi.fn(async (req: PutCommuteRequest) => commuteAnswer(req));
    openAndEdit(p);
    click(p.save());
    await flush();
    expect(heard.said()).toStrictEqual([SAVING_TEXT, `${SAVED_TEXT}.`]);
    click(p.edit()); // the note goes when the editor opens again (#634); a removal is not read
    expect(p.saveRegion().textContent).toBe('');
    typeInto(p.detour(), '21');
    click(p.save());
    await flush();
    expect(heard.said()).toStrictEqual([SAVING_TEXT, `${SAVED_TEXT}.`]);
  }, T);

  it('a save error is said once, politely: by the region, with no alert beside it, and not again by a poll', async () => {
    const p = setup();
    const region = p.saveRegion();
    const heard = watch(region);
    openAndEdit(p);
    p.api.saveCommute = vi.fn(async () => { throw new ApiRequestError(0, 'Failed to fetch'); });
    click(p.save());
    await flush();
    expect(heard.said()).toStrictEqual([SAVING_TEXT, NETWORK_TEXT]);
    expect(liveRegionsWith(p.c, NETWORK_TEXT)).toStrictEqual([region]);
    expect(region.getAttribute('aria-live')).toBe('polite');
    // The banner in the editor shows it, as plain text; the form's own message has no role either.
    const banner = p.editor()!.querySelector<HTMLElement>('.ep-notice.ep-problem')!;
    expect(textOf(banner)).toBe(NETWORK_TEXT);
    expect(banner.hasAttribute('role')).toBe(false);
    expect(p.editor()!.querySelector('[role="alert"]')).toBeNull();
    expect(p.form()!.querySelector('.cf-message')!.hasAttribute('role')).toBe(false);
    expect(p.form()!.querySelector('.cf-message')!.hasAttribute('aria-live')).toBe(false);

    p.poll({ ...dashboard, version: dashboard.version + 1 });
    p.poll({ ...dashboard, version: dashboard.version + 2 });
    expect(heard.said()).toStrictEqual([]);

    // The same failure again is a new event: it passes through "Saving" and is said once more.
    click(p.save());
    await flush();
    expect(heard.said()).toStrictEqual([SAVING_TEXT, NETWORK_TEXT]);
  }, T);

  it('a 400 that the form shows next to its field is said by the same region, once', async () => {
    const p = setup();
    const region = p.saveRegion();
    const heard = watch(region);
    openAndEdit(p);
    const message = 'Morning departure must be on Day 2';
    p.api.saveCommute = vi.fn(async () => { throw new ApiRequestError(400, message, { morningDepartureMin: message }); });
    click(p.save());
    await flush();
    expect(heard.said()).toStrictEqual([SAVING_TEXT, message]);
    // The form shows the message and the field error; neither is a live region of its own.
    expect(textOf(p.form()!.querySelector('.cf-message')!)).toBe(message);
    expect(liveRegionsWith(p.c, message)).toStrictEqual([region]);
    expectFocusKept(p);
  }, T);

  it('with no save in play, the form still says its locked sentence itself', () => {
    const p = setup();
    click(p.edit());
    p.poll({ ...dashboard, phase: 'locked', version: dashboard.version + 1 });
    const message = p.form()!.querySelector<HTMLElement>('.cf-message')!;
    expect(message.getAttribute('role')).toBe('alert');
    expect(p.saveRegion().textContent).toBe('');
  }, T);
});

describe('#735 announcements: a new delivery', () => {
  const note = (jobId: string, message: string, createdSeq: number): Notification => ({
    id: `ntf-${jobId}`, audience: 'employee', audienceId: 'emp-001', kind: 'job_assigned',
    shipmentId: 'shp-x', planId: 'plan-x', jobId, message, createdSeq,
  });
  const DIRECT_MSG = 'New delivery job: "Fabric swatches". Collect from Acme Studio and deliver to Cafe Luna. Reward $8.00.';
  const RELAY_MSG = 'New delivery job: "Print proofs". Drop at Corner Books; another employee completes delivery. Reward $7.00.';
  const none: EmployeeDashboard = { ...dashboard, assigned: [], completed: [], notifications: [], version: 3 };
  const onlyDirect: EmployeeDashboard = { ...none, assigned: [directView], notifications: [note(DIRECT, DIRECT_MSG, 1)] };
  const both: EmployeeDashboard = {
    ...none, assigned: [directView, relayView], notifications: [note(RELAY, RELAY_MSG, 2), note(DIRECT, DIRECT_MSG, 1)], version: 4,
  };

  it('the page has one region for new deliveries, in place and empty on the first load', () => {
    const p = setup(ready(onlyDirect));
    expect(p.jobRegions()).toHaveLength(1);
    const region = p.jobRegions()[0];
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe(''); // the first load flags nothing (pass 9)
    expect(region.closest('.ew')).toBeNull(); // the page's own, so it outlives the list
  }, T);

  it('a delivery that arrives with a poll is said once, word for word, and not again by the next polls', () => {
    const p = setup(ready(onlyDirect));
    const region = p.jobRegions()[0];
    const heard = watch(region);
    p.poll(both);
    expect(p.jobRegions()).toStrictEqual([region]);
    expect(heard.said()).toStrictEqual([RELAY_MSG]);
    expect(liveRegionsWith(p.c, RELAY_MSG)).toStrictEqual([region]);
    expect(p.row(RELAY)!.querySelector('.ew-new')).not.toBeNull();

    const sentence = region.firstElementChild;
    p.poll(both);
    p.poll({ ...both, version: 5 });
    p.poll({ ...both, version: 6, earnedCents: 100 });
    expect(heard.said()).toStrictEqual([]);
    expect(region.firstElementChild).toBe(sentence);
    expect(region.children).toHaveLength(1);
  }, T);

  it('opening a job and going back does not put the region, or a message already said, into the page again', () => {
    const p = setup(ready(none));
    const region = p.jobRegions()[0];
    const heard = watch(region);
    p.poll(both); // two new deliveries
    expect(heard.said()).toStrictEqual([RELAY_MSG, DIRECT_MSG]);
    const directSentence = [...region.children].find((el) => el.textContent === DIRECT_MSG)!;

    // Open the relay job: its own "New" tag is cleared, the other message stays where it is.
    p.row(RELAY)!.querySelector<HTMLAnchorElement>('[data-row-focus]')!.focus();
    p.setJob(RELAY);
    p.send({ type: 'jobCleared' });
    p.send({ type: 'job', job: jobResponseFor(relayView) });
    expect(p.c.querySelector('.job-v2')).not.toBeNull();
    expect(p.c.querySelector('.ew')).toBeNull(); // the list is not on screen
    expect(p.jobRegions()).toStrictEqual([region]); // the region is
    expect(region.isConnected).toBe(true);
    expect([...region.children]).toStrictEqual([directSentence]);

    click(button(p.c, 'Back to deliveries'));
    p.setJob(null);
    p.poll({ ...both, version: 5 });
    expect(p.jobRegions()).toStrictEqual([region]);
    expect([...region.children]).toStrictEqual([directSentence]);
    expect(heard.said()).toStrictEqual([]); // nothing was added after the first two
    expect(p.row(DIRECT)!.querySelector('.ew-new')).not.toBeNull();
    expect(p.row(RELAY)!.querySelector('.ew-new')).toBeNull();
  }, T);

  it('a delivery that arrives while a job view is open is said too', () => {
    const p = setup(ready(onlyDirect), DIRECT);
    p.send({ type: 'job', job: jobResponseFor(directView) });
    expect(p.c.querySelector('.job-v2')).not.toBeNull();
    const region = p.jobRegions()[0];
    const heard = watch(region);
    p.poll(both);
    expect(heard.said()).toStrictEqual([RELAY_MSG]);
    expect(document.activeElement).toBe(p.c.querySelector('#job-v2-title')); // focus is not moved by it
  }, T);

  it('the save region and the delivery region are two regions: a save does not repeat a new delivery', async () => {
    const p = setup(ready(onlyDirect));
    p.poll(both);
    const jobs = watch(p.jobRegions()[0]);
    p.api.saveCommute = vi.fn(async (req: PutCommuteRequest) => commuteAnswer(req, both));
    openAndEdit(p);
    click(p.save());
    await flush();
    expect(p.saveRegion().textContent).toBe(`${SAVED_TEXT}.`);
    expect(jobs.said()).toStrictEqual([]);
    expect(p.jobRegions()[0].textContent).toBe(RELAY_MSG);
  }, T);
});

describe('#735 focus rings found missing in headless Chrome (CommuteForm.css)', () => {
  const css = readFileSync('client/src/components/employee/v2/CommuteForm.css', 'utf8');
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    expect(at, `no rule ${selector}`).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf('}', at));
  };
  const RING = /outline:\s*2px solid var\(--accent, #1D5075\);\s*outline-offset:\s*2px;/;

  it('a checkbox gets the 2px accent outline: a 1px accent ring cannot be seen around an accent-filled box', () => {
    const checkbox = rule('.cf-check input:focus-visible');
    expect(checkbox).toMatch(RING);
    expect(checkbox).toMatch(/box-shadow:\s*none/);
    // It comes after the general field rule it overrides (same specificity).
    expect(css.indexOf('.cf-check input:focus-visible {')).toBeGreaterThan(css.indexOf('.cf input:focus-visible {'));
  });

  it("the time field's picker button gets the same outline instead of the system-blue one", () => {
    expect(rule(".cf input[type='time']:focus-within:not(:focus)::-webkit-calendar-picker-indicator")).toMatch(RING);
  });

  it('Save looks switched off while it is aria-disabled, and does not react to hover', () => {
    expect(css).toMatch(/\.cf-btn:disabled,\s*\.cf-btn\[aria-disabled='true'\],[^{]*\{[^}]*opacity:\s*0\.55;[^}]*cursor:\s*not-allowed;/);
    expect(css).toContain(".cf-btn-primary:hover:not(:disabled):not([aria-disabled='true'])");
    expect(css).toContain(".cf-btn:hover:not(:disabled):not([aria-disabled='true'])");
  });
});
