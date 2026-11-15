import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('client/src/styles/landing.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** The body of the first rule with exactly this selector (the base rule, not one inside a media block). */
const rule = (selector: string) =>
  new RegExp(`(?:^|\\})\\s*${selector.replace(/[.:]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';

describe('landing.css at 390 px', () => {
  it('has no fixed width or min-width above 390 px', () => {
    for (const [, prop, value] of css.matchAll(/(?:^|[;{\s])((?:min-)?width):\s*([^;]+);/g)) {
      for (const [, px] of value.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px), `${prop}: ${value}`).toBeLessThanOrEqual(390);
    }
    for (const [, cols] of css.matchAll(/grid-template-columns:\s*([^;]+);/g)) expect(cols.replace(/minmax\(0, [^)]*\)/g, '')).not.toMatch(/\d+px/);
  });

  it('stacks the hero and the entries to one column, and the map key wraps rather than scrolls', () => {
    const narrow = (px: number) => new RegExp(`@media \\(max-width: ${px}px\\) \\{([\\s\\S]*?)\\n\\}`).exec(css)![1];
    expect(narrow(820)).toMatch(/\.landing-hero-inner \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    // The map keeps the drawing's own shape at every width (nothing cropped), so no narrow rule changes it.
    expect(rule('.landing-hero-map')).toMatch(/aspect-ratio: 4 \/ 3/);
    expect(css.match(/\.landing-hero-map \{/g)).toHaveLength(1);
    expect(narrow(480)).toMatch(/\.workspaces \{ grid-template-columns: 1fr; \}/);
    expect(css).toMatch(/\.hero-legend \{[^}]*flex-wrap: wrap/);
    expect(css).toMatch(/\.landing \{[^}]*overflow-wrap: anywhere/);
  });

  it('nothing on the page can be wider than a 390 px screen: no nowrap, no scrolling box', () => {
    expect(css).not.toContain('nowrap');
    expect(css).not.toMatch(/overflow(-x)?:\s*(scroll|auto)/);
  });

  it('has no separate logo above the title any more (#853)', () => {
    expect(css).not.toContain('landing-logo');
  });

  it('sizes the logo in the title like a capital letter of the title, at every width (#853)', () => {
    const logo = rule('.landing-title-logo');
    const em = (prop: string) => Number(new RegExp(`(?:^|[;\\s])${prop}: (-?[\\d.]+)em;`).exec(logo)![1]);
    // Every size is in em, so the mark follows the title's clamp() size: no px, no rule per width.
    expect(logo).not.toMatch(/\d(px|rem|vw|%)/);
    expect(css.match(/\.landing-title-logo \{/g)).toHaveLength(1);
    // Measured in Chrome at 1440 and 390 px: the mark is 90 % of the picture's height and Inter's capital
    // letters are 0.728em high, so the picture is 0.728 / 0.9 = 0.81em high and hangs under the baseline by
    // its bottom margin. A capital letter is between 0.66em and 0.74em high in the title's fallback fonts too.
    expect(em('height') * 0.9).toBeGreaterThan(0.66);
    expect(em('height') * 0.9).toBeLessThan(0.74);
    expect(em('vertical-align')).toBeLessThan(0);
    expect(em('vertical-align')).toBeGreaterThan(-0.08);
    // Narrower than the picture: the clear margin at its sides is cut off, not squeezed.
    expect(em('width')).toBeLessThan(em('height'));
    expect(logo).toMatch(/object-fit: cover/);
    // A little room to the "e", like between two letters, and never a negative one.
    expect(em('margin-right')).toBeGreaterThan(0);
    expect(em('margin-right')).toBeLessThan(0.1);
    expect(logo).not.toMatch(/border|background|radius/);
    // The word is one box, so a line cannot break between the logo and "elay:" (and nowrap is not needed).
    expect(rule('.landing-title-word')).toMatch(/^\s*display: inline-block;\s*$/);
  });

  it('keeps the title legible at 390 px: 30 px at least, and the logo scales with it (#853)', () => {
    const size = /font-size: clamp\((\d+)px, [^,]+, (\d+)px\)/.exec(rule('.landing-hero h1'))!;
    expect(Number(size[1])).toBeGreaterThanOrEqual(30);
    expect(Number(size[2])).toBeGreaterThanOrEqual(Number(size[1]));
  });

  it('puts the hero text and the map in a centered column of 1200 px with 48 px at each side (#853)', () => {
    expect(rule('.landing')).toMatch(/--landing-max: 1200px;/);
    // 48 px on a desktop, less on a phone: 6vw of 390 px is 23 px.
    expect(rule('.landing')).toMatch(/--landing-pad: clamp\(16px, 6vw, 48px\);/);
    const inner = rule('.landing-hero-inner');
    expect(inner).toMatch(/max-width: var\(--landing-max, 1200px\)/);
    expect(inner).toMatch(/margin: 0 auto;/); // centered
    expect(inner).toMatch(/padding: var\(--space-8, 32px\) var\(--landing-pad, 48px\);/);
    // Two columns with a gap between them of 24 to 48 px.
    expect(inner).toMatch(/display: grid;/);
    expect(inner).toMatch(/grid-template-columns: minmax\(0, 7fr\) minmax\(0, 5fr\);/);
    expect(inner).toMatch(/gap: var\(--space-6, 24px\) clamp\(24px, 4vw, 48px\);/);
    expect(inner).toMatch(/align-items: center;/);
    // The dark ground is the section around the column, so it still runs from edge to edge.
    expect(rule('.landing-hero')).not.toMatch(/max-width|margin|padding/);
    expect(rule('.landing-hero')).toMatch(/display: flex;/);
    expect(inner).toMatch(/flex: 1;/);
    expect(inner).not.toMatch(/background/);
  });

  it('gives "How it works" the same column: the same limit, centered, the same side padding (#853)', () => {
    const how = rule('.landing-how');
    expect(how).toMatch(/max-width: var\(--landing-max, 1200px\)/);
    expect(how).toMatch(/margin: 0 auto;/);
    expect(how).toMatch(/padding: [^;]* var\(--landing-pad, 48px\) [^;]*;/);
    expect(css).not.toContain('1080px');
    // Border-box sizing (global.css) makes both limits include the padding, so the two left edges line up.
    expect(readFileSync('client/src/styles/global.css', 'utf8')).toMatch(/\* \{ box-sizing: border-box; \}/);
  });

  it('frames the map as a panel in the column: a thin border, corners of 6px at most (#853)', () => {
    const map = rule('.landing-hero-map');
    expect(map).toMatch(/border: 1px solid var\(--hero-shore, #44526A\)/);
    expect(map).toMatch(/border-radius: var\(--radius-lg, 6px\)/);
    expect(map).not.toMatch(/min-height|\bheight/);
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
