import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HERO_SAFE_BOX, HERO_VIEWBOX } from '../../client/src/pages/landingHeroModel';

const css = readFileSync('client/src/styles/landing.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** The body of the first rule with exactly this selector (the base rule, not one inside a media block). */
const rule = (selector: string) =>
  new RegExp(`(?:^|\\})\\s*${selector.replace(/[.:]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';

/** The rules for a narrow or upright window: the map lies under the text (#869). */
const STACKED = /@media \(max-width: 820px\), \(max-aspect-ratio: 6\/5\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';

/** The rules of the block for windows up to `px` wide. */
const narrow = (px: number) => new RegExp(`@media \\(max-width: ${px}px\\) \\{([\\s\\S]*?)\\n\\}`).exec(css)![1];

describe('landing.css at 390 px', () => {
  it('has no fixed width or min-width above 390 px', () => {
    for (const [, prop, value] of css.matchAll(/(?:^|[;{\s])((?:min-)?width):\s*([^;]+);/g)) {
      for (const [, px] of value.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px), `${prop}: ${value}`).toBeLessThanOrEqual(390);
    }
    for (const [, cols] of css.matchAll(/grid-template-columns:\s*([^;]+);/g)) expect(cols.replace(/minmax\(0, [^)]*\)/g, '')).not.toMatch(/\d+px/);
  });

  it('on a phone the text comes first and the map lies under it, about half the window tall, from edge to edge (#869)', () => {
    expect(STACKED).toMatch(/\.landing-hero \{ grid-template-columns: minmax\(0, 1fr\); grid-template-rows: auto minmax\(max\(50vh, 320px\), 1fr\); \}/);
    // The text has the column's whole width there (#955; side by side it is 58 % of it).
    expect(STACKED).toMatch(/\.landing-hero-copy \{ flex-basis: 100%; \}/);
    // The second row of the hero itself, not of the padded column: the map still reaches both sides and the
    // bottom. It fades in from its top, where the text ends.
    expect(STACKED).toMatch(/\.landing-hero-map \{ --hero-fade: to bottom; grid-column: 1; grid-row: 2; \}/);
    expect(STACKED).not.toMatch(/border|radius|margin|padding|aspect-ratio/);
    // The key starts at the text's left edge.
    expect(STACKED).toMatch(/\.hero-legend \{ left: var\(--landing-pad, 48px\); right: var\(--landing-pad, 48px\); justify-content: flex-start; \}/);
    // The two entries are side by side only where both fit with their text on one line (17.5em each, so
    // from about 1300 px up), else one column; an entry is never wider than the box. On a phone they take
    // the whole width.
    expect(rule('.workspaces')).toMatch(/grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 17\.5em\), 1fr\)\);/);
    expect(narrow(480)).toMatch(/\.workspaces \{ max-width: none; \}/);
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
    // Measured in Chrome at 1440 px (#955): the mark is 90 % of the picture's height and Archivo's capital
    // letters are 0.687em high, so the picture is 0.687 / 0.9 = 0.76em high and hangs under the baseline by
    // its bottom margin (5 % of its height). In the fallback, Inter, a capital letter is 0.728em high.
    expect(em('height') * 0.9).toBeGreaterThan(0.66);
    expect(em('height') * 0.9).toBeLessThan(0.74);
    expect(Math.abs(em('height') * 0.9 - 0.687)).toBeLessThan(0.005);
    expect(Math.abs(em('height') * 0.05 + em('vertical-align'))).toBeLessThan(0.005);
    expect(em('vertical-align')).toBeLessThan(0);
    expect(em('vertical-align')).toBeGreaterThan(-0.08);
    // Narrower than the picture: the clear margin at its sides is cut off, not squeezed.
    expect(em('width')).toBeLessThan(em('height'));
    expect(logo).toMatch(/object-fit: cover/);
    // A little room to the "e", like between two letters, and never a negative one.
    expect(em('margin-right')).toBeGreaterThan(0);
    expect(em('margin-right')).toBeLessThan(0.1);
    expect(logo).not.toMatch(/border|background|radius/);
    // The word is one box, and so is each further line of the title (#955): a line cannot break between
    // the logo and "elay:", and the title has the same three lines at every width (nowrap is not needed).
    expect(css).toMatch(/\.landing-title-word, \.landing-title-line \{ display: block; \}/);
    expect(css.match(/\.landing-title-(word|line)\b/g)).toHaveLength(2);
  });

  it('keeps the title legible at 390 px: 30 px at least, and the logo scales with it (#853)', () => {
    const size = /font-size: clamp\((\d+)px, [^,]+, (\d+)px\)/.exec(rule('.landing-hero h1'))!;
    expect(Number(size[1])).toBeGreaterThanOrEqual(30);
    expect(Number(size[2])).toBeGreaterThanOrEqual(Number(size[1]));
  });

  it('the title is the one bold thing: Archivo, condensed and heavy, as large as its longest line allows (#955)', () => {
    const h1 = rule('.landing-hero h1');
    expect(h1).toMatch(/font-family: var\(--font-display, 'Archivo Variable', 'Inter', system-ui, sans-serif\);/);
    expect(h1).toMatch(/font-weight: 800;/);
    expect(h1).toMatch(/font-stretch: 78%;/);
    expect(h1).toMatch(/line-height: \.92;/);
    expect(h1).toMatch(/letter-spacing: -0\.02em;/); // tight
    // Measured in Chrome: the longest line, "packages ride", is 5.43 times the font size wide.
    const LINE_EM = 5.43;
    // Side by side the text is 58 % of the column, and the size is 8 % of the window's width up to 116 px.
    const side = /font-size: clamp\((\d+)px, (\d+(?:\.\d+)?)vw, (\d+)px\);/.exec(h1)!;
    const [vw, max] = [Number(side[2]) / 100, Number(side[3])];
    expect(max).toBeGreaterThanOrEqual(100); // huge at 1440 px
    expect(rule('.landing-hero-copy')).toMatch(/flex: 0 1 58%;/);
    for (const width of [821, 900, 1024, 1200, 1296, 1440, 1920, 2560]) {
      const text = 0.58 * (Math.min(width, 1200) - 96);
      expect(Math.min(vw * width, max) * LINE_EM, `${width} px`).toBeLessThanOrEqual(text);
    }
    // Under the text's own column (a narrow or upright window) the size is the column's width over 5.6,
    // so the line fits whatever the width and the padding are.
    const stacked = /\.landing-hero h1 \{ font-size: clamp\((\d+)px, calc\(\(100vw - 2 \* var\(--landing-pad, 48px\)\) \/ (\d+(?:\.\d+)?)\), (\d+)px\); \}/.exec(STACKED)!;
    expect(Number(stacked[2])).toBeGreaterThan(LINE_EM);
    expect(Number(stacked[2])).toBeLessThan(LINE_EM * 1.06); // and not much smaller than it could be
    expect(Number(stacked[3])).toBe(max);
    // At 390 px: (390 - 48) / 5.6 = 61 px. The least size, 40 px, fits a 320 px window: 40 * 5.43 = 217 of 272 px.
    expect((390 - 48) / Number(stacked[2])).toBeGreaterThan(56);
    expect(Number(stacked[1]) * LINE_EM).toBeLessThanOrEqual(320 - 48);
  });

  it('puts the hero text at the left edge of a centered column of 1200 px with 48 px at each side (#853, #869)', () => {
    expect(rule('.landing')).toMatch(/--landing-max: 1200px;/);
    // 48 px (twice --space-6) on a desktop and --space-6 on a phone: steps of the spacing scale, so the
    // text's left edge is on a whole pixel at every width (#879; 6vw of 390 px was 23.4 px).
    expect(rule('.landing')).toMatch(/--landing-pad: calc\(2 \* var\(--space-6, 24px\)\);/);
    expect(narrow(480)).toMatch(/\.landing \{ --landing-pad: var\(--space-6, 24px\); \}/);
    expect(css.match(/--landing-pad:/g)).toHaveLength(2);
    const inner = rule('.landing-hero-inner');
    expect(inner).toMatch(/max-width: var\(--landing-max, 1200px\)/);
    expect(inner).toMatch(/margin: 0 auto;/); // centered
    expect(inner).toMatch(/padding: calc\(2 \* var\(--space-6, 24px\)\) var\(--landing-pad, 48px\);/);
    // #955: the text is the column's only child, at its left edge and centered in the hero's height. It is
    // 58 % of the column wide, a little over the hero's left half: the title's long line ends on the map's
    // faded inner edge, so the column is drawn over the map.
    expect(inner).toMatch(/display: flex;/);
    expect(inner).toMatch(/align-items: center;/);
    expect(inner).toMatch(/position: relative;/);
    expect(inner).toMatch(/z-index: 1;/);
    expect(rule('.landing-hero-copy')).toMatch(/flex: 0 1 58%;/);
    expect(rule('.landing-hero-copy')).toMatch(/align-items: flex-start;/);
    expect(rule('.landing-hero-copy')).not.toMatch(/(^|[\s;])(grid-column|width|max-width|margin[a-z-]*):/);
    // The sentence, the button and the entries have narrower limits of their own (in em or rem, so they
    // follow the text size): none reaches the map's drawing.
    expect(rule('.landing-sub')).toMatch(/max-width: 26em;/);
    expect(rule('.workspaces')).toMatch(/max-width: 36rem;/);
    // The column lies over both halves of the hero and takes its height. A grid item with auto margins is
    // only as wide as its content, so the width is stated.
    expect(inner).toMatch(/grid-column: 1 \/ -1;/);
    expect(inner).toMatch(/grid-row: 1;/);
    expect(inner).toMatch(/(^|\s)width: 100%;/);
    // The dark ground is the section around the column, so it still runs from edge to edge.
    const hero = rule('.landing-hero');
    expect(hero).not.toMatch(/max-width|margin|padding/);
    expect(hero).toMatch(/display: grid;/);
    expect(hero).toMatch(/grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/);
    expect(inner).not.toMatch(/background/);
  });

  it('gives "How it works" and the study\'s figure the same column: the same limit, centered, the same side padding (#853, #955)', () => {
    const how = rule('.landing-how');
    expect(how).toMatch(/max-width: var\(--landing-max, 1200px\)/);
    expect(how).toMatch(/margin: 0 auto;/);
    expect(how).toMatch(/padding: calc\(4 \* var\(--space-6, 24px\)\) var\(--landing-pad, 48px\) 0;/);
    const numbers = rule('.landing-numbers');
    expect(numbers).toMatch(/max-width: var\(--landing-max, 1200px\)/);
    expect(numbers).toMatch(/margin: calc\(4 \* var\(--space-6, 24px\)\) auto 0;/);
    expect(numbers).toMatch(/padding: calc\(3 \* var\(--space-6, 24px\)\) var\(--landing-pad, 48px\) calc\(4 \* var\(--space-6, 24px\)\);/);
    // The paper under the hero runs from edge to edge: it is the page's ground, not the sections'.
    expect(rule('.landing')).toMatch(/background: var\(--paper, #F4F2EC\);/);
    expect(rule('.landing')).toMatch(/color: var\(--paper-text, #14171F\);/);
    for (const section of [how, numbers]) expect(section).not.toMatch(/background/);
    expect(css).not.toContain('1080px');
    // Border-box sizing (global.css) makes both limits include the padding, so the two left edges line up.
    expect(readFileSync('client/src/styles/global.css', 'utf8')).toMatch(/\* \{ box-sizing: border-box; \}/);
  });

  it('the map is the whole right half of the hero, with no frame of any kind (#869)', () => {
    const map = rule('.landing-hero-map');
    // The hero's second half and its only row: the box runs from the middle to the window's right edge and
    // from the hero's top to its bottom. It has no size of its own that could hold it back.
    expect(map).toMatch(/grid-column: 2;/);
    expect(map).toMatch(/grid-row: 1;/);
    expect(map).not.toMatch(/(^|[\s;])(width|height|max-width|max-height|aspect-ratio|margin[a-z-]*|padding[a-z-]*|inset|top|right|bottom|left|align-self|justify-self):/);
    // No rectangle around it, in any rule of the file: no border, corner, shadow, outline, fill or card.
    const boxes = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
      .filter((m) => /\.landing-hero-map\b|\.hero-map\b/.test(m[1]));
    expect(boxes.length).toBeGreaterThanOrEqual(3); // the box, the drawing, the box under the text
    for (const [, selector, body] of boxes) {
      expect(body, selector).not.toMatch(/border|radius|shadow|outline|background|filter|backdrop/);
    }
    // The drawing fills the box and is cropped to it, around its middle.
    expect(map).toMatch(/position: relative;/);
    expect(map).toMatch(/overflow: hidden;/);
    const drawing = rule('.hero-map');
    expect(drawing).toMatch(/position: absolute;/);
    expect(drawing).toMatch(/inset: 0;/);
    expect(drawing).toMatch(/(^|\s)width: 100%;/);
    expect(drawing).toMatch(/(^|\s)height: 100%;/);
  });

  it('the map fades into the hero ground on its inner edge with a mask, and the key is not faded (#869)', () => {
    const drawing = rule('.hero-map');
    // From nothing at the edge next to the text (the left one, or the top one under the text) to the full
    // drawing: a mask, so the hero's flat ground shows through and no color is painted over the map.
    expect(rule('.landing-hero-map')).toMatch(/--hero-fade: to right;/);
    const masks = [...drawing.matchAll(/(-webkit-mask-image|mask-image): ([^;]+);/g)].map((m) => [m[1], m[2]]);
    expect(masks.map((m) => m[0])).toEqual(['-webkit-mask-image', 'mask-image']); // the prefixed one first
    // 30 % (#955; 22 % before): the title's long line ends on this edge, so it fades a little further in.
    for (const [, value] of masks) expect(value).toBe('linear-gradient(var(--hero-fade, to right), transparent, #000 30%)');
    expect(css.match(/mask-image:/g)).toHaveLength(2);
    // The key is the box's child, not the drawing's, so the mask does not touch it.
    expect(rule('.landing-hero-map')).not.toMatch(/mask/);
    expect(rule('.hero-legend')).not.toMatch(/mask|opacity/);
  });

  it('the key sits at the bottom of the map and ends on the centered column\'s right edge (#869)', () => {
    const key = rule('.hero-legend');
    expect(key).toMatch(/position: absolute;/);
    expect(key).toMatch(/bottom: var\(--space-6, 24px\);/);
    // The box is half the hero, so the column's inner right edge is (box width - 600px + padding) from the
    // box's right side; in a window narrower than the column it is the padding alone.
    expect(key).toMatch(/right: max\(var\(--landing-pad, 48px\), calc\(100% - var\(--landing-max, 1200px\) \/ 2 \+ var\(--landing-pad, 48px\)\)\);/);
    expect(key).toMatch(/justify-content: flex-end;/);
    expect(key).toMatch(/flex-wrap: wrap;/);
    expect(key).not.toMatch(/background|border|shadow/);
  });

  it('the hero is dark and fills the window under the header, so "How it works" starts below the fold (#869)', () => {
    const hero = /\.landing-hero \{([^}]*)\}/.exec(css)![1];
    expect(hero).toMatch(/--hero-ground: var\(--ink, #0B0F17\)/); // the deep ink of #955 is the dark ground
    expect(hero).toMatch(/background: var\(--hero-ground, #0B0F17\)/);
    expect(hero).toMatch(/color: var\(--hero-light, #F4F2EC\)/);
    // The window's height less the header's. dvh is the height a phone really shows; the vh line before it
    // is for a browser that does not know dvh.
    const heights = [...hero.matchAll(/min-height: ([^;]+);/g)].map((m) => m[1]);
    expect(heights).toEqual(['calc(100vh - var(--app-header-h, 72px))', 'calc(100dvh - var(--app-header-h, 72px))']);
    // 72 px is the header's height on one row (ui/shell.css, #955), and the fallback says the same (#879).
    // On two rows the hero ends below the fold, never above.
    expect(readFileSync('client/src/ui/shell.css', 'utf8')).toMatch(/:root \{ --app-header-h: 72px; \}/);
    // No narrower rule makes the hero shorter, and nothing of "How it works" is pulled up into it.
    expect(css.match(/min-height: calc\(100dvh/g)).toHaveLength(1);
    expect(css.replace(hero, '')).not.toMatch(/\.landing-hero \{[^}]*(min-)?height/);
    expect(rule('.landing-how')).not.toMatch(/margin(-top)?: -|position|transform/);
    expect(css).toMatch(/\.app-main:has\(\.landing\) \{ max-width: none; padding: 0; \}/);
  });

  it('never gives the map a box that crops the route: half the hero only in a wide window, a least height under the text (#869)', () => {
    // The drawing is cropped to its box around the middle (slice). The route stays whole while the box is
    // between these two shapes (width / height).
    const narrowest = (HERO_SAFE_BOX.x1 - HERO_SAFE_BOX.x0) / HERO_VIEWBOX.height;
    const widest = HERO_VIEWBOX.width / (HERO_SAFE_BOX.y1 - HERO_SAFE_BOX.y0);
    const query = /@media \(max-width: (\d+)px\), \(max-aspect-ratio: (\d+)\/(\d+)\) \{/.exec(css)!;
    const [maxWidth, upright] = [Number(query[1]), Number(query[2]) / Number(query[3])];
    // Side by side: the window is wider than `upright` times its height, the box is half of it and no
    // taller than the window. So the box is never narrower than this:
    expect(upright / 2).toBeGreaterThan(narrowest);
    // Under the text: at least half the window tall and at least `floor` px.
    const row = /grid-template-rows: auto minmax\(max\((\d+)vh, (\d+)px\), 1fr\);/.exec(STACKED)!;
    const [share, floor] = [Number(row[1]) / 100, Number(row[2])];
    expect(share).toBe(0.5); // "about 50vh"
    expect(upright / share).toBeLessThan(widest); // an upright window
    expect(maxWidth / floor).toBeLessThan(widest); // a narrow one that is wide for its height (a phone on its side)
  });

  it('has no rule left for the removed parts: the stats line, the text link, the indicator line, the footer (#724, #833)', () => {
    for (const gone of ['op-summary', 'landing-more', 'landing-intro', 'landing-indicator', 'landing-footer', 'workspace-id', 'workspace-action']) {
      expect(css, gone).not.toContain(gone);
    }
  });

  it('follows the design tokens: corners of 6px at most (docs/mvp3.md P4), no shadows, no gradient but the map\'s mask, fallbacks on every token', () => {
    for (const [, value] of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      for (const [, px] of value.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px)).toBeLessThanOrEqual(6);
      expect(value).not.toMatch(/%|rem|em\b/);
    }
    expect(css).not.toMatch(/box-shadow|text-shadow|drop-shadow/i);
    // Flat fills only. The one gradient is a mask (#869): it fades the drawing, it paints nothing.
    expect(css.replace(/(-webkit-)?mask-image: linear-gradient\([^;]*;/g, '')).not.toMatch(/gradient/i);
    expect(css).not.toMatch(/var\(--[a-z0-9-]+\)/);
  });
});
