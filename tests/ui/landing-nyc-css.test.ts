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

  it('stacks the hero and the entries to one column, and the map key wraps rather than scrolls', () => {
    const narrow = (px: number) => new RegExp(`@media \\(max-width: ${px}px\\) \\{([\\s\\S]*?)\\n\\}`).exec(css)![1];
    expect(narrow(820)).toMatch(/\.landing-hero \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    expect(narrow(820)).toMatch(/\.landing-hero-map \{[^}]*aspect-ratio: 4 \/ 3/); // the whole drawing, nothing cropped
    expect(narrow(480)).toMatch(/\.workspaces \{ grid-template-columns: 1fr; \}/);
    expect(css).toMatch(/\.hero-legend \{[^}]*flex-wrap: wrap/);
    expect(css).toMatch(/\.landing \{[^}]*overflow-wrap: anywhere/);
  });

  it('nothing on the page can be wider than a 390 px screen: no nowrap, no scrolling box', () => {
    expect(css).not.toContain('nowrap');
    expect(css).not.toMatch(/overflow(-x)?:\s*(scroll|auto)/);
  });

  it('shows the logo at 72 px above the title, smaller on a phone, with no frame (#784, #833)', () => {
    const logo = /\.landing-logo \{([^}]*)\}/.exec(css)![1];
    expect(logo).toMatch(/display: block; width: 72px; height: 72px/);
    expect(logo).not.toMatch(/border|background|radius/);
    const narrow = /@media \(max-width: 480px\) \{([\s\S]*?)\n\}/.exec(css)![1];
    expect(narrow).toMatch(/\.landing-logo \{ width: 56px; height: 56px/);
  });

  it('the hero is dark, at least half the window tall, and the page uses the whole window (#833)', () => {
    const hero = /\.landing-hero \{([^}]*)\}/.exec(css)![1];
    expect(hero).toMatch(/--hero-ground: var\(--text, #171C24\)/); // the ink token is the dark ground
    expect(hero).toMatch(/background: var\(--hero-ground, #171C24\)/);
    expect(Number(/min-height: (\d+)vh/.exec(hero)![1])).toBeGreaterThanOrEqual(50);
    expect(css).toMatch(/\.app-main:has\(\.landing\) \{ max-width: none; padding: 0; \}/);
  });

  it('has no rule left for the removed parts: the stats line, the text link, the indicator line, the footer (#724, #833)', () => {
    for (const gone of ['op-summary', 'landing-more', 'landing-intro', 'landing-indicator', 'landing-footer', 'workspace-id', 'workspace-action']) {
      expect(css, gone).not.toContain(gone);
    }
  });

  it('follows the design tokens: corners of 6px at most (docs/mvp3.md P4), no shadows or gradients, fallbacks on every token', () => {
    for (const [, value] of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      for (const [, px] of value.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px)).toBeLessThanOrEqual(6);
      expect(value).not.toMatch(/%|rem|em\b/);
    }
    expect(css).not.toMatch(/box-shadow|gradient/i);
    expect(css).not.toMatch(/var\(--[a-z0-9-]+\)/);
  });
});
