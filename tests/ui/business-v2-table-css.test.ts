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

  it('the stacked cell is a two-column grid: the label, then the cell\'s one child (#609)', () => {
    const narrow = css.match(/@media \(max-width: 640px\) \{([\s\S]*)\}\s*$/)![1];
    const td = /\.bw-table td \{([^}]*display: grid[^}]*)\}/.exec(narrow);
    expect(td).not.toBeNull();
    expect(td![1]).toMatch(/grid-template-columns: 7\.5rem minmax\(0, 1fr\);/);
    expect(td![1]).toContain('overflow-wrap: anywhere');
    // The reason is a block inside the value, never a grid item of its own.
    expect(css).toMatch(/\.bw-reason \{[^}]*display: block/);
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

  it('has :focus-visible on header sort buttons and rows', () => {
    expect(css).toMatch(/\.bw-sort:focus-visible/);
    expect(css).toMatch(/\.bw-row:focus-visible/);
  });

  it('uses tokens with fallbacks for color', () => {
    expect(css).toMatch(/var\(--ns-line, #DCD8CE\)/); // the hairline of the page's palette (#956)
    expect(css).toMatch(/var\(--font-mono, /);
    expect(css).not.toMatch(/var\(--[a-z-]+\)/); // every token has a fallback
  });
});
