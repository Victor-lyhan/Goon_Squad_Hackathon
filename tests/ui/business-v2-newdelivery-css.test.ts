import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('client/src/components/business/v2/newDelivery.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('newDelivery.css', () => {
  it('has a narrow rule covering 390 px: one column, controls at least 40 px high', () => {
    const m = css.match(/@media \(max-width: (\d+)px\) \{([\s\S]*)\}\s*$/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(390);
    const narrow = m![2];
    expect(narrow).toMatch(/\.nd-row \{[^}]*grid-template-columns: 1fr;/);
    const controls = narrow.match(/\.nd-input, \.nd-btn \{([^}]*)\}/);
    expect(controls).not.toBeNull();
    const h = controls![1].match(/min-height: (\d+)px/);
    expect(Number(h![1])).toBeGreaterThanOrEqual(40);
  });

  it('has no radius over 6px', () => {
    for (const [, value] of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      for (const [, px] of value.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px)).toBeLessThanOrEqual(6);
      expect(value).not.toMatch(/%|rem|em/);
    }
  });

  it('has no shadows other than a 1px focus ring, and no gradients', () => {
    const shadows = [...css.matchAll(/([^{}]+)\{[^}]*box-shadow:\s*([^;]+);/g)];
    for (const [, selector, value] of shadows) {
      expect(selector).toContain(':focus-visible');
      expect(value).toMatch(/^0 0 0 1px /);
    }
    expect(css).not.toMatch(/gradient/i);
  });

  it('has :focus-visible styles for inputs and buttons', () => {
    expect(css).toMatch(/\.nd-input:focus-visible/);
    expect(css).toMatch(/\.nd-btn:focus-visible/);
  });

  it('uses tokens with fallbacks', () => {
    expect(css).toMatch(/var\(--border, #E3E3DE\)/);
    expect(css).not.toMatch(/var\(--[a-z0-9-]+\)/);
  });
});
