import { readFileSync, readdirSync } from 'node:fs';
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

  it('follows the design tokens: radius at most 6 px, no shadows or gradients, fallbacks on every token', () => {
    for (const [, value] of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      for (const [, px] of value.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px)).toBeLessThanOrEqual(6);
    }
    expect(css).not.toMatch(/box-shadow|gradient/i);
    expect(css).not.toMatch(/var\(--[a-z-]+\)/);
  });
});

// #581: the page uses up to 1320 px although the shell's column is 960 px, and the table never makes the
// page scroll sideways between 641 px and the full width.
describe('desktop width (#581)', () => {
  const shell = readFileSync('client/src/styles/global.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('widens the shell\'s <main> to 1320 px only around a Business page', () => {
    expect(base).toMatch(/(^|\})\s*\.app-main:has\(\.bp\) \{ max-width: 1320px; \}/);
    expect(base).toMatch(/\.bp \{[^}]*max-width: 1320px/);
    // The only selector of this file that names the shell.
    expect(css.match(/\.app-[\w-]+/g)).toEqual(['.app-main']);
  });

  it('leaves the shell at 960 px for every other page', () => {
    expect(shell).toMatch(/\.app-main \{ max-width: 960px;/);
    expect(shell).not.toMatch(/\.bp\b|1320/);
    // The simulator's full-width rule aside, no other stylesheet changes the shell's column.
    const widths = [...shell.matchAll(/\.app-main[^{]*\{[^}]*max-width:\s*([^;}]+)/g)].map((x) => x[1].trim());
    expect(widths).toEqual(['960px', 'none']);
    // The homepage's own rule aside (#833: its dark hero runs edge to edge), scoped to the page like this one.
    const landing = readFileSync('client/src/styles/landing.css', 'utf8');
    expect(landing.match(/\.app-main\b[^{]*\{/g)).toEqual(['.app-main:has(.landing) {']);
    const others = readdirSync('client/src', { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.css') && !f.endsWith('styles/global.css') && !f.endsWith('page/businessPage.css')
        && !f.endsWith('styles/landing.css'));
    expect(others.length).toBeGreaterThan(5);
    for (const f of others) expect(readFileSync(`client/src/${f}`, 'utf8'), f).not.toMatch(/\.app-main\b[^{]*\{[^}]*max-width/);
  });

  it('keeps the side column only while the table has room, then stacks', () => {
    const m = css.match(/@media \(max-width: (\d+)px\) \{([\s\S]*?)\n\}/)!;
    // 1320 px shell: about 880 px for the table beside the 360 px side column (800 px with a delivery open).
    // The 440 px details column, the gap and both paddings leave the table 640 px only above 1160 px.
    expect(Number(m[1])).toBeGreaterThanOrEqual(640 + 440 + 16 + 4 * 16);
    expect(base).toMatch(/\.bp-layout \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 360px\)/);
    expect(base).toMatch(/\.bp-layout--open \{ grid-template-columns: minmax\(0, 1fr\) minmax\(0, 440px\); \}/);
  });

  it('the table drops its least important columns by its own box width and scrolls inside its box', () => {
    // The box is a size container, so the rule follows the box (with or without an open delivery), not the window.
    expect(table).toMatch(/\.bw-table-wrap \{[^}]*container: bw-table \/ inline-size/);
    const wide = table.match(/@media \(min-width: 641px\) \{([\s\S]*?)\n\}/);
    expect(wide).not.toBeNull();
    expect(wide![1]).toMatch(/\.bw-table-wrap \{ overflow-x: auto; \}/);
    const steps = [...wide![1].matchAll(/@container bw-table \(max-width: (\d+)px\) \{\s*\.bw-table \.(bw-col--drop\d) \{ display: none; \}/g)]
      .map((x) => [x[2], Number(x[1])]);
    expect(steps.map((x) => x[0])).toEqual(['bw-col--drop1', 'bw-col--drop2', 'bw-col--drop3']);
    // Wider boxes drop fewer columns; every step is above the 640 px stacked rows.
    const widths = steps.map((x) => x[1] as number);
    expect([...widths].sort((a, b) => b - a)).toEqual(widths);
    for (const w of widths) expect(w).toBeGreaterThan(640);
    // The columns are hidden nowhere else, so the 390 px stacked rows keep every cell.
    expect(table.match(/bw-col--drop/g)).toHaveLength(3);
    const stacked = table.match(/@media \(max-width: 640px\) \{([\s\S]*)\}\s*$/)![1];
    expect(stacked).toMatch(/\.bw-table-wrap \{ overflow-x: hidden; \}/);
    expect(stacked).not.toMatch(/display: none/);
  });
});
