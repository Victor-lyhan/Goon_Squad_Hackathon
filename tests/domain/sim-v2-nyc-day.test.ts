// A whole simulated day of the default NYC run on the COMMITTED travel cache (#516): real Google travel times
// and real route lines, every minute from 930 to 2160, through the real engine (buildNycScenario, buildTrips,
// assignShipments, buildTimeline, snapshotAt). The straight-line twin of this file is sim-v2-day-*.
// Every assertion is a rule that holds for any story: no story ID, name or matched count is pinned
// (DECISIONS pass 54), so the story can be retuned (#492) without touching this file.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import type { JobStatus, ShipmentProgress, SimEventKind, Snapshot, StopKind } from '../../shared/v2/types.js';
import { jobIdFor } from '../../shared/v2/types.js';
import { assignShipments } from '../../server/domain/v2/matching.js';
import { nextEventMin, snapshotAt } from '../../server/domain/v2/simulation.js';
import { buildTimeline } from '../../server/domain/v2/timeline.js';
import { buildTrips } from '../../server/domain/v2/trips.js';
import {
  DAY_END_MIN, DAY_START_MIN, buildNycDay, deepFreeze, deriveLegs, type DerivedLeg,
} from './sim-v2-nyc-helper.js';

/** Per test (DECISIONS pass 19). The whole file takes well under a second locally. */
const T = 30_000;
/**
 * The 1231 snapshots of the day, measured locally: 33 to 50 ms with this file alone, 100 to 175 ms inside the
 * whole suite (`bash scripts/test.sh`, all workers busy). The limit is 10x the slower one (DECISIONS pass 52).
 */
const LOCAL_DAY_MS = 175;

const day = buildNycDay();
const { run, travel, places, businessIds, homeIds } = day;
const { scenario } = run;
const { plans } = run.assignments;
const legs = deriveLegs(day);
const legsOfPlan = new Map<string, DerivedLeg[]>();
for (const leg of legs) legsOfPlan.set(leg.plan.id, [...(legsOfPlan.get(leg.plan.id) ?? []), leg]);

// From here on nothing may write to the run or to the cache: a write to a frozen object throws.
deepFreeze(run);
deepFreeze(day.files.travelFiles);
const runBefore = JSON.stringify(run);
const cacheBefore = JSON.stringify(day.files.travelFiles);

const minutes = Array.from({ length: DAY_END_MIN - DAY_START_MIN + 1 }, (_, i) => DAY_START_MIN + i);
let swept: Snapshot[] | null = null;
/** The snapshot of every minute of the day, taken once per file. */
function snapshots(): Snapshot[] {
  swept ??= minutes.map(minute => snapshotAt(run, minute, travel));
  return swept;
}
/** Calls `check` for every minute of the day, in order. */
function everyMinute(check: (snapshot: Snapshot, minute: number, at: string) => void): void {
  snapshots().forEach((snapshot, i) => check(snapshot, minutes[i]!, `minute ${minutes[i]}`));
}

const eventKindOfStop: Record<StopKind, SimEventKind> = {
  pickup: 'pickup', hub_drop: 'hub_drop', hub_pickup: 'hub_pickup', delivery: 'delivered',
};
const statusAfter: Record<StopKind, ShipmentProgress> = {
  pickup: 'picked_up', hub_drop: 'at_hub', hub_pickup: 'out_for_delivery', delivery: 'delivered',
};
const statusRank: Record<ShipmentProgress, number> = {
  unmatched: 0, scheduled: 1, picked_up: 2, at_hub: 3, out_for_delivery: 4, delivered: 5,
};
const jobRank: Record<JobStatus, number> = { assigned: 0, in_progress: 1, completed: 2 };
const samePoint = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => a.lat === b.lat && a.lng === b.lng;
/** The package is in this leg's vehicle from the end of its pickup handling to the end of its drop-off handling. */
const carries = (leg: DerivedLeg, minute: number) =>
  minute >= leg.stops[0]!.serviceEndMin && minute < leg.stops.at(-1)!.serviceEndMin;

it('the run is exactly what buildTrips, assignShipments and buildTimeline make of the cache', () => {
  expect(run.trips).toEqual(scenario.employees.flatMap(employee => buildTrips(employee, travel)));
  expect(run.assignments).toEqual(assignShipments(scenario.shipments, {
    travel, trips: run.trips, employees: scenario.employees, businesses: scenario.businesses, settings: scenario.settings,
  }));
  expect(run.events).toEqual(buildTimeline(plans, run.jobs));
  // A day with nothing to deliver would prove nothing below.
  expect(plans.length, 'the default NYC run has no matched package').toBeGreaterThan(0);
  expect(legs.length).toBe(plans.reduce((count, plan) => count + plan.legs.length, 0));
  // Every place of the run is in the cache with the coordinates the run uses for a business.
  for (const business of scenario.businesses) expect(travel.place(business.id)).toEqual(places[business.id]);
}, T);

it('event times agree with the cache: departure + Google minutes per pair + handling + waiting, for every leg', () => {
  expect(scenario.settings.handlingMin).toBe(2); // SPEC: 2 min handling per pickup and drop-off
  const employees = new Map(scenario.employees.map(employee => [employee.id, employee]));
  const rawPairs = day.files.travelFiles.matrix.pairs;
  let pairCount = 0;
  let waitedMin = 0;
  for (const derived of legs) {
    const { plan, leg, legIndex, trip, shipment } = derived;
    const at = `${plan.id} leg ${legIndex}`;
    const employee = employees.get(leg.employeeId)!;
    const evening = trip.direction === 'evening';
    expect(trip.employeeId, at).toBe(leg.employeeId);
    expect(trip.departureMin, at).toBe(evening ? employee.eveningDepartureMin : employee.morningDepartureMin);
    expect([leg.placeIds[0], leg.placeIds.at(-1)], at).toEqual([trip.originPlaceId, trip.destinationPlaceId]);

    // Each drive takes Google's seconds for that ordered pair, rounded up to whole minutes.
    expect(derived.pairs.length, at).toBe(leg.placeIds.length - 1);
    for (const pair of derived.pairs) {
      pairCount++;
      const pairAt = `${at} ${pair.from} -> ${pair.to}`;
      expect(pair.seconds, `${pairAt}: Google seconds in matrix.json`).toBeGreaterThan(0);
      expect(pair.arriveMin - pair.departMin, pairAt).toBe(Math.ceil(pair.seconds / 60));
      expect(travel.durationMin(pair.from, pair.to), pairAt).toBe(Math.ceil(pair.seconds / 60));
    }

    // The plan stores exactly the re-derived clock: arrival, start of handling (after any waiting), end.
    expect(leg.stops, at).toEqual(derived.stops);
    expect(leg.finishMin, at).toBe(derived.finishMin);
    for (const stop of derived.stops) {
      expect(stop.serviceEndMin - stop.serviceStartMin, at).toBe(2);
      expect(stop.serviceStartMin, at).toBeGreaterThanOrEqual(stop.arrivalMin);
      waitedMin += stop.serviceStartMin - stop.arrivalMin;
      // Rule 5: a stop is at a network business, never at a home.
      expect(businessIds.has(stop.placeId), `${at}: stop at ${stop.placeId} is not a business`).toBe(true);
      expect(homeIds.has(stop.placeId), `${at}: stop at a home`).toBe(false);
    }
    expect(derived.stops, at).toHaveLength(2);
    expect(derived.stops[0]!.serviceStartMin, `${at}: pickup before the package is ready`).toBeGreaterThanOrEqual(shipment.readyMin);
    // Only the pickup may wait; the drop-off starts on arrival.
    expect(derived.stops[1]!.serviceStartMin, at).toBe(derived.stops[1]!.arrivalMin);

    // Added time and distance are measured against the same cache.
    const baseline = rawPairs[`${trip.originPlaceId}|${trip.destinationPlaceId}`]!;
    expect(trip.baselineDurationMin, at).toBe(Math.ceil(baseline.durationS / 60));
    expect(trip.baselineDistanceM, at).toBe(baseline.distanceM);
    expect(leg.extraMin, at).toBe(derived.finishMin - trip.departureMin - trip.baselineDurationMin);
    expect(leg.extraDistanceM, at).toBe(derived.distanceM - trip.baselineDistanceM);
    expect(leg.extraMin, `${at}: over the carrier's limit`).toBeLessThanOrEqual(employee.maxExtraMin);
  }

  // The timeline is those stops, one event per stop at the end of its handling, inside the simulated day.
  expect(run.events.map(event => event.seq)).toEqual(run.events.map((_, i) => i));
  for (let i = 1; i < run.events.length; i++) {
    expect(run.events[i]!.timeMin, 'events are in time order').toBeGreaterThanOrEqual(run.events[i - 1]!.timeMin);
  }
  for (const event of run.events) {
    expect(event.timeMin, event.id).toBeGreaterThanOrEqual(DAY_START_MIN);
    expect(event.timeMin, event.id).toBeLessThanOrEqual(DAY_END_MIN);
  }
  const expectedEvents = legs.flatMap(({ plan, leg, legIndex, stops }) => stops.map(stop => ({
    planId: plan.id, shipmentId: plan.shipmentId, jobId: jobIdFor(plan.id, legIndex),
    employeeId: leg.employeeId, kind: eventKindOfStop[stop.kind], timeMin: stop.serviceEndMin,
  })));
  const key = (e: { planId: string; timeMin: number }) => `${e.planId} ${String(e.timeMin).padStart(5, '0')}`;
  expect(run.events
    .map(({ planId, shipmentId, jobId, employeeId, kind, timeMin }) => ({ planId, shipmentId, jobId, employeeId, kind, timeMin }))
    .sort((a, b) => key(a).localeCompare(key(b))),
  ).toEqual(expectedEvents.sort((a, b) => key(a).localeCompare(key(b))));

  for (const plan of plans) {
    const planLegs = legsOfPlan.get(plan.id)!;
    const shipment = planLegs[0]!.shipment;
    expect(plan.deliveryMin, plan.id).toBe(planLegs.at(-1)!.stops.at(-1)!.serviceEndMin);
    expect(plan.deliveryMin, `${plan.id}: delivered after its deadline`).toBeLessThanOrEqual(shipment.deadlineMin);
    expect(planLegs[0]!.stops[0]!.placeId, plan.id).toBe(shipment.originBusinessId);
    expect(planLegs.at(-1)!.stops.at(-1)!.placeId, plan.id).toBe(shipment.destinationBusinessId);
    if (plan.kind === 'relay') {
      // Evening carrier drops at the relay business; another carrier collects it there the next morning.
      expect(planLegs.map(leg => leg.trip.direction), plan.id).toEqual(['evening', 'morning']);
      expect(planLegs.map(leg => leg.stops.map(stop => stop.kind)), plan.id).toEqual([['pickup', 'hub_drop'], ['hub_pickup', 'delivery']]);
      expect([planLegs[0]!.stops[1]!.placeId, planLegs[1]!.stops[0]!.placeId], plan.id).toEqual([plan.relayBusinessId, plan.relayBusinessId]);
      expect(planLegs[1]!.stops[0]!.serviceStartMin, `${plan.id}: collected before it was dropped`)
        .toBeGreaterThanOrEqual(planLegs[0]!.stops[1]!.serviceEndMin);
      expect(planLegs[0]!.leg.employeeId, plan.id).not.toBe(planLegs[1]!.leg.employeeId);
    } else {
      expect(planLegs.map(leg => leg.stops.map(stop => stop.kind)), plan.id).toEqual([['pickup', 'delivery']]);
    }
  }
  console.info(`NYC day on the cache: ${plans.length} plans, ${legs.length} legs, ${pairCount} drives and ${run.events.length} events re-derived from Google seconds; ${waitedMin} min of waiting at pickups`);
}, T);

it('every minute: a package status and a job status only move forward, and follow the handling that has finished', () => {
  const matched = new Set(plans.map(plan => plan.shipmentId));
  const lastStatus = new Map<string, number>();
  const lastJob = new Map<string, number>();
  everyMinute((snapshot, minute, at) => {
    for (const shipment of scenario.shipments) {
      const status = snapshot.shipmentStatus[shipment.id]!;
      assert(statusRank[status] >= (lastStatus.get(shipment.id) ?? 0), `${at}: ${shipment.id} went back to ${status}`);
      lastStatus.set(shipment.id, statusRank[status]);
      if (!matched.has(shipment.id)) assert.equal(status, 'unmatched', `${at}: ${shipment.id}`);
    }
    for (const plan of plans) {
      const done = legsOfPlan.get(plan.id)!.flatMap(leg => leg.stops).filter(stop => stop.serviceEndMin <= minute);
      const expected = done.length === 0 ? 'scheduled' : statusAfter[done.at(-1)!.kind];
      assert.equal(snapshot.shipmentStatus[plan.shipmentId], expected, `${at}: ${plan.shipmentId}`);
      assert.equal(snapshot.deliveredAtMin[plan.shipmentId], expected === 'delivered' ? plan.deliveryMin : undefined, `${at}: ${plan.shipmentId} delivery time`);
    }
    for (const { plan, legIndex, stops } of legs) {
      const jobId = jobIdFor(plan.id, legIndex);
      const status = snapshot.jobStatus[jobId]!;
      const expected: JobStatus = minute < stops[0]!.serviceEndMin ? 'assigned'
        : minute >= stops.at(-1)!.serviceEndMin ? 'completed' : 'in_progress';
      assert.equal(status, expected, `${at}: ${jobId}`);
      assert(jobRank[status] >= (lastJob.get(jobId) ?? 0), `${at}: ${jobId} went back to ${status}`);
      lastJob.set(jobId, jobRank[status]);
    }
    assert.deepEqual(snapshot.occurredEvents, run.events.filter(event => event.timeMin <= minute), `${at}: occurred events`);
  });
  assert.deepEqual(Object.keys(snapshots()[0]!.jobStatus).sort(), run.jobs.map(job => job.id).sort());
}, T);

it('every minute: a package is with a carrier only between that leg\'s pickup and drop-off, waits at the relay business overnight, and is never at a home', () => {
  const homePoints = scenario.homes.map(home => places[home.id]!);
  const matched = new Set(plans.map(plan => plan.shipmentId));
  let carriedMin = 0;
  let overnightMin = 0;
  everyMinute((snapshot, minute, at) => {
    assert.deepEqual(Object.keys(snapshot.packagePositions).sort(), [...matched].sort(), `${at}: packages on the map`);
    for (const marker of snapshot.markers) {
      if (marker.carryingShipmentId !== undefined) {
        assert(matched.has(marker.carryingShipmentId), `${at}: ${marker.employeeId} carries an unmatched package`);
      }
    }
    for (const plan of plans) {
      const planLegs = legsOfPlan.get(plan.id)!;
      const shipment = planLegs[0]!.shipment;
      const where = `${at}: ${shipment.id}`;
      const position = snapshot.packagePositions[shipment.id]!;
      const carriers = snapshot.markers.filter(marker => marker.carryingShipmentId === shipment.id);
      const carrying = planLegs.find(leg => carries(leg, minute));
      assert(!homePoints.some(home => samePoint(home, position)), `${where} is at a home`);
      if (carrying) {
        assert.deepEqual(carriers.map(marker => marker.employeeId), [carrying.leg.employeeId], `${where} carrier`);
        assert.deepEqual(position, { lat: carriers[0]!.lat, lng: carriers[0]!.lng }, `${where} is not with its carrier`);
        carriedMin++;
        continue;
      }
      assert.deepEqual(carriers, [], `${where} is with a carrier outside pickup..drop-off`);
      const first = planLegs[0]!;
      const last = planLegs.at(-1)!;
      let expectedPlace: string;
      if (minute < first.stops[0]!.serviceEndMin) expectedPlace = shipment.originBusinessId;
      else if (minute >= last.stops.at(-1)!.serviceEndMin) expectedPlace = shipment.destinationBusinessId;
      else {
        // Between the relay drop and the next morning's pickup.
        assert.equal(plan.kind, 'relay', `${where} is between legs of a direct plan`);
        assert(plan.relayBusinessId !== undefined && businessIds.has(plan.relayBusinessId), `${where} has no relay business`);
        assert(plan.relayBusinessId !== shipment.originBusinessId && plan.relayBusinessId !== shipment.destinationBusinessId, `${where} relay is its sender or recipient`);
        expectedPlace = plan.relayBusinessId;
        overnightMin++;
      }
      assert(businessIds.has(expectedPlace) && !homeIds.has(expectedPlace), `${where}: ${expectedPlace} is not a business`);
      assert.deepEqual(position, places[expectedPlace], `${where} should be at ${expectedPlace}`);
    }
  });
  // The whole gap is spent at the relay business, and a package is only ever driven between two businesses.
  const expectedOvernight = plans.filter(plan => plan.kind === 'relay').reduce((sum, plan) => {
    const [evening, morning] = legsOfPlan.get(plan.id)!;
    return sum + morning!.stops[0]!.serviceEndMin - evening!.stops[1]!.serviceEndMin;
  }, 0);
  expect(overnightMin).toBe(expectedOvernight);
  expect(carriedMin).toBe(legs.reduce((sum, leg) => sum + leg.stops[1]!.serviceEndMin - leg.stops[0]!.serviceEndMin, 0));
  for (const leg of legs) {
    const loaded = leg.pairs.filter(pair => pair.departMin < leg.stops[1]!.serviceEndMin && pair.arriveMin > leg.stops[0]!.serviceEndMin);
    expect(loaded.map(pair => [pair.from, pair.to]), `${leg.plan.id} leg ${leg.legIndex}: the loaded drive`)
      .toEqual([[leg.stops[0]!.placeId, leg.stops[1]!.placeId]]);
  }
  console.info(`NYC day custody: ${carriedMin} package-minutes with a carrier, ${overnightMin} package-minutes at a relay business`);
}, T);

it('every minute: a vehicle is on the map only during its planned trip and stands still at the business while it waits and handles', () => {
  let handlingMin = 0;
  let drivingMin = 0;
  everyMinute((snapshot, minute, at) => {
    const active = legs.filter(leg => minute >= leg.trip.departureMin && minute <= leg.finishMin);
    assert.deepEqual(snapshot.markers.map(marker => marker.employeeId).sort(), active.map(leg => leg.leg.employeeId).sort(), `${at}: vehicles on the map`);
    assert.equal(new Set(snapshot.markers.map(marker => marker.employeeId)).size, snapshot.markers.length, `${at}: one marker per employee`);
    for (const derived of active) {
      const marker = snapshot.markers.find(candidate => candidate.employeeId === derived.leg.employeeId)!;
      const who = `${at}: ${marker.employeeId}`;
      assert(Number.isFinite(marker.lat) && Number.isFinite(marker.lng), `${who} has no position`);
      assert.equal(marker.carryingShipmentId, carries(derived, minute) ? derived.shipment.id : undefined, `${who} load`);
      const stop = derived.stops.find(candidate => minute >= candidate.arrivalMin && minute < candidate.serviceEndMin);
      if (stop) {
        // Waiting for the package and the 2 minutes of handling: parked at the business's own point.
        assert.deepEqual({ lat: marker.lat, lng: marker.lng }, places[stop.placeId], `${who} moved while stopped at ${stop.placeId}`);
        assert.equal(marker.servicing, minute >= stop.serviceStartMin, `${who} handling flag`);
        if (marker.servicing) handlingMin++;
        continue;
      }
      assert.equal(marker.servicing, false, `${who} handling flag while not at a stop`);
      if (minute === derived.finishMin) {
        assert.deepEqual({ lat: marker.lat, lng: marker.lng }, places[derived.leg.placeIds.at(-1)!], `${who} at the end of the trip`);
        continue;
      }
      const drive = derived.pairs.filter(pair => minute >= pair.departMin && minute < pair.arriveMin);
      assert.equal(drive.length, 1, `${who} is neither stopped nor on exactly one drive`);
      drivingMin++;
    }
  });
  // Every stop is handled for exactly 2 whole minutes.
  expect(handlingMin).toBe(2 * legs.reduce((sum, leg) => sum + leg.stops.length, 0));
  expect(drivingMin).toBe(legs.reduce((sum, leg) => sum + leg.pairs.reduce((s, pair) => s + pair.arriveMin - pair.departMin, 0), 0));
  console.info(`NYC day vehicles: ${drivingMin} vehicle-minutes driving, ${handlingMin} handling`);
}, T);

it('every minute: no metric is NaN or goes down, and money is earned only by finished handling', () => {
  const nullable = new Set(['avgExtraMinPerTrip', 'maxExtraMin']);
  const lastMetric = new Map<string, number>();
  const lastEarnings = new Map<string, number>();
  everyMinute((snapshot, minute, at) => {
    for (const [name, value] of Object.entries(snapshot.metrics) as [string, number | null][]) {
      if (value === null) {
        assert(nullable.has(name), `${at}: ${name} is null`);
        continue;
      }
      assert(typeof value === 'number' && Number.isFinite(value), `${at}: ${name} is ${String(value)}`);
      if (name.endsWith('Cents')) assert(Number.isInteger(value), `${at}: ${name} is not whole cents`);
      assert(value >= (lastMetric.get(name) ?? -Infinity), `${at}: ${name} went down to ${value}`);
      lastMetric.set(name, value);
    }
    for (const [employeeId, cents] of Object.entries(snapshot.earningsCents)) {
      assert(Number.isInteger(cents) && cents >= (lastEarnings.get(employeeId) ?? 0), `${at}: earnings of ${employeeId} are ${cents}`);
      lastEarnings.set(employeeId, cents);
    }
    const { metrics } = snapshot;
    assert.equal(metrics.requested, scenario.shipments.length, at);
    assert.equal(metrics.matched, plans.length, at);
    assert.equal(metrics.matched + metrics.unmatched, metrics.requested, at);
    assert.equal(metrics.direct + metrics.relay, metrics.matched, at);
    assert.equal(metrics.delivered, plans.filter(plan => plan.deliveryMin <= minute).length, `${at}: delivered`);
    const finishedLegs = legs.filter(leg => leg.stops.at(-1)!.serviceEndMin <= minute);
    const earned = finishedLegs.reduce((sum, leg) => sum + leg.leg.rewardCents, 0);
    assert.equal(metrics.earnedRewardsCents, earned, `${at}: earned rewards`);
    assert.equal(Object.values(snapshot.earningsCents).reduce((sum, cents) => sum + cents, 0), earned, `${at}: earnings by employee`);
    assert.equal(metrics.earnedPlatformContributionCents,
      plans.filter(plan => plan.deliveryMin <= minute).reduce((sum, plan) => sum + plan.platformContributionCents, 0), `${at}: earned contribution`);
    assert(metrics.delivered <= metrics.matched && metrics.earnedPlatformContributionCents <= metrics.projectedPlatformContributionCents, `${at}: actual above projected`);
  });
}, T);

it('at 2160 every matched package is delivered and actual equals projected', () => {
  const end = snapshots().at(-1)!;
  expect(end.timeMin).toBe(DAY_END_MIN);
  for (const plan of plans) {
    expect(end.shipmentStatus[plan.shipmentId], plan.shipmentId).toBe('delivered');
    expect(end.deliveredAtMin[plan.shipmentId], plan.shipmentId).toBe(plan.deliveryMin);
    expect(end.packagePositions[plan.shipmentId], plan.shipmentId).toEqual(places[legsOfPlan.get(plan.id)![0]!.shipment.destinationBusinessId]);
  }
  for (const job of run.jobs) expect(end.jobStatus[job.id], job.id).toBe('completed');
  expect(end.occurredEvents).toEqual(run.events);
  expect(nextEventMin(run, DAY_END_MIN)).toBeNull();
  expect(end.metrics.delivered).toBe(end.metrics.matched);
  expect(end.metrics.earnedPlatformContributionCents).toBe(end.metrics.projectedPlatformContributionCents);
  expect(end.metrics.earnedRewardsCents).toBe(plans.reduce((sum, plan) => sum + plan.legs.reduce((s, leg) => s + leg.rewardCents, 0), 0));
  for (const employee of new Set(legs.map(leg => leg.leg.employeeId))) {
    expect(end.earningsCents[employee], employee)
      .toBe(legs.filter(leg => leg.leg.employeeId === employee).reduce((sum, leg) => sum + leg.leg.rewardCents, 0));
  }
  // Before the first handling finishes nothing has been earned or delivered.
  const start = snapshots()[0]!;
  const beforeFirst = run.events.every(event => event.timeMin > DAY_START_MIN);
  if (beforeFirst) {
    expect([start.metrics.delivered, start.metrics.earnedRewardsCents, start.metrics.earnedPlatformContributionCents]).toEqual([0, 0, 0]);
  }
}, T);

it('two builds are deep-equal, minute by minute, and snapshotAt does not change the run or the cache', () => {
  const second = buildNycDay();
  expect(second.run).not.toBe(run);
  expect(second.run).toEqual(run);
  expect(JSON.stringify(second.run)).toBe(runBefore);
  const first = snapshots();
  minutes.forEach((minute, i) => {
    assert.equal(JSON.stringify(snapshotAt(second.run, minute, second.travel)), JSON.stringify(first[i]), `minute ${minute}: second build differs`);
  });
  // Rewinding gives the same answers: a snapshot depends only on the run and the minute.
  for (let i = minutes.length - 1; i >= 0; i -= 7) {
    assert.deepEqual(snapshotAt(run, minutes[i]!, travel), first[i], `minute ${minutes[i]}: differs after rewinding`);
  }
  // The run and the cache were frozen before the first snapshot; they are byte-identical after all of them.
  expect(JSON.stringify(run)).toBe(runBefore);
  expect(JSON.stringify(day.files.travelFiles)).toBe(cacheBefore);
  expect(JSON.stringify(second.run)).toBe(runBefore);
}, T);

it(`the whole day (${minutes.length} snapshots) runs within 10x the local time`, () => {
  snapshots(); // route lines are decoded once; the poll never pays for that twice either
  const limitMs = 10 * LOCAL_DAY_MS;
  const samples: number[] = [];
  // A parallel test worker can pause one sample; the best of up to 3 is the engine's own time.
  for (let attempt = 0; attempt < 3 && (samples.length === 0 || Math.min(...samples) >= limitMs); attempt++) {
    const started = performance.now();
    for (const minute of minutes) snapshotAt(run, minute, travel);
    samples.push(performance.now() - started);
  }
  const bestMs = Math.min(...samples);
  console.info(`NYC day on the cache: ${minutes.length} snapshots in ${bestMs.toFixed(1)} ms (${(bestMs / minutes.length).toFixed(3)} ms each; samples ${samples.map(ms => ms.toFixed(1)).join(', ')} ms; limit ${limitMs} ms)`);
  expect(minutes).toHaveLength(1231);
  expect(bestMs).toBeLessThan(limitMs);
}, T);
