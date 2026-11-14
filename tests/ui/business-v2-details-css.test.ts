import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('client/src/components/business/v2/deliveryDetails.css', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('deliveryDetails.css', () => {
  it('has a narrow rule that covers 390 px and makes the panel full width', () => {
    const m = css.match(/@media \(max-width: (\d+)px\) \{([\s\S]*)\}\s*$/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(390);
    expect(m![2]).toMatch(/\.bd-panel \{[^}]*max-width: none/);
    expect(m![2]).toMatch(/\.bd-legs[^{]*\{[^}]*display: block/);
  });

  it('has no radius over 6px', () => {
    for (const [, value] of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      for (const [, px] of value.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px)).toBeLessThanOrEqual(6);
      expect(value).not.toMatch(/%|rem|em/);
    }
  });

  it('has no shadows (other than a 1px focus ring) and no gradients', () => {
    for (const [, value] of css.matchAll(/box-shadow:\s*([^;]+);/g)) expect(value).toMatch(/^0 0 0 1px /);
    expect(css).not.toMatch(/gradient/i);
  });

  it('has :focus-visible on links and buttons', () => {
    expect(css).toMatch(/\.bd-link:focus-visible/);
    expect(css).toMatch(/\.bd-btn:focus-visible/);
  });

  it('uses tokens with fallbacks and mono for data', () => {
    expect(css).toMatch(/var\(--border, #E3E3DE\)/);
    expect(css).toMatch(/\.bd-mono \{[^}]*var\(--font-mono, /);
    expect(css).not.toMatch(/var\(--[a-z0-9-]+\)/);
  });
});
