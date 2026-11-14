import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { encodePolyline, positionBetween } from '../../server/domain/v2/polyline';
import { markersAt, packagePositionsAt } from '../../server/domain/v2/movement';
import { pairKey } from '../../shared/v2/types';
import { businesses, employee, runFor, shipment, travelWithTimes } from './sim-v2-movement-helpers';

function directTravel() { return travelWithTimes({
  'biz-a|biz-b': 10, 'biz-b|home-eve': 10, 'home-morn|biz-a': 10,
  'biz-a|home-eve': 20, 'home-morn|biz-b': 20,
}); }

describe('v2 simulation movement', () => {
  it('moves evening and morning direct carriers over cached geometry and pauses for handling', () => {
    const travel = directTravel();
    const evening = runFor([employee('emp-eve', 'biz-a', { availableEvening: true })], shipment(), travel, 'direct');
    const eveningLeg = evening.assignments.plans[0]!.legs[0]!;
    const [origin, , destination] = businesses;
    const encoded = encodePolyline([
      { lat: origin.lat, lng: origin.lng }, { lat: origin.lat, lng: -73.98 },
      { lat: destination.lat, lng: destination.lng },
    ]);
    travel.files.polylines.polylines[pairKey(origin.id, destination.id)] = encoded;
    expect(travel.polyline(origin.id, destination.id)).not.toBeNull();
    expect(positionBetween({ encoded, from: origin, to: destination, departMin: 1022, arriveMin: 1032, timeMin: 1027 }).lat)
      .toBeCloseTo(origin.lat, 5);

    expect(markersAt(evening, 1020, travel)).toMatchObject([{ employeeId: 'emp-eve', lat: origin.lat, lng: origin.lng }]);
    const halfway = markersAt(evening, eveningLeg.stops[1]!.arrivalMin - 5, travel)[0]!;
    expect(halfway.lat).toBeCloseTo(origin.lat, 5);
    expect(halfway.lng).toBeGreaterThan(-73.985); // On the L's eastbound segment, not the straight chord.
    const handling = markersAt(evening, eveningLeg.stops[1]!.serviceStartMin, travel)[0]!;
    expect(handling).toMatchObject({ lat: destination.lat, lng: destination.lng, servicing: true, carryingShipmentId: 'shp-1' });
    expect(markersAt(evening, eveningLeg.finishMin + 1, travel)).toEqual([]);

    const morning = runFor([employee('emp-morn', 'biz-b', { availableMorning: true })], shipment(), travel, 'direct');
    expect(markersAt(morning, morning.trips[0]!.departureMin, travel)[0])
      .toMatchObject({ employeeId: 'emp-morn', lat: 39.995, lng: -74.005 });
  }, 10_000);

  it('keeps a relay package at businesses and carriers, including overnight', () => {
    const relayTravel = travelWithTimes({
      'biz-a|biz-r': 10, 'biz-r|home-eve': 5, 'biz-a|home-eve': 15,
      'home-morn|biz-r': 5, 'biz-r|biz-b': 20, 'home-morn|biz-b': 25,
      'biz-a|biz-b': 30, 'biz-b|home-eve': 15, 'home-morn|biz-a': 5,
    });
    const run = runFor([
      employee('emp-eve', 'biz-a', { availableEvening: true }),
      employee('emp-morn', 'biz-b', { availableMorning: true }),
    ], shipment(), relayTravel, 'relay');
    const [first, second] = run.assignments.plans[0]!.legs;
    const position = (timeMin: number) => packagePositionsAt(run, timeMin, markersAt(run, timeMin, relayTravel))['shp-1'];

    expect(position(first.stops[0]!.serviceEndMin - 1)).toEqual({ lat: businesses[0]!.lat, lng: businesses[0]!.lng });
    const carriedFirst = first.stops[0]!.serviceEndMin;
    expect(position(carriedFirst)).toEqual(markersAt(run, carriedFirst, relayTravel)[0] && {
      lat: markersAt(run, carriedFirst, relayTravel)[0]!.lat, lng: markersAt(run, carriedFirst, relayTravel)[0]!.lng,
    });
    expect(position(first.stops[1]!.serviceEndMin)).toEqual({ lat: businesses[1]!.lat, lng: businesses[1]!.lng });
    const carriedSecond = second.stops[0]!.serviceEndMin;
    const secondMarker = markersAt(run, carriedSecond, relayTravel).find(marker => marker.employeeId === second.employeeId)!;
    expect(position(carriedSecond)).toEqual({ lat: secondMarker.lat, lng: secondMarker.lng });
    expect(position(second.stops[1]!.serviceEndMin)).toEqual({ lat: businesses[2]!.lat, lng: businesses[2]!.lng });
  }, 10_000);

  it('falls back to a straight line, omits unknown places, and stays deterministic', () => {
    const travel = directTravel();
    const run = runFor([employee('emp-eve', 'biz-a', { availableEvening: true })], shipment(), travel, 'direct');
    const leg = run.assignments.plans[0]!.legs[0]!;
    const middle = markersAt(run, leg.stops[0]!.serviceEndMin + 5, travel)[0]!;
    expect(middle.lat).toBeCloseTo(40.005, 8);
    expect(middle.lng).toBeCloseTo(-73.995, 8);
    expect(markersAt({ ...run, scenario: { ...run.scenario, homes: [] } }, 1020, travel)).toEqual([]);
    expect(markersAt(run, 1025, travel)).toEqual(markersAt(run, 1025, travel));
  }, 10_000);

  it('serves 1,000 60-employee snapshots within the animation budget', () => {
    const travel = directTravel();
    const employees = Array.from({ length: 60 }, (_, index) => employee(`emp-${index}`, 'biz-a', {
      homeId: 'home-eve', availableEvening: true,
    }));
    const initial = runFor(employees, shipment(), travel, 'direct');
    const basePlan = initial.assignments.plans[0]!;
    const plans = Array.from({ length: 24 }, (_, index) => ({
      ...basePlan,
      id: `plan-shp-${index}`,
      shipmentId: `shp-${index}`,
      legs: [{ ...basePlan.legs[0]!, employeeId: `emp-${index}`, tripId: `emp-${index}-eve` }],
    }));
    const run = {
      ...initial,
      scenario: { ...initial.scenario, shipments: plans.map(plan => ({ ...shipment(plan.shipmentId), id: plan.shipmentId })) },
      assignments: { plans, unmatched: [], computeMs: 0 },
    };
    // Warm every sampled minute before timing repeated animation frames.
    for (let minute = 1020; minute < 1045; minute += 1) markersAt(run, minute, travel);
    const startedAt = performance.now();
    for (let index = 0; index < 1_000; index += 1) markersAt(run, 1020 + (index % 25), travel);
    const elapsedMs = performance.now() - startedAt;
    console.info(`Movement markers: 1,000 snapshots in ${elapsedMs.toFixed(3)} ms`);
    // Local batch: 23.922 ms, up to 158.769 ms with concurrent suite load (2026-11-14).
    // 2,000 ms gives >10x headroom even for the loaded measurement (DECISIONS pass 52).
    expect(elapsedMs).toBeLessThan(2_000);
  }, 20_000);
});
