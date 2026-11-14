// Helper for the agreement tests of the three workspaces (tests/api/v2-nyc-consistency-*.test.ts, #533).
// SPEC demo step 6: tracking and earnings update "from the same run". These tests read, over HTTP, every
// answer a workspace shows (GET /simulator, every business and employee dashboard, every delivery and
// every job) at one moment of the day and compare them with each other.
// The server is the one of v2-e2e-nyc-helper.ts: the real v2 runtime on the committed `fixtures/nyc`, no
// key, with both state files in a temp folder. Nothing here writes to `fixtures/nyc` or `data/`.
// Only rules are asserted. No story ID, name or count is pinned (DECISIONS pass 54): every list is read
// from the answers themselves.
import { expect } from 'vitest';
import type {
  BusinessDashboard, EmployeeDashboard, EmployeeJobView, JobResponse, ShipmentResponse, ShipmentView,
  SimulatorResponse,
} from '../../shared/v2/api';
import type { DeliveryPlan, Job, JobStatus, Notification, Settings } from '../../shared/v2/types';
import { DAY_2_MIN, statusFromPlan, stopsOf, type City, type NycApi } from './v2-e2e-nyc-helper';

/**
 * Timeout of every test and hook in these files (DECISIONS pass 19): each talks to a real HTTP server.
 * The slowest hook reads every answer of the run once (about 140 requests) and takes under 0.1 s locally;
 * each of the three files takes about 0.5 s.
 */
export const T = 30_000;

// ---------- the five moments ----------

export const MOMENTS = ['start', 'evening', 'day2', 'morning', 'end'] as const;
export type MomentKey = (typeof MOMENTS)[number];

export const MOMENT_TITLE: Record<MomentKey, string> = {
  start: 'the start of the run',
  evening: 'the middle of the Day 1 evening',
  day2: 'the start of Day 2',
  morning: 'the middle of the Day 2 morning',
  end: 'the end of the run',
};

const middle = (times: number[], from: number, to: number): number =>
  Math.floor(times.length > 0 ? (Math.min(...times) + Math.max(...times)) / 2 : (from + to) / 2);

/**
 * The minute of each moment, read from the run: the start and the end are the settings' (930 and 2160 in
 * the default run), Day 2 starts at 1440, and the middle of an evening or a morning is halfway between
 * the first and the last stop of that half of the day. So at least one stop of that half is over and,
 * when its stops are not all at one minute, at least one is still to come.
 */
export function momentMinutes(sim: Pick<SimulatorResponse, 'plans'>, settings: Settings): Record<MomentKey, number> {
  const stopEnds = sim.plans.flatMap((plan) => stopsOf(plan).map((stop) => stop.serviceEndMin));
  return {
    start: settings.simStartMin,
    evening: middle(stopEnds.filter((t) => t < DAY_2_MIN), settings.simStartMin, DAY_2_MIN),
    day2: DAY_2_MIN,
    morning: middle(stopEnds.filter((t) => t >= DAY_2_MIN), DAY_2_MIN, settings.simEndMin),
    end: settings.simEndMin,
  };
}

/** Moves the shared clock with POST /simulator/control `seek`. The answer must show the clock exactly there, paused. */
export async function moveClock(api: NycApi, timeMin: number): Promise<SimulatorResponse> {
  const sim = await api.control({ action: 'seek', timeMin });
  expect(sim.clock).toMatchObject({ timeMin, playing: false });
  expect(sim.snapshot.timeMin).toBe(timeMin);
  return sim;
}

// ---------- every answer of the three workspaces at one moment ----------

export type Workspaces = {
  timeMin: number;
  /** GET /simulator. */
  sim: SimulatorResponse;
  /** GET /businesses/:id/dashboard of every business of GET /businesses. */
  business: Map<string, BusinessDashboard>;
  /** GET /employees/:id/dashboard of every employee of GET /employees. */
  employee: Map<string, EmployeeDashboard>;
  /** GET /shipments/:id of every delivery of the simulator. */
  shipment: Map<string, ShipmentResponse>;
  /** GET /jobs/:id of every job of the simulator. */
  job: Map<string, JobResponse>;
};

/**
 * Reads everything the three workspaces show, at the clock's current minute. Every request must answer
 * 200. The simulator is read before and after the rest: the same version both times proves that all the
 * answers were built from one state of the run (the clock is paused, nobody else writes).
 */
export async function readWorkspaces(api: NycApi, city: City): Promise<Workspaces> {
  const sim = await api.simulator();
  const all = async <B>(ids: string[], url: (id: string) => string): Promise<Map<string, B>> =>
    new Map(await Promise.all(ids.map(async (id): Promise<[string, B]> => {
      const res = await api.get<B>(url(id));
      expect(res.status, `GET ${url(id)}`).toBe(200);
      return [id, res.body];
    })));
  const enc = encodeURIComponent;

  const business = await all<BusinessDashboard>(city.businesses.map((b) => b.id), (id) => `/businesses/${enc(id)}/dashboard`);
  const employee = await all<EmployeeDashboard>(city.employees.map((e) => e.id), (id) => `/employees/${enc(id)}/dashboard`);
  const shipment = await all<ShipmentResponse>(sim.shipments.map((s) => s.id), (id) => `/shipments/${enc(id)}`);
  const job = await all<JobResponse>(sim.jobs.map((j) => j.id), (id) => `/jobs/${enc(id)}`);

  const after = await api.simulator();
  expect(after.version).toBe(sim.version);
  expect(after.clock).toStrictEqual(sim.clock);
  return { timeMin: sim.clock.timeMin, sim, business, employee, shipment, job };
}

// ---------- the simulator's own word on a delivery and on a job ----------

/**
 * A delivery as the simulator's answer tells it, in the shape the other answers use (`ShipmentView`):
 * the request from `shipments`, the plan (carriers, relay business, stop times) from `plans`, the jobs
 * from `jobs` in leg order, and status and delivery time from the snapshot.
 */
export function simulatorDelivery(sim: SimulatorResponse, shipmentId: string): ShipmentView {
  const shipment = sim.shipments.find((s) => s.id === shipmentId);
  if (!shipment) throw new Error(`The simulator has no delivery ${shipmentId}`);
  const status = sim.snapshot.shipmentStatus[shipmentId];
  if (status === undefined) throw new Error(`The simulator's snapshot has no status for ${shipmentId}`);
  return {
    shipment,
    plan: sim.plans.find((plan) => plan.shipmentId === shipmentId) ?? null,
    jobIds: sim.jobs.filter((job) => job.shipmentId === shipmentId).sort((a, b) => a.legIndex - b.legIndex).map((job) => job.id),
    status,
    deliveredAtMin: sim.snapshot.deliveredAtMin[shipmentId] ?? null,
    unmatchedReason: sim.unmatched.find((u) => u.shipmentId === shipmentId)?.reason ?? null,
  };
}

/** A job as the simulator's answer tells it, in the shape of the employee's rows (`EmployeeJobView`). */
export function simulatorJob(sim: SimulatorResponse, jobId: string): EmployeeJobView {
  const job = sim.jobs.find((j) => j.id === jobId);
  if (!job) throw new Error(`The simulator has no job ${jobId}`);
  const shipment = sim.shipments.find((s) => s.id === job.shipmentId);
  const plan = sim.plans.find((p) => p.id === job.planId);
  const status = sim.snapshot.jobStatus[jobId];
  if (!shipment || !plan || status === undefined) throw new Error(`The simulator has no delivery, plan or status for job ${jobId}`);
  return { job, status, shipment, plan };
}

/**
 * What a delivery looks like to a person: status, carriers, relay business and every time.
 * Compared next to the whole row, so a failure names the part that differs.
 */
export function deliveryStory(view: ShipmentView) {
  return {
    status: view.status,
    carriers: view.plan?.legs.map((leg) => leg.employeeId) ?? [],
    relayBusinessId: view.plan?.relayBusinessId ?? null,
    readyMin: view.shipment.readyMin,
    deadlineMin: view.shipment.deadlineMin,
    stops: view.plan ? stopsOf(view.plan).map((s) => `${s.kind} ${s.placeId} ${s.arrivalMin} ${s.serviceStartMin} ${s.serviceEndMin}`) : [],
    deliveryMin: view.plan?.deliveryMin ?? null,
    deliveredAtMin: view.deliveredAtMin,
  };
}

/** Drops `matched` (and anything else) from a GET /shipments/:id answer, leaving the shared `ShipmentView`. */
export const viewOf = ({ shipment, plan, jobIds, status, deliveredAtMin, unmatchedReason }: ShipmentView): ShipmentView =>
  ({ shipment, plan, jobIds, status, deliveredAtMin, unmatchedReason });

/** The four shared fields of a job row, without the `trip` GET /jobs/:id adds. */
export const jobViewOf = ({ job, status, shipment, plan }: EmployeeJobView): EmployeeJobView => ({ job, status, shipment, plan });

/**
 * The status a job must show at `timeMin`, from its own two stops (DECISIONS pass 3): `assigned` until the
 * handling of its first stop ends, `completed` once the handling of its last stop ended, else `in_progress`.
 */
export function jobStatusFromStops(job: Job, timeMin: number): JobStatus {
  if (job.dropoff.serviceEndMin <= timeMin) return 'completed';
  return job.pickup.serviceEndMin <= timeMin ? 'in_progress' : 'assigned';
}

// ---------- small tools ----------

export const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
export const sorted = (values: string[]): string[] => [...values].sort();
/** A copy of a list of things with an `id`, in ID order: for comparing two lists as sets. */
export const byId = <V extends { id: string }>(list: V[]): V[] => [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** An amount of money: whole cents, never negative. */
export function expectCents(value: number, what: string): void {
  expect(Number.isInteger(value) && value >= 0, `${what} = ${value} must be whole cents, not negative`).toBe(true);
}

/** The employee's job rows, open and done. */
export const jobRows = (dashboard: EmployeeDashboard): EmployeeJobView[] => [...dashboard.assigned, ...dashboard.completed];

const at = (ws: Workspaces) => `at minute ${ws.timeMin}`;

// ---------- rule: the dashboards belong to the simulator's run ----------

/** Every business and every employee of the lists has a dashboard, at the simulator's version and phase. */
export function expectDashboardsOfOneRun(ws: Workspaces, city: City): void {
  expect(ws.business.size).toBeGreaterThan(0);
  expect(ws.employee.size).toBeGreaterThan(0);
  expect(sorted([...ws.business.keys()])).toStrictEqual(sorted(city.businesses.map((b) => b.id)));
  expect(sorted([...ws.employee.keys()])).toStrictEqual(sorted(city.employees.map((e) => e.id)));
  for (const [id, dashboard] of [...ws.business, ...ws.employee]) {
    expect(dashboard.version, `${id} version ${at(ws)}`).toBe(ws.sim.version);
    expect(dashboard.phase, `${id} phase ${at(ws)}`).toBe(ws.sim.clock.phase);
  }
  expect(ws.sim.snapshot.version).toBe(ws.sim.version);
  expect(ws.sim.snapshot.runId).toBe(ws.sim.runId);
  expect(ws.sim.snapshot.timeMin).toBe(ws.timeMin);
  for (const [id, dashboard] of ws.business) expect(dashboard.business).toStrictEqual(city.business.get(id));
  for (const [id, dashboard] of ws.employee) expect(dashboard.employee).toStrictEqual(city.employee.get(id));
}

// ---------- rule: one story per delivery ----------

/**
 * Every delivery is the same in GET /simulator, in the sender's dashboard, in the recipient's dashboard
 * and in GET /shipments/:id: status, carriers, relay business and times, and then the whole row.
 */
export function expectDeliveriesAgree(ws: Workspaces): void {
  expect(ws.sim.shipments.length).toBeGreaterThan(0);
  for (const shipment of ws.sim.shipments) {
    const what = `delivery ${shipment.id} ${at(ws)}`;
    const inSimulator = simulatorDelivery(ws.sim, shipment.id);

    const sender = ws.business.get(shipment.originBusinessId);
    const recipient = ws.business.get(shipment.destinationBusinessId);
    expect(sender, `${what}: the sender has a dashboard`).toBeDefined();
    expect(recipient, `${what}: the recipient has a dashboard`).toBeDefined();
    const outgoing = sender!.outgoing.filter((row) => row.shipment.id === shipment.id);
    const incoming = recipient!.incoming.filter((row) => row.shipment.id === shipment.id);
    expect(outgoing, `${what}: one row in the sender's outgoing list`).toHaveLength(1);
    expect(incoming, `${what}: one row in the recipient's incoming list`).toHaveLength(1);
    const tracked = ws.shipment.get(shipment.id);
    expect(tracked, `${what}: GET /shipments/:id`).toBeDefined();

    // Status, carriers, relay business and times, named so a failure says which part differs.
    const story = deliveryStory(inSimulator);
    expect(deliveryStory(outgoing[0]), `${what}: sender's dashboard`).toStrictEqual(story);
    expect(deliveryStory(incoming[0]), `${what}: recipient's dashboard`).toStrictEqual(story);
    expect(deliveryStory(tracked!), `${what}: GET /shipments/:id`).toStrictEqual(story);
    // And the whole row: the request, the plan with every leg and its money, the job IDs, the reason.
    expect(outgoing[0], `${what}: sender's dashboard`).toStrictEqual(inSimulator);
    expect(incoming[0], `${what}: recipient's dashboard`).toStrictEqual(inSimulator);
    expect(viewOf(tracked!), `${what}: GET /shipments/:id`).toStrictEqual(inSimulator);
    expect(tracked!.matched, `${what}: matched`).toBe(inSimulator.plan !== null);
  }

  // No dashboard lists a delivery of another business, and together they list every delivery once.
  for (const [id, dashboard] of ws.business) {
    for (const row of dashboard.outgoing) expect(row.shipment.originBusinessId, `outgoing row ${row.shipment.id} of ${id}`).toBe(id);
    for (const row of dashboard.incoming) expect(row.shipment.destinationBusinessId, `incoming row ${row.shipment.id} of ${id}`).toBe(id);
  }
  const all = sorted(ws.sim.shipments.map((s) => s.id));
  expect(new Set(all).size).toBe(all.length);
  expect(sorted([...ws.business.values()].flatMap((d) => d.outgoing.map((row) => row.shipment.id)))).toStrictEqual(all);
  expect(sorted([...ws.business.values()].flatMap((d) => d.incoming.map((row) => row.shipment.id)))).toStrictEqual(all);
  expect(sorted([...ws.shipment.values()].map((view) => view.shipment.id))).toStrictEqual(all);
}

/**
 * Every delivery's status and delivery time follow from its own plan's stop times, its carriers are the
 * employees of its jobs, and its relay business is a third network business.
 */
export function expectDeliveriesFollowPlans(ws: Workspaces, city: City): void {
  for (const shipment of ws.sim.shipments) {
    const what = `delivery ${shipment.id} ${at(ws)}`;
    const view = ws.shipment.get(shipment.id)!;
    if (view.plan === null) {
      expect(view.status, what).toBe('unmatched');
      expect(view.deliveredAtMin, what).toBeNull();
      expect(view.jobIds, what).toStrictEqual([]);
      expect(view.unmatchedReason?.trim(), `${what}: the reason`).toBeTruthy();
      continue;
    }
    const plan: DeliveryPlan = view.plan;
    expect(view.unmatchedReason, what).toBeNull();
    expect(view.status, what).toBe(statusFromPlan(plan, ws.timeMin));
    // Delivered exactly when the last stop's handling is over, and then at the plan's own minute.
    expect(plan.deliveryMin, what).toBe(stopsOf(plan).at(-1)!.serviceEndMin);
    expect(view.deliveredAtMin, what).toBe(plan.deliveryMin <= ws.timeMin ? plan.deliveryMin : null);
    expect(view.status === 'delivered', what).toBe(view.deliveredAtMin !== null);

    // Carriers: one job per leg, in leg order, each the leg's employee, and each a known employee.
    expect(view.jobIds, what).toHaveLength(plan.legs.length);
    plan.legs.forEach((leg, legIndex) => {
      const job = ws.sim.jobs.find((j) => j.id === view.jobIds[legIndex]);
      expect(job, `${what}: job of leg ${legIndex}`).toBeDefined();
      expect(job!.employeeId, `${what}: carrier of leg ${legIndex}`).toBe(leg.employeeId);
      expect(job!.legIndex, what).toBe(legIndex);
      expect(city.employee.has(leg.employeeId), `${what}: carrier ${leg.employeeId} is an employee`).toBe(true);
    });
    // Relay business: a third network business for a relay, none for a direct delivery.
    if (plan.kind === 'relay') {
      expect(city.business.has(plan.relayBusinessId as string), `${what}: relay business`).toBe(true);
      expect([shipment.originBusinessId, shipment.destinationBusinessId], what).not.toContain(plan.relayBusinessId);
    } else {
      expect(plan.relayBusinessId, what).toBeUndefined();
    }
  }
}

/**
 * The simulator's map shows every matched package where its status says (DECISIONS pass 4): at the
 * sender until it is picked up, with the carrier of the leg that is under way, at the relay business
 * overnight, at the recipient once delivered. And every vehicle on the map is a carrier of some job.
 */
export function expectMapFollowsStatus(ws: Workspaces, city: City): void {
  const { markers, packagePositions } = ws.sim.snapshot;
  const pointOf = (businessId: string) => {
    const business = city.business.get(businessId);
    if (!business) throw new Error(`${businessId} is not a network business`);
    return { lat: business.lat, lng: business.lng };
  };
  for (const plan of ws.sim.plans) {
    const view = ws.shipment.get(plan.shipmentId)!;
    const what = `package ${plan.shipmentId} (${view.status}) ${at(ws)}`;
    const position = packagePositions[plan.shipmentId];
    expect(position, `${what}: is on the map`).toBeDefined();
    const carrying = markers.filter((marker) => marker.carryingShipmentId === plan.shipmentId);

    if (view.status === 'picked_up' || view.status === 'out_for_delivery') {
      // Under way: with exactly one vehicle, the one of the leg its status names.
      const leg = plan.legs[view.status === 'picked_up' ? 0 : plan.legs.length - 1];
      expect(carrying.map((marker) => marker.employeeId), `${what}: its carrier`).toStrictEqual([leg.employeeId]);
      expect(position, `${what}: with its carrier`).toStrictEqual({ lat: carrying[0].lat, lng: carrying[0].lng });
      continue;
    }
    expect(carrying, `${what}: in nobody's vehicle`).toStrictEqual([]);
    const restsAt = view.status === 'scheduled' ? view.shipment.originBusinessId
      : view.status === 'at_hub' ? (plan.relayBusinessId as string)
        : view.shipment.destinationBusinessId;
    expect(view.status === 'at_hub' ? plan.kind : 'any', what).not.toBe('direct');
    expect(position, `${what}: at ${restsAt}`).toStrictEqual(pointOf(restsAt));
  }
  for (const marker of markers) {
    expect(ws.sim.jobs.some((job) => job.employeeId === marker.employeeId), `vehicle of ${marker.employeeId} ${at(ws)}: has a job`).toBe(true);
  }
}

// ---------- rule: one story per job ----------

/**
 * Every job is the same in the simulator's `jobs`, in its employee's dashboard and in GET /jobs/:id:
 * stops, times, reward and status. The job is its plan's leg, and its status follows from its two stops.
 */
export function expectJobsAgree(ws: Workspaces): void {
  for (const job of ws.sim.jobs) {
    const what = `job ${job.id} ${at(ws)}`;
    const inSimulator = simulatorJob(ws.sim, job.id);
    const dashboard = ws.employee.get(job.employeeId);
    expect(dashboard, `${what}: its employee has a dashboard`).toBeDefined();
    const rows = jobRows(dashboard!).filter((row) => row.job.id === job.id);
    expect(rows, `${what}: one row in the employee's dashboard`).toHaveLength(1);
    const detail = ws.job.get(job.id);
    expect(detail, `${what}: GET /jobs/:id`).toBeDefined();

    for (const [where, row] of [['employee dashboard', rows[0]], ['GET /jobs/:id', detail!]] as const) {
      expect(row.job.pickup, `${what}: pickup stop, ${where}`).toStrictEqual(job.pickup);
      expect(row.job.dropoff, `${what}: drop-off stop, ${where}`).toStrictEqual(job.dropoff);
      expect(row.job.rewardCents, `${what}: reward, ${where}`).toBe(job.rewardCents);
      expect(row.status, `${what}: status, ${where}`).toBe(inSimulator.status);
      expect(jobViewOf(row), `${what}: ${where}`).toStrictEqual(inSimulator);
    }

    // The job is its plan's leg: the same carrier, trip, first and last stop, and reward.
    const leg = inSimulator.plan.legs[job.legIndex];
    expect(leg, `${what}: its leg`).toBeDefined();
    expect(job.employeeId, what).toBe(leg.employeeId);
    expect(job.tripId, what).toBe(leg.tripId);
    expect(job.pickup, what).toStrictEqual(leg.stops[0]);
    expect(job.dropoff, what).toStrictEqual(leg.stops.at(-1));
    expect(job.rewardCents, what).toBe(leg.rewardCents);
    expect(Number.isInteger(job.rewardCents) && job.rewardCents > 0, `${what}: reward ${job.rewardCents} in whole cents`).toBe(true);

    // The trip of the job view is one of the commutes the employee's dashboard shows.
    expect(detail!.trip.id, what).toBe(job.tripId);
    expect(detail!.trip.employeeId, what).toBe(job.employeeId);
    expect(dashboard!.trips, what).toContainEqual(detail!.trip);

    // Status from the job's own stop times, and the dashboard files the row under it.
    expect(inSimulator.status, what).toBe(jobStatusFromStops(job, ws.timeMin));
    const list = inSimulator.status === 'completed' ? dashboard!.completed : dashboard!.assigned;
    expect(list.map((row) => row.job.id), `${what}: listed under ${inSimulator.status}`).toContain(job.id);
  }

  // No employee lists a job of someone else, and together they list every job once.
  for (const [id, dashboard] of ws.employee) {
    for (const row of jobRows(dashboard)) expect(row.job.employeeId, `job ${row.job.id} in the dashboard of ${id}`).toBe(id);
    for (const row of dashboard.completed) expect(row.status, `completed row ${row.job.id}`).toBe('completed');
    for (const row of dashboard.assigned) expect(row.status, `assigned row ${row.job.id}`).not.toBe('completed');
  }
  const all = sorted(ws.sim.jobs.map((j) => j.id));
  expect(new Set(all).size).toBe(all.length);
  expect(sorted([...ws.employee.values()].flatMap((d) => jobRows(d).map((row) => row.job.id)))).toStrictEqual(all);
  expect(sorted([...ws.job.values()].map((detail) => detail.job.id))).toStrictEqual(all);
}

// ---------- rule: totals add up from the answers' own rows ----------

/**
 * Each business dashboard's totals are a count of the rows it lists (DECISIONS pass 4: spend is the
 * price of every matched outgoing delivery, delivered or not), and the businesses together add up to
 * the simulator's summary.
 */
export function expectBusinessTotalsAddUp(ws: Workspaces, settings: Settings): void {
  for (const [id, dashboard] of ws.business) {
    const what = `totals of ${id} ${at(ws)}`;
    const matched = dashboard.outgoing.filter((row) => row.plan !== null);
    expect(dashboard.totals, what).toStrictEqual({
      sent: dashboard.outgoing.length,
      matched: matched.length,
      delivered: dashboard.outgoing.filter((row) => row.status === 'delivered').length,
      spendCents: sum(matched.map((row) => row.plan!.customerPriceCents)),
    });
    expectCents(dashboard.totals.spendCents, `${what}: spendCents`);
    for (const row of matched) expectCents(row.plan!.customerPriceCents, `price of ${row.shipment.id}`);
  }

  const totals = [...ws.business.values()].map((d) => d.totals);
  const { metrics } = ws.sim.snapshot;
  expect(sum(totals.map((t) => t.sent)), `sent ${at(ws)}`).toBe(ws.sim.shipments.length);
  expect(sum(totals.map((t) => t.sent)), `sent ${at(ws)}`).toBe(metrics.requested);
  expect(sum(totals.map((t) => t.matched)), `matched ${at(ws)}`).toBe(ws.sim.plans.length);
  expect(sum(totals.map((t) => t.matched)), `matched ${at(ws)}`).toBe(metrics.matched);
  expect(sum(totals.map((t) => t.delivered)), `delivered ${at(ws)}`).toBe(metrics.delivered);
  expect(metrics.direct + metrics.relay, `direct + relay ${at(ws)}`).toBe(metrics.matched);
  expect(metrics.unmatched, `unmatched ${at(ws)}`).toBe(sum(totals.map((t) => t.sent - t.matched)));
  // Money: what the businesses are committed to spend is the price of every plan, and the simulator's
  // projected customer spend is that plus the courier price of every request with no match (shared/types.ts).
  const spend = sum(totals.map((t) => t.spendCents));
  expect(spend, `spend ${at(ws)}`).toBe(sum(ws.sim.plans.map((plan) => plan.customerPriceCents)));
  expect(metrics.projectedCustomerSpendCents, `projected customer spend ${at(ws)}`)
    .toBe(spend + metrics.unmatched * settings.courierPriceCents);
}

/**
 * Each employee's earnings are the sum over its own job rows, by the rule the API states: a job's
 * reward is earned when the job is completed (`earnedCents`), and every job counts as projected
 * (`projectedCents`). The employees together add up to the simulator's earned rewards.
 */
export function expectEarningsAddUp(ws: Workspaces): void {
  for (const [id, dashboard] of ws.employee) {
    const what = `earnings of ${id} ${at(ws)}`;
    expect(dashboard.earnedCents, `${what}: earned`).toBe(sum(dashboard.completed.map((row) => row.job.rewardCents)));
    expect(dashboard.projectedCents, `${what}: projected`).toBe(sum(jobRows(dashboard).map((row) => row.job.rewardCents)));
    expect(dashboard.earnedCents, `${what}: the simulator's earnings`).toBe(ws.sim.snapshot.earningsCents[id] ?? 0);
    expect(dashboard.earnedCents, what).toBeLessThanOrEqual(dashboard.projectedCents);
    expectCents(dashboard.earnedCents, `${what}: earned`);
    expectCents(dashboard.projectedCents, `${what}: projected`);
  }
  // The simulator pays nobody the dashboards do not know.
  for (const employeeId of Object.keys(ws.sim.snapshot.earningsCents)) {
    expect(ws.employee.has(employeeId), `${employeeId} of the simulator's earnings is an employee`).toBe(true);
  }
  const dashboards = [...ws.employee.values()];
  expect(sum(dashboards.map((d) => d.earnedCents)), `earned rewards ${at(ws)}`).toBe(ws.sim.snapshot.metrics.earnedRewardsCents);
  expect(sum(dashboards.map((d) => d.projectedCents)), `projected rewards ${at(ws)}`).toBe(sum(ws.sim.jobs.map((job) => job.rewardCents)));
}

// ---------- rule: notifications ----------

/** Every notification of every dashboard, with the dashboard it was read from. */
export function allNotifications(ws: Workspaces): { note: Notification; audience: 'business' | 'employee'; audienceId: string }[] {
  return [
    ...[...ws.business].flatMap(([id, d]) => d.notifications.map((note) => ({ note, audience: 'business' as const, audienceId: id }))),
    ...[...ws.employee].flatMap(([id, d]) => d.notifications.map((note) => ({ note, audience: 'employee' as const, audienceId: id }))),
  ];
}

/**
 * Every notification names a delivery that exists: its delivery, its plan and (for an employee) its job
 * are in the simulator's answer, it was sent to someone who has a part in that delivery, and its text
 * says which package it is about. And nobody with a part in a plan is left without one.
 */
export function expectNotificationsNameDeliveries(ws: Workspaces): void {
  const notes = allNotifications(ws);
  expect(new Set(notes.map(({ note }) => note.id)).size, 'notification IDs are unique').toBe(notes.length);

  for (const { note, audience, audienceId } of notes) {
    const what = `notification ${note.id} in the ${audience} dashboard of ${audienceId}`;
    expect(note.audience, what).toBe(audience);
    expect(note.audienceId, what).toBe(audienceId);

    const shipment = ws.sim.shipments.find((s) => s.id === note.shipmentId);
    expect(shipment, `${what}: delivery ${note.shipmentId} exists`).toBeDefined();
    const plan = ws.sim.plans.find((p) => p.id === note.planId);
    expect(plan, `${what}: plan ${note.planId} exists`).toBeDefined();
    expect(plan!.shipmentId, `${what}: the plan is the delivery's`).toBe(note.shipmentId);
    expect(ws.shipment.get(note.shipmentId)?.plan?.id, `${what}: GET /shipments/:id shows that plan`).toBe(note.planId);

    // The text is for a person: it names the package and holds no missing value.
    expect(note.message.trim(), what).not.toBe('');
    expect(note.message, `${what}: names the package`).toContain(shipment!.label);
    expect(note.message, what).not.toMatch(/undefined|NaN|null/);

    if (audience === 'business') {
      expect(note.kind, what).toBe('delivery_matched');
      expect(note.jobId, what).toBeUndefined();
      expect([shipment!.originBusinessId, shipment!.destinationBusinessId, plan!.relayBusinessId], `${what}: sender, recipient or relay point`)
        .toContain(audienceId);
    } else {
      expect(note.kind, what).toBe('job_assigned');
      const job = ws.sim.jobs.find((j) => j.id === note.jobId);
      expect(job, `${what}: job ${note.jobId} exists`).toBeDefined();
      expect(job!.employeeId, `${what}: the job is this employee's`).toBe(audienceId);
      expect(job!.planId, what).toBe(note.planId);
      expect(jobRows(ws.employee.get(audienceId)!).map((row) => row.job.id), `${what}: the job is in the same dashboard`).toContain(note.jobId);
    }
  }

  // Nobody is left out: the sender and the recipient of every plan, and the carrier of every job.
  const has = (list: Notification[], test: (note: Notification) => boolean) => list.filter(test).length;
  for (const plan of ws.sim.plans) {
    const shipment = ws.sim.shipments.find((s) => s.id === plan.shipmentId)!;
    for (const businessId of [shipment.originBusinessId, shipment.destinationBusinessId]) {
      expect(has(ws.business.get(businessId)!.notifications, (note) => note.planId === plan.id), `${businessId} is told about ${plan.id}`).toBe(1);
    }
  }
  for (const job of ws.sim.jobs) {
    expect(has(ws.employee.get(job.employeeId)!.notifications, (note) => note.jobId === job.id), `${job.employeeId} is told about ${job.id}`).toBe(1);
  }
}

/**
 * A business that is the relay point of a plan can see that role in its dashboard. `BusinessDashboard`
 * has no list of packages held at the business, so the role shows the way the Business page reads it
 * (DECISIONS pass 50, `business/v2/activity/activityModel.ts`): a notification about a delivery the
 * business neither sends nor receives. The page then opens that package with GET /shipments/:id
 * (pass 60), which must name this business as the relay business.
 * Returns how many relay plans were checked, so a caller can tell the rule was not empty.
 */
export function expectRelayRoleVisible(ws: Workspaces): number {
  const relayPlans = ws.sim.plans.filter((plan) => plan.kind === 'relay');
  for (const plan of relayPlans) {
    const relayId = plan.relayBusinessId as string;
    const what = `relay point ${relayId} of ${plan.id}`;
    const dashboard = ws.business.get(relayId);
    expect(dashboard, `${what}: has a dashboard`).toBeDefined();
    const own = new Set([...dashboard!.outgoing, ...dashboard!.incoming].map((row) => row.shipment.id));
    expect(own.has(plan.shipmentId), `${what}: neither sends nor receives the package`).toBe(false);
    const notes = dashboard!.notifications.filter((note) => note.shipmentId === plan.shipmentId);
    expect(notes, `${what}: one notification about the package it holds`).toHaveLength(1);
    expect(notes[0].planId, what).toBe(plan.id);
    expect(ws.shipment.get(notes[0].shipmentId)?.plan?.relayBusinessId, `${what}: GET /shipments/:id names it`).toBe(relayId);
  }

  // The other way round: a notification about someone else's delivery is only ever the relay role.
  for (const [id, dashboard] of ws.business) {
    const own = new Set([...dashboard.outgoing, ...dashboard.incoming].map((row) => row.shipment.id));
    for (const note of dashboard.notifications) {
      if (own.has(note.shipmentId)) continue;
      const plan = ws.sim.plans.find((p) => p.id === note.planId);
      expect(plan?.relayBusinessId, `${note.id}: ${id} is the relay point of that plan`).toBe(id);
    }
  }
  return relayPlans.length;
}

// ---------- two readers ----------

/** One poll of a reader: the simulator and the dashboards of the pages it has open. */
export type Poll = {
  sim: SimulatorResponse;
  business: Record<string, BusinessDashboard>;
  employee: Record<string, EmployeeDashboard>;
};

export type Reader = ReturnType<typeof openReader>;

/**
 * A client that polls, like a browser with the three workspaces open (SPEC must-have 10): the simulator,
 * the Business page of each of `businessIds` and the Employee page of each of `employeeIds`.
 * It is opened once. Every poll asks the same URLs again and nothing else: no lists, no map, no reload.
 */
export function openReader(api: NycApi, pages: { businessIds: string[]; employeeIds: string[] }) {
  const enc = encodeURIComponent;
  const businessIds = [...new Set(pages.businessIds)];
  const employeeIds = [...new Set(pages.employeeIds)];
  const polls: Poll[] = [];

  const read = async <B>(url: string): Promise<B> => {
    const res = await api.get<B>(url);
    expect(res.status, `GET ${url}`).toBe(200);
    return res.body;
  };

  return {
    /** Every poll so far, oldest first. */
    polls,
    /** The poll before the newest one. */
    previous: (): Poll => {
      const poll = polls.at(-2);
      if (!poll) throw new Error('This reader has polled fewer than two times');
      return poll;
    },
    /** One round of the 1 s poll: all pages asked at once, the way separate tabs do. */
    poll: async (): Promise<Poll> => {
      const [sim, business, employee] = await Promise.all([
        read<SimulatorResponse>('/simulator'),
        Promise.all(businessIds.map(async (id) => [id, await read<BusinessDashboard>(`/businesses/${enc(id)}/dashboard`)] as const)),
        Promise.all(employeeIds.map(async (id) => [id, await read<EmployeeDashboard>(`/employees/${enc(id)}/dashboard`)] as const)),
      ]);
      const poll: Poll = { sim, business: Object.fromEntries(business), employee: Object.fromEntries(employee) };
      polls.push(poll);
      return poll;
    },
  };
}

/** Every version a poll holds: the simulator's, its snapshot's and each dashboard's. */
export const versionsOf = (poll: Poll): number[] => [
  poll.sim.version, poll.sim.snapshot.version,
  ...Object.values(poll.business).map((d) => d.version),
  ...Object.values(poll.employee).map((d) => d.version),
];
