// #879: design audit of the homepage against .claude/skills/frontend-design/SKILL.md and docs/mvp3.md P4.
// The page was measured in headless Chrome on a production build at 1440x900, 1366x768, 1024x768, 900x800 and
// 390x844, and swept from 320 to 1440 px. Each test below pins one thing the audit changed, or one thing it
// found right that no other test held. The numbers in the comments are the rects Chrome reported.
// #955 redrew the page ("night-shift transit ops": the humans' direction overrides docs/mvp3.md's fonts and
// colours); the audit's rules stay, with the new values, measured again at 1440x900, 900x700 and 390x800.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Landing, {
  HOW_STEPS, HOW_TITLE, LANDING_SUBLINE, LANDING_TITLE, STUDY_FIGURE, STUDY_FIGURE_TEXT, STUDY_LABEL, STUDY_NOTE, TITLE_LINES,
  WATCH_LABEL, WATCH_NOTE_NARROW, WORKSPACES,
} from '../../client/src/pages/Landing';
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

/** An entry's height: 8 + 21 + 18.2 + 8 px (15 px and 13 px lines at 1.4) and two hairlines. It has no stated height. */
const ENTRY_HEIGHT = 57.2;

describe('the homepage above the fold (#879)', () => {
  it('"Watch a package" is in sight at 1366x768 and 1440x900 under the 72 px header', () => {
    // The hero is the window less the header, and the fallback is the header's real height (it said 48 px).
    const header = px(/:root \{ --app-header-h: (\d+px); \}/.exec(readFileSync('client/src/ui/shell.css', 'utf8'))![1]);
    expect(header).toBe(72);
    expect(css.match(/var\(--app-header-h, (\d+)px\)/g)).toEqual(['var(--app-header-h, 72px)', 'var(--app-header-h, 72px)']);
    // The text block is centered in the hero. Its height from the rules (#955): three title lines at the
    // window's size, the sentence in two lines at its largest size, the button, and the two entries side
    // by side (both windows are wide enough for that).
    const title = rule('.landing-hero h1');
    const [, vw, max] = /font-size: clamp\(\d+px, ([\d.]+)vw, (\d+)px\)/.exec(title)!.map(Number);
    const sub = rule('.landing-sub');
    const subSize = Number(/font-size: clamp\(\d+px, [^,]+, (\d+)px\)/.exec(sub)![1]);
    const [subTop, subBottom] = [...prop(sub, 'margin')!.matchAll(/(\d+)px/g)].map((m) => Number(m[1]));
    const padding = px(prop(rule('.landing-hero-inner'), 'padding')) * 2; // calc(2 * 24px), above and below
    expect(padding).toBe(48);
    for (const [windowWidth, windowHeight] of [[1366, 768], [1440, 900]] as const) {
      const size = Math.min((vw! / 100) * windowWidth, max!);
      const block = 3 * size * Number(prop(title, 'line-height'))
        + subTop! + 2 * subSize * Number(prop(sub, 'line-height')) + subBottom!
        + px(prop(rule('.watch-button'), 'min-height'))
        + px(prop(rule('.workspaces'), 'margin')) + ENTRY_HEIGHT;
      const hero = windowHeight - header;
      // It fits with the column's padding, so the hero is not taller than the window and "How it works"
      // starts at the fold; the button's lower edge is then well above the fold (619 px at 768).
      expect(block + 2 * padding, `${windowWidth}x${windowHeight}`).toBeLessThanOrEqual(hero);
      const buttonBottom = header + (hero - block) / 2 + block - ENTRY_HEIGHT - px(prop(rule('.workspaces'), 'margin'));
      expect(buttonBottom, `${windowWidth}x${windowHeight}`).toBeLessThan(windowHeight - 100);
    }
  });

  it('"Watch a package" is the one dominant control: the only orange one, higher and set larger than the entries', () => {
    const button = rule('.watch-button');
    // The fills of the page: the paper, the ink hero, the button, and "See the numbers" in ink. The route
    // line's stations are filled with the paper so the line does not show through them. The entries are outlines.
    const filled = rules.filter(([selector, body]) => /(^|[;\s])background(-color)?:/.test(body) && !/:hover/.test(selector)).map(([selector]) => selector);
    expect(filled).toEqual(['.landing', '.landing-hero', '.watch-button', '.landing-steps li::before', '.landing-numbers::after', '.numbers-button']);
    expect(prop(button, 'background')).toBe('var(--hero-package, #FF6A1A)');
    expect(prop(rule('.landing-steps li::before'), 'background')).toBe('var(--paper, #F4F2EC)');
    expect(prop(rule('.landing-numbers::after'), 'background')).toBe('var(--paper, #F4F2EC)');
    expect(rule('.workspace-entry')).toMatch(/border: 1px solid var\(--hero-line, #262D3A\);/);
    // 64 px against an entry's 57 px, at every width. No rule gives an entry a height.
    expect(px(prop(button, 'min-height'))).toBe(64);
    expect(px(prop(button, 'min-height'))).toBeGreaterThanOrEqual(ENTRY_HEIGHT * 1.1);
    expect(phone).toMatch(/\.watch-button \{ display: flex; \}/);
    expect(css).not.toMatch(/\.workspace-entry[^{]*\{[^}]*(min-)?height:/);
    expect(prop(rule('.workspace-entry'), 'padding')).toBe('var(--space-2, 8px) var(--space-4, 16px)');
    expect(prop(rule('.workspace-body'), 'line-height')).toBe('1.4');
    // The largest label of any control on the page.
    expect(px(prop(button, 'font-size'))).toBe(19);
    expect(prop(rule('.workspace-title'), 'font-size')).toBe('15px');
    expect(prop(rule('.numbers-button'), 'font-size')).toBe('15px');
    // Never narrower than 300 px where 300 px fit; the entries may be wider (two side by side).
    expect(prop(button, 'min-width')).toBe('min(300px, 100%)');
    expect(prop(rule('.workspaces'), 'max-width')).toBe('36rem');
    expect(css).not.toMatch(/@media \(min-width/);
  });

  it('the title, its sentence, the button and the two entries are four groups, with more room around the button than between the entries', () => {
    // 24 px under the title, 32 px over the button, 24 px under it, 8 px between the entries.
    expect(prop(rule('.landing-hero h1'), 'margin')).toBe('0');
    expect(prop(rule('.landing-sub'), 'margin')).toBe('var(--space-6, 24px) 0 var(--space-8, 32px)');
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
    // The hero's column, "How it works" and the study's figure have the same limit and the same side padding.
    for (const selector of ['.landing-hero-inner', '.landing-how', '.landing-numbers']) {
      expect(prop(rule(selector), 'max-width'), selector).toBe('var(--landing-max, 1200px)');
      expect(prop(rule(selector), 'margin'), selector).toMatch(/^(0|calc\(4 \* var\(--space-6, 24px\)\)) auto( 0)?$/);
      // top, the sides, and where it differs the bottom
      expect(prop(rule(selector), 'padding'), selector).toMatch(/^calc\(\d \* var\(--space-6, 24px\)\) var\(--landing-pad, 48px\)( (0|calc\(\d \* var\(--space-6, 24px\)\)))?$/);
    }
    // Only the key on the map, the title's logo, the padding inside a box and the route line's marks
    // (drawn as ::before and ::after of their step or section) are placed sideways.
    const sideways = rules.filter(([, body]) => /(^|[;\s])(margin-left|margin-inline[a-z-]*|padding-left|padding-inline[a-z-]*|text-indent|translate|transform|left):/.test(body)).map(([selector]) => selector);
    expect(sideways.filter((s) => !/^\.hero-|^@|hero-package|^\d+%|^0%|::(before|after)$/.test(s))).toEqual([]);
    // The marks start at the column's own edge: the station at 0, the section's line at the side padding.
    expect(prop(rule('.landing-steps li::before'), 'left')).toBe('0');
    expect(prop(rule('.landing-numbers::before'), 'left')).toBe('var(--landing-pad, 48px)');
    for (const selector of ['.landing-hero h1', '.landing-sub', '.workspaces', '.landing-note', '.landing-how h2', '.landing-steps', '.landing-numbers h2', '.landing-numbers-note']) {
      // no margin at all; or top and bottom only; or top, sides, bottom: the sides are 0
      const sides = prop(rule(selector), 'margin')!.replace(/calc\([^;]*\)\)/g, 'step').replace(/var\([^)]*\)/g, 'step').split(' ');
      expect([1, 2, 3], selector).toContain(sides.length);
      expect(sides.length === 1 ? sides[0] : sides[1], selector).toBe('0');
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
          .replace(/calc\([234] \* var\(--space-6, 24px\)\)/g, '') // 48, 72 and 96 px: whole steps of --space-6
          .replace(/calc\(var\(--space-8, 32px\) \+ var\(--space-2, 8px\)\)/g, '') // 40 px under a station
          .replace(/var\(--landing-pad, 48px\)/g, '')
          .replace(step, '')
          .replace(/\b(0|auto)\b/g, '');
        expect(rest.trim(), `${selector} { ${name}: ${value} }`).toBe('');
      }
    }
    for (const [, n, fallback] of css.matchAll(step)) expect(`${fallback}px`, `--space-${n}`).toBe(token(`--space-${n}`));
    // Only type sizes follow the window's width (the title, its sentence, the headings, the figure and
    // the steps), never a margin or a padding, so no edge lands between two pixels.
    const fluid = rules.flatMap(([selector, body]) => [...body.matchAll(/(?:^|[;\s])([a-z-]+): [^;]*\d(?:vw)\b[^;]*;/g)].map((m) => `${selector} ${m[1]}`));
    expect(fluid.length).toBeGreaterThan(0);
    for (const use of fluid) expect(use).toMatch(/ font-size$/);
    expect(css.match(/\d+(?:vh|dvh)\b/g)).toEqual(['100vh', '100dvh', '50vh']);
  });

  it('nothing can be wider than a 320 px window', () => {
    // Swept in Chrome from 320 to 1440 px: scrollWidth equals the window's width at every step.
    for (const [selector, body] of rules) {
      for (const [, name, value] of body.matchAll(/(?:^|[;\s])((?:min-)?width): ([^;]+);/g)) {
        if (/^(0|100%|[\d.]+(em|ch))$/.test(value)) continue;
        if (/::(before|after)$/.test(selector) && /^(8|10|12)px$/.test(value)) continue; // a station's ring
        expect(`${selector} { ${name}: ${value} }`).toBe('.watch-button { min-width: min(300px, 100%) }');
      }
    }
    // At 320 px the column is 272 px wide: the window less --space-6 at each side.
    expect(320 - 2 * px(token('--space-6'))).toBe(272);
    expect(css).not.toContain('nowrap');
  });
});

describe('"How it works" and "See the numbers" (#879)', () => {
  it('one heading size and one body size under the hero, each with a least and a largest size', () => {
    const sizes = rules.filter(([selector]) => /^\.landing-(how|step)/.test(selector) && !selector.includes(':'))
      .flatMap(([selector, body]) => (prop(body, 'font-size') ? [`${selector}: ${prop(body, 'font-size')}`] : []));
    // #955: the heading is Archivo, condensed and heavy like the title; the steps are the body face.
    expect(sizes).toEqual(['.landing-how h2: clamp(34px, 4vw, 52px)', '.landing-steps li: clamp(17px, 1.5vw, 20px)']);
    expect(prop(rule('.landing-how h2'), 'font-stretch')).toBe('78%');
    expect(prop(rule('.landing-how h2'), 'font-weight')).toBe('800');
    expect(rule('.landing-steps li')).not.toMatch(/font-family/);
    // No numeral is printed beside a step (the list is ordered; the stations show the order), so no mono face.
    expect(css).not.toContain('landing-step-n');
    // The button's label is a control's label: Archivo's wide cut at 15 px, paper on ink.
    expect(prop(rule('.numbers-button'), 'font-size')).toBe('15px');
    expect(prop(rule('.numbers-button'), 'color')).toBe('var(--paper, #F4F2EC)');
    // 96 px of paper over the heading, and again between the steps and the figure's line.
    expect(prop(rule('.landing-how'), 'padding')).toBe('calc(4 * var(--space-6, 24px)) var(--landing-pad, 48px) 0');
    expect(prop(rule('.landing-numbers'), 'margin')).toBe('calc(4 * var(--space-6, 24px)) auto 0');
  });

  it('the three steps are three stations on a route line: blue to the relay point\'s diamond, green from it (#955)', () => {
    // A 2 px line from each station's middle to the next one's, in the two carriers' colours; none after the last.
    const line = rule('.landing-steps li::after');
    expect(prop(line, 'border-top')).toBe('2px solid var(--carrier-a, #3D8BFF)');
    expect(css).toMatch(/\.landing-steps li:nth-child\(2\)::after \{ border-top-color: var\(--carrier-b, #22C08A\); \}/);
    expect(prop(rule('.landing-steps li:last-child::after'), 'content')).toBe('none');
    expect([prop(line, 'top'), prop(line, 'left'), prop(line, 'width')]).toEqual(['5px', '6px', '100%']); // the middle of a 12 px ring
    // The station: a 12 px ring in the text's ink (a circle: a 6 px corner on a 12 px box), over the line.
    const station = rule('.landing-steps li::before');
    expect([prop(station, 'width'), prop(station, 'height'), prop(station, 'border-radius'), prop(station, 'box-sizing')])
      .toEqual(['12px', '12px', 'var(--radius-lg, 6px)', 'border-box']);
    expect(prop(station, 'border')).toBe('2px solid var(--paper-text, #14171F)');
    expect(prop(station, 'z-index')).toBe('1');
    // The second one is the relay point's diamond, as on the map above: the same box, square and turned.
    expect(css).toMatch(/\.landing-steps li:nth-child\(2\)::before \{ border-radius: 0; transform: rotate\(45deg\); \}/);
    // Three columns; in a narrow window one column, and the line runs down from each station to the next.
    expect(prop(rule('.landing-steps'), 'grid-template-columns')).toBe('repeat(3, minmax(0, 1fr))');
    const narrow = /@media \(max-width: 700px\) \{([\s\S]*?)\n\}/.exec(css)![1]!;
    expect(narrow).toMatch(/\.landing-steps \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    expect(narrow).toMatch(/\.landing-steps li::after \{ top: 12px; left: 5px; width: 0; height: 100%; border-top: 0; border-left: 2px solid var\(--carrier-a, #3D8BFF\); \}/);
    expect(narrow).toMatch(/\.landing-steps li:nth-child\(2\)::after \{ border-left-color: var\(--carrier-b, #22C08A\); \}/);
    // The marks are drawn by the stylesheet only: the list's markup is its three sentences.
    expect(html).toContain(`<ol class="landing-steps">${HOW_STEPS.map((step) => `<li><span class="landing-step-text">${step}</span></li>`).join('')}</ol>`);
  });

  it('the study\'s figure is one very large number in Archivo, with a route line that ends at a station over it (#955)', () => {
    const figure = rule('.landing-figure');
    expect(prop(figure, 'font-size')).toBe('clamp(120px, 17vw, 232px)');
    expect(prop(figure, 'font-weight')).toBe('800');
    expect(prop(figure, 'font-stretch')).toBe('78%');
    expect(prop(figure, 'letter-spacing')).toBe('-0.03em');
    // The largest type under the hero by far: the page has one headline figure, not a row of them.
    expect(html.match(/class="landing-figure"/g)).toHaveLength(1);
    expect(120).toBeGreaterThan(2 * 52);
    // The words that finish its sentence wrap beside it, or under it in a narrow window, in balanced lines.
    expect(prop(rule('.landing-numbers h2'), 'flex-wrap')).toBe('wrap');
    expect(prop(rule('.landing-figure-text'), 'text-wrap')).toBe('balance');
    // The section's divider: a 2 px hairline across the column that ends at a station's ring.
    expect(prop(rule('.landing-numbers::before'), 'border-top')).toBe('2px solid var(--paper-line, #DCD8CE)');
    expect([prop(rule('.landing-numbers::before'), 'left'), prop(rule('.landing-numbers::before'), 'right'), prop(rule('.landing-numbers::after'), 'right')])
      .toEqual(['var(--landing-pad, 48px)', 'var(--landing-pad, 48px)', 'var(--landing-pad, 48px)']);
    expect(prop(rule('.landing-numbers::after'), 'border')).toBe('2px solid var(--paper-text, #14171F)');
  });

  it('the copy of the whole page is short, in sentence case, and has no jargon or ids', () => {
    const copy = [
      LANDING_TITLE, LANDING_SUBLINE, WATCH_LABEL, WATCH_NOTE_NARROW, STUDY_LABEL, HOW_TITLE, ...HOW_STEPS,
      ...WORKSPACES.flatMap((w) => [w.title, w.text]), ...HERO_LEGEND.map((x) => x.text), HERO_MAP_LABEL,
    ];
    /** The study's figure, its words and its line (#955): the only numbers on the page, checked against the study page in landing-numbers-figure.test.tsx. */
    const study = [STUDY_FIGURE, STUDY_FIGURE_TEXT, STUDY_NOTE];
    for (const line of [...copy, ...study]) {
      expect(line, line).not.toMatch(/\b(hubs?|trips?|ids?|nodes?|legs?|shipments?|payloads?|carriers?|v2|api)\b/i);
      expect(line, line).not.toMatch(/\b(shp|emp|biz)-/);
      if (!study.includes(line)) expect(line, line).not.toMatch(/\d/);
      expect(line.replace('CO2', ''), line).not.toMatch(/[A-Z]{2,}/); // no all caps (CO2 is a formula)
      expect(line, line).not.toMatch(/[—·]| - /); // no dash or dot joins
    }
    // What is shown is all of it: the page's text is these lines (the title in its three boxes, the
    // figure's words around the subscript 2 of CO2).
    const shown = html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '|').split('|').map((s) => s.trim()).filter(Boolean);
    const [beforeTwo, afterTwo] = STUDY_FIGURE_TEXT.split('2');
    const known = new Set([...copy, ...study, 'R', TITLE_LINES[0].slice(1), ...TITLE_LINES.slice(1), beforeTwo!.trim(), '2', afterTwo!.trim()]);
    expect(shown.filter((s) => !known.has(s))).toEqual([]);
    expect(HOW_TITLE.split(' ')).toHaveLength(3);
    for (const step of HOW_STEPS) expect(step.split(' ').length, step).toBeLessThanOrEqual(16);
    for (const line of [LANDING_SUBLINE, STUDY_NOTE]) expect(line.split(' ').length, line).toBeLessThanOrEqual(13);
    expect(LANDING_TITLE.split(' ')).toHaveLength(5);
    for (const w of WORKSPACES) expect(w.text.split(' ').length, w.text).toBeLessThanOrEqual(8);
  });
});

describe('the homepage\'s fonts and keyboard order (#879)', () => {
  it('the body and the map key are Inter, the title, headings, figure, button labels and map letters Archivo, and nothing is mono', () => {
    // #955: IBM Plex Mono is for times and prices only, and the homepage shows neither. "Commuter A" is a word.
    expect(rule('.hero-legend')).not.toMatch(/font-family/);
    expect(prop(rule('.landing'), 'font-family')).toBe('var(--font-sans, inherit)');
    expect(css).not.toMatch(/--font-mono|monospace/);
    const display = rules.filter(([, body]) => /font-family: var\(--font-display, 'Archivo Variable', 'Inter', system-ui, sans-serif\);/.test(body)).map(([selector]) => selector);
    expect(display).toEqual([
      '.landing-hero h1', '.watch-button', '.workspace-title', '.hero-badge-letter',
      '.landing-how h2', '.landing-figure', '.landing-figure-text', '.numbers-button',
    ]);
    expect(css.match(/font-family:/g)).toHaveLength(display.length + 1);
    // Condensed where it is large, wide where it is small (the sizes are checked in kit-v2-fonts.test.ts).
    const width = (selector: string) => prop(rule(selector), 'font-stretch');
    for (const selector of ['.landing-hero h1', '.landing-how h2', '.landing-figure', '.landing-figure-text']) expect(width(selector), selector).toBe('78%');
    for (const selector of ['.watch-button', '.workspace-title', '.numbers-button']) expect(width(selector), selector).toBe('112%');
  });

  it('the page\'s links are in the order they are drawn: Watch a package, Business, Employee, See the numbers', () => {
    // The header's stops come first (tests/ui/landing-dom-two-entries.test.tsx walks the whole shell).
    // The button is described by the line under it (#908), so its `aria-describedby` sits before its href.
    const links = [...html.matchAll(/<a class="([^"]*)"(?: aria-describedby="[^"]*")? href="([^"]*)"/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(links).toEqual([
      'watch-button /simulator?package=shp-3&amp;play=1', 'workspace-entry /business/biz-a', 'workspace-entry /employee/emp-a', 'numbers-button /study.html',
    ]);
    expect(html).not.toMatch(/tabindex/i);
    // No rule draws them in another order than the markup's, and each has a ring of its own.
    expect(css).not.toMatch(/(^|[;\s])order:|-reverse|direction: rtl/);
    for (const selector of ['.watch-button:focus-visible', 'a.workspace-entry:focus-visible', '.numbers-button:focus-visible']) {
      expect(rule(selector), selector).toMatch(/outline: [23]px solid var\(--(hero-light|paper-text), #[0-9A-F]{6}\);\s*outline-offset: [23]px;/);
    }
  });
});
