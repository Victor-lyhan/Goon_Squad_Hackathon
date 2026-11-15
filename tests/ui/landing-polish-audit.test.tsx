// #879: design audit of the homepage against .claude/skills/frontend-design/SKILL.md and docs/mvp3.md P4.
// The page was measured in headless Chrome on a production build at 1440x900, 1366x768, 1024x768, 900x800 and
// 390x844, and swept from 320 to 1440 px. Each test below pins one thing the audit changed, or one thing it
// found right that no other test held. The numbers in the comments are the rects Chrome reported.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Landing, { HOW_STEPS, HOW_TITLE, LANDING_TITLE, STUDY_LABEL, WATCH_LABEL, WORKSPACES } from '../../client/src/pages/Landing';
import { HERO_LEGEND, HERO_MAP_LABEL } from '../../client/src/pages/LandingHeroMap';
import type { NycSummary } from '../../client/src/pages/landingModel';

const raw = readFileSync('client/src/styles/landing.css', 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = readFileSync('client/src/styles/tokens.css', 'utf8');
/** The body of the first rule with exactly this selector (the base rule, not one inside a media block). */
const rule = (selector: string) =>
  new RegExp(`(?:^|\\})\\s*${selector.replace(/[.:]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
/** Every rule of the file, the ones inside media blocks too: [selector, body]. */
const rules = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]] as const);
const phone = /@media \(max-width: 480px\) \{([\s\S]*?)\n\}/.exec(css)![1];
const px = (value: string | undefined) => Number(/(-?[\d.]+)px/.exec(value ?? '')?.[1]);
const prop = (body: string, name: string) => new RegExp(`(?:^|[;\\s])${name}: ([^;]+);`).exec(body)?.[1];
const token = (name: string) => new RegExp(`${name}: ([^;]+);`).exec(tokens)![1];

const summary: NycSummary = { status: 'ready', businessIds: ['biz-a'], employeeIds: ['emp-a'], watchPackageId: 'shp-3' };
const html = renderToStaticMarkup(<MemoryRouter><Landing initialSummary={summary} /></MemoryRouter>);

/** An entry's height in Chrome: 8 + 21 + 19.5 + 8 px and two hairlines. It has no stated height. */
const ENTRY_HEIGHT = 58.5;

describe('the homepage above the fold (#879)', () => {
  it('"Watch a package" is in sight at 1366x768 and 1440x900 under the 64 px header', () => {
    // The hero is the window less the header, and the fallback is the header's real height (it said 48 px).
    const header = px(/:root \{ --app-header-h: (\d+px); \}/.exec(readFileSync('client/src/ui/shell.css', 'utf8'))![1]);
    expect(header).toBe(64);
    expect(css.match(/var\(--app-header-h, (\d+)px\)/g)).toEqual(['var(--app-header-h, 64px)', 'var(--app-header-h, 64px)']);
    // The text block is centered in the hero. Its height from the rules: three title lines at the largest
    // size, the button, the two entries and the room between them. 421 px in Chrome.
    const title = rule('.landing-hero h1');
    const size = Number(/font-size: clamp\(\d+px, [^,]+, (\d+)px\)/.exec(title)![1]);
    const block = 3 * size * Number(prop(title, 'line-height')) + px(prop(title, 'margin'))
      + px(prop(rule('.watch-button'), 'min-height'))
      + px(prop(rule('.workspaces'), 'margin')) + 2 * ENTRY_HEIGHT + px(prop(rule('.workspaces'), 'gap'));
    expect(Math.round(block)).toBe(421);
    const padding = px(prop(rule('.landing-hero-inner'), 'padding'));
    for (const windowHeight of [768, 900]) {
      const hero = windowHeight - header;
      // It fits with the column's padding, so the hero is not taller than the window and "How it works"
      // starts at the fold; the button's lower edge is then well above the fold (477.5 px at 768).
      expect(block + 2 * padding).toBeLessThanOrEqual(hero);
      const buttonBottom = header + (hero - block) / 2 + block - 2 * ENTRY_HEIGHT - px(prop(rule('.workspaces'), 'gap')) - px(prop(rule('.workspaces'), 'margin'));
      expect(buttonBottom).toBeLessThan(windowHeight - 200);
    }
  });

  it('"Watch a package" is the one dominant element: the only filled one, higher and set larger than the entries', () => {
    const button = rule('.watch-button');
    // The only fill among the hero's text and controls. The entries are outlines.
    const filled = rules.filter(([selector, body]) => /(^|[;\s])background(-color)?:/.test(body) && !/:hover/.test(selector)).map(([selector]) => selector);
    expect(filled).toEqual(['.landing-hero', '.watch-button', '.numbers-button']);
    expect(prop(button, 'background')).toBe('var(--panel, #FFFFFF)');
    expect(rule('.workspace-entry')).toMatch(/border: 1px solid var\(--hero-shore, #44526A\);/);
    // 72 px against an entry's 58.5 px (it was 64 against 60.5), and 64 px on a phone (it was 56, lower than
    // an entry). No rule gives an entry a height.
    expect(px(prop(button, 'min-height'))).toBe(72);
    expect(px(prop(button, 'min-height'))).toBeGreaterThanOrEqual(ENTRY_HEIGHT * 1.2);
    expect(phone).toMatch(/\.watch-button \{ display: flex; min-height: 64px; font-size: var\(--text-lg, 18px\); \}/);
    expect(64).toBeGreaterThan(ENTRY_HEIGHT);
    expect(css).not.toMatch(/\.workspace-entry[^{]*\{[^}]*(min-)?height:/);
    // The largest label of any control on the page.
    expect(px(prop(button, 'font-size'))).toBe(20);
    expect(prop(rule('.workspace-title'), 'font-size')).toBe('var(--text-md, 14px)');
    expect(prop(rule('.numbers-button'), 'font-size')).toBe('var(--text-md, 14px)');
    // Never narrower than the entries under it: between 481 and 599 px it was 241.5 px over 320 px entries.
    expect(prop(button, 'min-width')).toBe('min(320px, 100%)');
    expect(prop(rule('.workspaces'), 'max-width')).toBe('320px');
    expect(css).not.toMatch(/@media \(min-width/);
  });

  it('the button stands alone and the two entries are one group: more room around the button than between them', () => {
    // 32 px over the button, 24 px under it, 8 px between the entries (it was 24, 16 and 12).
    expect(prop(rule('.landing-hero h1'), 'margin')).toBe('0 0 var(--space-8, 32px)');
    expect(prop(rule('.workspaces'), 'margin')).toBe('var(--space-6, 24px) 0 0');
    expect(prop(rule('.workspaces'), 'gap')).toBe('var(--space-2, 8px)');
  });

  it('an entry is its two lines and nothing else: no arrow after the text', () => {
    // An arrow appended to a link is decoration (the skill lists it); the outlined box is the link.
    const entries = [...html.matchAll(/<a class="workspace-entry"[^>]*>(.*?)<\/a>/g)].map((m) => m[1]);
    expect(entries).toEqual(WORKSPACES.map((w) =>
      `<span class="workspace-body"><span class="workspace-title">${w.title}</span><span class="workspace-text">${w.text}</span></span>`));
    expect(html).not.toMatch(/[→›»➜➔]|&rarr;|&#8594;/);
    expect(raw).not.toMatch(/workspace-arrow|[→›»]/);
    expect(readFileSync('client/src/pages/Landing.tsx', 'utf8')).not.toContain('workspace-arrow');
  });
});

describe('the homepage\'s edges and spacing (#879)', () => {
  it('text blocks and buttons share one left edge: nothing in the two columns is pushed in or out', () => {
    // In Chrome the title, the button, the entries, the heading, the step numbers and "See the numbers" all
    // start at x = 168 (1440 px), 131 (1366), 48 (1024 and 900) and 24 (390).
    expect(prop(rule('.landing-hero-copy'), 'align-items')).toBe('flex-start');
    expect(phone).toMatch(/\.landing-hero-copy \{ align-items: stretch; \}/);
    // The hero's column and "How it works" have the same limit and the same side padding.
    for (const selector of ['.landing-hero-inner', '.landing-how']) {
      expect(prop(rule(selector), 'max-width'), selector).toBe('var(--landing-max, 1200px)');
      expect(prop(rule(selector), 'margin'), selector).toBe('0 auto');
      expect(prop(rule(selector), 'padding'), selector).toMatch(/\) var\(--landing-pad, 48px\)$/); // top and bottom, then the sides
    }
    // Only the key on the map, the title's logo and the padding inside a box are placed sideways.
    const sideways = rules.filter(([, body]) => /(^|[;\s])(margin-left|margin-inline[a-z-]*|padding-left|padding-inline[a-z-]*|text-indent|translate|transform|left):/.test(body)).map(([selector]) => selector);
    expect(sideways.filter((s) => !/^\.hero-|^@|hero-package|^\d+%|^0%/.test(s))).toEqual([]);
    for (const selector of ['.landing-hero h1', '.workspaces', '.landing-note', '.landing-how h2', '.landing-steps']) {
      // top, sides, bottom: the sides are 0
      const sides = prop(rule(selector), 'margin')!.replace(/var\([^)]*\)/g, 'step').split(' ');
      expect(sides.length, selector).toBe(3);
      expect(sides[1], selector).toBe('0');
      expect(rule(selector), selector).not.toMatch(/padding(-left)?: (?!0;)/);
    }
  });

  it('every margin, padding and gap is a step of the spacing scale, with the token\'s own value as its fallback', () => {
    // --landing-pad and the room around "How it works" are twice --space-6. It was clamp(16px, 6vw, 48px):
    // 23.4 px at 390 px and a 40.96 px column gap at 1024 px.
    expect(prop(rule('.landing'), '--landing-pad')).toBe('calc(2 * var(--space-6, 24px))');
    expect(phone).toMatch(/\.landing \{ --landing-pad: var\(--space-6, 24px\); \}/);
    const step = /var\(--space-(\d), (\d+)px\)/g;
    for (const [selector, body] of rules) {
      if (selector === '.landing-title-logo') continue; // sized in em with the title (#853)
      for (const [, name, value] of body.matchAll(/(?:^|[;\s])((?:margin|padding|gap)[a-z-]*): ([^;]+);/g)) {
        const rest = value
          .replace(/calc\(2 \* var\(--space-6, 24px\)\)/g, '')
          .replace(/var\(--landing-pad, 48px\)/g, '')
          .replace(step, '')
          .replace(/\b(0|auto)\b/g, '');
        expect(rest.trim(), `${selector} { ${name}: ${value} }`).toBe('');
      }
    }
    for (const [, n, fallback] of css.matchAll(step)) expect(`${fallback}px`, `--space-${n}`).toBe(token(`--space-${n}`));
    // No size that follows the window's width but the title's, so no edge lands between two pixels.
    expect(css.match(/\d+(?:vw|vh|dvh)\b/g)).toEqual(['100vh', '100dvh', '4vw', '50vh']);
  });

  it('nothing can be wider than a 320 px window', () => {
    // Swept in Chrome from 320 to 1440 px: scrollWidth equals the window's width at every step.
    for (const [selector, body] of rules) {
      for (const [, name, value] of body.matchAll(/(?:^|[;\s])((?:min-)?width): ([^;]+);/g)) {
        if (/^(0|100%|[\d.]+(em|ch))$/.test(value)) continue;
        expect(`${selector} { ${name}: ${value} }`).toBe('.watch-button { min-width: min(320px, 100%) }');
      }
    }
    // At 320 px the column is 272 px wide: the window less --space-6 at each side.
    expect(320 - 2 * px(token('--space-6'))).toBe(272);
    expect(css).not.toContain('nowrap');
  });
});

describe('"How it works" and "See the numbers" (#879)', () => {
  it('one heading size and one body size, both from the type scale', () => {
    const sizes = rules.filter(([selector]) => /^\.landing-(how|step)/.test(selector) && !selector.includes(':'))
      .flatMap(([selector, body]) => (prop(body, 'font-size') ? [`${selector}: ${prop(body, 'font-size')}`] : []));
    // The lines were 16 px (not in the scale) with 14 px numbers; the numbers now take the line's size.
    expect(sizes).toEqual(['.landing-how h2: var(--text-xl, 28px)', '.landing-steps li: var(--text-lg, 18px)']);
    expect(token('--text-xl')).toBe('28px');
    expect(token('--text-lg')).toBe('18px');
    // The numbers are the page's numbers, so they keep the mono face (docs/mvp3.md P4), at the same size.
    expect(rule('.landing-step-n')).toMatch(/font-family: var\(--font-mono, ui-monospace, monospace\);/);
    // The button's label is a control's label, like every button of the kit.
    expect(prop(rule('.numbers-button'), 'font-size')).toBe('var(--text-md, 14px)');
    expect(prop(rule('.numbers-button'), 'color')).toBe('var(--panel, #FFFFFF)');
    // The same room over the heading as under the button.
    expect(prop(rule('.landing-how'), 'padding')).toBe('calc(2 * var(--space-6, 24px)) var(--landing-pad, 48px)');
  });

  it('the copy of the whole page is short, in sentence case, and has no jargon or ids', () => {
    const copy = [
      LANDING_TITLE, WATCH_LABEL, STUDY_LABEL, HOW_TITLE, ...HOW_STEPS,
      ...WORKSPACES.flatMap((w) => [w.title, w.text]), ...HERO_LEGEND.map((x) => x.text), HERO_MAP_LABEL,
    ];
    for (const line of copy) {
      expect(line, line).not.toMatch(/\b(hubs?|trips?|ids?|nodes?|legs?|shipments?|payloads?|carriers?|v2|api)\b/i);
      expect(line, line).not.toMatch(/\b(shp|emp|biz)-|\d/);
      expect(line, line).not.toMatch(/[A-Z]{2,}/); // no all caps
      expect(line, line).not.toMatch(/[—·]| - /); // no dash or dot joins
    }
    // What is shown is all of it: the page's text is these lines and the three step numbers.
    const shown = html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '|').split('|').map((s) => s.trim()).filter(Boolean);
    const known = new Set([...copy, 'R', LANDING_TITLE.slice(1, 6), LANDING_TITLE.slice(6).trim(), '1', '2', '3']);
    expect(shown.filter((s) => !known.has(s))).toEqual([]);
    expect(HOW_TITLE.split(' ')).toHaveLength(3);
    for (const step of HOW_STEPS) expect(step.split(' ').length, step).toBeLessThanOrEqual(16);
    for (const w of WORKSPACES) expect(w.text.split(' ').length, w.text).toBeLessThanOrEqual(8);
  });
});

describe('the homepage\'s fonts and keyboard order (#879)', () => {
  it('the map key is set in Inter: the mono face is only on the letters A and B and on the step numbers', () => {
    // docs/mvp3.md P4: IBM Plex Mono is for times, ids, distances and prices. "Commuter A" is a word.
    expect(rule('.hero-legend')).not.toMatch(/font-family/);
    expect(prop(rule('.landing'), 'font-family')).toBe('var(--font-sans, inherit)');
    const mono = rules.filter(([, body]) => /font-family: var\(--font-mono/.test(body)).map(([selector]) => selector);
    expect(mono).toEqual(['.hero-badge-letter', '.landing-step-n']);
    expect(css.match(/font-family:/g)).toHaveLength(3);
  });

  it('the page\'s links are in the order they are drawn: Watch a package, Business, Employee, See the numbers', () => {
    // The header's stops come first (tests/ui/landing-dom-two-entries.test.tsx walks the whole shell).
    const links = [...html.matchAll(/<a class="([^"]*)" href="([^"]*)"/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(links).toEqual([
      'watch-button /simulator?package=shp-3&amp;play=1', 'workspace-entry /business/biz-a', 'workspace-entry /employee/emp-a', 'numbers-button /study.html',
    ]);
    expect(html).not.toMatch(/tabindex/i);
    // No rule draws them in another order than the markup's, and each has a ring of its own.
    expect(css).not.toMatch(/(^|[;\s])order:|-reverse|direction: rtl/);
    for (const selector of ['.watch-button:focus-visible', 'a.workspace-entry:focus-visible', '.numbers-button:focus-visible']) {
      expect(rule(selector), selector).toMatch(/outline: [23]px solid var\(--(panel|text), #[0-9A-F]{6}\);\s*outline-offset: [23]px;/);
    }
  });
});
