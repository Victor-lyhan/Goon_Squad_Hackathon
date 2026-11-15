// @vitest-environment jsdom
// #812 (docs/mvp4.md F1): the typed demo sentence, from the Business text box to the carriers' Employee pages.
// PR #804 (#798) proves over HTTP that the sentence is parsed offline and matched as the README says. Here
// the pages a presenter uses do it: the Business page (BusinessV2) of the README's sender and the Employee
// pages (EmployeeV2) of its two carriers run in a real DOM with the real client/src/api, side by side like
// three browser tabs, against the REAL server.
//
// The server is `startServer` of server/index.ts, as `npm start` runs it, on a temp folder: a copy of
// fixtures/nyc (DECISIONS pass 56), an environment with only `PORT=0` and a fresh `RELAY_STATE_PATH`, and no
// `.env` file. So there is no Google key and no Gemini key, and the sentence is parsed offline. The global
// `fetch` is a bridge: the pages' relative `/api/...` URLs reach this server, any other URL is refused and
// recorded, and so is every call of the server's own Google and Gemini clients. All three lists must stay empty.
//
// The pages' poll timers are fake and the requests are real (as in demo-rehearse-twice.test.tsx), so "the
// next poll" is exact: the timers move by one poll interval and each page asks for its dashboard once.
// Nothing presses a simulator control: the run is fresh, so "Back to start" is not needed.
//
// What is expected is read from the README's ```demo-request block (DECISIONS pass 54, 59 and 85) and found
// in the run by name, never by ID. Written here are only the sentence, which has to name the block's
// recipient, and the two fields that are the sentence's own words (PR #804: the delivery is listed as
// "Envelope" with the contents "Espresso blend samples").
// Elements are found by role, label and text, not by CSS class: #807 may change the Business markup.
// No product code is changed here: a fault would be an `it.fails` test below, with the request, the answer
// and the file that is wrong (DECISIONS pass 54 and 56). This run found none.
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { act } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { EmployeeDashboard, ShipmentResponse } from '../../shared/v2/api';
import type { ParseRequestResponse } from '../../shared/v2/parseRequest';
import type { CreateShipmentRequest } from '../../shared/v2/schemas';
import type { Employee, NetworkBusiness, Run } from '../../shared/v2/types';
import {
  getBusinessDashboard, getBusinesses, getEmployeeDashboard, getEmployees, getSimulator,
} from '../../client/src/api/v2';
import { POLL_INTERVAL_MS as BUSINESS_POLL_MS } from '../../client/src/components/business/v2/live/businessPoller';
import { NEEDS_INPUT_HINT, RESULT_COPY, recipientOptions } from '../../client/src/components/business/v2/newDeliveryModel';
import { REQUEST_COPY } from '../../client/src/components/business/v2/requestTextModel';
import { POLL_INTERVAL_MS as EMPLOYEE_POLL_MS } from '../../client/src/components/employee/v2/live/employeePoller';
import BusinessV2 from '../../client/src/pages/v2/BusinessV2';
import EmployeeV2 from '../../client/src/pages/v2/EmployeeV2';
import { formatCents, formatMin } from '../../client/src/ui/format';
import { startServer, type RelayServer } from '../../server/index';
import { NYC_FIXTURES_DIR } from '../../server/api/v2/bootRun';
import { nycFilesState, repoDataState } from '../api/v2-e2e-nyc-helper';
import { T, byName, isDisabled, readmeDemo, useFakePollTimers } from './demo-rehearse-twice-helper';
import { button, buttons, byLabel, click, mount, textOf, typeInto } from './kitDom';

vi.setConfig({ testTimeout: T, hookTimeout: T });

// The pages run with no browser key, so nothing may load from Google (the route previews show their no-key state).
const google = vi.hoisted(() => ({ loads: 0 }));
vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: () => { google.loads += 1; },
  importLibrary: () => { google.loads += 1; return new Promise(() => {}); },
}));

/** The sentence of the demo (PR #804, DECISIONS pass 85), typed on the Business page of the block's sender. */
const SENTENCE = 'Send a 0.5 kg envelope of espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow, ready at 4 p.m.';
/** The sentence's own words for the package name and the contents (PR #804). */
const SENTENCE_LABEL = 'Envelope';
const SENTENCE_CONTENTS = 'Espresso blend samples';

const demo = readmeDemo();
const TYPE_OF: Record<string, 'envelope' | 'small_box'> = { Envelope: 'envelope', 'Small box': 'small_box' };

// ---------- the server (`npm start` on a temp folder) and the browser's fetch ----------

/** One request of the pages (or of the test, through client/src/api). `status` is null while it is open. */
type Logged = { method: string; path: string; sent: unknown; status: number | null; answer: unknown };

type DemoServer = {
  root: string;
  /** The file `RELAY_STATE_PATH` names. */
  statePath: string;
  /** The default state file of the temp folder (`data/state-v2.json` in the app). It must never appear. */
  defaultStatePath: string;
  /** The server's start lines. */
  lines: string[];
  log: Logged[];
  /** What the browser side tried to fetch outside the test server. Must stay empty. */
  outgoing: string[];
  /** What the server's Google and Gemini clients tried to fetch. Must stay empty. */
  serverCalls: string[];
  /** Requests that have no answer yet. */
  open: () => number;
  /** `METHOD /api/...` of every request from `from` on, in the order they were sent. */
  sentSince: (from: number) => string[];
  /** Ctrl-C: the server stops and writes its state file. */
  stop: () => Promise<void>;
  close: () => Promise<void>;
};

/**
 * The address this server answers on. `startServer` listens on every address of a port the system chose, and
 * on this Mac another program was once listening on 127.0.0.1 with the same port number and answered instead.
 * So the loopback address of the server's own family is asked first, and an address counts only when
 * `/api/health` answers there as the app does.
 */
async function ownOrigin(server: RelayServer): Promise<string> {
  const { port, family } = server.address() as AddressInfo;
  const hosts = family === 'IPv6' ? ['[::1]', '127.0.0.1'] : ['127.0.0.1'];
  for (const host of hosts) {
    try {
      const res = await fetch(`http://${host}:${port}/api/health`);
      if (res.ok && ((await res.json()) as { ok?: unknown }).ok === true) return `http://${host}:${port}`;
    } catch {
      // nothing of this server on that address: the next one
    }
  }
  throw new Error(`f1-sentence-to-employee: the server on port ${port} does not answer /api/health on ${hosts.join(' or ')}`);
}

async function startDemoServer(): Promise<DemoServer> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-sentence-to-employee-'));
  const fixturesDir = path.join(root, 'fixtures', 'nyc');
  fs.cpSync(NYC_FIXTURES_DIR, fixturesDir, { recursive: true });
  // A fresh state file per run, named the way a presenter names it; the folder's default file stays unused.
  const statePath = path.join(root, 'run', 'state.json');
  const defaultStatePath = path.join(root, 'data', 'state-v2.json');

  const lines: string[] = [];
  const serverCalls: string[] = [];
  const server: RelayServer = startServer({
    env: { PORT: '0', RELAY_STATE_PATH: statePath }, // no Google key, no Gemini key
    envPath: path.join(root, '.env'),                // not written: the repo's own .env is never read
    log: (line) => void lines.push(line),
    clientDist: path.join(root, 'client', 'dist'),
    fixturesDir,
    statePath: defaultStatePath,
    fetch: async (url) => {
      serverCalls.push(String(url).split('?')[0]);
      throw new Error('f1-sentence-to-employee: the server must not call Google or Gemini');
    },
    exit: () => undefined,
  });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  const origin = await ownOrigin(server);

  const realFetch = globalThis.fetch;
  const log: Logged[] = [];
  const outgoing: string[] = [];
  let open = 0;

  // The bridge of demo-rehearse-twice-helper.ts: the whole answer is read here, so a request counts as open
  // until its body is in, and the readers answer in the same turn (a real `Response` body takes turns of its own).
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? 'GET';
    if (!url.startsWith('/api/')) {
      outgoing.push(`${method} ${url.split('?')[0]}`);
      throw new Error(`f1-sentence-to-employee: unexpected fetch of ${url.split('?')[0]}`);
    }
    const entry: Logged = {
      method, path: url, status: null, answer: undefined,
      sent: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    log.push(entry);
    open += 1;
    try {
      const res = await realFetch(origin + url, init);
      const text = await res.text();
      entry.status = res.status;
      try { entry.answer = JSON.parse(text); } catch { /* not JSON: the status says enough */ }
      const { status } = res;
      return {
        ok: res.ok,
        status,
        headers: res.headers,
        text: async () => text,
        json: async () => JSON.parse(text) as unknown,
        arrayBuffer: async () => new TextEncoder().encode(text).buffer,
      } as unknown as Response;
    } finally {
      open -= 1;
    }
  });

  return {
    root, statePath, defaultStatePath, lines, log, outgoing, serverCalls,
    open: () => open,
    sentSince: (from) => log.slice(from).map((r) => `${r.method} ${r.path}`),
    stop: () => server.stop(),
    close: async () => {
      vi.unstubAllGlobals();
      await server.stop();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

// ---------- time (as demo-rehearse-twice-helper.ts, for this file's server) ----------

const QUIET_TURNS = 5;
const MAX_TURNS = 20_000;

/** Waits until no request is open and React has rendered the answers. The pages' clock does not move (0 ms timers run). */
async function settle(): Promise<void> {
  let quiet = 0;
  for (let turn = 0; quiet < QUIET_TURNS; turn++) {
    if (turn >= MAX_TURNS) throw new Error(`settle(): ${api.open()} request(s) still open after ${MAX_TURNS} turns`);
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
      vi.advanceTimersByTime(0);
    });
    quiet = api.open() === 0 ? quiet + 1 : 0;
  }
}

/** One poll of every mounted page: the timers move by one interval. Answers the dashboard requests it caused. */
async function onePoll(): Promise<string[]> {
  await settle();
  const from = api.log.length;
  await act(async () => { vi.advanceTimersByTime(EMPLOYEE_POLL_MS); });
  await settle();
  return api.sentSince(from).filter((line) => line.endsWith('/dashboard')).sort();
}

// ---------- the run ----------

let api: DemoServer;
let nycBefore: string[];
let dataBefore: string[] | null;
let businesses: NetworkBusiness[];
let employees: Employee[];
let sender: NetworkBusiness;
let recipient: NetworkBusiness;
let relayPoint: NetworkBusiness;
let eveningCarrier: Employee;
let morningCarrier: Employee;

beforeAll(async () => {
  nycBefore = nycFilesState();
  dataBefore = repoDataState();
  api = await startDemoServer();
  businesses = (await getBusinesses()).businesses;
  employees = (await getEmployees()).employees;
  sender = byName(businesses, demo.sender, 'sender');
  recipient = byName(businesses, demo.recipient, 'recipient');
  relayPoint = byName(businesses, demo.relay_point, 'relay point');
  eveningCarrier = byName(employees, demo.evening_carrier, 'evening carrier');
  morningCarrier = byName(employees, demo.morning_carrier, 'morning carrier');
});
afterAll(async () => {
  await api?.close();
  // Nothing was written to the committed fixtures/nyc or to the repo's data/ (DECISIONS pass 56).
  expect(nycFilesState()).toStrictEqual(nycBefore);
  expect(repoDataState()).toStrictEqual(dataBefore);
});
beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
  google.loads = 0;
  useFakePollTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  // No outgoing fetch, from the pages or from the server: any one fails the test.
  expect(google.loads).toBe(0);
  expect(api.outgoing).toStrictEqual([]);
  expect(api.serverCalls).toStrictEqual([]);
});

// ---------- the pages ----------

function mountPage(url: string): HTMLElement {
  return mount(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/business/:id" element={<BusinessV2 />} />
        <Route path="/employee/:id" element={<EmployeeV2 />} />
      </Routes>
    </MemoryRouter>,
  ).container;
}

const enc = encodeURIComponent;
const dashboardOf = (kind: 'businesses' | 'employees', id: string) => `GET /api/v2/${kind}/${enc(id)}/dashboard`;

/** The requests with this method and path sent at or after `from`. */
const requests = (from: number, method: string, urlPath: string) =>
  api.log.slice(from).filter((r) => r.method === method && r.path === urlPath);

/** The one element under `root` with this role (explicit, or the tag's own) and this accessible name. */
function byRole(root: ParentNode, role: 'region' | 'form' | 'list' | 'complementary', name: string): HTMLElement {
  const tags = { region: 'section', form: 'form', list: 'ol, ul', complementary: 'aside' }[role];
  const nameOf = (el: Element) => {
    const label = el.getAttribute('aria-label');
    if (label !== null) return label.trim();
    // Looked up under `root`, not in the document: two Employee pages on one document share their IDs.
    const by = el.getAttribute('aria-labelledby');
    const heading = by ? root.querySelector(`[id="${by}"]`) : null;
    return heading ? textOf(heading) : null;
  };
  const found = [...root.querySelectorAll<HTMLElement>(`[role="${role}"], ${tags}`)].filter((el) => nameOf(el) === name);
  if (found.length !== 1) throw new Error(`byRole(): ${found.length} ${role} elements named "${name}"`);
  return found[0];
}

/** The `<dt>: <dd>` pairs under `root`, as text. */
const terms = (root: ParentNode) => new Map([...root.querySelectorAll('dt')].map((dt) => [textOf(dt), textOf(dt.nextElementSibling!)]));

/** The text of the option a select shows. */
const chosen = (el: Element) => textOf((el as HTMLSelectElement).selectedOptions[0]);
const valueOf = (el: Element) => (el as HTMLInputElement).value;

// ----- Business -----

/** The New delivery form: the confirmation card's fields and its "Find a delivery match" (DECISIONS pass 81). */
const deliveryForm = (c: ParentNode): HTMLFormElement => {
  const form = button(c, 'Find a delivery match').closest('form');
  if (!form) throw new Error('"Find a delivery match" is not in a form');
  return form;
};
/** Every alert of the form that says something. */
const alerts = (root: ParentNode) => [...root.querySelectorAll('[role="alert"]')].map(textOf).filter((text) => text !== '');
/** The rows of the deliveries table, as text. */
const tableRows = (c: ParentNode) => [...byRole(c, 'region', 'Deliveries').querySelectorAll('tbody tr')].map(textOf);

// ----- Employee -----

/** The rows under "Assigned deliveries" and "Completed deliveries" of an Employee page. */
const jobRows = (c: ParentNode, heading: string) => [...byRole(c, 'region', heading).querySelectorAll<HTMLElement>('[data-job-id]')];
const jobIds = (c: ParentNode) => ({
  assigned: jobRows(c, 'Assigned deliveries').map((row) => row.dataset.jobId),
  completed: jobRows(c, 'Completed deliveries').map((row) => row.dataset.jobId),
});
/** The same two lists as the server answers them. */
const jobIdsOf = (dash: EmployeeDashboard) => ({
  assigned: dash.assigned.map((view) => view.job.id),
  completed: dash.completed.map((view) => view.job.id),
});

describe('F1: the typed demo sentence, from the Business text box to the carriers\' Employee pages (#812)', () => {
  it('the server is `npm start` with a fresh RELAY_STATE_PATH and no key, and the sentence is the README block\'s', () => {
    expect(api.lines).toContain(`State file: ${api.statePath} (RELAY_STATE_PATH)`);
    expect(api.lines.join('\n')).toContain('/api/v2');
    expect(api.lines.join('\n')).not.toMatch(/not loaded/);
    expect(api.statePath.startsWith(api.root)).toBe(true);
    // The pages poll at the same interval, so one poll is one step of all three.
    expect(BUSINESS_POLL_MS).toBe(EMPLOYEE_POLL_MS);
    // The sentence names the recipient and says the type, the weight and the two times of the block.
    expect(SENTENCE).toContain(`to ${demo.recipient} `);
    expect(SENTENCE).toContain(`${demo.weight_kg} kg ${demo.type.toLowerCase()} `);
    expect(demo.ready).toBe('Day 1, 4:00 PM');       // "ready at 4 p.m."
    expect(demo.deliver_by).toBe('Day 2, 10:00 AM'); // "by 10 a.m. tomorrow"
    expect(eveningCarrier.id).not.toBe(morningCarrier.id);
    expect(new Set([sender.id, relayPoint.id, recipient.id]).size).toBe(3);
  });

  it('typed as the sender: "Read by Relay’s rules" with no field to fill, Find a delivery match shows the README\'s relay, and one poll later each carrier\'s page lists its own leg', async () => {
    // Three tabs. The Business page is first in the document, so its labels find its own fields.
    const biz = mountPage(`/business/${enc(sender.id)}`);
    const evening = mountPage(`/employee/${enc(eveningCarrier.id)}`);
    const morning = mountPage(`/employee/${enc(morningCarrier.id)}`);
    const carriers = [
      { name: demo.evening_carrier, employee: eveningCarrier, page: evening, day: 'Day 1' },
      { name: demo.morning_carrier, employee: morningCarrier, page: morning, day: 'Day 2' },
    ];
    await settle();

    // ----- Before: a fresh run in planning; each page shows what the server has. -----
    const start = await getSimulator();
    expect(start.clock).toMatchObject({ phase: 'planning', playing: false });
    const before = {
      rows: tableRows(biz),
      dashboards: [await getEmployeeDashboard(eveningCarrier.id), await getEmployeeDashboard(morningCarrier.id)],
    };
    carriers.forEach(({ name, page }, i) => {
      expect(textOf(page.querySelector('h1')!), `${name}'s page`).toBe(name);
      expect(jobIds(page), `${name}'s jobs before`).toStrictEqual(jobIdsOf(before.dashboards[i]));
    });

    // ----- Business: New delivery opens on the text box, with nothing sent. -----
    let from = api.log.length;
    click(buttons(biz, 'New delivery')[0]);
    const box = byLabel(biz, REQUEST_COPY.label);
    expect(box.tagName).toBe('TEXTAREA');
    typeInto(box, SENTENCE);
    expect(api.sentSince(from)).toStrictEqual([]);

    // ----- "Read my request": one POST /parse-request, answered by the offline parser. -----
    click(button(biz, REQUEST_COPY.read));
    await settle();
    const parses = requests(from, 'POST', '/api/v2/parse-request');
    expect(parses).toHaveLength(1);
    expect(parses[0].sent).toStrictEqual({ text: SENTENCE });
    expect(parses[0].status).toBe(200);
    const parsed = parses[0].answer as ParseRequestResponse;
    expect(parsed.source).toBe('offline');
    expect(parsed.rejected).toBeNull();
    expect(parsed.missing).toStrictEqual(['originBusinessId']); // the sender: the signed-in business (pass 81)
    expect(requests(from, 'POST', '/api/v2/shipments'), 'nothing is sent before Find a delivery match').toStrictEqual([]);

    // ----- The card: "Read by Relay’s rules", the sentence, and the form with every field filled. -----
    const card = byRole(biz, 'region', 'Your request');
    expect(textOf(card)).toContain('Read by Relay’s rules');
    expect(textOf(card)).not.toContain(REQUEST_COPY.parsedByModel);
    expect(textOf(card)).toContain(SENTENCE);
    expect(textOf(card), 'no sender note: the sentence names no other sender').not.toContain('signed in as');
    const form = deliveryForm(biz);
    expect(form).toBe(byRole(biz, 'form', 'New delivery'));
    expect(textOf(form)).toContain(`From ${demo.sender}`);
    // No field to fill: no "Check this" hint, no invalid field, no alert, and the button is ready.
    expect(textOf(form)).not.toContain(NEEDS_INPUT_HINT);
    expect(textOf(form)).not.toMatch(/check this/i);
    expect(form.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
    expect(alerts(biz)).toStrictEqual([]);
    expect(isDisabled(button(form, 'Find a delivery match'))).toBe(false);
    // The fields hold the block's package. Option values are positions, so the recipient is read by its text.
    const recipientLabel = recipientOptions(businesses, sender.id).find((o) => o.id === recipient.id)!.label;
    expect(recipientLabel.startsWith(demo.recipient)).toBe(true);
    expect(chosen(byLabel(form, 'Recipient'))).toBe(recipientLabel);
    expect(valueOf(byLabel(form, 'Package name'))).toBe(SENTENCE_LABEL);
    expect(chosen(byLabel(form, 'Type'))).toBe(demo.type);
    expect(valueOf(byLabel(form, 'Weight (kg)'))).toBe(demo.weight_kg);
    expect(valueOf(byLabel(form, 'Contents'))).toBe(SENTENCE_CONTENTS);
    // README: "Ready for pickup (Day 1)" 16:00, "Deliver by: day" Day 2 and "Deliver by: time" 10:00.
    expect(valueOf(byLabel(form, 'Ready for pickup (Day 1)'))).toBe('16:00');
    expect(chosen(byLabel(form, 'Deliver by: day'))).toBe('Day 2');
    expect(valueOf(byLabel(form, 'Deliver by: time'))).toBe('10:00');

    // ----- "Find a delivery match": one POST /shipments with the card's fields, answered matched. -----
    from = api.log.length;
    click(button(form, 'Find a delivery match'));
    await settle();
    const posts = requests(from, 'POST', '/api/v2/shipments');
    expect(posts).toHaveLength(1);
    const sent = posts[0].sent as CreateShipmentRequest;
    expect(sent).toMatchObject({
      originBusinessId: sender.id, destinationBusinessId: recipient.id, label: SENTENCE_LABEL,
      description: SENTENCE_CONTENTS, category: TYPE_OF[demo.type], weightKg: Number(demo.weight_kg),
    });
    expect(formatMin(sent.readyMin)).toBe(demo.ready);
    expect(formatMin(sent.deadlineMin)).toBe(demo.deliver_by);
    expect(posts[0].status).toBe(201);
    const created = posts[0].answer as ShipmentResponse;
    expect(created.unmatchedReason).toBeNull();
    expect(created.matched).toBe(true);
    const plan = created.plan!;
    expect(plan.kind).toBe('relay');
    expect(plan.relayBusinessId).toBe(relayPoint.id);
    expect(plan.legs.map((leg) => leg.employeeId)).toStrictEqual([eveningCarrier.id, morningCarrier.id]);
    expect(created.jobIds).toHaveLength(2);

    // ----- The page shows the matched result: Relay via the block's relay point, at the block's price. -----
    const result = [...deliveryForm(biz).querySelectorAll('[role="status"]')].find((el) => textOf(el) !== '')!;
    expect(textOf(result)).toContain(RESULT_COPY.matched);
    expect(textOf(result)).toContain(created.shipment.id);
    const facts = terms(result);
    expect(facts.get('Plan')).toBe('Relay');
    expect(facts.get('Relay point')).toBe(demo.relay_point);
    expect(facts.get('Price')).toBe(demo.price);
    expect(formatCents(plan.customerPriceCents)).toBe(demo.price);
    // The two carriers in the order of the legs, each with the stops of its own leg.
    const cardCarriers = [...byRole(result, 'list', 'Carriers').children].map(textOf);
    expect(cardCarriers).toHaveLength(2);
    expect(cardCarriers[0]).toContain(demo.evening_carrier);
    expect(cardCarriers[0]).toContain(demo.sender);
    expect(cardCarriers[0]).toContain(demo.relay_point);
    expect(cardCarriers[0]).not.toContain(demo.recipient);
    expect(cardCarriers[1]).toContain(demo.morning_carrier);
    expect(cardCarriers[1]).toContain(demo.relay_point);
    expect(cardCarriers[1]).toContain(demo.recipient);
    expect(cardCarriers[1]).not.toContain(demo.sender);
    expect(alerts(biz)).toStrictEqual([]);
    // The table has the new delivery at once (the page refetches after its own request), under the sentence's name.
    const newRows = tableRows(biz).filter((row) => row.includes(created.shipment.id));
    expect(newRows).toHaveLength(1);
    expect(newRows[0]).toContain(SENTENCE_LABEL);
    expect(newRows[0]).toContain(demo.recipient);
    expect(tableRows(biz)).toHaveLength(before.rows.length + 1);

    // "View delivery" (README step 3): the details say the plan and the price in the README's words.
    click(button(result, 'View delivery'));
    await settle();
    const details = byRole(biz, 'complementary', 'Delivery details and notifications');
    const detailFacts = terms(details);
    expect(detailFacts.get('Plan')).toBe(`Relay via ${demo.relay_point} (relay point)`);
    expect(detailFacts.get('Price')).toBe(demo.price);
    expect(detailFacts.get('Category')).toBe(demo.type);
    expect(detailFacts.get('Weight')).toBe(`${demo.weight_kg} kg`);
    expect(detailFacts.get('Ready')).toBe(demo.ready);
    expect(detailFacts.get('Deadline')).toBe(demo.deliver_by);
    expect(detailFacts.get('Contents')).toBe(SENTENCE_CONTENTS);
    expect(textOf(details)).toContain(demo.evening_carrier);
    expect(textOf(details)).toContain(demo.morning_carrier);

    // ----- Employee: the two pages have not polled yet, so they still show the lists of before. -----
    carriers.forEach(({ name, page }, i) => {
      expect(jobIds(page), `${name}'s jobs before the poll`).toStrictEqual(jobIdsOf(before.dashboards[i]));
    });

    // ----- The next poll: one dashboard request per page, and each carrier has one new job. -----
    expect(await onePoll()).toStrictEqual([
      dashboardOf('businesses', sender.id), dashboardOf('employees', eveningCarrier.id), dashboardOf('employees', morningCarrier.id),
    ].sort());
    const sim = await getSimulator();
    const legPlaces = [[sender, relayPoint], [relayPoint, recipient]];
    for (const [i, { name, employee, page, day }] of carriers.entries()) {
      const what = `${name}'s page after the poll`;
      const dash = await getEmployeeDashboard(employee.id);
      const jobId = created.jobIds[i];
      // One job more than before, under Assigned deliveries: the job of this carrier's leg.
      expect(jobIds(page), what).toStrictEqual(jobIdsOf(dash));
      expect(jobIds(page).assigned.filter((id) => !before.dashboards[i].assigned.some((view) => view.job.id === id)), what)
        .toStrictEqual([jobId]);
      expect(jobIds(page).completed, what).toStrictEqual(jobIdsOf(before.dashboards[i]).completed);
      const job = sim.jobs.find((j) => j.id === jobId)!;
      expect(job).toMatchObject({ shipmentId: created.shipment.id, employeeId: employee.id, legIndex: i });
      expect(job.pickup.placeId).toBe(legPlaces[i][0].id);
      expect(job.dropoff.placeId).toBe(legPlaces[i][1].id);

      // The row: the package, "New", the leg, its two stops with the day they happen on, and the pay.
      const row = jobRows(page, 'Assigned deliveries').find((r) => r.dataset.jobId === jobId)!;
      expect(textOf(row), what).toContain(SENTENCE_LABEL);
      expect(textOf(row), what).toContain('New');
      expect(textOf(row), what).toContain('Assigned');
      // #916: who carries it where, by the relay point's name; the first carrier takes it there, the second from there.
      expect(textOf(row), what).toContain(`Relay: you take it ${i === 0 ? 'to' : 'from'} ${relayPoint.name}`);
      const stops = terms(row);
      const place = (b: NetworkBusiness) => (b.id === relayPoint.id ? `Relay point: ${b.name}` : b.name);
      expect(stops.get('Pickup'), what).toBe(`${formatMin(job.pickup.serviceStartMin)} · ${place(legPlaces[i][0])}`);
      expect(stops.get('Drop-off'), what).toBe(`${formatMin(job.dropoff.serviceStartMin)} · ${place(legPlaces[i][1])}`);
      // The evening leg is on Day 1 and the morning leg on Day 2: the package waits at the relay point overnight.
      expect(stops.get('Pickup')!.startsWith(`${day}, `), what).toBe(true);
      expect(stops.get('Drop-off')!.startsWith(`${day}, `), what).toBe(true);
      // The pay is the leg's reward as the server planned it, and Projected rose by exactly that much.
      expect(job.rewardCents).toBeGreaterThan(0);
      expect(job.rewardCents).toBe(plan.legs[i].rewardCents);
      expect(stops.get('Reward'), what).toBe(formatCents(job.rewardCents));
      expect(dash.projectedCents - before.dashboards[i].projectedCents).toBe(job.rewardCents);
      const money = terms(byRole(page, 'region', 'Earnings'));
      expect(money.get('Projected'), what).toBe(formatCents(dash.projectedCents));
      expect(money.get('Earned'), what).toBe(formatCents(before.dashboards[i].earnedCents));
      // The page says the new job once, for a screen reader, in the server's sentence.
      const told = dash.notifications.filter((n) => n.kind === 'job_assigned' && n.jobId === jobId);
      expect(told).toHaveLength(1);
      expect([...page.querySelectorAll('[role="status"]')].map(textOf).filter((text) => text.includes(told[0].message)), what).toHaveLength(1);
    }

    // ----- No other carrier got a job for it. -----
    const jobsOfDelivery = sim.jobs.filter((job) => job.shipmentId === created.shipment.id);
    expect(jobsOfDelivery.map((job) => job.id)).toStrictEqual(created.jobIds);
    expect(jobsOfDelivery.map((job) => job.employeeId)).toStrictEqual([eveningCarrier.id, morningCarrier.id]);
    const others = employees.filter((e) => e.id !== eveningCarrier.id && e.id !== morningCarrier.id);
    expect(others.length).toBe(employees.length - 2);
    const withJob: string[] = [];
    for (const other of others) {
      const dash = await getEmployeeDashboard(other.id);
      const mine = [...dash.assigned, ...dash.completed].some((view) => view.shipment.id === created.shipment.id);
      const told = dash.notifications.some((n) => created.jobIds.includes(n.jobId ?? ''));
      if (mine || told) withJob.push(other.name);
    }
    expect(withJob, 'other employees with a job or a notification for the delivery').toStrictEqual([]);

    // ----- The whole path: no simulator control (no Back to start), the same run in planning, nothing refused. -----
    expect(api.log.filter((r) => r.path.includes('/simulator/control') || r.path.includes('/planning/')).map((r) => r.path)).toStrictEqual([]);
    expect(sim.runId).toBe(start.runId);
    expect(sim.clock).toStrictEqual(start.clock);
    expect(sim.shipments.map((s) => s.id)).toStrictEqual([...start.shipments.map((s) => s.id), created.shipment.id]);
    expect((await getBusinessDashboard(sender.id)).outgoing.map((view) => view.shipment.id)).toContain(created.shipment.id);
    expect(api.log.filter((r) => r.status === null || r.status >= 400).map((r) => `${r.method} ${r.path} ${r.status}`)).toStrictEqual([]);
  });

  it('after Ctrl-C the delivery is in the RELAY_STATE_PATH file, and the folder\'s default state file was never written', async () => {
    const sim = await getSimulator();
    const mine = sim.shipments.filter((s) => s.originBusinessId === sender.id && s.label === SENTENCE_LABEL && s.description === SENTENCE_CONTENTS);
    expect(mine).toHaveLength(1);

    await api.stop();

    const saved = (JSON.parse(fs.readFileSync(api.statePath, 'utf8')) as { run: Run }).run;
    expect(saved.runId).toBe(sim.runId);
    expect(saved.scenario.shipments.map((s) => s.id)).toContain(mine[0].id);
    expect(fs.existsSync(api.defaultStatePath)).toBe(false);
  });
});
