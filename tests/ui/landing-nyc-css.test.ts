import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('client/src/styles/landing.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('landing.css at 390 px', () => {
  it('has no fixed width or min-width above 390 px', () => {
    for (const [, prop, value] of css.matchAll(/(?:^|[;{\s])((?:min-)?width):\s*([^;]+);/g)) {
      for (const [, px] of value.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px), `${prop}: ${value}`).toBeLessThanOrEqual(390);
    }
    for (const [, cols] of css.matchAll(/grid-template-columns:\s*([^;]+);/g)) expect(cols.replace(/minmax\(0, [^)]*\)/g, '')).not.toMatch(/\d+px/);
  });

  it('stacks the entries to one column, and the stats line wraps rather than scrolls if it must', () => {
    const m = css.match(/@media \(max-width: (\d+)px\) \{([\s\S]*?)\n\}/);
    expect(Number(m![1])).toBeGreaterThanOrEqual(390);
    expect(m![2]).toMatch(/\.workspaces \{ grid-template-columns: 1fr; \}/);
    expect(css).toMatch(/\.op-summary-list \{[^}]*flex-wrap: wrap/);
    expect(css).toMatch(/\.landing \{[^}]*overflow-wrap: anywhere/);
  });

  it('nothing on the page can be wider than a 390 px screen: no nowrap outside the short stats facts, no fixed height trap', () => {
    const nowrap = [...css.matchAll(/([^{}]+)\{[^}]*white-space: nowrap[^}]*\}/g)].map((x) => x[1].trim());
    expect(nowrap).toEqual(['.op-summary-list li']);
    expect(css).not.toMatch(/overflow(-x)?:\s*(scroll|auto)/);
  });

  it('shows the logo at 96 px above the sentence, smaller on a phone, with no frame (#784)', () => {
    const logo = /\.landing-logo \{([^}]*)\}/.exec(css)![1];
    expect(logo).toMatch(/display: block; width: 96px; height: 96px/);
    expect(logo).not.toMatch(/border|background|radius/);
    const narrow = css.match(/@media \(max-width: (\d+)px\) \{([\s\S]*?)\n\}/)![2];
    expect(narrow).toMatch(/\.landing-logo \{ width: 72px; height: 72px/);
  });

  it('has no rule left for the removed parts: the Relay points note, the indicator line, the footer (#610, #652, #724)', () => {
    for (const gone of ['op-summary-hint', 'op-summary-item', 'landing-indicator', 'landing-footer', 'workspace-id', 'workspace-action']) {
      expect(css, gone).not.toContain(gone);
    }
  });

  it('follows the design tokens: corners of 6px at most (docs/mvp3.md P4), no shadows or gradients, fallbacks on every token', () => {
    for (const [, value] of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      for (const [, px] of value.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px)).toBeLessThanOrEqual(6);
    }
    expect(css).not.toMatch(/box-shadow|gradient/i);
    expect(css).not.toMatch(/var\(--[a-z0-9-]+\)/);
  });
});
