// #761 (docs/mvp4.md F2): Play on the homepage's package ("Watch a package", the Navy Yard relay) shows each
// carrier's WHOLE commute. Carrier A leaves work with the package, drops it at the relay point and drives on
// home; the "Overnight at <relay point>" card; carrier B leaves home, picks up at the relay point and
// delivers at work.
//
// The real journey player (journeyPlay.ts) runs on the REAL default NYC run with fake timers: its `control`
// is answered like POST /api/v2/simulator/control `seek` (sim-v2-real-helper.ts `at`: planControl, the real
// `snapshotAt`, simulatorResponse), so every position asserted here is the server's. The package is found
// the way the homepage finds it (`watchPackageId`); no ID, name or minute is written here (pass 54).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimControlRequest } from '../../shared/v2/schemas';
import type { LatLng } from '../../shared/v2/types';
import {
  createJourneyPlayer, journeyWindows, type PlayState,
} from '../../client/src/components/sim/v2/compose/journeyPlay';
import { buildJourney, playPlan, type Journey } from '../../client/src/components/sim/v2/journey/journeyModel';
import {
  JOURNEY_COMMUTE_STEP_MIN, JOURNEY_STEP_MIN, JOURNEY_STEP_MS, OVERNIGHT_CARD_MS, nextJourneyAction,
} from '../../client/src/components/sim/v2/motion/journeyPlayback';
import { watchPackageId } from '../../client/src/pages/landingModel';
import { T, metersBetween, realSim, type Moment } from './sim-v2-real-helper';

vi.setConfig({ testTimeout: T, hookTimeout: T });

const real = realSim();
const { sim, map } = real.moments[0];

// ---------- The story, read from the run ----------
const shipmentId = watchPackageId(sim)!;
const plan = sim.plans.find((p) => p.shipmentId === shipmentId)!;
const [legA, legB] = plan.legs;
const tripOf = (tripId: string) => real.run.trips.find((t) => t.id === tripId)!;
const [tripA, tripB] = [tripOf(legA.tripId), tripOf(legB.tripId)];
const journey = buildJourney({ shipmentId, sim, map }) as Journey;
const windows = journeyWindows(journey);

const place = (id: string): LatLng => {
  const p = map.businesses.find((b) => b.id === id) ?? map.homes.find((h) => h.id === id);
  if (!p) throw new Error(`no place ${id} in the map answer`);
  return { lat: p.lat, lng: p.lng };
};
const employee = (id: string) => map.employees.find((e) => e.id === id)!;
const [empA, empB] = [employee(legA.employeeId), employee(legB.employeeId)];
const relayId = plan.relayBusinessId!;
const [pickup, drop] = [legA.stops[0], legA.stops[legA.stops.length - 1]];
const [collect, deliver] = [legB.stops[0], legB.stops[legB.stops.length - 1]];

/** A route line starts on the road next to its place, not on the place's own point. */
const NEAR_M = 300;
const near = (a: LatLng | undefined, b: LatLng) => a !== undefined && metersBetween(a, b) <= NEAR_M;
const markerOf = (m: Moment, employeeId: string) => m.sim.snapshot.markers.find((x) => x.employeeId === employeeId);

/** What one press of Play takes in real time, computed from the plan's windows alone. */
function realTimeMs(): { ms: number; seeks: number[] } {
  const seeks: number[] = [];
  let cards = 0;
  let t = -Infinity;
  for (;;) {
    const a = nextJourneyAction(windows, t);
    if (a.kind === 'done') return { ms: seeks.length * JOURNEY_STEP_MS + cards * OVERNIGHT_CARD_MS, seeks };
    if (a.toMin <= t || seeks.length > 10_000) throw new Error('the journey never ends');
    if (a.overnight) cards += 1;
    seeks.push(a.toMin);
    t = a.toMin;
  }
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('the homepage\'s package on the real NYC run: the plan (#761)', () => {
  it('it is a relay: carrier A on an evening trip from work, carrier B on a morning trip to work', () => {
    expect(plan.kind).toBe('relay');
    expect(plan.legs).toHaveLength(2);
    expect(tripA.direction).toBe('evening');
    expect(tripB.direction).toBe('morning');
    // Homes are only commute end points: A ends at home, B starts at home; every stop is a business.
    expect(legA.placeIds[0]).toBe(empA.businessId);
    expect(legA.placeIds[legA.placeIds.length - 1]).toBe(empA.homeId);
    expect(legB.placeIds[0]).toBe(empB.homeId);
    expect(legB.placeIds[legB.placeIds.length - 1]).toBe(empB.businessId);
    for (const s of [...legA.stops, ...legB.stops]) expect(map.businesses.some((b) => b.id === s.placeId)).toBe(true);
  });

  it('the simulator answer has both carriers\' trips, and the journey reads the departures from them', () => {
    expect(sim.trips!.map((t) => t.id)).toEqual(expect.arrayContaining([tripA.id, tripB.id]));
    expect(journey.commutes).toEqual([
      { legIndex: 0, departureMin: tripA.departureMin, finishMin: legA.finishMin },
      { legIndex: 1, departureMin: tripB.departureMin, finishMin: legB.finishMin },
    ]);
  });

  it('each window runs from the trip\'s departure (minus 1) to the leg\'s finish; the package part is the stops', () => {
    expect(playPlan(journey).windows).toEqual([
      {
        legIndex: 0, startMin: tripA.departureMin - 1, endMin: legA.finishMin,
        carryStartMin: pickup.arrivalMin - 1, carryEndMin: drop.serviceEndMin,
      },
      {
        legIndex: 1, startMin: tripB.departureMin - 1, endMin: legB.finishMin,
        carryStartMin: collect.arrivalMin - 1, carryEndMin: deliver.serviceEndMin,
      },
    ]);
    // Wider than the stops on both sides that have a drive without the package.
    expect(legA.finishMin).toBeGreaterThan(drop.serviceEndMin); // A drives on home after the drop
    expect(tripB.departureMin).toBeLessThan(collect.arrivalMin); // B drives from home to the relay point
  });

  it('without `trips` (an answer from before #761) the same journey falls back to the stop-based windows', () => {
    const { trips: _trips, ...old } = sim;
    const before = buildJourney({ shipmentId, sim: old, map }) as Journey;
    expect(journeyWindows(before)).toEqual([
      { startMin: pickup.arrivalMin - 1, endMin: drop.serviceEndMin, carryStartMin: pickup.arrivalMin - 1, carryEndMin: drop.serviceEndMin },
      { startMin: collect.arrivalMin - 1, endMin: deliver.serviceEndMin, carryStartMin: collect.arrivalMin - 1, carryEndMin: deliver.serviceEndMin },
    ]);
  });

  it('the whole journey plays in about 30 s of real time: at most 40 s, computed from the plan', () => {
    const { ms, seeks } = realTimeMs();
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(40_000);
    // The steps: small around the package, larger while a carrier drives without it, never larger than that.
    for (let i = 1; i < seeks.length; i += 1) {
      const step = seeks[i] - seeks[i - 1];
      const overNight = seeks[i - 1] === legA.finishMin;
      if (overNight) continue;
      expect(step).toBeGreaterThan(0);
      const aroundPackage = windows.some((w) => seeks[i - 1] >= w.carryStartMin! && seeks[i] <= w.carryEndMin!);
      expect(step).toBeLessThanOrEqual(aroundPackage ? JOURNEY_STEP_MIN : JOURNEY_COMMUTE_STEP_MIN);
    }
    console.log(`[#761] Play on the homepage's package: ${seeks.length} seeks, ${ms / 1000} s of real time`);
  });
});

describe('Play on the homepage\'s package, with fake timers on the real run (#761)', () => {
  /** Plays the whole journey; every seek is answered by the real server views. */
  async function playAll() {
    const moments: Moment[] = [];
    const states: PlayState[] = [];
    /** The seeks sent before the overnight card went up. */
    let beforeCard = -1;
    const control = vi.fn(async (req: SimControlRequest) => {
      if (req.action !== 'seek') throw new Error(`unexpected control ${req.action}`);
      const m = real.at(req.timeMin);
      moments.push(m);
      return m.sim;
    });
    const player = createJourneyPlayer({
      control,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      onChange: (s) => {
        states.push(s);
        if (s.status === 'running' && s.overnight && beforeCard < 0) beforeCard = moments.length;
      },
    });
    player.start({ shipmentId, runId: sim.runId, windows, fromMin: -Infinity, clockPlaying: false });
    const { ms } = realTimeMs();
    await vi.advanceTimersByTimeAsync(ms - 1);
    const runningJustBeforeTheEnd = player.state().status === 'running';
    await vi.advanceTimersByTimeAsync(1);
    return { moments, states, player, control, beforeCard, runningJustBeforeTheEnd, ms };
  }

  it('the seek sequence starts at carrier A\'s departure and ends at carrier B\'s leg finish, with one card for the night', async () => {
    const { moments, states, player, control, beforeCard, runningJustBeforeTheEnd, ms } = await playAll();
    const seeks = moments.map((m) => m.timeMin);

    expect(seeks[0]).toBe(tripA.departureMin - 1);
    expect(seeks[seeks.length - 1]).toBe(legB.finishMin);
    expect(seeks).toEqual(realTimeMs().seeks);
    for (let i = 1; i < seeks.length; i += 1) expect(seeks[i]).toBeGreaterThan(seeks[i - 1]);

    // The evening ends when A is home; then the card; then one jump to just before B leaves home.
    expect(beforeCard).toBeGreaterThan(0);
    expect(seeks[beforeCard - 1]).toBe(legA.finishMin);
    expect(seeks[beforeCard]).toBe(tripB.departureMin - 1);
    expect(seeks[beforeCard + 1]).toBe(tripB.departureMin);
    expect(seeks.filter((t) => t > legA.finishMin && t < tripB.departureMin - 1)).toEqual([]); // the night is never played
    expect(states.filter((s) => s.status === 'running' && s.overnight)).toHaveLength(1);

    // It ends by itself after exactly the computed real time, at most 40 s; nothing is sent after it.
    expect(runningJustBeforeTheEnd).toBe(true);
    expect(player.state()).toEqual({ status: 'finished', shipmentId, runId: sim.runId });
    expect(ms).toBeLessThanOrEqual(40_000);
    const calls = control.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(control.mock.calls.length).toBe(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('evening: A leaves work with the package, drops it at the relay point, drives on home', async () => {
    const { moments, beforeCard } = await playAll();
    const evening = moments.slice(0, beforeCard);
    const status = (m: Moment) => m.sim.snapshot.shipmentStatus[shipmentId];
    const pkg = (m: Moment) => m.sim.snapshot.packagePositions[shipmentId];

    // Before A sets off: the package waits at the sender.
    expect(status(evening[0])).toBe('scheduled');
    expect(near(pkg(evening[0]), place(pickup.placeId))).toBe(true);

    // A is first seen at work (the sender), and is on the map at every later evening step.
    const seen = evening.filter((m) => markerOf(m, empA.id));
    expect(seen.length).toBeGreaterThanOrEqual(evening.length - 1);
    expect(near(markerOf(seen[0], empA.id), place(empA.businessId))).toBe(true);
    expect(seen[0].timeMin).toBeLessThanOrEqual(tripA.departureMin + JOURNEY_STEP_MIN);

    // With the package between the pickup and the drop: the package is where A is.
    const carrying = evening.filter((m) => markerOf(m, empA.id)?.carryingShipmentId === shipmentId);
    expect(carrying.length).toBeGreaterThan(0);
    for (const m of carrying) {
      expect(m.timeMin).toBeGreaterThanOrEqual(pickup.serviceEndMin);
      expect(m.timeMin).toBeLessThan(drop.serviceEndMin);
      expect(status(m)).toBe('picked_up');
      expect(metersBetween(pkg(m), markerOf(m, empA.id)!)).toBeLessThan(1);
    }

    // After the drop: the package stays at the relay point while A drives on, away from it, to home.
    const after = evening.filter((m) => m.timeMin >= drop.serviceEndMin);
    expect(after.length).toBeGreaterThan(2);
    for (const m of after) {
      expect(status(m)).toBe('at_hub');
      expect(near(pkg(m), place(relayId))).toBe(true);
      expect(markerOf(m, empA.id)?.carryingShipmentId).toBeUndefined();
    }
    const fromRelay = after.map((m) => metersBetween(markerOf(m, empA.id)!, place(relayId)));
    expect(fromRelay[fromRelay.length - 1]).toBeGreaterThan(NEAR_M);
    const moved = after.slice(1).filter((m, i) => metersBetween(markerOf(m, empA.id)!, markerOf(after[i], empA.id)!) > 50);
    expect(moved.length).toBeGreaterThanOrEqual(after.length - 2); // A moves at (nearly) every step

    // The last evening step: A is home. A home is only the end of the commute, never where the package is.
    const last = evening[evening.length - 1];
    expect(last.timeMin).toBe(legA.finishMin);
    expect(metersBetween(markerOf(last, empA.id)!, place(empA.homeId))).toBeLessThan(1);
    expect(near(pkg(last), place(empA.homeId))).toBe(false);
  });

  it('morning: B leaves home, picks up at the relay point, delivers at work', async () => {
    const { moments, beforeCard } = await playAll();
    const morning = moments.slice(beforeCard);
    const status = (m: Moment) => m.sim.snapshot.shipmentStatus[shipmentId];
    const pkg = (m: Moment) => m.sim.snapshot.packagePositions[shipmentId];

    // One minute before B leaves: nobody on the road for this package, which waited at the relay point.
    expect(markerOf(morning[0], empB.id)).toBeUndefined();
    expect(status(morning[0])).toBe('at_hub');
    expect(near(pkg(morning[0]), place(relayId))).toBe(true);

    // The departure: B is at home, without the package.
    expect(morning[1].timeMin).toBe(tripB.departureMin);
    expect(near(markerOf(morning[1], empB.id), place(empB.homeId))).toBe(true);
    expect(markerOf(morning[1], empB.id)?.carryingShipmentId).toBeUndefined();

    // The drive from home to the relay point: B is on the map at every step and gets closer to the relay point.
    const toRelay = morning.filter((m) => m.timeMin >= tripB.departureMin && m.timeMin <= collect.arrivalMin);
    expect(toRelay.length).toBeGreaterThan(2);
    for (const m of toRelay) {
      expect(status(m)).toBe('at_hub');
      expect(near(pkg(m), place(relayId))).toBe(true);
      expect(markerOf(m, empB.id)?.carryingShipmentId).toBeUndefined();
    }
    const gap = toRelay.map((m) => metersBetween(markerOf(m, empB.id)!, place(relayId)));
    expect(gap[0]).toBeGreaterThan(NEAR_M);
    expect(gap[gap.length - 1]).toBeLessThan(gap[0]);

    // With the package from the relay point's pickup to the delivery.
    const carrying = morning.filter((m) => markerOf(m, empB.id)?.carryingShipmentId === shipmentId);
    expect(carrying.length).toBeGreaterThan(0);
    for (const m of carrying) {
      expect(m.timeMin).toBeGreaterThanOrEqual(collect.serviceEndMin);
      expect(m.timeMin).toBeLessThan(deliver.serviceEndMin);
      expect(status(m)).toBe('out_for_delivery');
    }

    // The last step: B's leg is finished, B is at work and the package is delivered there.
    const last = morning[morning.length - 1];
    expect(last.timeMin).toBe(legB.finishMin);
    expect(status(last)).toBe('delivered');
    expect(metersBetween(markerOf(last, empB.id)!, place(empB.businessId))).toBeLessThan(1);
    expect(near(pkg(last), place(deliver.placeId))).toBe(true);
    expect(last.sim.snapshot.deliveredAtMin[shipmentId]).toBe(deliver.serviceEndMin);
  });
});
