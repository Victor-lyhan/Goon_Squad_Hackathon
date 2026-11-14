import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('client/src/components/employee/v2/route/commuteRoute.css', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('commuteRoute.css', () => {
  it('map block is 320px on desktop and 240px at 390 px wide', () => {
    expect(css).toMatch(/^\.ecr__map \{[^}]*height: 320px;/m);
    const m = css.match(/@media \(max-width: (\d+)px\) \{([\s\S]*)\}\s*$/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(390);
    expect(m![2]).toMatch(/\.ecr__map \{\s*height: 240px;/);
  });

  it('lets the shared map fill the block (overrides its own min-height)', () => {
    expect(css).toMatch(/\.ecr__map \.map-v2 \{[^}]*min-height: 0;/);
  });

  it('sets no fixed width wider than a 390 px screen', () => {
    for (const [, prop, value] of css.matchAll(/(?:^|[;{\s])((?:min-|max-)?width):\s*([^;]+);/g)) {
      for (const [, px] of value.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px), `${prop}: ${value}`).toBeLessThanOrEqual(390);
      expect(value).not.toMatch(/\d+(vw|rem|em)/);
    }
  });

  it('square corners, no shadows, no gradients, tokens with fallbacks', () => {
    for (const [, value] of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      for (const [, px] of value.matchAll(/(\d+)px/g)) expect(Number(px)).toBeLessThanOrEqual(4);
    }
    expect(css).not.toMatch(/box-shadow|gradient/i);
    expect(css).not.toMatch(/var\(--[a-z-]+\)/);
  });
});
