import { describe, expect, it } from 'vitest';
import type { MarkerPosition } from '../../shared/types';
import { shouldSnap, tweenMarkers, tweenPackages } from '../../client/src/components/sim/markerTween';

const m = (id: string, x: number, y: number, extra: Partial<MarkerPosition> = {}): MarkerPosition =>
  ({ employeeId: id, x, y, servicing: false, ...extra });

describe('tweenMarkers', () => {
  it('blends matched markers and takes flags from next', () => {
    const out = tweenMarkers([m('a', 0, 0, { carryingShipmentId: 's0' })], [m('a', 10, 20, { servicing: true })], 0.5);
    expect(out).toEqual([{ employeeId: 'a', x: 5, y: 10, servicing: true }]);
  });
  it('appears at next position and drops prev-only', () => {
    const out = tweenMarkers([m('gone', 1, 1)], [m('new', 7, 8)], 0.25);
    expect(out).toEqual([m('new', 7, 8)]);
  });
  it('clamps alpha', () => {
    expect(tweenMarkers([m('a', 0, 0)], [m('a', 10, 10)], -3)[0]).toMatchObject({ x: 0, y: 0 });
    expect(tweenMarkers([m('a', 0, 0)], [m('a', 10, 10)], 9)[0]).toMatchObject({ x: 10, y: 10 });
  });
});

describe('tweenPackages', () => {
  it('blends, appears, drops and clamps', () => {
    const out = tweenPackages({ p1: { x: 0, y: 0 }, old: { x: 1, y: 1 } }, { p1: { x: 10, y: 0 }, p2: { x: 3, y: 4 } }, 0.5);
    expect(out).toEqual({ p1: { x: 5, y: 0 }, p2: { x: 3, y: 4 } });
    expect(tweenPackages({ p1: { x: 0, y: 0 } }, { p1: { x: 10, y: 0 } }, 5).p1.x).toBe(10);
  });
});

describe('shouldSnap', () => {
  const a = { runId: 'r1', timeMin: 100 };
  it('is false for a normal poll', () => {
    expect(shouldSnap(a, { runId: 'r1', timeMin: 130 }, { speed: 30 })).toBe(false);
    expect(shouldSnap(a, { runId: 'r1', timeMin: 160 }, { speed: 30 })).toBe(false);
  });
  it('snaps on run change', () => expect(shouldSnap(a, { runId: 'r2', timeMin: 101 }, { speed: 30 })).toBe(true));
  it('snaps when time goes backwards', () => expect(shouldSnap(a, { runId: 'r1', timeMin: 99 }, { speed: 30 })).toBe(true));
  it('snaps on a jump beyond 2 s of play', () => {
    expect(shouldSnap(a, { runId: 'r1', timeMin: 161 }, { speed: 30 })).toBe(true);
    expect(shouldSnap(a, { runId: 'r1', timeMin: 400 }, { speed: 120 })).toBe(true);
  });
});
