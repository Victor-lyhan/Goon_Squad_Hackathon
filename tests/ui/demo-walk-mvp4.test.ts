// #847: the API half of the MVP IV demo walk, so a later PR cannot silently break the path.
// The walk itself was done once in headless Chrome at 1440x900 against `npm run build && npm start` (the PR
// body has one row per step). This file replays what that walk sent to the server, in the same order, on a
// fresh run and with no key:
//
//   1. the README demo sentence, typed on the sender's Business page   POST /api/v2/parse-request (offline)
//   2. "Find a delivery match" on the card it fills in                  POST /api/v2/shipments
//      -> Relay via Etsy, $10.00, Elena Rossi (evening) then Reese Green (morning)
//   3. `/` -> "Watch a package": the journey plays to "Journey complete"   seeks
//   4. "Back to start", then Play with no package (network Play)           reset_playback, then seeks to the
//      end of the day; Elena Rossi's "Arrive home" (Day 1, 6:22 PM) is ticked only from that minute
//
// The server is the real one of tests/ui/demo-rehearse-twice-helper.ts (PR #818): `createV2Runtime` on a temp
// copy of fixtures/nyc with a temp state file and no Google or Gemini key, listening on 127.0.0.1 only (PR #822).
// Its clock ticker is not started, so the clock moves only when a control moves it.
// The requests go through client/src/api, and the pages' own models decide what is sent and what is shown:
// the New delivery form's draft and request (newDeliveryModel), the homepage's package (landingModel), the
// simulator's player with its windows and steps (journeyPlay) and the Employee job view's rows (jobDetailV2Model).
// The player's 500 ms timer is run by hand here, so the two Plays take no real time and each seek is checked
// before the next one is sent.
//
// Written here are the sentence and the demo numbers the issue names (Etsy, $10.00, Elena Rossi, Reese Green,
// Day 1, 6:22 PM). Everything else is read from the README's ```demo-request block or from the run, by name.
// "See the numbers" (`/study.html`) is not part of this file: it is a static page outside the API (#841).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EmployeeDashboard, JobResponse, ShipmentResponse, SimulatorResponse } from '../../shared/v2/api';
import type { ParseRequestResponse } from '../../shared/v2/parseRequest';
import type { SimControlRequest } from '../../shared/v2/schemas';
import type { Employee, NetworkBusiness } from '../../shared/v2/types';
import {
  createShipment, getBusinesses, getEmployeeDashboard, getEmployees, getJob, getMap, getSimulator, parseRequest,
  simulatorControl,
} from '../../client/src/api/v2';
import { draftFromParsed, toRequest, validate } from '../../client/src/components/business/v2/newDeliveryModel';
import { parsedFields } from '../../client/src/components/business/v2/requestTextModel';
import { routeRows, type RouteRow } from '../../client/src/components/employee/v2/jobDetailV2Model';
import {
  NETWORK_FINISHED_TEXT, createJourneyPlayer, journeyWindows, networkWindows, playButtonView, playFromMin,
  playStatusText, PLAY_IDLE, PLAY_LABEL, type JourneyStart, type PlayState,
} from '../../client/src/components/sim/v2/compose/journeyPlay';
import { SIM_END_MIN } from '../../client/src/components/sim/v2/compose/simPageView';
import { FINISHED_REASON, RESET_REQUEST } from '../../client/src/components/sim/v2/controls/controlsModel';
import { buildJourney, type Journey } from '../../client/src/components/sim/v2/journey/journeyModel';
import { journeyEndMin } from '../../client/src/components/sim/v2/motion/journeyPlayback';
import { WATCH_PACKAGE_LABEL, watchPackageId } from '../../client/src/pages/landingModel';
import { formatCents } from '../../client/src/ui/format';
import { nycFilesState } from '../api/v2-e2e-nyc-helper';
import { T, byName, readmeDemo, startRehearsalApi, type RehearsalApi } from './demo-rehearse-twice-helper';

vi.setConfig({ testTimeout: T, hookTimeout: T });

// ---------- the demo numbers (issue #847, README "2-minute demo") ----------

/** The sentence of the demo (DECISIONS pass 85), typed on the Business page of the README's sender. */
const SENTENCE = 'Send a 0.5 kg envelope of espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow, ready at 4 p.m.';
const RELAY_POINT = 'Etsy';
const PRICE = '$10.00';
const EVENING_CARRIER = 'Elena Rossi';
const MORNING_CARRIER = 'Reese Green';
/** The end row of Elena Rossi's job view: she is home at this time, and the row is ticked from then on. */
const ARRIVE_HOME = { action: 'Arrive home', time: 'Day 1, 6:22 PM' };

const demo = readmeDemo();

let api: RehearsalApi;
let nycBefore: string[];
let businesses: NetworkBusiness[];
let employees: Employee[];
let sender: NetworkBusiness;
let recipient: NetworkBusiness;
let elena: Employee;
/** The run before anything was sent. */
let fresh: SimulatorResponse;
/** Step 1's answer and step 2's answer, for the steps after them. */
let parsed: ParseRequestResponse;
let arranged: ShipmentResponse;

const businessName = (id: string | undefined) => businesses.find((b) => b.id === id)?.name;
const employeeName = (id: string) => employees.find((e) => e.id === id)?.name;

beforeAll(async () => {
  nycBefore = nycFilesState();
  api = await startRehearsalApi();
  businesses = (await getBusinesses()).businesses;
  employees = (await getEmployees()).employees;
  sender = byName(businesses, demo.sender, 'sender');
  recipient = byName(businesses, demo.recipient, 'recipient');
  elena = byName(employees, EVENING_CARRIER, 'evening carrier');
  fresh = await getSimulator();
});
afterAll(async () => {
  const { outgoing, googleCalls } = api;
  await api.close();
  expect(outgoing).toStrictEqual([]);     // nothing left the test server
  expect(googleCalls).toStrictEqual([]);  // no Google call and no Gemini call: there is no key
  expect(nycFilesState()).toStrictEqual(nycBefore); // nothing was written to the committed fixtures/nyc
});

// ---------- the simulator's Play, with its timer run by hand ----------

type Played = {
  /** The minute of every seek, in the order sent. */
  seeks: number[];
  /** How often the overnight card went up. */
  cards: number;
  /** The real time the player waited between its steps: what a presenter waits for. */
  waitedMs: number;
  /** The player's state after its last step. */
  state: PlayState;
  /** The answer to the last seek. */
  last: SimulatorResponse;
};

/** Far more promise turns than the player needs (about 5) between a seek's answer and its next timer. */
const PROMISE_TURNS = 100;

/**
 * Plays with the simulator's real player (`createJourneyPlayer`) against the real server. Each control goes
 * through client/src/api; `onSeek` runs on its answer before the player schedules the next step, and the
 * player's timer is fired here as soon as that is done. Anything but a seek fails: Play never sends `play`.
 */
async function play(start: JourneyStart, onSeek: (sim: SimulatorResponse) => Promise<void> | void): Promise<Played> {
  const seeks: number[] = [];
  let cards = 0;
  let waitedMs = 0;
  let last: SimulatorResponse | null = null;
  let timer: { fn: () => void; ms: number } | null = null;
  let inFlight: Promise<unknown> = Promise.resolve();
  let failure: unknown = null;

  const player = createJourneyPlayer({
    control: (req: SimControlRequest) => {
      const answer = (async () => {
        if (req.action !== 'seek') throw new Error(`Play sent "${req.action}"; it may only seek (DECISIONS pass 84)`);
        const sim = await simulatorControl(req);
        seeks.push(req.timeMin);
        expect(sim.clock.timeMin, `the clock after a seek to ${req.timeMin}`).toBe(req.timeMin);
        // Play never locks the run and never starts the server clock (pass 84).
        expect(sim.clock.phase, `the phase after a seek to ${req.timeMin}`).toBe('planning');
        expect(sim.clock.playing, `the server clock after a seek to ${req.timeMin}`).toBe(false);
        await onSeek(sim);
        last = sim;
        return sim;
      })();
      inFlight = answer.catch((e: unknown) => { failure ??= e; });
      return answer;
    },
    setTimer: (fn, ms) => { timer = { fn, ms }; return timer; },
    clearTimer: () => { timer = null; },
    onChange: (s) => { if (s.status === 'running' && s.overnight) cards += 1; },
  });

  player.start(start);
  for (let guard = 0; player.state().status === 'running'; guard += 1) {
    if (guard > 5000) throw new Error(`Play is still running after ${seeks.length} seeks`);
    await inFlight; // the seek's answer, and the checks on it
    if (failure) throw failure;
    // The player schedules its next step a few promise turns after the answer. Only promise turns are
    // waited for: with a timer or `setImmediate` between two requests, each seek took about 200 ms here.
    for (let turn = 0; turn < PROMISE_TURNS && timer === null && player.state().status === 'running'; turn += 1) await Promise.resolve();
    const due = timer as { fn: () => void; ms: number } | null;
    if (!due) {
      if (player.state().status === 'running') throw new Error(`Play is running with no step scheduled after ${seeks.length} seeks`);
      break;
    }
    timer = null;
    waitedMs += due.ms;
    due.fn();
  }
  await inFlight;
  if (failure) throw failure;
  if (!last) throw new Error('Play sent no seek');
  for (let i = 1; i < seeks.length; i += 1) expect(seeks[i], 'no minute is played twice or backwards').toBeGreaterThan(seeks[i - 1]);
  return { seeks, cards, waitedMs, state: player.state(), last };
}

/** `METHOD /path {body}` of every write since `from`: what a step changed on the server. */
const writesSince = (from: number) => api.log.slice(from).filter((r) => r.method !== 'GET')
  .map((r) => `${r.method} ${r.path}${r.sent && typeof r.sent === 'object' && 'action' in r.sent ? ` ${String(r.sent.action)}` : ''}`);

// ---------- Elena Rossi's Employee page ----------

type ElenaJob = {
  dashboard: EmployeeDashboard;
  /** `GET /api/v2/jobs/:id`, which the job view shows. */
  job: JobResponse;
  /** The job view's "Your route" rows, as the page builds them. */
  rows: RouteRow[];
  end: RouteRow;
};

/** Elena Rossi's job for the demo delivery: her dashboard's entry, the job view and its rows. */
async function elenaJob(): Promise<ElenaJob> {
  const dashboard = await getEmployeeDashboard(elena.id);
  const listed = [...dashboard.assigned, ...dashboard.completed].filter((j) => j.shipment.id === arranged.shipment.id);
  expect(listed, `${EVENING_CARRIER}'s jobs for ${arranged.shipment.id}`).toHaveLength(1);
  const job = await getJob(listed[0].job.id);
  // The list and the job view say the same about the commute.
  expect({ status: job.status, stopsDone: job.stopsDone, departed: job.departed, arrived: job.arrived })
    .toStrictEqual({ status: listed[0].status, stopsDone: listed[0].stopsDone, departed: listed[0].departed, arrived: listed[0].arrived });
  const rows = routeRows(job, businesses, dashboard.home.neighborhood);
  return { dashboard, job, rows, end: rows[rows.length - 1] };
}

// ---------- the walk ----------

describe('the MVP IV demo walk over the API, on a fresh run with no key (#847)', () => {
  it('starts on a fresh run: planning, paused at the start, the README sender has sent nothing yet', () => {
    expect(fresh.clock.phase).toBe('planning');
    expect(fresh.clock.playing).toBe(false);
    expect(fresh.shipments.length).toBeGreaterThan(0);
    expect(fresh.unmatched).toStrictEqual([]);
    expect(fresh.shipments.filter((s) => s.originBusinessId === sender.id)).toStrictEqual([]);
    // The README block and the issue name the same match.
    expect([demo.relay_point, demo.price, demo.evening_carrier, demo.morning_carrier])
      .toStrictEqual([RELAY_POINT, PRICE, EVENING_CARRIER, MORNING_CARRIER]);
    expect(SENTENCE).toContain(demo.recipient);
  });

  it('1. the sentence is parsed offline to a complete draft, and nothing is stored', async () => {
    const from = api.log.length;
    parsed = await parseRequest(SENTENCE);

    expect(parsed.source).toBe('offline');
    expect(parsed.rejected).toBeNull();
    // The sender is not in the sentence: a request is sent from the business whose page it is typed on.
    expect(parsed.missing).toStrictEqual(['originBusinessId']);
    expect(parsed.draft).toStrictEqual({
      originBusinessId: null,
      destinationBusinessId: recipient.id,
      label: demo.package,
      category: 'envelope',
      description: demo.contents,
      weightKg: Number(demo.weight_kg),
      readyMin: 16 * 60,            // "ready at 4 p.m.": Day 1, 4:00 PM
      deadlineMin: 1440 + 10 * 60,  // "by 10 a.m. tomorrow": Day 2, 10:00 AM
    });

    expect(writesSince(from)).toStrictEqual(['POST /api/v2/parse-request']);
    const after = await getSimulator();
    expect(after.version).toBe(fresh.version);
    expect(after.shipments.map((s) => s.id)).toStrictEqual(fresh.shipments.map((s) => s.id));
  });

  it(`2. Find a delivery match: Relay via ${RELAY_POINT}, ${PRICE}, ${EVENING_CARRIER} then ${MORNING_CARRIER}`, async () => {
    // The card to check: the New delivery form filled from the draft, with nothing left to fill in.
    const { draft, needsInput } = draftFromParsed(parsedFields(parsed), { originId: sender.id, businesses });
    expect(needsInput).toStrictEqual([]);
    expect(validate(draft, sender.id)).toStrictEqual({});

    const from = api.log.length;
    arranged = await createShipment(toRequest(draft, sender.id, 'demo-walk-mvp4'));
    expect(writesSince(from)).toStrictEqual(['POST /api/v2/shipments']);

    expect(arranged.matched).toBe(true);
    expect(arranged.unmatchedReason).toBeNull();
    expect(arranged.status).toBe('scheduled');
    expect(arranged.shipment).toMatchObject({
      originBusinessId: sender.id, destinationBusinessId: recipient.id, label: demo.package, description: demo.contents,
      category: 'envelope', weightGrams: 500, readyMin: 960, deadlineMin: 2040,
    });

    const plan = arranged.plan!;
    expect(plan.kind).toBe('relay');
    expect(businessName(plan.relayBusinessId)).toBe(RELAY_POINT);
    expect(formatCents(plan.customerPriceCents)).toBe(PRICE);
    expect(plan.legs.map((leg) => employeeName(leg.employeeId))).toStrictEqual([EVENING_CARRIER, MORNING_CARRIER]);
    expect(plan.deliveryMin).toBeLessThanOrEqual(arranged.shipment.deadlineMin);
    expect(arranged.jobIds).toHaveLength(2);

    // The run is still open and at its start; the new delivery is its only new one, and nothing is unmatched.
    const sim = await getSimulator();
    expect(sim.clock).toMatchObject({ phase: 'planning', playing: false, timeMin: fresh.clock.timeMin });
    expect(sim.shipments.map((s) => s.id)).toStrictEqual([...fresh.shipments.map((s) => s.id), arranged.shipment.id]);
    expect(sim.unmatched).toStrictEqual([]);
    const trips = new Map((sim.trips ?? []).map((t) => [t.id, t]));
    expect(plan.legs.map((leg) => trips.get(leg.tripId)?.direction)).toStrictEqual(['evening', 'morning']);

    // Elena Rossi's page has the job at once, with every row of its route still open.
    const { dashboard, rows, end } = await elenaJob();
    expect(dashboard.assigned.map((j) => j.shipment.label)).toContain(demo.package);
    expect(rows.map((r) => r.done)).toStrictEqual(rows.map(() => false));
    expect(end).toMatchObject({ kind: 'end', ...ARRIVE_HOME, done: false });
    expect(rows[0]).toMatchObject({ kind: 'start', action: 'Leave work', place: sender.name });
  });

  it('3. Watch a package: the journey plays to "Journey complete" with seeks only, and the run stays open', async () => {
    const sim = await getSimulator();
    const map = await getMap();
    const id = watchPackageId(sim);
    const shipment = sim.shipments.find((s) => s.id === id)!;
    expect(shipment.label).toBe(WATCH_PACKAGE_LABEL);
    expect(id).not.toBe(arranged.shipment.id);
    const journey = buildJourney({ shipmentId: id!, sim, map }) as Journey;
    expect(journey.kind).toBe('journey');
    const windows = journeyWindows(journey);

    const from = api.log.length;
    const played = await play(
      { shipmentId: id, runId: sim.runId, windows, fromMin: playFromMin(PLAY_IDLE, windows, sim.clock.timeMin), clockPlaying: sim.clock.playing },
      () => undefined,
    );
    expect(played.state.status).toBe('finished');
    expect(played.cards).toBe(1); // a relay: one night at the relay point
    expect(played.seeks[played.seeks.length - 1]).toBe(journeyEndMin(windows));
    expect(new Set(writesSince(from))).toStrictEqual(new Set(['POST /api/v2/simulator/control seek']));
    // About 16 s for a presenter (README "30-second demo").
    expect(played.waitedMs).toBeGreaterThan(5_000);
    expect(played.waitedMs).toBeLessThanOrEqual(30_000);

    // What the page shows when it ends: the line under the buttons, and Play again.
    const end = played.last;
    const ended = buildJourney({ shipmentId: id!, sim: end, map }) as Journey;
    expect(playStatusText(ended, played.state, end.clock.timeMin))
      .toBe(`Journey complete: Delivered to recipient at ${businessName(shipment.destinationBusinessId)}.`);
    expect(playButtonView({ packagePicked: true, journey: ended, play: played.state, clock: end.clock, busy: false, simEndMin: SIM_END_MIN }))
      .toMatchObject({ label: PLAY_LABEL, action: 'play_journey' });
    expect(end.snapshot.shipmentStatus[id!]).toBe('delivered');
    expect(end.clock.timeMin).toBeGreaterThanOrEqual(1440); // the clock is left on Day 2
  });

  it(`4. Back to start, then Play with no package: seeks to the end of the day, never locked, and "${ARRIVE_HOME.action}" at ${ARRIVE_HOME.time} is ticked only from that minute`, async () => {
    // Back to start: the clock is at the start again, paused, and the demo delivery keeps its plan.
    const reset = await simulatorControl(RESET_REQUEST);
    expect(reset.clock).toMatchObject({ phase: 'planning', playing: false, timeMin: fresh.clock.timeMin });
    expect(new Set(Object.values(reset.snapshot.shipmentStatus))).toStrictEqual(new Set(['scheduled']));
    expect(reset.plans.find((p) => p.shipmentId === arranged.shipment.id)).toStrictEqual(arranged.plan);

    const before = await elenaJob();
    const leg = before.job.plan.legs[before.job.job.legIndex];
    const lastStop = leg.stops[leg.stops.length - 1];
    expect(before.rows.map((r) => r.done)).toStrictEqual(before.rows.map(() => false));
    expect(before.end).toMatchObject({ ...ARRIVE_HOME, done: false });
    // She drives on after her last stop, so "completed" comes before "arrived" (DECISIONS pass 91).
    expect(leg.finishMin).toBeGreaterThan(lastStop.serviceEndMin);

    /** Seeks at which the job reads Completed while "Arrive home" is still open. */
    const completedNotHome: number[] = [];
    /** The first seek at which "Arrive home" is ticked. */
    let tickedAt: number | null = null;
    const from = api.log.length;
    const played = await play(
      { shipmentId: null, runId: reset.runId, windows: networkWindows(reset, SIM_END_MIN), fromMin: reset.clock.timeMin, clockPlaying: reset.clock.playing },
      async (sim) => {
        const t = sim.clock.timeMin;
        const { job, rows, end } = await elenaJob();
        const home = t >= leg.finishMin;
        expect(job.arrived, `arrived at minute ${t}`).toBe(home);
        expect(end, `the end row at minute ${t}`).toMatchObject({ ...ARRIVE_HOME, done: home });
        // The rows above it follow the server's own counts.
        expect(rows[0].done, `"Leave work" at minute ${t}`).toBe(job.departed);
        expect(rows.slice(1, -1).map((r) => r.done), `the stops at minute ${t}`)
          .toStrictEqual(leg.stops.map((_, i) => i < (job.stopsDone ?? 0)));
        if (job.status === 'completed' && !home) completedNotHome.push(t);
        if (home && tickedAt === null) tickedAt = t;
      },
    );

    expect(played.state.status).toBe('finished');
    expect(played.cards).toBe(1); // the one night, between the evening and the morning commutes
    expect(played.seeks[played.seeks.length - 1]).toBe(SIM_END_MIN);
    expect(new Set(writesSince(from))).toStrictEqual(new Set(['POST /api/v2/simulator/control seek']));
    // About 40 s for a presenter (README "State file and reset").
    expect(played.waitedMs).toBeGreaterThan(10_000);
    expect(played.waitedMs).toBeLessThanOrEqual(60_000);

    // Play showed the minutes between her last stop and her home: Completed, and not home yet.
    expect(completedNotHome.length).toBeGreaterThan(0);
    expect(tickedAt).not.toBeNull();
    expect(tickedAt!).toBeGreaterThanOrEqual(leg.finishMin);
    expect(tickedAt! - leg.finishMin).toBeLessThan(5); // the first step at or after she is home

    // The end of the day: every delivery Delivered, the run still open, the button's note as the page shows it.
    const end = played.last;
    expect(end.clock).toMatchObject({ phase: 'planning', playing: false, timeMin: SIM_END_MIN });
    expect(new Set(Object.values(end.snapshot.shipmentStatus))).toStrictEqual(new Set(['delivered']));
    expect(Object.keys(end.snapshot.shipmentStatus)).toHaveLength(fresh.shipments.length + 1);
    expect(playStatusText(null, played.state, end.clock.timeMin)).toBe(NETWORK_FINISHED_TEXT);
    expect(playButtonView({ packagePicked: false, journey: null, play: played.state, clock: end.clock, busy: false, simEndMin: SIM_END_MIN }))
      .toMatchObject({ label: PLAY_LABEL, action: null, note: FINISHED_REASON });

    // Elena Rossi's page at the end: the job is under Completed, every row ticked, the reward earned.
    const after = await elenaJob();
    expect(after.dashboard.assigned).toStrictEqual([]);
    expect(after.dashboard.completed.map((j) => j.shipment.label)).toContain(demo.package);
    expect(after.rows.map((r) => r.done)).toStrictEqual(after.rows.map(() => true));
    expect(after.end).toMatchObject({ kind: 'end', ...ARRIVE_HOME, done: true });
    expect(after.dashboard.earnedCents).toBe(after.dashboard.projectedCents);
    expect(after.dashboard.earnedCents).toBeGreaterThanOrEqual(after.job.job.rewardCents);

    // The exact minute, off Play's 4-minute steps: one minute before 6:22 PM the row is open, at 6:22 PM it is ticked.
    await simulatorControl({ action: 'seek', timeMin: leg.finishMin - 1 });
    const minuteBefore = await elenaJob();
    expect(minuteBefore.job).toMatchObject({ status: 'completed', arrived: false });
    expect(minuteBefore.end).toMatchObject({ ...ARRIVE_HOME, done: false });
    const onTheMinute = await simulatorControl({ action: 'seek', timeMin: leg.finishMin });
    expect((await elenaJob()).end).toMatchObject({ ...ARRIVE_HOME, done: true });
    expect(onTheMinute.clock.phase).toBe('planning'); // after all of it the run is still open
  });
});
