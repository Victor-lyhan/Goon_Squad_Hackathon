import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('client/src/components/business/v2/page/businessPage.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const table = readFileSync('client/src/components/business/v2/businessWorkspace.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Rules outside any @media block. */
const base = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');

describe('businessPage.css at 390 px', () => {
  it('has no fixed width or min-width above 390 px', () => {
    for (const [, prop, value] of css.matchAll(/(?:^|[;{\s])((?:min-)?width):\s*([^;]+);/g)) {
      for (const [, px] of value.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px), `${prop}: ${value}`).toBeLessThanOrEqual(390);
    }
    // Grid tracks are minmax(0, …), so a column can shrink below its preferred size.
    for (const [, cols] of css.matchAll(/grid-template-columns:\s*([^;]+);/g)) expect(cols.replace(/minmax\(0, [^)]*\)/g, '')).not.toMatch(/\d+px/);
  });

  it('stacks to one column on narrow screens, open delivery first', () => {
    const m = css.match(/@media \(max-width: (\d+)px\) \{([\s\S]*?)\n\}/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(390);
    expect(m![2]).toMatch(/\.bp-layout[\s\S]*?flex-direction: column/);
    expect(m![2]).toMatch(/\.bp-details \{ order: -1; \}/);
    expect(css).toMatch(/@media \(max-width: 390px\)/);
  });

  it('lets the table stack at 390 px instead of widening the page', () => {
    expect(base).toMatch(/\.bp-main, \.bp-side \{[^}]*min-width: 0/);
    const narrow = table.match(/@media \(max-width: (\d+)px\) \{([\s\S]*)\}\s*$/);
    expect(Number(narrow![1])).toBeGreaterThanOrEqual(390);
    expect(narrow![2]).toMatch(/\.bw-table tr[\s\S]*?display: block/);
  });

  it('follows the design tokens: square corners, no shadows or gradients, fallbacks on every token', () => {
    for (const [, value] of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      for (const [, px] of value.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px)).toBeLessThanOrEqual(4);
    }
    expect(css).not.toMatch(/box-shadow|gradient/i);
    expect(css).not.toMatch(/var\(--[a-z-]+\)/);
  });
});
