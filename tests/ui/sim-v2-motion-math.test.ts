// #692: the two helpers the v2 motion files share, moved out of the MVP 1 marker tween.
import { describe, expect, it } from 'vitest';
import { REDUCED_MOTION_QUERY, clampAlpha } from '../../client/src/components/sim/v2/motion/motionMath';

describe('clampAlpha', () => {
  it('keeps a value inside 0..1 as it is', () => {
    expect(clampAlpha(0)).toBe(0);
    expect(clampAlpha(0.25)).toBe(0.25);
    expect(clampAlpha(1)).toBe(1);
  });

  it('clamps below 0 to 0 and above 1 to 1', () => {
    expect(clampAlpha(-0.5)).toBe(0);
    expect(clampAlpha(1.5)).toBe(1);
  });

  it('treats a non-finite value as the end of the tween', () => {
    expect(clampAlpha(Number.NaN)).toBe(1);
    expect(clampAlpha(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampAlpha(Number.NEGATIVE_INFINITY)).toBe(1);
  });
});

describe('REDUCED_MOTION_QUERY', () => {
  it('is the prefers-reduced-motion media query', () => {
    expect(REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)');
  });
});
