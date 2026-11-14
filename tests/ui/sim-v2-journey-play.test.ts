import { describe, expect, it } from 'vitest';
import {
  activeMinutes, buildJourney, isFinished, nextSeek, playPlan, type Journey,
} from '../../client/src/components/sim/v2/journey/journeyModel';
import { T, map, simAt } from './sim-v2-journey-sample';

const relay = buildJourney({ shipmentId: 'shp-2', sim: simAt(T.beforePickup), map }) as Journey;
const direct = buildJourney({ shipmentId: 'shp-1', sim: simAt(T.beforePickup), map }) as Journey;

describe('playPlan', () => {
  it('relay: one window per leg, from one minute before the first stop to the last serviceEndMin', () => {
    expect(playPlan(relay).windows).toEqual([
      { legIndex: 0, startMin: 1039, endMin: 1062 }, // Day 1 17:19 → 17:42
      { legIndex: 1, startMin: 1949, endMin: 1977 }, // Day 2 8:29 → 8:57
    ]);
  });
  it('direct: one window', () => {
    expect(playPlan(direct).windows).toEqual([{ legIndex: 0, startMin: 1049, endMin: 1072 }]);
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
