// #923: the demo survives the server being restarted mid-demo, twice.
// The server is the app's own entry (`startServer` of server/index.ts, what `npm start` runs: the real
// ticker and the real `stop()` of Ctrl-C), on one temp state file, booted each time from one temp copy of
// the committed `fixtures/nyc` (DECISIONS pass 56), with no key and no `.env`.
//
// What the first server does is the README's 2-minute demo up to the middle of the evening commute:
// the ```demo-request block is sent the way the New delivery form sends it and matches as a relay; the
// clock is then moved with `seek`, which is all the simulator's Play sends (journeyPlay.ts, DECISIONS
// pass 46 and 84), until the evening carrier's Employee page ticks "left" and the pickup. Then:
//   restart 1: stop, start on the same file. Every answer the three pages poll is the same as before
//              the stop: the delivery, its match, the jobs and their ticks, the clock's minute; paused.
//   restart 2: stop and start again with nothing done in between. Nothing changes.
//   one more:  the server clock itself is playing (POST control `play`, moved by the real ticker) when
//              the server stops. It comes back paused at the minute the stop saved, and stays there.
// After the three starts the demo goes on to "delivered" and both carriers are paid.
//
// The one thing a clean stop changes is the run's `version`: the stop pauses and saves once more
// (DECISIONS pass 13), which is one more version. The pages only use it to tell "something changed".
// Names and the price are read from the README block, never written here (DECISIONS pass 54).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyDraft, toRequest, validate } from '../../client/src/components/business/v2/newDeliveryModel';
import { formatCents } from '../../client/src/ui/format';
import { startServer, type RelayServer } from '../../server/index';
import { DEFAULT_V2_STATE_PATH } from '../../server/api/v2/bootRun';
import type {
  BusinessDashboard, BusinessesResponse, EmployeeDashboard, EmployeeJobView, EmployeesResponse, ExportFile,
  JobResponse, ShipmentResponse, SimulatorResponse,
} from '../../shared/v2/api';
import type { DeliveryPlan, Employee, NetworkBusiness, Run as RunV2 } from '../../shared/v2/types';
import { ownOrigin } from './own-origin-helper';
import { copyNycFixtures, DAY_2_MIN, nycFilesState, REPO_ROOT } from './v2-e2e-nyc-helper';

/** Timeout of every test and hook (DECISIONS pass 19): each boots the real NYC run or waits for the real ticker. */
const T = 60_000;

// ---------- the README's demo delivery ----------

const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
const block = /```demo-request\n([\s\S]*?)```/.exec(readme)?.[1];
if (!block) throw new Error('README.md has no ```demo-request block');
/** The block's lines as `key: value`. The keys are checked by v2-readme-demo.test.ts. */
const demo: Record<string, string> = Object.fromEntries(
  block.trim().split('\n').map((line) => {
    const colon = line.indexOf(':');
    return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  }),
);
const TYPE_OF: Record<string, 'envelope' | 'small_box'> = { Envelope: 'envelope', 'Small box': 'small_box' };

// ---------- the server: `npm start`, one start after the other on one state file ----------

const SHELL = '<!doctype html><html><head><title>Relay</title></head><body><div id="root">relay-shell</div></body></html>';
const SIDECAR = 'state-v2.source.json';

let root = '';
let fixturesDir = '';
let stateDir = '';
let statePath = '';
let dist = '';
/** Every call a server made to its `fetch` (Google). Must stay empty: there is no key. */
const outgoing: string[] = [];
/** Every `console.warn` / `console.error` line while a server of this file ran. Must stay empty. */
const complaints: string[] = [];
let restoreConsole = () => {};

type Started = { server: RelayServer; origin: string; lines: string[] };
/** The server that is running now, or null between a stop and the next start. */
let now: Started | null = null;
/** How many servers this file has started. */
let starts = 0;

async function start(): Promise<Started> {
  if (now) throw new Error('demo-restart-twice: stop the running server first');
  const lines: string[] = [];
  const server = startServer({
    env: { PORT: '0' }, // no key of any kind; the state file is the `statePath` below
    envPath: path.join(root, '.env'), // not there
    log: (line) => void lines.push(line),
    clientDist: dist,
    fixturesDir,
    statePath,
    fetch: async (url) => {
      outgoing.push(url.split('?')[0]);
      throw new Error('demo-restart-twice: the server must not reach the network');
    },
    exit: () => undefined,
  });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  starts += 1;
  now = { server, origin: await ownOrigin(server), lines };
  return now;
}

/** As Ctrl-C does: close, stop the ticker, pause, save. After it the server listens nowhere. */
async function stop(): Promise<void> {
  if (!now) return;
  const { server } = now;
  now = null;
  await server.stop();
  // Really down, which is what the open pages meet. (Not checked with a request to the old port: the
  // system may give that port to another test's server at once.)
  expect(server.listening).toBe(false);
}

type Answer<B> = { status: number; body: B };

async function call<B>(method: string, url: string, body?: unknown): Promise<Answer<B>> {
  if (!now) throw new Error(`demo-restart-twice: ${method} ${url} with no server running`);
  const res = await fetch(`${now.origin}${url}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as B };
}

/** A GET of /api/v2 that must answer 200. */
async function ok<B>(url: string): Promise<B> {
  const res = await call<B>('GET', `/api/v2${url}`);
  expect(`${url} ${res.status}`).toBe(`${url} 200`);
  return res.body;
}

/** POST /api/v2/simulator/control, which must answer 200. */
async function control(body: { action: string; timeMin?: number; speed?: number }): Promise<SimulatorResponse> {
  const res = await call<SimulatorResponse>('POST', '/api/v2/simulator/control', body);
  expect(`${body.action} ${res.status}`).toBe(`${body.action} 200`);
  return res.body;
}

/** The run in the state file. */
const savedRun = () => JSON.parse(fs.readFileSync(statePath, 'utf8')).run as RunV2;
const stateFiles = () => fs.readdirSync(stateDir).sort();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const repoDataDir = path.dirname(DEFAULT_V2_STATE_PATH);
const repoDataNames = () => (fs.existsSync(repoDataDir) ? fs.readdirSync(repoDataDir).sort() : null);
let repoDataBefore: string[] | null = null;
let nycBefore: string[] = [];

beforeAll(() => {
  repoDataBefore = repoDataNames();
  nycBefore = nycFilesState();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-restart-twice-'));
  fixturesDir = copyNycFixtures();
  stateDir = path.join(root, 'data');
  statePath = path.join(stateDir, 'state-v2.json');
  dist = path.join(root, 'client', 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), SHELL);

  const { warn, error } = console;
  console.warn = (...args: unknown[]) => void complaints.push(`warn: ${args.map(String).join(' ')}`);
  console.error = (...args: unknown[]) => void complaints.push(`error: ${args.map(String).join(' ')}`);
  restoreConsole = () => Object.assign(console, { warn, error });
}, T);

afterAll(async () => {
  try {
    await stop();
  } finally {
    restoreConsole();
    if (root) fs.rmSync(root, { recursive: true, force: true });
    if (fixturesDir) fs.rmSync(fixturesDir, { recursive: true, force: true });
  }
}, T);

// ---------- what the open pages poll ----------

let sender: NetworkBusiness;
let recipient: NetworkBusiness;
let relayPoint: NetworkBusiness;
let eveningCarrier: Employee;
let morningCarrier: Employee;
/** The demo delivery, as the first server answered the request. */
let created: ShipmentResponse;
const plan = () => created.plan as DeliveryPlan;

/** The one entry with this name. A name the run does not have, or has twice, fails. */
function byName<V extends { name: string }>(list: V[], name: string, what: string): V {
  const found = list.filter((entry) => entry.name === name);
  if (found.length !== 1) throw new Error(`README names the ${what} "${name}", and the default run has ${found.length} of them`);
  return found[0];
}

/**
 * Every answer the open tabs of the demo keep polling: the simulator (which the app header polls on every
 * page too), the sender's and the recipient's Business page, both carriers' Employee pages with their job
 * views, and the delivery's own details.
 */
async function pagesSee() {
  return {
    simulator: await ok<SimulatorResponse>('/simulator'),
    delivery: await ok<ShipmentResponse>(`/shipments/${created.shipment.id}`),
    sender: await ok<BusinessDashboard>(`/businesses/${sender.id}/dashboard`),
    recipient: await ok<BusinessDashboard>(`/businesses/${recipient.id}/dashboard`),
    evening: await ok<EmployeeDashboard>(`/employees/${eveningCarrier.id}/dashboard`),
    morning: await ok<EmployeeDashboard>(`/employees/${morningCarrier.id}/dashboard`),
    eveningJob: await ok<JobResponse>(`/jobs/${created.jobIds[0]}`),
    morningJob: await ok<JobResponse>(`/jobs/${created.jobIds[1]}`),
  };
}
type PagesSee = Awaited<ReturnType<typeof pagesSee>>;

/**
 * The run's version counter in the answers the pages read: each answer's own `version` and its `snapshot.version`
 * (the simulator answer has both). Only these two places are rewritten by `atVersion`, so a `version` field that
 * some nested object gets one day is compared as it is and a real change in it is not hidden.
 */
const isVersionCounter = (path: string[]) =>
  path.length >= 2 && path[path.length - 1] === 'version' && (path.length === 2 || (path.length === 3 && path[1] === 'snapshot'));

/** The same answers with the run's version counter set to `version`: the one thing a clean stop changes. */
function atVersion(seen: PagesSee, version: number): PagesSee {
  const set = <V>(value: V, path: string[]): V => {
    if (Array.isArray(value)) return value.map((item, i) => set(item, [...path, String(i)])) as V;
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(Object.entries(value).map(([key, v]) =>
      [key, isVersionCounter([...path, key]) ? version : set(v, [...path, key])])) as V;
  };
  return set(seen, []);
}

/** The row of a job on its carrier's Employee page (assigned, or completed once its last stop is handled). */
function rowOf(dash: EmployeeDashboard, jobId: string): EmployeeJobView {
  const rows = [...dash.assigned, ...dash.completed].filter((view) => view.job.id === jobId);
  expect(rows, `one row for ${jobId} on the page of ${dash.employee.name}`).toHaveLength(1);
  return rows[0];
}

/** The ticks of a job's row: left, stops handled, arrived. */
const ticksOf = (view: EmployeeJobView) => ({ departed: view.departed, stopsDone: view.stopsDone, arrived: view.arrived, status: view.status });

/** What the pages saw just before the last stop, the whole run then, and the minute the demo is at. */
let before: PagesSee;
let runBefore: RunV2;
let demoMin = 0;

/** Checks of every start on the existing file: loaded, the file used as it is, the shell and health answer. */
async function expectCleanStart(started: Started): Promise<void> {
  expect(started.lines).toContain('Relay MVP II API ready at /api/v2 (NYC travel cache loaded)');
  // The saved run was neither renamed as unusable nor set aside as stale: only the state file and its sidecar.
  expect(stateFiles()).toStrictEqual(['state-v2.json', SIDECAR]);
  expect(started.lines.filter((line) => /stale|set aside|\.bad-/.test(line))).toStrictEqual([]);
  expect((await call<{ ok: boolean }>('GET', '/api/health')).body).toStrictEqual({ ok: true });
  // A page that is reloaded after all gets the app again, on any of the demo's paths.
  for (const page of ['/', `/business/${sender.id}`, `/employee/${eveningCarrier.id}`, `/simulator?package=${created.shipment.id}`]) {
    const res = await fetch(`${started.origin}${page}`);
    expect([page, res.status, await res.text()]).toStrictEqual([page, 200, SHELL]);
  }
}

describe('the README demo, with the server restarted mid-demo (npm start, one state file, no key)', () => {
  it('first server: the demo delivery is sent and matched as the README says', async () => {
    const first = await start();
    expect(first.lines).toContain('Relay MVP II API ready at /api/v2 (NYC travel cache loaded)');
    expect(fs.existsSync(statePath)).toBe(false); // a fresh run: nothing was saved yet

    const { businesses } = await ok<BusinessesResponse>('/businesses');
    const { employees } = await ok<EmployeesResponse>('/employees');
    sender = byName(businesses, demo.sender, 'sender');
    recipient = byName(businesses, demo.recipient, 'recipient');
    relayPoint = byName(businesses, demo.relay_point, 'relay point');
    eveningCarrier = byName(employees, demo.evening_carrier, 'evening carrier');
    morningCarrier = byName(employees, demo.morning_carrier, 'morning carrier');

    // The request of the New delivery form with the block typed in (v2-readme-demo.test.ts proves the sentence
    // of the text box makes the same one).
    const draft = {
      ...emptyDraft(), recipientId: recipient.id, label: demo.package, category: TYPE_OF[demo.type],
      weightKg: demo.weight_kg, description: demo.contents,
    };
    expect(validate(draft, sender.id)).toStrictEqual({});
    const res = await call<ShipmentResponse>('POST', '/api/v2/shipments', toRequest(draft, sender.id, 'demo-restart-twice'));
    expect(res.status).toBe(201);
    created = res.body;

    expect(created).toMatchObject({ matched: true, unmatchedReason: null, status: 'scheduled' });
    expect(plan().kind).toBe('relay');
    expect(plan().relayBusinessId).toBe(relayPoint.id);
    expect(plan().legs.map((leg) => leg.employeeId)).toStrictEqual([eveningCarrier.id, morningCarrier.id]);
    expect(formatCents(plan().customerPriceCents)).toBe(demo.price);
    expect(created.jobIds).toHaveLength(2);
    expect(plan().legs[0].finishMin).toBeLessThan(DAY_2_MIN);
  }, T);

  it('first server: Play a bit, until the evening carrier\'s page ticks "left" and the pickup', async () => {
    const [pickup, drop] = plan().legs[0].stops;
    // The simulator's Play is a row of seeks, 2 simulated minutes each (DECISIONS pass 46). It never locks the run.
    demoMin = pickup.serviceEndMin;
    let sim = await control({ action: 'seek', timeMin: demoMin });
    for (let step = 0; step < 3 && demoMin + 2 < drop.serviceStartMin; step += 1) {
      demoMin += 2;
      sim = await control({ action: 'seek', timeMin: demoMin });
    }
    expect(sim.clock).toMatchObject({ phase: 'planning', playing: false, timeMin: demoMin });
    expect(demoMin).toBeLessThan(drop.serviceEndMin); // mid-journey: the package is in the evening carrier's car

    before = await pagesSee();
    runBefore = (await ok<ExportFile>('/scenario/export')) as RunV2;

    expect(before.simulator.snapshot.shipmentStatus[created.shipment.id]).toBe('picked_up');
    expect(before.sender.outgoing.find((view) => view.shipment.id === created.shipment.id)?.status).toBe('picked_up');
    expect(before.recipient.incoming.find((view) => view.shipment.id === created.shipment.id)?.status).toBe('picked_up');
    // The evening carrier has left and collected the package; the drop at the relay point is still to come.
    expect(ticksOf(rowOf(before.evening, created.jobIds[0]))).toMatchObject({ departed: true, stopsDone: 1, arrived: false });
    // The morning carrier's job waits for Day 2.
    expect(ticksOf(rowOf(before.morning, created.jobIds[1]))).toMatchObject({ departed: false, stopsDone: 0, arrived: false });
    expect(before.eveningJob.stopsDone).toBe(1);
    // Each of the sender, the recipient and the two carriers was told about the delivery.
    for (const page of [before.sender, before.recipient, before.evening, before.morning]) {
      expect(page.notifications.some((n) => n.shipmentId === created.shipment.id)).toBe(true);
    }
  }, T);

  it('restart 1: the same run on the same file; the delivery, its match, the ticks and the clock\'s minute are what they were, paused', async () => {
    await stop();
    // The stop saved once more: the same run, one version on.
    expect(savedRun()).toStrictEqual({ ...runBefore, version: runBefore.version + 1 });

    const second = await start();
    await expectCleanStart(second);

    const after = await pagesSee();
    // Nothing a page shows has changed. Only the version of the stop's save differs.
    expect(after).toStrictEqual(atVersion(before, runBefore.version + 1));
    expect(after.simulator.runId).toBe(before.simulator.runId); // the pages keep their state: same run, not a new one
    expect(after.simulator.clock).toStrictEqual({ ...before.simulator.clock, playing: false, timeMin: demoMin });
    expect(after.simulator.clock.phase).toBe('planning'); // not locked: the demo can still send a delivery
    expect(after.delivery).toMatchObject({ matched: true, shipment: created.shipment, plan: created.plan, jobIds: created.jobIds });
    expect(ticksOf(rowOf(after.evening, created.jobIds[0]))).toMatchObject({ departed: true, stopsDone: 1, arrived: false });
    expect((await ok<ExportFile>('/scenario/export')) as RunV2).toStrictEqual({ ...runBefore, version: runBefore.version + 1 });

    // Reading wrote nothing: the file is still the one the stop left.
    expect(savedRun().version).toBe(runBefore.version + 1);
  }, T);

  it('restart 2, with nothing done in between: nothing changes', async () => {
    const fileBefore = savedRun();
    await stop();
    expect(savedRun()).toStrictEqual({ ...fileBefore, version: fileBefore.version + 1 });

    const third = await start();
    await expectCleanStart(third);

    const after = await pagesSee();
    expect(after).toStrictEqual(atVersion(before, runBefore.version + 2));
    expect(after.simulator.clock).toStrictEqual({ ...before.simulator.clock, playing: false, timeMin: demoMin });
    expect((await ok<ExportFile>('/scenario/export')) as RunV2).toStrictEqual({ ...runBefore, version: runBefore.version + 2 });

    // And the run is paused for real: the ticker of this server is running, and the minute does not move.
    await sleep(700); // more than two ticks of 250 ms
    expect((await ok<SimulatorResponse>('/simulator')).clock).toStrictEqual(after.simulator.clock);
    expect(savedRun().version).toBe(runBefore.version + 2);
  }, T);

  it('a stop while the server clock itself is playing: it comes back paused at the minute the stop saved, and stays there', async () => {
    // No page sends `play` any more (pass 84), but the API has it, and it is the only way the clock is
    // "playing" when a server stops. The slowest speed, so the run is far from its end when it stops.
    await control({ action: 'speed', speed: 30 });
    const playing = await control({ action: 'play' });
    expect(playing.clock).toMatchObject({ phase: 'locked', playing: true, speed: 30 });

    // The real ticker moves the minute.
    let seen = playing.clock.timeMin;
    for (let tries = 0; tries < 200 && seen === demoMin; tries += 1) {
      await sleep(50);
      seen = (await ok<SimulatorResponse>('/simulator')).clock.timeMin;
    }
    expect(seen).toBeGreaterThan(demoMin);

    await stop();
    const saved = savedRun();
    expect(saved.clock).toMatchObject({ phase: 'locked', playing: false, speed: 30 });
    expect(saved.clock.timeMin).toBeGreaterThanOrEqual(seen);
    expect(saved.clock.timeMin).toBeLessThan(saved.scenario.settings.simEndMin);
    // Only the clock moved while it played: the delivery, the plans and the jobs are the ones of the first server.
    expect({ ...saved, version: 0, clock: null }).toStrictEqual({ ...runBefore, version: 0, clock: null });

    const fourth = await start();
    await expectCleanStart(fourth);
    const sim = await ok<SimulatorResponse>('/simulator');
    expect(sim.runId).toBe(runBefore.runId);
    expect(sim.version).toBe(saved.version); // the restore itself is not a change
    expect(sim.clock).toStrictEqual(saved.clock);
    expect((await ok<ExportFile>('/scenario/export')) as RunV2).toStrictEqual(saved);
    expect(await ok<ShipmentResponse>(`/shipments/${created.shipment.id}`))
      .toMatchObject({ matched: true, shipment: created.shipment, plan: created.plan, jobIds: created.jobIds });

    await sleep(700);
    expect((await ok<SimulatorResponse>('/simulator')).clock).toStrictEqual(saved.clock);
    demoMin = saved.clock.timeMin;
  }, T);

  it('after the restarts the demo goes on: Back to start, the journey plays to "delivered", both carriers are paid', async () => {
    // Back to start is the way out of the lock the API's `play` set (#734).
    const back = await control({ action: 'reset_playback' });
    expect(back.clock).toMatchObject({ phase: 'planning', playing: false, timeMin: runBefore.scenario.settings.simStartMin });

    const night = await control({ action: 'seek', timeMin: plan().legs[0].finishMin });
    expect(night.snapshot.shipmentStatus[created.shipment.id]).toBe('at_hub');
    expect(night.snapshot.packagePositions[created.shipment.id]).toMatchObject({ lat: relayPoint.lat, lng: relayPoint.lng });

    const end = await control({ action: 'seek', timeMin: plan().deliveryMin });
    expect(end.clock.phase).toBe('planning');
    expect(end.snapshot.shipmentStatus[created.shipment.id]).toBe('delivered');
    const seen = await pagesSee();
    expect(seen.sender.outgoing.find((view) => view.shipment.id === created.shipment.id)?.status).toBe('delivered');
    expect(seen.recipient.incoming.find((view) => view.shipment.id === created.shipment.id)?.status).toBe('delivered');
    for (const [i, dash] of [seen.evening, seen.morning].entries()) {
      expect(dash.completed.map((view) => view.job.id)).toContain(created.jobIds[i]);
      expect(dash.earnedCents).toBeGreaterThanOrEqual(plan().legs[i].rewardCents);
    }
    expect(plan().legs.every((leg) => leg.rewardCents > 0)).toBe(true);
  }, T);

  it('four starts, one state file; nothing was written to the repo, nothing left the machine, and no server complained', async () => {
    await stop();
    expect(starts).toBe(4);
    expect(stateFiles()).toStrictEqual(['state-v2.json', SIDECAR]);
    expect(repoDataNames()).toStrictEqual(repoDataBefore);
    expect(nycFilesState()).toStrictEqual(nycBefore);
    expect(fs.existsSync(path.join(root, '.env'))).toBe(false);
    expect(outgoing).toStrictEqual([]);
    expect(complaints).toStrictEqual([]);
  }, T);
});
