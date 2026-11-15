// #478: the MVP II Employee workspace by keyboard and screen reader. Static renders walked in DOM
// order: every control is reachable, named and has a :focus-visible style; errors and save results
// are announced; the saved commute is the first content on the page.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CommuteResponse, EmployeeDashboard, JobResponse } from '../../shared/v2/api';
import { AddressSearchView } from '../../client/src/components/employee/v2/AddressSearch';
import {
  addressSearchReducer, initialSearchState, isOpen, keyIntent, type AddressSearchState,
} from '../../client/src/components/employee/v2/addressSearchModel';
import { CommuteForm } from '../../client/src/components/employee/v2/CommuteForm';
import { draftFromSaved, type FieldErrors } from '../../client/src/components/employee/v2/commuteFormModel';
import {
  TRAVEL_DATA_MISSING_TEXT, employeeWorkspaceReducer, initialWorkspaceState, type EmployeeWorkspaceState,
} from '../../client/src/components/employee/v2/live/employeeWorkspaceState';
import { EmployeePageView, type EmployeePageViewProps } from '../../client/src/components/employee/v2/page/EmployeePageView';
import { outcomeFromError } from '../../client/src/components/employee/v2/page/employeePageModel';
import { ApiRequestError } from '../../client/src/api/v2';
import {
  accessibleName, all, byId, focusVisibleSelectors, matchesSelector, parseCss, parseHtml, tabOrder, textOf, v2CssFiles,
  type El,
} from './employee-v2-qa-helpers';
import { businesses as workBusinesses, dashboard } from './employee-v2-workspace-sample';
import { businesses as jobBusinesses, eveningDirect } from './employeeV2JobSample';

const businesses = [...workBusinesses, ...jobBusinesses];
const focusSelectors = v2CssFiles().flatMap((f) => focusVisibleSelectors(parseCss(readFileSync(f, 'utf8'))));
const noop = () => {};
const saveOk = async (): Promise<CommuteResponse> => ({ employee: dashboard.employee, home: dashboard.home, trips: [], rematchedShipmentIds: [] });

function ready(d: EmployeeDashboard = dashboard): EmployeeWorkspaceState {
  const s = employeeWorkspaceReducer(initialWorkspaceState, { type: 'dashboard', dashboard: d, runId: 'run-1' });
  return employeeWorkspaceReducer(s, { type: 'businesses', businesses });
}

function page(state: EmployeeWorkspaceState, p: Partial<EmployeePageViewProps> = {}): El {
  return parseHtml(renderToStaticMarkup(
    <EmployeePageView
      state={state} jobId={null} saveCommute={saveOk} refetchNow={async () => {}} markSeen={noop}
      onCloseJob={noop} search={async () => []} employeeHref={(id) => `/nyc/employee/${id}`} {...p}
    />,
  ));
}

const describeEl = (e: El) => `<${e.tag}${e.attrs.class ? ` class="${e.attrs.class}"` : ''}${e.attrs.type ? ` type="${e.attrs.type}"` : ''}>`;

/** Every tab stop has a name and a :focus-visible style from this folder; returns the names in tab order. */
function walkTabs(root: El): string[] {
  const names: string[] = [];
  for (const e of tabOrder(root)) {
    const name = accessibleName(root, e);
    expect(name, `${describeEl(e)} has no accessible name`).not.toBe('');
    expect(focusSelectors.some((s) => matchesSelector(e, s)), `${describeEl(e)} "${name}" has no :focus-visible style`).toBe(true);
    names.push(name);
  }
  return names;
}

describe('keyboard walk (#478)', () => {
  // Issue 957: the assigned list (the next job's pass first) is above the commute, so Tab reaches it first.
  it('workspace: the assigned rows (View job, Watch in simulator), Edit commute, then the completed rows', () => {
    const root = page({ ...ready(), newJobIds: [dashboard.assigned[0].job.id] });
    const names = walkTabs(root);
    // #882: a row's two links are named after its package, so two rows do not both read "View job".
    const links = (views: typeof dashboard.assigned) => views.flatMap((v) => [`View job: ${v.shipment.label}`, `Watch in simulator: ${v.shipment.label}`]);
    expect(names).toEqual([...links(dashboard.assigned), 'Edit commute', ...links(dashboard.completed)]);
    // Every delivery row is reachable, the boarding pass included: each has both links.
    const rows = all(root, (e) => (e.attrs.class ?? '').split(/\s+/).includes('ew-row'));
    expect(rows).toHaveLength(dashboard.assigned.length + dashboard.completed.length);
    expect(rows[0].attrs.class).toBe('ew-row ew-pass');
    for (const row of rows) {
      expect(tabOrder(row).map((e) => textOf(e))).toEqual(['View job', 'Watch in simulator']);
    }
  });

  it('commute editor: Close, workplace, address, departure times, availability, detour limit, Save and Discard', () => {
    const dirty = { ...draftFromSaved(dashboard.employee, dashboard.home), maxExtraMin: 20 };
    const all13 = walkTabs(page(ready(), { initialEditing: true, initialDraft: dirty }));
    // The assigned rows come before the editor (issue 957), two links each.
    const before = dashboard.assigned.length * 2;
    expect(all13.slice(0, 2)).toEqual([`View job: ${dashboard.assigned[0].shipment.label}`, `Watch in simulator: ${dashboard.assigned[0].shipment.label}`]);
    const names = all13.slice(before);
    expect(names.slice(0, 11)).toEqual([
      'Close',
      'Workplace',
      'Change',
      'Evening departure (Day 1, work to home)',
      'Morning departure (Day 2, home to work)',
      'Available on the evening commute',
      'Available on the morning commute',
      'Maximum detour (minutes)',
      'Maximum detour slider (minutes)',
      'Save commute',
      'Discard changes',
    ]);
    // The completed rows follow the editor.
    const first = dashboard.completed[0].shipment.label;
    expect(names.slice(11, 13)).toEqual([`View job: ${first}`, `Watch in simulator: ${first}`]);
  });

  it('address search: labelled combobox, results reached by arrow keys, Esc closes', () => {
    const results = [
      { label: '31-10 Steinway St, Queens', neighborhood: 'Astoria', lat: 40.76, lng: -73.92 },
      { label: '30-02 Steinway St, Queens', neighborhood: 'Astoria', lat: 40.77, lng: -73.91 },
    ];
    let s: AddressSearchState = addressSearchReducer(initialSearchState, { type: 'input', query: 'Steinway' });
    s = addressSearchReducer(s, { type: 'searchStart', query: 'Steinway' });
    s = addressSearchReducer(s, { type: 'searchSuccess', query: 'Steinway', results });
    expect(isOpen(s)).toBe(true);

    // ArrowDown highlights the first result.
    const down = keyIntent(s, 'ArrowDown', { hasValue: true, editing: true });
    expect(down).toEqual({ kind: 'highlight', delta: 1 });
    s = addressSearchReducer(s, { type: 'highlight', delta: 1 });
    expect(keyIntent(s, 'Enter', { hasValue: true, editing: true })).toEqual({ kind: 'choose', index: 0 });

    const root = parseHtml(renderToStaticMarkup(
      <AddressSearchView id="qa" state={s} value={{ neighborhood: 'Astoria', lat: 1, lng: 2 }} editing />,
    ));
    expect(walkTabs(root)).toEqual(['Home address', 'Cancel']);
    const input = byId(root, 'qa-input')!;
    expect(input.attrs.role).toBe('combobox');
    expect(input.attrs['aria-expanded']).toBe('true');
    const list = byId(root, input.attrs['aria-controls'])!;
    expect(list.attrs.role).toBe('listbox');
    expect(accessibleName(root, list)).toBe('Matching addresses');
    const options = all(list, (e) => e.attrs.role === 'option');
    expect(options).toHaveLength(2);
    // The highlighted option is announced through aria-activedescendant, so arrow keys reach every result.
    expect(input.attrs['aria-activedescendant']).toBe(options[0].attrs.id);
    expect(options[0].attrs['aria-selected']).toBe('true');
    expect(options.map((o) => o.attrs.id)).toEqual(['qa-opt-0', 'qa-opt-1']);
    // The status line is the input's description and a polite live region.
    const status = byId(root, input.attrs['aria-describedby'])!;
    expect(status.attrs.role).toBe('status');

    // Esc closes the list; a second Esc leaves the edit and keeps the saved home.
    expect(keyIntent(s, 'Escape', { hasValue: true, editing: true })).toEqual({ kind: 'close' });
    const closed = addressSearchReducer(s, { type: 'close' });
    expect(isOpen(closed)).toBe(false);
    const closedRoot = parseHtml(renderToStaticMarkup(
      <AddressSearchView id="qa" state={closed} value={{ neighborhood: 'Astoria', lat: 1, lng: 2 }} editing />,
    ));
    expect(byId(closedRoot, 'qa-input')!.attrs['aria-expanded']).toBe('false');
    expect(byId(closedRoot, 'qa-list')!.attrs.hidden).toBeDefined();
    expect(keyIntent(closed, 'Escape', { hasValue: true, editing: true })).toEqual({ kind: 'cancel' });
    // Enter with nothing highlighted never submits the form around it.
    expect(keyIntent(closed, 'Enter', { hasValue: true, editing: true })).toEqual({ kind: 'swallow' });
  });

  it("job detail: 'Watch this package' and 'Back to deliveries' are reachable and named", () => {
    const own: JobResponse = (() => { const j = eveningDirect(); return { ...j, job: { ...j.job, employeeId: 'emp-001' } }; })();
    const s = employeeWorkspaceReducer(ready(), { type: 'job', job: own });
    const root = page(s, { jobId: own.job.id });
    expect(walkTabs(root)).toEqual(['Watch this package', 'Back to deliveries']);
    const watch = tabOrder(root)[0];
    expect(watch.attrs.href).toMatch(/simulator\?package=/);
  });
});

describe('announcements (#478)', () => {
  it('every field error is tied to its control with aria-describedby', () => {
    const fieldErrors: FieldErrors = {
      businessId: 'Choose a workplace.', home: 'Choose a home address.',
      eveningDepartureMin: 'Bad evening time.', morningDepartureMin: 'Bad morning time.',
      availableEvening: 'Bad evening flag.', availableMorning: 'Bad morning flag.', maxExtraMin: 'Bad detour.',
    };
    const root = parseHtml(renderToStaticMarkup(
      <CommuteForm
        employee={dashboard.employee} home={dashboard.home} businesses={businesses} phase="planning"
        onSave={saveOk} initialSaveState={{ status: 'error', message: 'Fix the fields below.', fieldErrors }}
      />,
    ));
    const errors = all(root, (e) => (e.attrs.class ?? '').split(' ').includes('cf-error'));
    expect(errors.map(textOf).sort()).toEqual(Object.values(fieldErrors).sort());
    for (const err of errors) {
      const described = all(root, (e) => (e.attrs['aria-describedby'] ?? '').split(/\s+/).includes(err.attrs.id));
      expect(described.length, `"${textOf(err)}" is not tied to a control`).toBeGreaterThan(0);
    }
    // Inputs with an error say so.
    for (const e of tabOrder(root)) {
      if (e.attrs['aria-describedby'] && e.tag !== 'div' && e.attrs.type !== 'range') expect(e.attrs['aria-invalid'], describeEl(e)).toBe('true');
    }
    const msg = all(root, (e) => (e.attrs.class ?? '').includes('cf-message'))[0];
    expect(msg.attrs.role).toBe('alert');
    expect(textOf(msg)).toBe('Fix the fields below.');
  });

  it("the save result and a 503 of the save are said by the page's one polite region (#735)", () => {
    // The visible notice has no role of its own, so the text is announced once, by the region.
    const live = (root: El, text: string) => all(root, (e) => (e.attrs.role === 'status' || e.attrs.role === 'alert'
      || e.attrs['aria-live'] !== undefined) && textOf(e).includes(text));
    const saved = page(ready(), { initialOutcome: { kind: 'saved', matched: 1 } });
    const ok = all(saved, (e) => textOf(e).startsWith('Commute saved') && e.tag === 'p')[0];
    expect(ok.attrs.role).toBeUndefined();
    const said = live(saved, 'Commute saved');
    expect(said).toHaveLength(1);
    expect(said[0].attrs).toMatchObject({ role: 'status', 'aria-live': 'polite' });
    expect((said[0].attrs.class ?? '').split(' ')).toContain('ep-announce');

    const e503 = outcomeFromError(new ApiRequestError(503, 'x', undefined, 'http', 'travel_data_missing'));
    const editing = page(ready(), { initialEditing: true, initialOutcome: e503 });
    const error = live(editing, TRAVEL_DATA_MISSING_TEXT);
    expect(error).toHaveLength(1);
    expect(error[0].attrs).toMatchObject({ role: 'status', 'aria-live': 'polite' });
    // It is still on screen in the editor, as text.
    const shown = all(editing, (e) => e.tag === 'p' && (e.attrs.class ?? '').includes('ep-problem') && textOf(e).includes(TRAVEL_DATA_MISSING_TEXT));
    expect(shown).toHaveLength(1);
    expect(shown[0].attrs.role).toBeUndefined();

    const unavailable = page({ ...initialWorkspaceState, view: 'unavailable', unavailable: { code: 'travel_data_missing', message: TRAVEL_DATA_MISSING_TEXT } });
    const box = all(unavailable, (e) => e.attrs.role === 'alert')[0];
    expect(textOf(box)).toContain(TRAVEL_DATA_MISSING_TEXT);
    expect(walkTabs(unavailable)).toEqual(['Retry']);
  });

  it('the "New" mark on a delivery is text, not colour alone', () => {
    const root = page({ ...ready(), newJobIds: [dashboard.assigned[0].job.id] });
    const marks = all(root, (e) => e.attrs.class === 'ew-new');
    expect(marks).toHaveLength(1);
    expect(textOf(marks[0])).toBe('New');
    const row = all(root, (e) => e.attrs['data-job-id'] === dashboard.assigned[0].job.id)[0];
    expect(textOf(row)).toContain('New');
  });

  it('no "hub" in anything a user reads', () => {
    const root = page({ ...ready(), newJobIds: [dashboard.assigned[0].job.id] });
    expect(textOf(root)).not.toMatch(/\bhub\b/i);
  });
});

describe('page order at 390 px (#478)', () => {
  const headings = (root: El) => all(root, (e) => e.tag === 'h1' || e.tag === 'h2').map(textOf);
  const sections = (root: El) => all(root, (e) => e.tag === 'section' || e.attrs['data-qa'] === 'route');

  // Issue 957 changed the order #478 set: the next job is the page's one bold element, so the band with the
  // earnings and the assigned list comes first; the commute follows with the route preview right under it.
  it('the earnings and the assigned list come first, then the saved commute with the route preview under it', () => {
    const root = page(
      { ...ready(), newJobIds: [dashboard.assigned[0].job.id] },
      { routePreview: <div data-qa="route">ROUTE</div>, initialOutcome: { kind: 'saved', matched: 0 } },
    );
    expect(sections(root).map((e) => e.attrs['aria-labelledby'] ?? e.attrs['data-qa'])).toEqual([
      'ew-earnings-heading', 'ew-assigned-heading', 'ew-commute-heading', 'route', 'ew-completed-heading',
    ]);
    expect(headings(root)).toEqual(['Maya Chen', 'Earnings', 'Assigned deliveries', 'Saved commute', 'Completed deliveries']);
  });

  it('the commute editor takes the commute\'s place while editing', () => {
    const root = page(ready(), { initialEditing: true, routePreview: <div data-qa="route">ROUTE</div> });
    expect(sections(root).map((e) => e.attrs['aria-labelledby'] ?? e.attrs['data-qa'])).toEqual([
      'ew-earnings-heading', 'ew-assigned-heading', 'ep-editor-heading', 'route', 'ew-completed-heading',
    ]);
    expect(headings(root)).toEqual(['Maya Chen', 'Earnings', 'Assigned deliveries', 'Edit commute', 'Completed deliveries']);
  });
});
