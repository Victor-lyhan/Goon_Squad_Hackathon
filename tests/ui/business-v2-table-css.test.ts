import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('client/src/components/business/v2/businessWorkspace.css', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('businessWorkspace.css', () => {
  it('stacks the table rows at 390 px with per-cell labels and no horizontal scroll', () => {
    const m = css.match(/@media \(max-width: (\d+)px\) \{([\s\S]*)\}\s*$/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(390);
    const narrow = m![2];
    expect(narrow).toMatch(/\.bw-table tr[\s\S]*?display: block/);
    expect(narrow).toContain('content: attr(data-label)');
    expect(narrow).toContain('overflow-x: hidden');
    expect(narrow).not.toMatch(/overflow-x: (auto|scroll)/);
  });

  it('has no radius over 4px', () => {
    for (const [, value] of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      for (const [, px] of value.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px)).toBeLessThanOrEqual(4);
      expect(value).not.toMatch(/%|rem|em/);
    }
  });

  it('has no shadows (other than a 1px focus ring) and no gradients', () => {
    for (const [, value] of css.matchAll(/box-shadow:\s*([^;]+);/g)) expect(value).toMatch(/^0 0 0 1px /);
    expect(css).not.toMatch(/gradient/i);
  });

  it('has :focus-visible on header sort buttons and rows', () => {
    expect(css).toMatch(/\.bw-sort:focus-visible/);
    expect(css).toMatch(/\.bw-row:focus-visible/);
  });

  it('uses tokens with fallbacks for color', () => {
    expect(css).toMatch(/var\(--border, #D7DDE5\)/);
    expect(css).toMatch(/var\(--font-mono, /);
    expect(css).not.toMatch(/var\(--[a-z-]+\)/); // every token has a fallback
  });
});
