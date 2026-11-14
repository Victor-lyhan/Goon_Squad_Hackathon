import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('client/src/styles/landing.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('landing.css at 390 px (NYC variant included)', () => {
  it('has no fixed width or min-width above 390 px', () => {
    for (const [, prop, value] of css.matchAll(/(?:^|[;{\s])((?:min-)?width):\s*([^;]+);/g)) {
      for (const [, px] of value.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px), `${prop}: ${value}`).toBeLessThanOrEqual(390);
    }
    for (const [, cols] of css.matchAll(/grid-template-columns:\s*([^;]+);/g)) expect(cols.replace(/minmax\(0, [^)]*\)/g, '')).not.toMatch(/\d+px/);
  });

  it('stacks the entries to one column and wraps the summary and footer on narrow screens', () => {
    const m = css.match(/@media \(max-width: (\d+)px\) \{([\s\S]*?)\n\}/);
    expect(Number(m![1])).toBeGreaterThanOrEqual(390);
    expect(m![2]).toMatch(/\.workspaces \{ grid-template-columns: 1fr; \}/);
    expect(css).toMatch(/\.op-summary-list \{[^}]*flex-wrap: wrap/);
    expect(css).toMatch(/\.landing-footer \{[^}]*flex-wrap: wrap/);
    expect(css).toMatch(/\.landing \{[^}]*overflow-wrap: anywhere/);
  });

  it('styles the NYC indicator line with the tokens', () => {
    expect(css).toMatch(/\.landing-intro p\.landing-indicator \{[^}]*font-family: var\(--font-mono, [^)]*\)/);
  });

  it('follows the design tokens: square corners, no shadows or gradients, fallbacks on every token', () => {
    for (const [, value] of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      for (const [, px] of value.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px)).toBeLessThanOrEqual(4);
    }
    expect(css).not.toMatch(/box-shadow|gradient/i);
    expect(css).not.toMatch(/var\(--[a-z0-9-]+\)/);
  });
});
