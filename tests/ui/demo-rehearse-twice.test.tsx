// @vitest-environment jsdom
// #740: the demo can be rehearsed twice, through the pages a presenter uses.
// PR #736 (#734, DECISIONS pass 74) proves over HTTP that "Back to start" (`reset_playback`) reopens planning.
// Here the Business page (BusinessV2) and the Employee page (EmployeeV2) run in a real DOM with the real
// client/src/api against a REAL server: `createV2Runtime` on a temp copy of fixtures/nyc, a temp state file
// and no key (demo-rehearse-twice-helper.ts). Both pages stay mounted side by side, like two browser tabs,
// while the simulator's controls are sent the way its buttons send them (controlsModel.ts).
//
// One rehearsal: Play locks the New delivery form and the commute editor; the day runs to its end; "Back to
// start" reopens both within ONE poll; "Find a delivery match" with the README's demo request answers
// matched; a commute save succeeds. The rehearsal runs twice in one test on the same server.
//
// The pages' poll timers are fake and the requests are real, so "one poll" is exact: the timers move by one
// poll interval and each page sends one dashboard request.
// The locked state is read from the controls (disabled or not), never from the locked sentence: #719 and
// #735 may still change that copy. The only story values are read from the README's ```demo-request block
// (DECISIONS pass 54 and 59), and no carrier name is expected after the first rehearsal (pass 74).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { BusinessDashboard, CommuteResponse, EmployeeDashboard, ShipmentResponse } from '../../shared/v2/api';
import type { Clock, Employee, NetworkBusiness } from '../../shared/v2/types';
import {
  getBusinessDashboard, getBusinesses, getEmployeeDashboard, getEmployees, getSimulator, simulatorControl,
} from '../../client/src/api/v2';
import { POLL_INTERVAL_MS as BUSINESS_POLL_MS } from '../../client/src/components/business/v2/live/businessPoller';
import {
  RESULT_COPY, emptyDraft, recipientOptions, toRequest, validate,
} from '../../client/src/components/business/v2/newDeliveryModel';
import { MAX_DETOUR_MIN } from '../../client/src/components/employee/v2/commuteFormModel';
import { POLL_INTERVAL_MS as EMPLOYEE_POLL_MS } from '../../client/src/components/employee/v2/live/employeePoller';
import { RESET_LABEL, RESET_REQUEST, playClockRequests } from '../../client/src/components/sim/v2/controls/controlsModel';
import BusinessV2 from '../../client/src/pages/v2/BusinessV2';
import EmployeeV2 from '../../client/src/pages/v2/EmployeeV2';
import { commuteOf, nycFilesState } from '../api/v2-e2e-nyc-helper';
import {
  T, advancePolls, byName, isDisabled, readmeDemo, settle, startRehearsalApi, useFakePollTimers,
  type Logged, type RehearsalApi,
} from './demo-rehearse-twice-helper';
import { button, buttons, byLabel, click, mount, select, textOf, typeInto } from './kitDom';

vi.setConfig({ testTimeout: T, hookTimeout: T });

// The pages run with no browser key, so nothing may load from Google (the route previews show their no-key state).
const google = vi.hoisted(() => ({ loads: 0 }));
vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: () => { google.loads += 1; },
  importLibrary: () => { google.loads += 1; return new Promise(() => {}); },
}));

const demo = readmeDemo();
const TYPE_OF: Record<string, 'envelope' | 'small_box'> = { Envelope: 'envelope', 'Small box': 'small_box' };

let api: RehearsalApi;
let nycBefore: string[];
let businesses: NetworkBusiness[];
let employees: Employee[];
let sender: NetworkBusiness;
let recipient: NetworkBusiness;
/** The employee the README opens: a carrier of the demo request on the fresh run. */
let employee: Employee;

beforeAll(async () => {
  nycBefore = nycFilesState();
  api = await startRehearsalApi();
  businesses = (await getBusinesses()).businesses;
  employees = (await getEmployees()).employees;
  sender = byName(businesses, demo.sender, 'sender');
  recipient = byName(businesses, demo.recipient, 'recipient');
  employee = byName(employees, demo.employee, 'employee');
});
afterAll(async () => {
  await api?.close();
  expect(nycFilesState()).toStrictEqual(nycBefore); // nothing was written to the committed fixtures/nyc
});
beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
  google.loads = 0;
  useFakePollTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  expect(google.loads).toBe(0);
  expect(api.outgoing).toStrictEqual([]);
  expect(api.googleCalls).toStrictEqual([]);
});

// ---------- the two pages ----------

function mountPage(path: string) {
  return mount(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/business/:id" element={<BusinessV2 />} />
        <Route path="/employee/:id" element={<EmployeeV2 />} />
      </Routes>
    </MemoryRouter>,
  ).container;
}

const enc = encodeURIComponent;
const businessPoll = () => `GET /api/v2/businesses/${enc(sender.id)}/dashboard`;
const employeePoll = () => `GET /api/v2/employees/${enc(employee.id)}/dashboard`;

/** One poll of each page: the timers move by one interval, and each page asks for its dashboard once. */
async function onePoll(step: string): Promise<void> {
  await settle(api);
  const from = api.log.length;
  await advancePolls(api, BUSINESS_POLL_MS);
  const polls = api.sentSince(from).filter((line) => line.endsWith('/dashboard'));
  expect(polls.sort(), `${step}: the dashboard requests of one poll`).toStrictEqual([businessPoll(), employeePoll()].sort());
}

/** The last request with this method whose path ends with `suffix`, sent at or after `from`. */
function lastRequest(from: number, method: string, suffix: string): Logged {
  const found = api.log.slice(from).filter((r) => r.method === method && r.path.endsWith(suffix));
  if (found.length !== 1) throw new Error(`${found.length} ${method} ...${suffix} requests, expected 1`);
  return found[0];
}

// ----- Business -----

/** The open New delivery form, or null. */
const form = (c: ParentNode) => c.querySelector<HTMLFormElement>('form.nd');
const openForm = (c: ParentNode): HTMLFormElement => {
  const f = form(c);
  if (!f) throw new Error('the New delivery form is not open');
  return f;
};
const formSubmit = (c: ParentNode) => openForm(c).querySelector<HTMLButtonElement>('button[type="submit"]')!;
/** The form's alert line: empty while requests are open. */
const formAlert = (c: ParentNode) => textOf(openForm(c).querySelector('[role="alert"]')!);
/** The page's New delivery buttons (the toolbar's, and the empty table's when it has no row). */
const newDeliveryButtons = (c: ParentNode) => buttons(c, 'New delivery');
/** New delivery opens on the request text box (MVP IV F1, #786); the form is one more press away. */
const openNewDeliveryForm = (c: ParentNode) => {
  click(newDeliveryButtons(c)[0]);
  click(button(c, 'Fill in the form instead'));
};
/** The header's phase word, whatever it reads. */
const phaseLabel = (c: ParentNode) => textOf(c.querySelector('.ba-header__phase-label')!);
/** The deliveries table: each row's shipment ID and the status it shows. */
const tableRows = (c: ParentNode) => [...c.querySelectorAll('tr.bw-row')].map((row) => ({
  id: textOf(row.querySelector('td[data-label="Shipment ID"]')!),
  status: textOf(row.querySelector('td[data-label="Status"]')!),
}));
const optionLabel = (b: NetworkBusiness) => {
  const option = recipientOptions(businesses, sender.id).find((o) => o.id === b.id);
  if (!option) throw new Error(`${b.name} is not a recipient option of ${sender.name}`);
  return option.label;
};

/** The server's status of every delivery of the sender, by shipment ID. */
const statusById = (dash: BusinessDashboard) =>
  new Map([...dash.outgoing, ...dash.incoming].map((view) => [view.shipment.id, view.status]));

/** The README's request as the form's model builds it (as tests/api/v2-reset-unlocks.test.ts does). */
function demoRequest(clientRequestId: string) {
  const draft = {
    ...emptyDraft(),
    recipientId: recipient.id,
    label: demo.package,
    category: TYPE_OF[demo.type],
    weightKg: demo.weight_kg,
    description: demo.contents,
  };
  expect(validate(draft, sender.id)).toStrictEqual({});
  return toRequest(draft, sender.id, clientRequestId);
}

/** Types the README's request into the open form. The times stay at the form's defaults, as in the README. */
function typeDemoRequest(c: ParentNode): void {
  const f = openForm(c);
  select(byLabel(f, 'Recipient'), optionLabel(recipient));
  typeInto(byLabel(f, 'Package name'), demo.package);
  select(byLabel(f, 'Type'), demo.type);
  typeInto(byLabel(f, 'Weight (kg)'), demo.weight_kg);
  typeInto(byLabel(f, 'Contents'), demo.contents);
}

// ----- Employee -----

/** The open commute editor's form, or null. */
const editor = (c: ParentNode) => c.querySelector<HTMLFormElement>('form.cf');
const openEditor = (c: ParentNode): HTMLFormElement => {
  const f = editor(c);
  if (!f) throw new Error('the commute editor is not open');
  return f;
};
/** Every field of the editor (the address search's controls included). */
const editorFields = (c: ParentNode) => [...openEditor(c).querySelectorAll('input, select')];
const editorButtons = (c: ParentNode) => [...openEditor(c).querySelectorAll('button')];
const saveButton = (c: ParentNode) => button(openEditor(c), 'Save commute');
/** The editor's own message: its role and text. */
const editorMessage = (c: ParentNode) => {
  const el = openEditor(c).querySelector('.cf-message')!;
  return { role: el.getAttribute('role'), text: textOf(el) };
};
const detourInput = (c: ParentNode) => byLabel(openEditor(c), 'Maximum detour (minutes)') as HTMLInputElement;
/** The workspace's "run is locked" line. */
const lockedLine = (c: ParentNode) => c.querySelector('.ew-locked');
/** Job IDs under "Assigned deliveries" and under "Completed deliveries", as listed. */
const jobLists = (c: ParentNode) => {
  const ids = (heading: string) =>
    [...c.querySelectorAll(`section[aria-labelledby="${heading}"] [data-job-id]`)].map((row) => row.getAttribute('data-job-id'));
  return { assigned: ids('ew-assigned-heading'), completed: ids('ew-completed-heading') };
};
/** The same two lists as the server answers them. */
const jobListsOf = (dash: EmployeeDashboard) => ({
  assigned: dash.assigned.map((view) => view.job.id),
  completed: dash.completed.map((view) => view.job.id),
});
/** Another detour limit than the saved one, inside the form's range. */
const anotherDetour = (saved: number) => (saved < MAX_DETOUR_MIN ? saved + 1 : saved - 1);

// ---------- the checks of a locked and of an open page ----------

function expectBusinessLocked(c: ParentNode, step: string): void {
  expect(isDisabled(formSubmit(c)), `${step}: the form's "Find a delivery match" is disabled`).toBe(true);
  expect(formAlert(c), `${step}: the form says why`).not.toBe('');
  expect(newDeliveryButtons(c).map(isDisabled), `${step}: New delivery is disabled`).toStrictEqual(newDeliveryButtons(c).map(() => true));
}

function expectBusinessOpen(c: ParentNode, step: string): void {
  expect(isDisabled(formSubmit(c)), `${step}: the form's "Find a delivery match" is enabled`).toBe(false);
  expect(formAlert(c), `${step}: the form's alert is empty`).toBe('');
  expect(newDeliveryButtons(c).map(isDisabled), `${step}: New delivery is enabled`).toStrictEqual(newDeliveryButtons(c).map(() => false));
  for (const field of openForm(c).querySelectorAll('input, select')) {
    expect(isDisabled(field), `${step}: the form field ${field.id} is enabled`).toBe(false);
  }
}

function expectEditorLocked(c: ParentNode, step: string): void {
  expect(editorFields(c).length, `${step}: the editor has its fields`).toBeGreaterThan(0);
  for (const control of [...editorFields(c), ...editorButtons(c)]) {
    expect(isDisabled(control), `${step}: the editor control ${control.id || textOf(control)} is disabled`).toBe(true);
  }
  expect(editorMessage(c).role, `${step}: the editor says why, as an alert`).toBe('alert');
  expect(editorMessage(c).text, `${step}: the editor says why`).not.toBe('');
  expect(lockedLine(c), `${step}: the workspace's locked line`).not.toBeNull();
}

function expectEditorOpen(c: ParentNode, step: string): void {
  expect(editorFields(c).length, `${step}: the editor has its fields`).toBeGreaterThan(0);
  for (const field of editorFields(c)) {
    expect(isDisabled(field), `${step}: the editor field ${field.id} is enabled`).toBe(false);
  }
  expect(editorMessage(c).text, `${step}: the editor's message is empty`).toBe('');
  expect(lockedLine(c), `${step}: the workspace's locked line is gone`).toBeNull();
}

// ---------- the controls, as the simulator's buttons send them ----------

/** Play with no package picked: the fixed speed first when the clock is at another one, then `play`. */
async function pressPlay(clock: Clock): Promise<void> {
  expect(clock).toMatchObject({ phase: 'planning', playing: false });
  let after: Clock = clock;
  for (const request of playClockRequests(clock)) after = (await simulatorControl(request)).clock;
  expect(after).toMatchObject({ phase: 'locked', playing: true });
}

/** "Back to start" (RESET_LABEL): `reset_playback`. Answers the clock it left. */
async function pressBackToStart(): Promise<Clock> {
  const after = await simulatorControl(RESET_REQUEST);
  expect(after.clock).toMatchObject({ phase: 'planning', playing: false });
  return after.clock;
}

describe('the demo can be rehearsed twice on a real server (#740)', () => {
  it('the two pages poll at the same interval, so one poll is one step of both', () => {
    expect(BUSINESS_POLL_MS).toBe(EMPLOYEE_POLL_MS);
    expect(api.runtime.status).toBe('ready');
    expect(api.fixturesDir.startsWith(api.root)).toBe(true);
    expect(api.statePath.startsWith(api.root)).toBe(true);
  });

  it('Play locks the Business and Employee pages, Back to start reopens them within one poll, the README request is matched and a commute save succeeds: twice in a row', async () => {
    const biz = mountPage(`/business/${enc(sender.id)}`);
    const emp = mountPage(`/employee/${enc(employee.id)}`);
    await settle(api);
    const start = await getSimulator();
    expect(start.clock).toMatchObject({ phase: 'planning', playing: false });

    /** The deliveries the two rehearsals stored. */
    const stored: ShipmentResponse[] = [];

    for (const round of [1, 2]) {
      const at = (step: string) => `rehearsal ${round}, ${step}`;

      // ----- Planning: both pages are open for changes. The presenter has the form and the editor open. -----
      await onePoll(at('before Play'));
      if (!form(biz)) openNewDeliveryForm(biz);
      click(button(emp, 'Edit commute'));
      await settle(api);
      expectBusinessOpen(biz, at('before Play'));
      expectEditorOpen(emp, at('before Play'));
      const before = {
        sim: await getSimulator(),
        business: await getBusinessDashboard(sender.id),
        employee: await getEmployeeDashboard(employee.id),
        rows: tableRows(biz),
        phase: phaseLabel(biz),
        jobs: jobLists(emp),
      };
      expect(before.sim.clock).toStrictEqual(start.clock); // each rehearsal starts where the first did
      expect(before.rows.map((row) => row.id).sort()).toStrictEqual([...statusById(before.business).keys()].sort());
      expect(before.jobs).toStrictEqual(jobListsOf(before.employee));

      // ----- Play: one poll later the form and the editor are locked. -----
      await pressPlay(before.sim.clock);
      await onePoll(at('after Play'));
      expectBusinessLocked(biz, at('after Play'));
      expectEditorLocked(emp, at('after Play'));
      expect(phaseLabel(biz), at('after Play: the header phase changed')).not.toBe(before.phase);

      // ----- The day runs to its end: still locked, and the pages show the end of the day. -----
      const finished = await simulatorControl({ action: 'finish' });
      expect(finished.clock.phase).toBe('locked');
      expect(finished.clock.timeMin).toBeGreaterThan(before.sim.clock.timeMin);
      await onePoll(at('at the end of the day'));
      expectBusinessLocked(biz, at('at the end of the day'));
      expectEditorLocked(emp, at('at the end of the day'));
      const end = { business: await getBusinessDashboard(sender.id), employee: await getEmployeeDashboard(employee.id) };
      // The same rows in the same order, and a row's status text changed exactly when the server's status
      // of that delivery changed.
      const endRows = tableRows(biz);
      expect(endRows.map((row) => row.id)).toStrictEqual(before.rows.map((row) => row.id));
      const moved = before.rows.filter((row) => statusById(end.business).get(row.id) !== statusById(before.business).get(row.id));
      const shownMoved = before.rows.filter((row, i) => endRows[i].status !== row.status);
      expect(shownMoved.map((row) => row.id), at('the rows whose status changed by the end of the day')).toStrictEqual(moved.map((row) => row.id));
      expect(jobLists(emp), at('the job lists at the end of the day')).toStrictEqual(jobListsOf(end.employee));
      if (round === 2) {
        // The first rehearsal's delivery was carried: so the end of the day is visibly not the start.
        expect(moved.map((row) => row.id)).toContain(stored[0].shipment.id);
      }

      // ----- Back to start: ONE poll later both pages are open again and show the planning state. -----
      expect(await pressBackToStart()).toStrictEqual(before.sim.clock);
      await onePoll(at(`after ${RESET_LABEL}`));
      expectBusinessOpen(biz, at(`after ${RESET_LABEL}`));
      expectEditorOpen(emp, at(`after ${RESET_LABEL}`));
      expect(phaseLabel(biz), at(`after ${RESET_LABEL}: the header phase`)).toBe(before.phase);
      expect(tableRows(biz), at(`after ${RESET_LABEL}: the table`)).toStrictEqual(before.rows);
      expect(jobLists(emp), at(`after ${RESET_LABEL}: the job lists`)).toStrictEqual(before.jobs);

      // ----- Business: "Find a delivery match" with the README's request answers matched. -----
      typeDemoRequest(biz);
      let from = api.log.length;
      click(button(openForm(biz), 'Find a delivery match'));
      await settle(api);
      const post = lastRequest(from, 'POST', '/api/v2/shipments');
      expect(post.status, at('POST /shipments')).toBe(201);
      const created = post.answer as ShipmentResponse;
      stored.push(created);
      // What the form sent is the README's request, built by the form's own model.
      const sent = post.sent as { clientRequestId: string };
      expect(sent).toStrictEqual(demoRequest(sent.clientRequestId));
      expect(created.unmatchedReason, at('the answer')).toBeNull();
      expect(created.matched, at('the answer')).toBe(true);
      expect(created.plan).not.toBeNull();
      const plan = created.plan!;

      // The form shows the arranged delivery, with its ID and every carrier's name.
      const result = openForm(biz).querySelector('.nd-result')!;
      expect(result.querySelector('.nd-arranged'), at('the arranged card')).not.toBeNull();
      expect(textOf(result)).toContain(RESULT_COPY.matched);
      expect(textOf(result)).toContain(created.shipment.id);
      const carriers = plan.legs.map((leg) => employees.find((e) => e.id === leg.employeeId)!.name);
      for (const name of carriers) expect(textOf(result), at('the arranged card')).toContain(name);
      if (round === 1) {
        // On the fresh run the carriers are the ones the README names. Later rehearsals get others (pass 74).
        expect(carriers).toStrictEqual([demo.evening_carrier, demo.morning_carrier]);
        expect(plan.legs.map((leg) => leg.employeeId)).toContain(employee.id);
      }
      expectBusinessOpen(biz, at('after the match'));
      // The table has the new delivery at once (the page refetches after its own request).
      expect(tableRows(biz).map((row) => row.id).sort(), at('the table after the match'))
        .toStrictEqual([...before.rows.map((row) => row.id), created.shipment.id].sort());

      // ----- Employee: one poll later a carrier of the new delivery has the job under Assigned deliveries. -----
      await onePoll(at('after the match'));
      const mine = plan.legs.findIndex((leg) => leg.employeeId === employee.id);
      const expectedJobs = mine < 0 ? before.jobs.assigned : [...before.jobs.assigned, created.jobIds[mine]];
      expect([...jobLists(emp).assigned].sort(), at('the assigned jobs after the match')).toStrictEqual([...expectedJobs].sort());
      expect(jobLists(emp)).toStrictEqual(jobListsOf(await getEmployeeDashboard(employee.id)));
      expectEditorOpen(emp, at('after the match'));

      // ----- Employee: a commute save succeeds (another detour limit; the rest as saved). -----
      const saved = (await getEmployeeDashboard(employee.id)).employee;
      const detour = anotherDetour(saved.maxExtraMin);
      expect(isDisabled(saveButton(emp)), at('Save commute before a change')).toBe(true);
      typeInto(detourInput(emp), String(detour));
      expect(isDisabled(saveButton(emp)), at('Save commute after a change')).toBe(false);
      from = api.log.length;
      click(saveButton(emp));
      await settle(api);
      const put = lastRequest(from, 'PUT', `/api/v2/employees/${enc(employee.id)}/commute`);
      expect(put.status, at('PUT commute')).toBe(200);
      expect(put.sent).toStrictEqual(commuteOf(saved, { maxExtraMin: detour }));
      expect((put.answer as CommuteResponse).employee.maxExtraMin).toBe(detour);
      // The editor closed on the saved commute, with one success note, and Edit commute is ready again.
      expect(editor(emp), at('the editor after the save')).toBeNull();
      expect(emp.querySelectorAll('.ep-success'), at('the saved note')).toHaveLength(1);
      expect(emp.querySelectorAll('.ep-problem'), at('no problem notice after the save')).toHaveLength(0);
      expect(isDisabled(button(emp, 'Edit commute')), at('Edit commute after the save')).toBe(false);
      const after = await getEmployeeDashboard(employee.id);
      expect(after.employee.maxExtraMin).toBe(detour);
      expect(after.phase).toBe('planning');
      expect(jobLists(emp)).toStrictEqual(jobListsOf(after));

      // The run is the same one, in planning at the first minute, with everything it had plus the new delivery.
      const sim = await getSimulator();
      expect(sim.runId).toBe(start.runId);
      expect(sim.clock).toStrictEqual(start.clock);
      expect(sim.shipments.map((s) => s.id)).toStrictEqual([...before.sim.shipments.map((s) => s.id), created.shipment.id]);
    }

    // Two rehearsals, two deliveries with their own IDs, both in the sender's table.
    expect(stored).toHaveLength(2);
    expect(stored[0].shipment.id).not.toBe(stored[1].shipment.id);
    await onePoll('after both rehearsals');
    for (const delivery of stored) expect(tableRows(biz).map((row) => row.id)).toContain(delivery.shipment.id);
    expectBusinessOpen(biz, 'after both rehearsals');
    // No request of the whole test was refused, and none failed.
    expect(api.log.filter((r) => r.status === null || r.status >= 400).map((r) => `${r.method} ${r.path} ${r.status}`)).toStrictEqual([]);
  });
});

// ---------- a click the lock refuses before the page has polled ----------
//
// The rehearsal above lets each page poll once after Play, so the pages learn about the lock from their
// dashboard and the buttons are disabled before anyone can press them. A page is up to one poll behind,
// though: a click on "Find a delivery match" or "Save commute" in that gap is sent and answered 409.
// The first test below plays that through on the same server and writes down what the two forms show one
// poll after Back to start. The two tests after it are the faults it found. They were `it.fails` until #755
// fixed them: #740 changed no product file (`business/v2/` was held by #719, `employee/v2/` by #735).

/** What the two forms showed one poll after Back to start, when a 409 had locked them. */
type AfterRefusal = {
  /** "Find a delivery match" is disabled. */
  formSubmitDisabled: boolean;
  /** The form's alert line. */
  formAlert: string;
  /** How many fields of the commute editor are disabled. */
  editorFieldsDisabled: number;
  /** The problem notice above the editor and the editor's own message, when they have text. */
  editorAlerts: string[];
};
let afterRefusal: AfterRefusal | null = null;
const observed = (): AfterRefusal => {
  if (!afterRefusal) throw new Error('the test above did not get as far as Back to start');
  return afterRefusal;
};

describe('a write the lock refused with 409, then Back to start (#740)', () => {
  it('the 409 locks the form and the editor at once; after Back to start the server takes writes again, and each form works once it is closed and opened again', async () => {
    const biz = mountPage(`/business/${enc(sender.id)}`);
    const emp = mountPage(`/employee/${enc(employee.id)}`);
    await settle(api);
    openNewDeliveryForm(biz);
    click(button(emp, 'Edit commute'));
    await settle(api);
    typeDemoRequest(biz);
    const saved = (await getEmployeeDashboard(employee.id)).employee;
    const detour = anotherDetour(saved.maxExtraMin);
    typeInto(detourInput(emp), String(detour));

    // Play, and no poll yet: both pages still show planning, so both buttons can be pressed.
    await pressPlay((await getSimulator()).clock);
    expectBusinessOpen(biz, 'before the page polled');
    expect(isDisabled(saveButton(emp))).toBe(false);
    const from = api.log.length;
    click(button(openForm(biz), 'Find a delivery match'));
    await settle(api);
    click(saveButton(emp));
    await settle(api);
    expect(lastRequest(from, 'POST', '/api/v2/shipments').status).toBe(409);
    expect(lastRequest(from, 'PUT', `/api/v2/employees/${enc(employee.id)}/commute`).status).toBe(409);
    // The refusal alone locks them: no dashboard request was needed.
    expect(api.sentSince(from).filter((line) => line.endsWith('/dashboard'))).toStrictEqual([]);
    expect(isDisabled(formSubmit(biz))).toBe(true);
    expect(formAlert(biz)).not.toBe('');
    for (const control of [...editorFields(emp), ...editorButtons(emp)]) expect(isDisabled(control), control.id || textOf(control)).toBe(true);
    expect(emp.querySelectorAll('.ep-editor .ep-problem')).toHaveLength(1);

    // The next poll says the same: locked.
    await onePoll('after the 409');
    expectBusinessLocked(biz, 'after the 409 and one poll');
    // Not `expectEditorLocked`: while the page's notice above the editor says the refusal, the form's own
    // message is hidden and has no role (#735, PR #744), so "says why, as an alert" is the notice here.
    for (const control of [...editorFields(emp), ...editorButtons(emp)]) expect(isDisabled(control), control.id || textOf(control)).toBe(true);
    expect(emp.querySelectorAll('.ep-editor .ep-problem')).toHaveLength(1);
    expect(lockedLine(emp)).not.toBeNull();

    // Back to start, one poll: the server is in planning, both dashboards say so and the pages got them.
    await pressBackToStart();
    await onePoll(`after ${RESET_LABEL}`);
    expect((await getBusinessDashboard(sender.id)).phase).toBe('planning');
    expect((await getEmployeeDashboard(employee.id)).phase).toBe('planning');
    expect(newDeliveryButtons(biz).map(isDisabled)).toStrictEqual(newDeliveryButtons(biz).map(() => false));
    expect(lockedLine(emp)).toBeNull();
    afterRefusal = {
      formSubmitDisabled: isDisabled(formSubmit(biz)),
      formAlert: formAlert(biz),
      editorFieldsDisabled: editorFields(emp).filter(isDisabled).length,
      editorAlerts: [
        ...[...emp.querySelectorAll('.ep-editor .ep-problem')].map(textOf),
        editorMessage(emp).text,
      ].filter((text) => text !== ''),
    };

    // The way out that works today: close the form and open it again. What was typed is lost.
    click(button(openForm(biz), 'Cancel'));
    openNewDeliveryForm(biz);
    click(button(emp.querySelector('.ep-editor')!, 'Close'));
    click(button(emp, 'Edit commute'));
    await settle(api);
    expectBusinessOpen(biz, 'the form opened again');
    expectEditorOpen(emp, 'the editor opened again');
    expect(emp.querySelectorAll('.ep-problem')).toHaveLength(0);
    expect((byLabel(openForm(biz), 'Package name') as HTMLInputElement).value).toBe('');

    // And the two writes the lock refused go through now. Whether this third request of the same package
    // still finds a free commute is the story's business, not this test's (DECISIONS pass 54).
    typeDemoRequest(biz);
    const again = api.log.length;
    click(button(openForm(biz), 'Find a delivery match'));
    await settle(api);
    const post = lastRequest(again, 'POST', '/api/v2/shipments');
    expect(post.status).toBe(201);
    expect(textOf(openForm(biz).querySelector('.nd-result')!)).toContain((post.answer as ShipmentResponse).shipment.id);
    typeInto(detourInput(emp), String(detour));
    click(saveButton(emp));
    await settle(api);
    expect(lastRequest(again, 'PUT', `/api/v2/employees/${enc(employee.id)}/commute`).status).toBe(200);
    expect(editor(emp)).toBeNull();
  });

  // Fixed by #755 (Business, client/src/components/business/v2/NewDeliveryForm.tsx with the submit state
  // of newDeliveryModel.ts): `locked = p.phase === 'locked' || p.status.kind === 'locked'`. A 409 sets
  // `status.kind` to 'locked', and nothing cleared it while the form stayed open: the only button that
  // dispatches is the disabled one. So after Back to start the dashboard said planning, the toolbar's New
  // delivery was enabled, and the open form still had "Find a delivery match" disabled under the 409's
  // sentence ("The simulation is playing. Press Back to start ..."), which was no longer true.
  // Now a planning dashboard that arrives after the 409 drops that state (the `dashboard` action).
  it('the New delivery form a 409 locked is open again one poll after Back to start', () => {
    expect(observed().formSubmitDisabled).toBe(false);
    expect(observed().formAlert).toBe('');
  });

  // Fixed by #755 (Employee, client/src/components/employee/v2/CommuteForm.tsx and
  // page/EmployeePageView.tsx): `locked = phase === 'locked' || save.status === 'locked'`. A 409 sets
  // `save.status` to 'locked', and `update()` returns early while locked, so no field could reset it; the
  // page kept its `outcome` of kind 'locked' until the editor was closed. So after Back to start the
  // dashboard said planning, the workspace's locked line was gone, and the open editor still had every
  // field disabled under two sentences that said the run is playing.
  // Now a planning dashboard that arrives after the 409 drops both (the `dashboard` action, `outcomeAfterDashboard`).
  it('the commute editor a 409 locked is open again one poll after Back to start', () => {
    expect(observed().editorFieldsDisabled).toBe(0);
    expect(observed().editorAlerts).toStrictEqual([]);
  });
});
