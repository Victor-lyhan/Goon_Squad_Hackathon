import { describe, expect, it } from 'vitest';
import {
  activeMinutes, buildJourney, isFinished, nextSeek, playPlan, type Journey,
} from '../../client/src/components/sim/v2/journey/journeyModel';
import type { SimulatorResponse } from '../../shared/v2/api';
import type { Trip } from '../../shared/v2/types';
import { T, map, simAt } from './sim-v2-journey-sample';

const relay = buildJourney({ shipmentId: 'shp-2', sim: simAt(T.beforePickup), map }) as Journey;
const direct = buildJourney({ shipmentId: 'shp-1', sim: simAt(T.beforePickup), map }) as Journey;

// The sample answer has no `trips` (it was written before #761): the windows are the stop-based ones.
describe('playPlan without trips (an old sample)', () => {
  it('relay: one window per leg, from one minute before the first stop to the last serviceEndMin', () => {
    expect(relay.commutes).toEqual([
      { legIndex: 0, departureMin: null, finishMin: 1100 },
      { legIndex: 1, departureMin: null, finishMin: 1977 },
    ]);
    expect(playPlan(relay).windows).toEqual([
      { legIndex: 0, startMin: 1039, endMin: 1062, carryStartMin: 1039, carryEndMin: 1062 }, // Day 1 17:19 → 17:42
      { legIndex: 1, startMin: 1949, endMin: 1977, carryStartMin: 1949, carryEndMin: 1977 }, // Day 2 8:29 → 8:57
    ]);
  });
  it('direct: one window', () => {
    expect(playPlan(direct).windows).toEqual([
      { legIndex: 0, startMin: 1049, endMin: 1072, carryStartMin: 1049, carryEndMin: 1072 },
    ]);
  });
});

// #761: with the carriers' trips in the answer, a window is the carrier's whole commute.
describe('playPlan with the carriers\' trips (#761)', () => {
  const trip = (id: string, employeeId: string, direction: Trip['direction'], from: string, to: string, departureMin: number): Trip => ({
    id, employeeId, direction, originPlaceId: from, destinationPlaceId: to, departureMin,
    baselineDurationMin: 30, baselineDistanceM: 8000,
  });
  // Ana leaves work at 17:30 (the pickup is at her desk); Cy leaves work at 17:20; Ben leaves home at 8:05.
  const anaEve = trip('emp-1-eve', 'emp-1', 'evening', 'biz-dumbo', 'home-story-ana', 1050);
  const cyEve = trip('emp-3-eve', 'emp-3', 'evening', 'biz-dumbo', 'home-007', 1040);
  const benMorn = trip('emp-2-morn', 'emp-2', 'morning', 'home-story-ben', 'biz-etsy', 1925);
  const withTrips = (trips: Trip[]): SimulatorResponse => ({ ...simAt(T.beforePickup), trips });
  const journeyOf = (shipmentId: string, trips: Trip[]) => buildJourney({ shipmentId, sim: withTrips(trips), map }) as Journey;

  it('direct: from one minute before the carrier leaves work to her arrival at home', () => {
    const j = journeyOf('shp-1', [anaEve, cyEve, benMorn]);
    expect(j.commutes).toEqual([{ legIndex: 0, departureMin: 1050, finishMin: 1110 }]);
    expect(playPlan(j).windows).toEqual([
      // departure 1050 - 1 → Leg.finishMin 1110; the package part is still 1049 → 1072.
      { legIndex: 0, startMin: 1049, endMin: 1110, carryStartMin: 1049, carryEndMin: 1072 },
    ]);
  });

  it('relay: carrier A from leaving work to home, carrier B from leaving home to work', () => {
    const j = journeyOf('shp-2', [anaEve, cyEve, benMorn]);
    expect(j.commutes).toEqual([
      { legIndex: 0, departureMin: 1040, finishMin: 1100 },
      { legIndex: 1, departureMin: 1925, finishMin: 1977 },
    ]);
    expect(playPlan(j).windows).toEqual([
      { legIndex: 0, startMin: 1039, endMin: 1100, carryStartMin: 1039, carryEndMin: 1062 }, // then the drive home
      { legIndex: 1, startMin: 1924, endMin: 1977, carryStartMin: 1949, carryEndMin: 1977 }, // first the drive from home
    ]);
    const plan = playPlan(j);
    expect(nextSeek(plan, 930)).toBe(1039);
    expect(nextSeek(plan, 1080)).toBeNull(); // driving home is inside the window now
    expect(nextSeek(plan, 1101)).toBe(1924); // the night is still skipped
    expect(nextSeek(plan, 1930)).toBeNull(); // driving from home
    expect(isFinished(plan, 1976)).toBe(false);
    expect(isFinished(plan, 1977)).toBe(true);
  });

  it('a leg whose trip is not in the answer keeps its stop-based window; the other leg is whole', () => {
    const j = journeyOf('shp-2', [benMorn]);
    expect(playPlan(j).windows).toEqual([
      { legIndex: 0, startMin: 1039, endMin: 1062, carryStartMin: 1039, carryEndMin: 1062 },
      { legIndex: 1, startMin: 1924, endMin: 1977, carryStartMin: 1949, carryEndMin: 1977 },
    ]);
  });

  it('trips with an unusable departure, or of other employees, are ignored; a window is never narrower than the package part', () => {
    const broken = { ...cyEve, departureMin: Number.NaN };
    const late = { ...benMorn, departureMin: 1970 }; // "departs" after its first stop: the stops win
    const other = trip('emp-9-eve', 'emp-9', 'evening', 'biz-other', 'home-099', 1000);
    expect(playPlan(journeyOf('shp-2', [broken, late, other])).windows).toEqual([
      { legIndex: 0, startMin: 1039, endMin: 1062, carryStartMin: 1039, carryEndMin: 1062 },
      { legIndex: 1, startMin: 1949, endMin: 1977, carryStartMin: 1949, carryEndMin: 1977 },
    ]);
    expect(playPlan(journeyOf('shp-2', [])).windows).toEqual(playPlan(relay).windows);
  });
});

describe('nextSeek / isFinished on the relay sample', () => {
  const plan = playPlan(relay);
  it('jumps from before the pickup to the start of leg 1', () => {
    expect(nextSeek(plan, 930)).toBe(1039);
    expect(nextSeek(plan, T.beforePickup)).toBe(1039);
  });
  it('returns null while a carrier is moving', () => {
    expect(nextSeek(plan, 1039)).toBeNull();
    expect(nextSeek(plan, T.onLeg1)).toBeNull();
    expect(nextSeek(plan, 1062)).toBeNull();
    expect(nextSeek(plan, T.onLeg2)).toBeNull();
  });
  it('jumps from the overnight gap to the start of leg 2', () => {
    expect(nextSeek(plan, 1063)).toBe(1949);
    expect(nextSeek(plan, T.overnight)).toBe(1949);
    expect(isFinished(plan, T.overnight)).toBe(false);
  });
  it('after the last window: null and finished', () => {
    expect(nextSeek(plan, T.afterDelivery)).toBeNull();
    expect(isFinished(plan, 1977)).toBe(true);
    expect(isFinished(plan, T.afterDelivery)).toBe(true);
    expect(isFinished(plan, 1976)).toBe(false);
  });
  it('an empty plan is finished at once and never seeks', () => {
    expect(nextSeek({ windows: [] }, 1000)).toBeNull();
    expect(isFinished({ windows: [] }, 1000)).toBe(true);
  });
  it('the two windows play in under 30 s at speed 120', () => {
    // 23 min (leg 1) + 28 min (leg 2) = 51 simulated minutes; at 120 min/s that is 0.425 s.
    expect(activeMinutes(plan)).toBe(51);
    expect(activeMinutes(plan) / 120).toBeLessThan(30);
  });
});
