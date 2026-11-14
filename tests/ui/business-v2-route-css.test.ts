// deliveryRoute.css (#549): full-width map with a fixed height, nothing wider than a 390 px screen, tokens only.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('client/src/components/business/v2/route/deliveryRoute.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const page = readFileSync('client/src/components/business/v2/page/businessPage.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('deliveryRoute.css at 390 px', () => {
  it('the map block is full width with a fixed height, smaller on narrow screens', () => {
    expect(css).toMatch(/^\.bdr__map \{[^}]*width: 100%;[^}]*height: 280px;/m);
    const m = css.match(/@media \(max-width: (\d+)px\) \{([\s\S]*?)\n\}/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(390);
    expect(m![2]).toMatch(/\.bdr__map \{ height: 240px; \}/);
    expect(css).toMatch(/\.bdr__map > \* \{[^}]*min-height: 0;/);
    expect(css).toMatch(/^\.bdr \{[^}]*min-width: 0;/m);
  });

  it('sits above the details in the one-column layout (the details block is first and stacks)', () => {
    expect(page).toMatch(/\.bp-details \{ order: -1; \}/);
    expect(page).toMatch(/\.bp-details \{[^}]*flex-direction: column;[^}]*min-width: 0;/);
  });

  it('sets no fixed width wider than a 390 px screen', () => {
    for (const [, prop, value] of css.matchAll(/(?:^|[;{\s])((?:min-|max-)?width):\s*([^;]+);/g)) {
      for (const [, px] of value.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px), `${prop}: ${value}`).toBeLessThanOrEqual(390);
      expect(value).not.toMatch(/\d+(vw|rem|em)/);
    }
    expect(css).not.toMatch(/white-space:\s*nowrap/);
  });

  it('follows the tokens: radius 2 to 4 px, no shadows or gradients, fallbacks on every token, no raw colours', () => {
    const radii = [...css.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1]);
    expect(radii.length).toBeGreaterThan(0);
    for (const value of radii) {
      for (const [, px] of value.matchAll(/(\d+(?:\.\d+)?)px/g)) {
        expect(Number(px)).toBeGreaterThanOrEqual(2);
        expect(Number(px)).toBeLessThanOrEqual(4);
      }
    }
    expect(css).not.toMatch(/box-shadow|gradient/i);
    expect(css).not.toMatch(/var\(--[a-z-]+\)/);
    // Every colour is a token (the hex values are only the fallbacks inside var()).
    const outsideVar = css.replace(/var\(--[a-z0-9-]+, [^)]*\)/g, '');
    expect(outsideVar).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});
