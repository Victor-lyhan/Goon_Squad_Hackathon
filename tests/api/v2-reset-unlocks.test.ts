// #734: "Back to start" (`reset_playback`) is the way out of a locked run.
// Since #700 the simulator has no "Start new planning cycle" button, so a Play with no package picked
// locked the run until the state file was deleted, and the demo could not be rehearsed twice.
// Over HTTP on the default NYC run, the real server with no key, booted from a temp copy of `fixtures/nyc`
// (v2-e2e-nyc-helper.ts, DECISIONS pass 56). `globalThis.fetch` is a recorder: a call that is not to the
// test server fails the test. The clock ticker is not started, so the clock moves only when a control moves it.
// The demo request is read from the ```demo-request block of README.md, so no story name is pinned here
// (DECISIONS pass 54 and 59); what the block's request matches as is proven in v2-readme-demo.test.ts.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { emptyDraft, toRequest, validate } from '../../client/src/components/business/v2/newDeliveryModel';
import { RESET_LABEL, RESET_REQUEST } from '../../client/src/components/sim/v2/controls/controlsModel';
import { COMMUTE_LOCKED } from '../../server/api/v2/commutePlan';
import { RECOMPUTE_LOCKED } from '../../server/api/v2/planningOps';
import { SHIPMENTS_LOCKED } from '../../server/api/v2/shipmentOps';
import type { CommuteResponse, EmployeeDashboard, ShipmentResponse, SimulatorResponse } from '../../shared/v2/api';
import type { ApiError } from '../../shared/v2/schemas';
import type { DeliveryPlan, Employee, NetworkBusiness } from '../../shared/v2/types';
import {
  commuteOf, copyNycFixtures, readCity, recordFetch, REPO_ROOT, startNycApi, stopsOf, T,
  type City, type NycApi,
} from './v2-e2e-nyc-helper';
import { planning } from './v2-nyc-controls-helper';

// ---------- the README's demo request ----------

const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
const block = /```demo-request\n([\s\S]*?)```/.exec(readme)?.[1];
if (!block) throw new Error('README.md has no ```demo-request block');
const demo: Record<string, string> = Object.fromEntries(
  block.trim().split('\n').map((line) => {
    const colon = line.indexOf(':');
    return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  }),
);
const TYPE_OF: Record<string, 'envelope' | 'small_box'> = { Envelope: 'envelope', 'Small box': 'small_box' };

// ---------- the server ----------

const net = recordFetch();
let fixturesDir = '';
let api: NycApi;
let city: City;
let sender: NetworkBusiness;
let recipient: NetworkBusiness;
/** The employee the README opens first: a carrier of the demo request. */
let employee: Employee;

/** The one entry of the default run with this name. A name the run does not have, or has twice, fails. */
function byName<V extends { name: string }>(list: V[], name: string, what: string): V {
  const found = list.filter((entry) => entry.name === name);
  if (found.length !== 1) throw new Error(`README names the ${what} "${name}", and the default run has ${found.length} of them`);
  return found[0];
}

beforeAll(async () => {
  fixturesDir = copyNycFixtures();
  api = await startNycApi(net, { fixturesDir });
  expect(api.runtime.status).toBe('ready');
  city = await readCity(api);
  sender = byName(city.businesses, demo.sender, 'sender');
  recipient = byName(city.businesses, demo.recipient, 'recipient');
  employee = byName(city.employees, demo.employee, 'employee');
}, T);
afterEach(() => net.expectNoOutgoing());
afterAll(async () => {
  await api?.close();
  net.restore();
  if (fixturesDir) fs.rmSync(fixturesDir, { recursive: true, force: true });
}, T);

/** The README's request, built the way the New delivery form builds it (as in v2-readme-demo.test.ts). */
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

const dashboardOf = async (employeeId: string): Promise<EmployeeDashboard> => {
  const res = await api.get<EmployeeDashboard>(`/employees/${employeeId}/dashboard`);
  expect(res.status).toBe(200);
  return res.body;
};
const enc = encodeURIComponent;

/** The three writes the lock refuses, each with its own sentence. Nothing may change. */
async function expectLocked(locked: SimulatorResponse, clientRequestId: string, step: string): Promise<void> {
  const delivery = await api.post<ApiError>('/shipments', demoRequest(clientRequestId));
  expect(`${step}: POST /shipments ${delivery.status}`).toBe(`${step}: POST /shipments 409`);
  expect(delivery.body).toStrictEqual({ error: SHIPMENTS_LOCKED });

  const commute = await api.put<ApiError>(`/employees/${enc(employee.id)}/commute`, commuteOf(employee));
  expect(`${step}: PUT commute ${commute.status}`).toBe(`${step}: PUT commute 409`);
  expect(commute.body).toStrictEqual({ error: COMMUTE_LOCKED });

  const recompute = await api.post<ApiError>('/matches/recompute');
  expect(`${step}: POST /matches/recompute ${recompute.status}`).toBe(`${step}: POST /matches/recompute 409`);
  expect(recompute.body).toStrictEqual({ error: RECOMPUTE_LOCKED });

  expect(await api.simulator(), step).toStrictEqual(locked);
}

describe('the three locked 409 texts', () => {
  it('name "Back to start", the control the simulator has, and no control it lost', () => {
    expect(SHIPMENTS_LOCKED).toBe('Playback has started, so press Back to start in the simulator to change deliveries.');
    expect(COMMUTE_LOCKED).toBe('Playback has started, so press Back to start in the simulator to edit commutes.');
    expect(RECOMPUTE_LOCKED).toBe('Playback has started, so press Back to start in the simulator to match again.');
    for (const text of [SHIPMENTS_LOCKED, COMMUTE_LOCKED, RECOMPUTE_LOCKED]) {
      expect(text).not.toMatch(/planning cycle/i);
      expect(text).not.toMatch(/reset/i);
    }
    // The words are the button's own label, and the button sends the control that unlocks.
    for (const text of [SHIPMENTS_LOCKED, COMMUTE_LOCKED, RECOMPUTE_LOCKED]) expect(text).toContain(`press ${RESET_LABEL} in the simulator`);
    expect(RESET_REQUEST).toStrictEqual({ action: 'reset_playback' });
  });
});

describe('Back to start unlocks the default NYC run (#734)', () => {
  /** The deliveries the two rehearsals stored. */
  const stored: ShipmentResponse[] = [];

  it.each([1, 2])('rehearsal %i: Play locks, the writes answer 409, Back to start unlocks, the README request matches and its carrier has the job', async (round) => {
    const { simStartMin, simEndMin } = city.settings;
    const before = await api.simulator();
    // Each rehearsal starts where the one before ended: in planning, paused at the first minute.
    expect(before.clock).toMatchObject({ phase: 'planning', playing: false, timeMin: simStartMin });
    const jobsBefore = (await dashboardOf(employee.id)).assigned.map((view) => view.job.id);

    // Play with no package picked: the run is locked.
    const played = await api.control({ action: 'play' });
    expect(played.clock).toStrictEqual({ ...before.clock, phase: 'locked', playing: true });
    await expectLocked(played, `reset-unlocks-${round}-refused`, 'after Play');

    // Pause, seek (the journey's steps) and the end of the day do not unlock.
    const lastStop = Math.max(...before.plans.flatMap(stopsOf).map((stop) => stop.serviceEndMin));
    for (const control of [
      { action: 'pause' }, { action: 'seek', timeMin: lastStop }, { action: 'seek', timeMin: simStartMin }, { action: 'finish' },
    ]) {
      const moved = await api.control(control);
      expect(moved.clock.phase, control.action).toBe('locked');
      await expectLocked(moved, `reset-unlocks-${round}-refused`, `after ${control.action}`);
    }
    const end = await api.simulator();
    expect(end.clock).toStrictEqual({ ...before.clock, phase: 'locked', timeMin: simEndMin });

    // Back to start: the first minute, paused, in planning; one version, the same run and the same matching.
    const reset = await api.control({ action: 'reset_playback' });
    expect(reset.clock).toStrictEqual(before.clock);
    expect(reset.runId).toBe(before.runId);
    expect(reset.version).toBe(end.version + 1);
    expect(planning(reset)).toStrictEqual(planning(before));
    expect(reset.snapshot.occurredEvents).toStrictEqual([]);
    expect(reset.snapshot.shipmentStatus).toStrictEqual(before.snapshot.shipmentStatus);
    expect(await api.simulator()).toStrictEqual(reset);
    const saved = await api.savedRun();
    expect(saved?.clock).toStrictEqual(reset.clock);
    expect(saved?.runId).toBe(before.runId);

    // The README's request, refused a moment ago, is now stored and matched.
    const res = await api.post<ShipmentResponse>('/shipments', demoRequest(`reset-unlocks-${round}`));
    expect(res.status).toBe(201);
    const created = res.body;
    stored.push(created);
    expect(created.unmatchedReason).toBeNull();
    expect(created.matched).toBe(true);
    expect(created.status).toBe('scheduled');
    expect(created.shipment).toMatchObject({ originBusinessId: sender.id, destinationBusinessId: recipient.id, label: demo.package });
    const plan = created.plan as DeliveryPlan;
    expect(created.jobIds).toHaveLength(plan.legs.length);

    // Every carrier of the plan has its job under the assigned deliveries, at once.
    for (const [i, leg] of plan.legs.entries()) {
      const dash = await dashboardOf(leg.employeeId);
      const view = dash.assigned.find((entry) => entry.job.id === created.jobIds[i]);
      expect(view, `job ${created.jobIds[i]} of ${leg.employeeId}`).toBeDefined();
      expect(view!.shipment.id).toBe(created.shipment.id);
    }
    if (round === 1) {
      // On the fresh run the carriers are the ones the README names; the employee it opens first has a new job.
      const names = plan.legs.map((leg) => city.employee.get(leg.employeeId)?.name);
      expect(names).toStrictEqual([demo.evening_carrier, demo.morning_carrier]);
      const mine = plan.legs.findIndex((leg) => leg.employeeId === employee.id);
      expect(mine).toBeGreaterThanOrEqual(0);
      expect(jobsBefore).not.toContain(created.jobIds[mine]);
    }

    // The run is still the same one, in planning at the first minute, with everything it had plus the new delivery.
    const after = await api.simulator();
    expect(after.runId).toBe(before.runId);
    expect(after.clock).toStrictEqual(before.clock);
    expect(after.shipments.map((s) => s.id)).toStrictEqual([...before.shipments.map((s) => s.id), created.shipment.id]);
    for (const old of before.plans) expect(after.plans).toContainEqual(old);

    // The commute save is open again too (the same commute: nothing to re-plan).
    const commute = await api.put<CommuteResponse>(`/employees/${enc(employee.id)}/commute`, commuteOf(employee));
    expect(commute.status).toBe(200);
    expect(planning(await api.simulator())).toStrictEqual(planning(after));
  }, T);

  it('the two rehearsals stored two deliveries with their own IDs, and the reset re-matched nothing: the first kept its plan', async () => {
    expect(stored).toHaveLength(2);
    expect(stored[0].shipment.id).not.toBe(stored[1].shipment.id);
    expect(stored[0].plan?.id).not.toBe(stored[1].plan?.id);
    // The second rehearsal's Play, 409s and Back to start left the first delivery's plan and jobs as they were.
    const sim = await api.simulator();
    expect(sim.clock).toMatchObject({ phase: 'planning', playing: false, timeMin: city.settings.simStartMin });
    for (const delivery of stored) {
      expect(sim.plans).toContainEqual(delivery.plan);
      expect(sim.jobs.filter((job) => job.planId === delivery.plan?.id).map((job) => job.id)).toStrictEqual(delivery.jobIds);
    }
  }, T);
});
