// Movement along the real route lines of the COMMITTED NYC cache (#516), for every drive of the default run
// and every minute of it. SPEC "Simulator and animation": a vehicle moves along the leg's decoded route line
// in proportion to the elapsed travel time; with no cached line it moves on the straight segment between the
// two places (DECISIONS pass 44), which only places the marker and never changes a time.
// The lines are decoded and measured with the tests' own geometry (sim-v2-nyc-helper.ts), not with
// server/domain/v2/polyline.ts. No story ID or count is pinned, and the split between line and straight
// segment is printed, not asserted: a human fetches the new lines after a story retune (#492).
import assert from 'node:assert/strict';
import { expect, it } from 'vitest';
import type { LatLng, Snapshot, TravelProvider } from '../../shared/v2/types.js';
import { pairKey } from '../../shared/v2/types.js';
import { snapshotAt } from '../../server/domain/v2/simulation.js';
import {
  buildNycDay, decodeLine, deepFreeze, deriveLegs, locateOnPath, metersBetween, pathOf, withoutLines,
  type DrivenPair, type Path,
} from './sim-v2-nyc-helper.js';

const T = 30_000;
/** The issue's bound: a vehicle on a cached line is never further than this from the decoded line. */
const ON_LINE_M = 30;
/** "On the straight segment", and "in proportion to time": rounding only. */
const EXACT_M = 1;

const day = buildNycDay();
const { run, travel, places } = day;
const legs = deriveLegs(day);
const drives: DrivenPair[] = legs.flatMap(leg => leg.pairs);
deepFreeze(run);
deepFreeze(day.files.travelFiles);

type Stats = { onLine: number; onStraight: number; minutes: number; worstOffM: number; worstTimingM: number };

/**
 * Checks every minute of every drive against the provider's own answer for that pair: its route line when it
 * has one, the straight segment between the two places when it has none.
 */
function checkDrives(provider: TravelProvider): Stats {
  const stats: Stats = { onLine: 0, onStraight: 0, minutes: 0, worstOffM: 0, worstTimingM: 0 };
  const byMinute = new Map<number, Snapshot>();
  const at = (minute: number) => {
    if (!byMinute.has(minute)) byMinute.set(minute, snapshotAt(run, minute, provider));
    return byMinute.get(minute)!;
  };
  const paths = new Map<string, Path>();
  for (const drive of drives) {
    const what = `${drive.planId} leg ${drive.legIndex} ${drive.from} -> ${drive.to}`;
    const from = places[drive.from]!;
    const to = places[drive.to]!;
    const encoded = provider.polyline(drive.from, drive.to);
    if (encoded === null) stats.onStraight++;
    else stats.onLine++;
    const key = pairKey(drive.from, drive.to);
    if (!paths.has(key)) paths.set(key, pathOf(encoded === null ? [from, to] : decodeLine(encoded)));
    const path = paths.get(key)!;
    assert(path.points.length >= 2 && path.lengthM > 0, `${what}: the path has no length`);
    assert(drive.arriveMin > drive.departMin, `${what}: the drive takes no time`);

    let lastAlongM = 0;
    for (let minute = drive.departMin; minute < drive.arriveMin; minute++) {
      const marker = at(minute).markers.find(candidate => candidate.employeeId === drive.employeeId);
      assert(marker, `${what} minute ${minute}: no vehicle`);
      const elapsed = (minute - drive.departMin) / (drive.arriveMin - drive.departMin);
      const { offM, alongM } = locateOnPath(path, marker, elapsed * path.lengthM);
      const where = `${what} minute ${minute}`;
      if (encoded === null) {
        assert(offM <= EXACT_M, `${where}: ${offM.toFixed(1)} m off the straight segment`);
      } else {
        assert(offM <= ON_LINE_M, `${where}: ${offM.toFixed(1)} m off its route line`);
      }
      assert(alongM >= lastAlongM - 0.01, `${where}: went back from ${lastAlongM.toFixed(1)} m to ${alongM.toFixed(1)} m along the path`);
      // In proportion to the elapsed travel time: a third of the minutes, a third of the path.
      const timingM = Math.abs(alongM - elapsed * path.lengthM);
      assert(timingM <= EXACT_M, `${where}: ${timingM.toFixed(1)} m from where ${Math.round(elapsed * 100)}% of the time puts it`);
      // A marker that stood still while driving would also "never go back".
      if (minute > drive.departMin) assert(alongM > lastAlongM, `${where}: did not move`);
      lastAlongM = alongM;
      stats.minutes++;
      stats.worstOffM = Math.max(stats.worstOffM, offM);
      stats.worstTimingM = Math.max(stats.worstTimingM, timingM);
    }
    // The drive starts at the start of the path and ends parked at the place it drove to.
    const first = at(drive.departMin).markers.find(candidate => candidate.employeeId === drive.employeeId)!;
    assert(metersBetween(first, path.points[0]!) <= EXACT_M, `${what}: does not start at the start of its path`);
    const arrived = at(drive.arriveMin).markers.find(candidate => candidate.employeeId === drive.employeeId);
    assert(arrived, `${what}: no vehicle on arrival`);
    assert.deepEqual({ lat: arrived.lat, lng: arrived.lng }, to, `${what}: not at ${drive.to} on arrival`);
  }
  return stats;
}

const describeStats = (stats: Stats) =>
  `${stats.onLine} leg pairs on a cached route line, ${stats.onStraight} on the straight segment; ${stats.minutes} vehicle-minutes checked, at most ${stats.worstOffM.toFixed(2)} m off the path and ${stats.worstTimingM.toFixed(2)} m off the time-proportional point`;

it('every driving minute on the cache: within 30 m of the cached route line with progress that never goes back, or on the straight segment when the pair has no line', () => {
  expect(drives.length, 'the default NYC run has no drive').toBeGreaterThan(0);
  const stats = checkDrives(travel);
  // Printed, not asserted: after a story retune some pairs have no line until a human runs the fetch again.
  console.info(`NYC day route lines: ${describeStats(stats)}`);
  expect(stats.onLine + stats.onStraight).toBe(drives.length);
  expect(stats.minutes).toBe(drives.reduce((sum, drive) => sum + drive.arriveMin - drive.departMin, 0));
}, T);

it('a cached line that bends is followed around the bend: at the moment the time puts the vehicle there, it is at the bend and off the straight segment', () => {
  // Guards the test above against passing on movement that is as good as straight. For every line in use
  // that leaves the straight segment by more than 60 m, take the line point farthest from that segment and
  // ask for the snapshot at the moment a vehicle driving in proportion to time reaches it.
  let bent = 0;
  let straightish = 0;
  for (const drive of drives) {
    const encoded = travel.polyline(drive.from, drive.to);
    if (encoded === null) continue;
    const line: LatLng[] = decodeLine(encoded);
    const path = pathOf(line);
    const straight = pathOf([places[drive.from]!, places[drive.to]!]);
    const offStraight = line.map(point => locateOnPath(straight, point, 0).offM);
    const bendM = Math.max(...offStraight);
    const bendIndex = offStraight.indexOf(bendM);
    const share = path.cumulativeM[bendIndex]! / path.lengthM;
    if (bendM <= 2 * ON_LINE_M || share <= 0 || share >= 1) {
      straightish++;
      continue;
    }
    bent++;
    const what = `${drive.from} -> ${drive.to}`;
    const moment = drive.departMin + share * (drive.arriveMin - drive.departMin);
    const marker = snapshotAt(run, moment, travel).markers.find(candidate => candidate.employeeId === drive.employeeId);
    assert(marker, `${what}: no vehicle at ${moment.toFixed(2)}`);
    const fromBendM = metersBetween(marker, line[bendIndex]!);
    assert(fromBendM <= EXACT_M, `${what}: ${fromBendM.toFixed(1)} m from the bend of its line ${Math.round(share * 100)}% into the drive`);
    const offM = locateOnPath(straight, marker, 0).offM;
    assert(offM > ON_LINE_M, `${what}: the vehicle is ${offM.toFixed(1)} m from the straight segment where its line is ${bendM.toFixed(0)} m away`);
  }
  console.info(`NYC day route lines: ${bent} lines in use bend more than ${2 * ON_LINE_M} m away from the straight segment (${straightish} do not)`);
}, T);

it('with some route lines not fetched yet (the state after a story retune) those drives use the straight segment, and no time, status or metric changes', () => {
  // Withhold the line of every second driven pair that has one: real travel times, missing geometry.
  const lined = [...new Set(drives.filter(drive => travel.polyline(drive.from, drive.to) !== null).map(drive => pairKey(drive.from, drive.to)))].sort();
  const withheld = new Set(lined.filter((_, i) => i % 2 === 0));
  const partial = withoutLines(travel, (from, to) => withheld.has(pairKey(from, to)));
  const stats = checkDrives(partial);
  console.info(`NYC day with ${withheld.size} of ${lined.length} lines withheld: ${describeStats(stats)}`);
  expect(stats.onLine + stats.onStraight).toBe(drives.length);
  // Every drive is on the straight segment when there is no line at all, too.
  const none = checkDrives(withoutLines(travel, () => true));
  expect(none.onLine).toBe(0);
  expect(none.onStraight).toBe(drives.length);
  expect(stats.onStraight).toBeGreaterThanOrEqual(withheld.size);
  expect(stats.onStraight).toBeGreaterThan(0);

  // Geometry only places markers: everything else in the snapshot is the same with and without lines.
  const rest = ({ markers, packagePositions, ...other }: Snapshot) => ({
    ...other,
    vehicles: markers.map(({ employeeId, carryingShipmentId, servicing }) => ({ employeeId, carryingShipmentId, servicing })),
    packages: Object.keys(packagePositions).sort(),
  });
  const driveMinutes = new Set(drives.flatMap(drive => [drive.departMin, Math.floor((drive.departMin + drive.arriveMin) / 2), drive.arriveMin]));
  for (const minute of driveMinutes) {
    assert.deepEqual(rest(snapshotAt(run, minute, partial)), rest(snapshotAt(run, minute, travel)), `minute ${minute}: a missing line changed more than a position`);
  }
  // A parked vehicle and a waiting package do not depend on a line.
  for (const leg of legs) {
    for (const stop of leg.stops) {
      const marker = snapshotAt(run, stop.serviceStartMin, partial).markers.find(candidate => candidate.employeeId === leg.leg.employeeId)!;
      assert.deepEqual({ lat: marker.lat, lng: marker.lng }, places[stop.placeId], `${leg.plan.id}: parked at ${stop.placeId}`);
    }
  }
}, T);
