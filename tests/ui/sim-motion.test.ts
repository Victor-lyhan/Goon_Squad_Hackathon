import { describe, expect, it } from 'vitest';
import type { MarkerPosition } from '../../shared/types';
import { shouldTween, tweenMarkers, tweenPackages } from '../../client/src/components/sim/markerTween';

const m = (id: string, x: number, y: number): MarkerPosition => ({ employeeId: id, x, y, servicing: false });

describe('reduced motion tween', () => {
  it('snaps to target when reducedMotion is true', () => {
    expect(tweenMarkers([m('a', 0, 0)], [m('a', 10, 20)], 0.3, true)).toEqual([m('a', 10, 20)]);
    expect(tweenPackages({ s: { x: 0, y: 0 } }, { s: { x: 4, y: 6 } }, 0, true)).toEqual({ s: { x: 4, y: 6 } });
  });
  it('still interpolates otherwise', () => {
    expect(tweenMarkers([m('a', 0, 0)], [m('a', 10, 20)], 0.5, false)[0]).toMatchObject({ x: 5, y: 10 });
    expect(tweenMarkers([m('a', 0, 0)], [m('a', 10, 20)], 0.5)[0]).toMatchObject({ x: 5, y: 10 });
    expect(tweenPackages({ s: { x: 0, y: 0 } }, { s: { x: 4, y: 6 } }, 0.5)).toEqual({ s: { x: 2, y: 3 } });
  });
  it('shouldTween is the inverse flag', () => {
    expect(shouldTween(true)).toBe(false);
    expect(shouldTween(false)).toBe(true);
  });
});
