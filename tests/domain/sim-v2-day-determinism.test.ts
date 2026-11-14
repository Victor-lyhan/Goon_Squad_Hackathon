import { expect, it } from 'vitest';
import { snapshotAt } from '../../server/domain/v2/simulation.js';
import { readFileSync } from 'node:fs';
import { buildDay, deepFreeze, DAY_EXPECTED_OUTCOMES } from './sim-v2-day-helper.js';

const first = buildDay();
const second = buildDay();
const minutes = [930, 960, 1020, 1050, 1080, 1200, 1440, 1900, 1950, 2160];

it('builds its own scenario and never reads the NYC fixtures, so a story retune cannot change it', () => {
  const source = readFileSync(new URL('./sim-v2-day-helper.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/fixtures\/nyc/);
  expect(source).not.toMatch(/node:fs|readFileSync|demoStory/);
  expect(first.run.scenario.businesses.every(business => /^biz-[a-z0-9-]+$/.test(business.id))).toBe(true);
  expect(first.run.scenario.homes.every(home => /^home-\d{3}$/.test(home.id))).toBe(true);
  expect(first.run.scenario.employees.map(employee => employee.id))
    .toEqual(Array.from({ length: 12 }, (_, index) => `emp-${index + 1}`));
  expect(first.run.scenario.shipments.map(shipment => shipment.id))
    .toEqual(Array.from({ length: 8 }, (_, index) => `shp-${index + 1}`));
});

it('gives the sweep direct plans in both directions, relay plans and an unmatched package', () => {
  const { plans, unmatched } = first.run.assignments;
  const outcomes = Object.fromEntries([
    ...plans.map(plan => [plan.shipmentId, plan.kind]),
    ...unmatched.map(reason => [reason.shipmentId, 'unmatched']),
  ]);
  expect(outcomes).toEqual(DAY_EXPECTED_OUTCOMES);
  const direct = plans.filter(plan => plan.kind === 'direct');
  const directions = new Set(direct.map(plan => first.run.trips.find(trip => trip.id === plan.legs[0].tripId)!.direction));
  expect(directions).toEqual(new Set(['evening', 'morning']));
  expect(direct.length).toBeGreaterThanOrEqual(2);
  expect(plans.filter(plan => plan.kind === 'relay').length).toBeGreaterThanOrEqual(2);
  expect(unmatched.length).toBeGreaterThanOrEqual(1);
});

it('independent builds produce deeply equal, byte-identical snapshots, including after rewinding', () => {
  const expected = minutes.map(minute => snapshotAt(first.run, minute, first.travel));
  const actual = minutes.map(minute => snapshotAt(second.run, minute, second.travel));
  expect(actual).toEqual(expected);
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
  for (let index = minutes.length - 1; index >= 0; index--) {
    expect(snapshotAt(first.run, minutes[index], first.travel)).toEqual(expected[index]);
  }
}, 10_000);

it('reads deeply frozen runs and provider tables without changing any input', () => {
  const beforeRun = JSON.stringify(first.run);
  const beforeTravel = JSON.stringify(first.travel);
  deepFreeze(first.run);
  deepFreeze(first.travel);
  expect(() => {
    for (const minute of minutes) snapshotAt(first.run, minute, first.travel);
    // Also cover every stop boundary, including both sides of custody transfers.
    for (const event of first.run.events) {
      for (const offset of [-1, 0, 1]) snapshotAt(first.run, event.timeMin + offset, first.travel);
    }
  }).not.toThrow();
  expect(JSON.stringify(first.run)).toBe(beforeRun);
  expect(JSON.stringify(first.travel)).toBe(beforeTravel);
}, 10_000);

it('uses straight-line marker interpolation for missing route lines without reading travel times or distances', () => {
  let checked = 0;
  const geometryOnly = {
    polyline: (from: string, to: string) => first.travel.polyline(from, to),
    durationMin() { throw new Error('snapshot must use stored plan times'); },
    distanceM() { throw new Error('snapshot must use stored plan distances'); },
  };
  for (const plan of first.run.assignments.plans) {
    for (const leg of plan.legs) {
      const trip = first.run.trips.find(candidate => candidate.id === leg.tripId)!;
      for (let index = 0; index < leg.placeIds.length - 1; index++) {
        const from = leg.placeIds[index];
        const to = leg.placeIds[index + 1];
        if (first.travel.polyline(from, to) !== null) continue;
        const departure = leg.stops.filter(stop => stop.placeId === from).at(-1)?.serviceEndMin ?? trip.departureMin;
        const arrival = leg.stops.find(stop => stop.placeId === to)?.arrivalMin ?? leg.finishMin;
        if (arrival <= departure) continue;
        const minute = (departure + arrival) / 2;
        const snapshot = snapshotAt(first.run, minute, geometryOnly);
        const marker = snapshot.markers.find(candidate => candidate.employeeId === leg.employeeId)!;
        const a = first.places[from];
        const b = first.places[to];
        expect(marker.lat).toBe(a.lat + (b.lat - a.lat) / 2);
        expect(marker.lng).toBe(a.lng + (b.lng - a.lng) / 2);
        // Changing geometry cannot change progress, money or the timeline.
        const withNoLines = snapshotAt(first.run, minute, { polyline: () => null });
        expect(snapshot.metrics).toEqual(withNoLines.metrics);
        expect(snapshot.occurredEvents).toEqual(withNoLines.occurredEvents);
        expect(snapshot.shipmentStatus).toEqual(withNoLines.shipmentStatus);
        checked++;
      }
    }
  }
  expect(checked, 'at least one planned travel segment must lack a route line').toBeGreaterThan(0);
}, 10_000);
