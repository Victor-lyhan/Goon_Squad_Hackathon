// Issue 957 (the bold redesign, "night-shift transit ops"): the six stylesheets of
// client/src/components/employee/v2 carry the look the human set for this page, in place of the MVP III
// colours and fonts (#685, whose three rules this file keeps in their new form). Read from the files:
//   1. every colour is a token of client/src/styles/tokens.css: the direction's own (#955: ink, paper,
//      signal, the two carriers) or the app's ok and danger; a fallback is the token's value, and no MVP III
//      colour is left. The signal orange is a fill or a border with ink words on it, never the colour of
//      words; the carrier colours are the pass's line only;
//   2. no shadow and no gradient; a radius is a radius token of at most 6 px, or 50% on a station dot;
//   3. Archivo (--font-display) for headings and the big numbers, heavy and condensed when large, wide when
//      small; IBM Plex Mono for times and prices; the sans token for everything else at 400 or 600.
// Rule 3 is also checked on the rendered markup: a time or a price that is in neither a mono nor a
// display rule fails, so a new number needs one of the two before it ships.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommuteForm } from '../../client/src/components/employee/v2/CommuteForm';
import { EmployeeWorkspace } from '../../client/src/components/employee/v2/EmployeeWorkspace';
import { JobDetailV2 } from '../../client/src/components/employee/v2/JobDetailV2';
import { CommuteRoutePreview } from '../../client/src/components/employee/v2/route/CommuteRoutePreview';
import { BASELINE, toneLabelColor } from '../../client/src/components/map/layers';
import {
  all, matchesSelector, parseCss, parseHtml, readTokens, v2CssFiles, type CssRule, type El,
} from './employee-v2-qa-helpers';
import { BUSINESSES, DASHBOARD, HOME, JOB, MAP, TRIPS } from './employee-v2-route-sample';
import { businesses, dashboard } from './employee-v2-workspace-sample';
import { businesses as jobBusinesses, eveningDirect, morningDirect, relayLeg1, relayLeg2 } from './employeeV2JobSample';

const files = v2CssFiles();
const tokens = readTokens();
const short = (f: string) => f.replace(/^.*employee\/v2\//, '');
const sources = new Map(files.map((f) => [short(f), readFileSync(f, 'utf8')]));
const parsed = new Map([...sources].map(([f, css]) => [f, parseCss(css)]));

const MAX_RADIUS_PX = 6; // docs/mvp3.md P4: "6px radius max"
/** The palette the issue names, value for value, under the names tokens.css gives it (#955). */
const PALETTE: Record<string, string> = {
  '--ink': '#0B0F17', '--paper': '#F4F2EC', '--on-ink': '#F4F2EC', '--paper-text': '#14171F', '--paper-muted': '#5A5F6B',
  '--paper-line': '#DCD8CE', '--signal': '#FF6A1A', '--carrier-a': '#3D8BFF', '--carrier-b': '#22C08A',
};
/** The MVP III colours this page no longer uses (their tokens and their values), comments included. */
/** --panel stays: it is the white of a form field on paper. */
const MVP3_TOKENS = ['--text', '--navy', '--muted', '--border', '--accent', '--accent-dark', '--accent-soft', '--bg', '--focus-ring'];
const MVP3_COLOURS = ['#F7F7F4', '#171C24', '#5B6472', '#E3E3DE', '#1D5075', '#173E5B', '#E8EEF1'];
/** The older MVP II values (#651). None may be left either. */
const MVP2_COLOURS = ['#F7F8FA', '#151B26', '#D7DDE5', '#28618A', '#1F4E70', '#E8F0F6'];
/** The one round shape: a station dot, a route mark or a notch of the pass. */
const ROUND = '50%';

const VAR_RE = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g;
const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i;
const GRADIENT = /gradient\s*\(/i;
const NAMED_COLOUR = /\b(white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|navy|teal|maroon|olive|lime|aqua|fuchsia|pink|brown|gold|tan|beige|ivory|coral|salmon|crimson|indigo|violet)\b/i;
const COLOUR_PROP = /^(color|background(-color)?|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|box-shadow|accent-color|caret-color|fill|stroke|text-decoration(-color)?|column-rule(-color)?)$/;

const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, '');
const families = (v: string) => v.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '').toLowerCase()).filter(Boolean);
/** True when `part` is `whole` with some families left out: same first family, same order. */
function isFontSubset(part: string, whole: string): boolean {
  const a = families(part);
  const b = families(whole);
  if (a.length === 0 || a[0] !== b[0]) return false;
  let i = 0;
  for (const f of a) {
    i = b.indexOf(f, i);
    if (i < 0) return false;
    i += 1;
  }
  return true;
}
const selectorsOf = (r: CssRule) => r.selector.split(',').map((s) => s.trim().replace(/\s+/g, ' '));
const at = (file: string, r: CssRule, d: { prop: string; value: string }) =>
  `${file}: ${r.media.length ? `${r.media.join(' ')} ` : ''}${r.selector.replace(/\s+/g, ' ')} { ${d.prop}: ${d.value} }`;

/** Rule 1: colours come from tokens.css, and a fallback repeats the token's value. */
function colourProblems(file: string, rules: CssRule[]): string[] {
  const bad: string[] = [];
  for (const r of rules) for (const d of r.decls) {
    for (const [, name, fb] of d.value.matchAll(VAR_RE)) {
      const token = tokens.get(name);
      if (token === undefined) { bad.push(`${at(file, r, d)}: ${name} is not in tokens.css`); continue; }
      if (fb === undefined) continue;
      const same = name.startsWith('--font-') ? isFontSubset(fb, token) : norm(fb) === norm(token);
      if (!same) bad.push(`${at(file, r, d)}: ${name} is ${token}, the fallback says ${fb.trim()}`);
    }
    const rest = d.value.replace(VAR_RE, ' ');
    if (GRADIENT.test(d.value)) bad.push(`${at(file, r, d)}: gradient`);
    else if (COLOUR_LITERAL.test(rest)) bad.push(`${at(file, r, d)}: colour literal outside a token`);
    else if (COLOUR_PROP.test(d.prop) && NAMED_COLOUR.test(rest)) bad.push(`${at(file, r, d)}: named colour`);
  }
  return bad;
}

/** Rule 2: no shadow of any kind; a radius is a radius token of at most 6 px, or 50% (a dot). */
function shapeProblems(file: string, rules: CssRule[]): string[] {
  const bad: string[] = [];
  for (const r of rules) for (const d of r.decls) {
    if (d.prop === 'text-shadow' && d.value !== 'none') bad.push(`${at(file, r, d)}: text-shadow`);
    if (/drop-shadow\(/i.test(d.value)) bad.push(`${at(file, r, d)}: drop-shadow`);
    if (d.prop === 'box-shadow' && d.value !== 'none') bad.push(`${at(file, r, d)}: box-shadow`);
    if (d.prop.includes('radius') && d.value !== ROUND) {
      const value = d.value.replace(VAR_RE, (_, name: string) => {
        if (name !== '--radius' && name !== '--radius-lg') bad.push(`${at(file, r, d)}: ${name} is not a radius token`);
        return ` ${tokens.get(name) ?? ''} `;
      });
      const px = [...value.matchAll(/(\d*\.?\d+)px/g)].map((m) => Number(m[1]));
      if (px.some((n) => n > MAX_RADIUS_PX) || /%|\d(r?em)\b/.test(value)) bad.push(`${at(file, r, d)}: radius above ${MAX_RADIUS_PX} px`);
    }
  }
  return bad;
}

type Font = 'sans' | 'mono' | 'display';
type FontUse = { file: string; selector: string; font: Font };
const FONT_TOKEN: Record<string, Font> = { '--font-sans': 'sans', '--font-mono': 'mono', '--font-display': 'display' };

/** Rule 3: a font family is one of the three tokens (or inherited); returns the uses, and the problems. */
function fontUses(file: string, rules: CssRule[]): { uses: FontUse[]; bad: string[] } {
  const uses: FontUse[] = [];
  const bad: string[] = [];
  for (const r of rules) for (const d of r.decls) {
    if (d.prop === 'font' && d.value !== 'inherit') bad.push(`${at(file, r, d)}: font shorthand`);
    if (d.prop !== 'font-family' || d.value === 'inherit') continue;
    const m = /^var\(\s*(--font-sans|--font-mono|--font-display)\s*(,[^()]*)?\)$/.exec(d.value);
    if (!m) { bad.push(`${at(file, r, d)}: not var(--font-sans), var(--font-mono) or var(--font-display)`); continue; }
    for (const selector of selectorsOf(r)) uses.push({ file, selector, font: FONT_TOKEN[m[1]] });
  }
  return { uses, bad };
}

const allProblems = (check: (file: string, rules: CssRule[]) => string[]) =>
  [...parsed].flatMap(([file, rules]) => check(file, rules));
const allFonts = [...parsed].map(([file, rules]) => fontUses(file, rules));
const MONO = allFonts.flatMap((f) => f.uses).filter((u) => u.font === 'mono');
const DISPLAY = allFonts.flatMap((f) => f.uses).filter((u) => u.font === 'display');
const allDecls = [...parsed].flatMap(([file, rules]) => rules.flatMap((r) => r.decls.map((d) => ({ file, r, d }))));

describe('Employee page CSS, the night-shift transit ops look (issue 957)', () => {
  it('reads the six stylesheets', () => {
    expect([...sources.keys()].sort()).toEqual([
      'AddressSearch.css', 'CommuteForm.css', 'EmployeeWorkspace.css', 'JobDetailV2.css',
      'page/employeePage.css', 'route/commuteRoute.css',
    ]);
  });

  it('the checkers catch a known-bad sample', () => {
    const bad = parseCss(`
      .x { color: #123456; background: linear-gradient(red, blue); border: 1px solid rgb(0, 0, 0); outline: 1px solid red;
           border-color: var(--accent, #28618A); padding: var(--space-2, 6px); margin: var(--space-5, 20px);
           font-family: var(--font-sans, 'IBM Plex Sans', system-ui, sans-serif); }
      .y { box-shadow: 0 1px 2px var(--text, #171C24); border-radius: 8px; text-shadow: 0 1px 0 var(--panel, #FFFFFF);
           font-family: Arial; font: 600 14px/1.4 Inter; }
      .z { box-shadow: 0 0 0 1px var(--accent, #1D5075); border-radius: var(--space-2, 8px); filter: drop-shadow(0 0 2px var(--text, #171C24)); }
      .w { color: var(--paper-text, #171C24); background: var(--nope, #000000); border-radius: 40%; }
      .ok:focus-visible { color: var(--paper-text, #14171F); outline: 2px solid var(--signal, #FF6A1A); box-shadow: none;
           border-radius: var(--radius-lg, 6px) 2px; font-family: var(--font-mono, "IBM Plex Mono", monospace); font: inherit; }
      .ok::before { border-radius: 50%; font-family: var(--font-display, 'Archivo Variable', 'Inter', system-ui, sans-serif); }`);
    const colour = colourProblems('bad.css', bad).join('\n');
    for (const s of ['color: #123456 }: colour literal', 'gradient', 'rgb(0, 0, 0) }: colour literal', 'named colour',
      '--accent is #1D5075, the fallback says #28618A', '--space-2 is 8px, the fallback says 6px', '--space-5 is not in tokens.css',
      'the fallback says \'IBM Plex Sans\', system-ui, sans-serif',
      '--paper-text is #14171F, the fallback says #171C24', '--nope is not in tokens.css']) expect(colour).toContain(s);
    const shape = shapeProblems('bad.css', bad).join('\n');
    for (const s of ['.y { box-shadow: 0 1px 2px', '.z { box-shadow: 0 0 0 1px', 'text-shadow', 'drop-shadow',
      '.y { border-radius: 8px }: radius above 6 px', '--space-2 is not a radius token',
      '.w { border-radius: 40% }: radius above 6 px']) expect(shape).toContain(s);
    const font = fontUses('bad.css', bad);
    expect(font.bad.join('\n')).toContain('.y { font-family: Arial }');
    expect(font.bad.join('\n')).toContain('font shorthand');
    expect(font.uses).toEqual([
      { file: 'bad.css', selector: '.x', font: 'sans' },
      { file: 'bad.css', selector: '.ok:focus-visible', font: 'mono' },
      { file: 'bad.css', selector: '.ok::before', font: 'display' },
    ]);
    for (const text of [colour, shape, font.bad.join('\n')]) expect(text).not.toMatch(/\.ok(:focus-visible|::before)/);
  });

  describe('1. colours', () => {
    it('no hex colour, rgb() or gradient outside a var(--token, fallback), and every fallback is the token value', () => {
      expect(allProblems(colourProblems)).toEqual([]);
    });

    it('tokens.css holds the colours and the display font the issue names, and the page uses each of them', () => {
      for (const [name, value] of Object.entries(PALETTE)) expect(tokens.get(name)?.toUpperCase(), name).toBe(value);
      expect(tokens.get('--font-display')).toMatch(/^"Archivo Variable", "Inter", /);
      const css = [...sources.values()].join('\n');
      for (const name of [...Object.keys(PALETTE), '--on-ink-muted', '--signal-hover', '--font-display']) {
        expect(css, `${name} is not used`).toContain(`var(${name}, `);
      }
    });

    it('the page has no palette of its own: no custom property is declared in its stylesheets', () => {
      // The Business page keeps an --ns-* block of its own; this page reads the app's tokens directly.
      for (const [file, rules] of parsed) {
        for (const r of rules) for (const d of r.decls) expect(d.prop.startsWith('--'), at(file, r, d)).toBe(false);
        expect(sources.get(file), file).not.toContain('--ns-');
      }
      expect(v2CssFiles()).toHaveLength(6);
    });

    it('no MVP III or MVP II colour and no IBM Plex Sans is left anywhere in the files, comments included', () => {
      for (const [file, css] of sources) {
        for (const old of [...MVP3_COLOURS, ...MVP2_COLOURS]) expect(css.toUpperCase(), `${file}: ${old}`).not.toContain(old);
        for (const name of MVP3_TOKENS) expect(css, `${file}: ${name}`).not.toMatch(new RegExp(`var\\(\\s*${name}\\s*[,)]`));
        expect(css, file).not.toMatch(/IBM Plex Sans/i);
        expect(css, file).not.toMatch(/mvp2-ui-redesign|MVP II\b/);
      }
    });

    it('the fallbacks carry the palette: ink, paper, text, muted, hairline and the signal', () => {
      const css = [...sources.values()].join('\n');
      for (const s of ['var(--ink, #0B0F17)', 'var(--paper, #F4F2EC)', 'var(--on-ink, #F4F2EC)', 'var(--paper-text, #14171F)',
        'var(--paper-muted, #5A5F6B)', 'var(--paper-line, #DCD8CE)', 'var(--signal, #FF6A1A)']) {
        expect(css).toContain(s);
      }
    });

    it('the signal orange is a fill with ink words on it, never the colour of words, a ring or a line of text', () => {
      const signal = allDecls.filter(({ d }) => d.value.includes('--signal'));
      expect(signal.length).toBeGreaterThan(3);
      for (const { file, r, d } of signal) expect(['background', 'border-color'], at(file, r, d)).toContain(d.prop);
      // Paper words on the orange would be 2.9:1; ink words are 6.7:1.
      for (const [file, rules] of parsed) for (const r of rules) {
        if (!r.decls.some((d) => d.prop === 'background' && d.value.includes('--signal'))) continue;
        const colour = r.decls.find((d) => d.prop === 'color');
        if (colour) expect(colour.value, `${file}: ${r.selector}`).toBe('var(--ink, #0B0F17)');
      }
      // The three places it fills: the "New" tag, the pass's action and the job view's action, plus the package on the pass.
      const fills = signal.filter(({ d }) => d.prop === 'background' && d.value === 'var(--signal, #FF6A1A)').map(({ r }) => r.selector.replace(/\s+/g, ' '));
      expect(fills).toEqual([
        '.ew-new',
        '.ew-pass[data-status="assigned"] .ew-pass-stop:first-child .ew-pass-place::before, .ew-pass[data-status="completed"] .ew-pass-stop:last-child .ew-pass-place::before',
        '.ew-pass[data-status="in_progress"] .ew-pass-parcel',
        '.ew-pass .ew-row-links a:first-child',
        '.job-v2__link',
      ]);
      // Under the pointer the two actions take the app's hover orange (lighter, so ink words on it read better still).
      const deep = allDecls.filter(({ d }) => d.value.includes('--signal-hover')).map(({ r }) => r.selector.replace(/\s+/g, ' '));
      expect([...new Set(deep)]).toEqual(['.ew-pass .ew-row-links a:first-child:hover', '.job-v2__link:hover']);
    });

    it('paper as the colour of words or of a ring is --on-ink; as a ground or a border it is --paper', () => {
      for (const { file, r, d } of allDecls) {
        if (d.value.includes('var(--on-ink, ')) expect(['color', 'outline', 'outline-color'], at(file, r, d)).toContain(d.prop);
        if (d.value.includes('var(--paper, ')) expect(['background', 'border', 'border-color'], at(file, r, d)).toContain(d.prop);
      }
    });

    it('the two carrier colours are the line of the boarding pass and nothing else', () => {
      const carrier = allDecls.filter(({ d }) => /--carrier-[ab]/.test(d.value));
      expect(carrier.map(({ r, d }) => `${r.selector} { ${d.prop}: ${d.value} }`)).toEqual([
        '.ew-pass-place { border-top: 4px solid var(--carrier-a, #3D8BFF) }',
        '.ew-pass[data-carrier="b"] .ew-pass-place { border-top-color: var(--carrier-b, #22C08A) }',
      ]);
    });

    it('a focus ring is an ink outline on paper and a paper outline on the ink band, never the orange', () => {
      const rings = allDecls.filter(({ r, d }) => /:focus-visible|:focus-within/.test(r.selector) && /^outline(-color)?$/.test(d.prop) && d.value !== 'none');
      expect(rings.length).toBeGreaterThan(8);
      for (const { file, r, d } of rings) {
        const onInk = r.selector.includes('.ew-next');
        expect(d.value, at(file, r, d)).toContain(onInk ? 'var(--on-ink, #F4F2EC)' : 'var(--paper-text, #14171F)');
      }
    });

    it('the route preview takes its line colours from map/layers.ts, not from the stylesheet', () => {
      const swatches = parsed.get('route/commuteRoute.css')!.filter((r) => r.selector.includes('ecr__swatch'));
      expect(swatches.length).toBeGreaterThan(0);
      for (const r of swatches) for (const d of r.decls) expect(COLOUR_PROP.test(d.prop), at('route/commuteRoute.css', r, d)).toBe(false);
      // The map's own colours (client/src/components/map, not this module's to change).
      expect(toneLabelColor('leg1').toUpperCase()).toBe('#1D5075'); // carrier A
      expect(toneLabelColor('leg2').toUpperCase()).toBe('#0F8A5F'); // carrier B
    });
  });

  describe('2. shadows and radius', () => {
    it('no box-shadow, no text-shadow, no radius above 6 px or outside a radius token (a dot is 50%)', () => {
      expect(allProblems(shapeProblems)).toEqual([]);
    });

    it('every radius is written with a radius token, and the tokens are at most 6 px', () => {
      for (const name of ['--radius', '--radius-lg']) expect(Number.parseFloat(tokens.get(name)!), name).toBeLessThanOrEqual(MAX_RADIUS_PX);
      const radii = [...parsed.values()].flat().flatMap((r) => r.decls.filter((d) => d.prop.includes('radius') && d.value !== ROUND));
      expect(radii.length).toBeGreaterThan(10);
      for (const d of radii) expect(d.value).toMatch(/^var\(--radius(-lg)?, \d+px\)$/);
    });

    it('only a station dot, a route mark and the notches of the pass are round: exactly these selectors', () => {
      const round = [...parsed].flatMap(([file, rules]) => rules
        .filter((r) => r.decls.some((d) => d.prop === 'border-radius' && d.value === ROUND))
        .flatMap((r) => selectorsOf(r).map((s) => `${file} ${s}`)));
      expect(round.sort()).toEqual([
        'EmployeeWorkspace.css .ew-pass-place::before', // the two stations of the boarding pass
        'EmployeeWorkspace.css .ew-pass-stub::after', // the notches at the ends of its perforation
        'EmployeeWorkspace.css .ew-pass-stub::before',
        'EmployeeWorkspace.css .ew-section-head::after', // the station at the start of a section's divider
        'EmployeeWorkspace.css .ew-station::before', // home and work on a commute strip
        'JobDetailV2.css .job-v2__check', // a station of the job's route (the tick box of #882)
        'JobDetailV2.css .job-v2__h3::after',
        'page/employeePage.css .ep-editor-head::after',
      ].sort());
    });

    it('no stylesheet has a box-shadow or a gradient at all', () => {
      for (const [file, css] of sources) {
        const rules = parsed.get(file)!;
        expect(rules.flatMap((r) => r.decls).filter((d) => d.prop === 'box-shadow' && d.value !== 'none'), file).toEqual([]);
        expect(css, file).not.toMatch(/gradient\(/i);
      }
    });
  });

  describe('3. fonts', () => {
    it('every font family is var(--font-sans), var(--font-mono) or var(--font-display); the font shorthand is only "inherit"', () => {
      expect(allFonts.flatMap((f) => f.bad)).toEqual([]);
    });

    it('each stylesheet sets the sans token on its root', () => {
      for (const [file, rules] of parsed) {
        const root = rules[0];
        const family = root.decls.find((d) => d.prop === 'font-family')?.value;
        expect(family, `${file} ${root.selector}`).toMatch(/^var\(--font-sans, "Inter", /);
      }
    });

    it('mono is used for times and prices only: exactly these selectors', () => {
      expect(MONO.map((u) => `${u.file} ${u.selector}`).sort()).toEqual([
        "CommuteForm.css .cf input[type='number']", // the detour minutes
        "CommuteForm.css .cf input[type='time']", // the two departures
        'EmployeeWorkspace.css .ew-mono', // commute departures and durations, stop times, extra time, a quiet row's reward
        'JobDetailV2.css .job-v2__number dd', // extra time and usual commute (the reward and the distance are set back, below)
        'JobDetailV2.css .job-v2__time', // a stop's time
        'JobDetailV2.css .job-v2__trip', // "Evening commute, leaves Day 1, 5:15 PM"
        'route/commuteRoute.css .ecr__summary', // "Evening: leaves 5:30 PM, 34 min, 9.8 km"
      ].sort());
    });

    it('Archivo is used for headings and the big numbers only: exactly these selectors', () => {
      expect(DISPLAY.map((u) => `${u.file} ${u.selector}`).sort()).toEqual([
        'EmployeeWorkspace.css .ew-name', // the employee's name
        'EmployeeWorkspace.css .ew h2', // the section headings
        'EmployeeWorkspace.css .ew-earnings dd', // earned and projected
        'EmployeeWorkspace.css .ew-trip-label', // "Evening", "Morning": the names of the two strips
        'EmployeeWorkspace.css .ew-pass .ew-row-head .ew-strong', // the next job's package
        'EmployeeWorkspace.css .ew-pass-time', // its two clocks
        'EmployeeWorkspace.css .ew-pass-reward', // its reward
        'EmployeeWorkspace.css .ew-pass .ew-row-links a:first-child', // its action, like the Business page's main action
        'JobDetailV2.css .job-v2__title',
        'JobDetailV2.css .job-v2__h3',
        'JobDetailV2.css .job-v2__number[data-number="reward"] dd', // the job view's reward
        'JobDetailV2.css .job-v2__link', // and its action
        'page/employeePage.css .ep-title',
        'page/employeePage.css .ep-editor-head h2',
        'page/employeePage.css .ep-name',
      ].sort());
      // While Archivo loads these show in Inter, so the token's list goes on with it.
      expect(tokens.get('--font-display')).toMatch(/^"Archivo Variable", "Inter", system-ui, /);
    });

    it('a distance is not mono: the commute strip and the job view set it in the body font', () => {
      const work = parsed.get('EmployeeWorkspace.css')!;
      expect(work.some((r) => selectorsOf(r).includes('.ew-trip-distance') && r.decls.some((d) => d.prop === 'font-family'))).toBe(false);
      const job = parsed.get('JobDetailV2.css')!;
      const distance = job.find((r) => selectorsOf(r).includes('.job-v2__number[data-number="extra-distance"] dd'))!;
      expect(distance.decls.find((d) => d.prop === 'font-family')?.value).toMatch(/^var\(--font-sans, /);
    });

    it('text in Inter or mono is 400 or 600; Archivo is 600, 700 or 800, stated in the rule that names the face', () => {
      // Inter and IBM Plex Mono are loaded at 400, 500 and 600; Archivo is one variable file with every weight.
      const displaySelectors = new Set(DISPLAY.map((u) => u.selector));
      const weights = allDecls.filter(({ d }) => d.prop === 'font-weight');
      expect(weights.length).toBeGreaterThan(20);
      for (const { file, r, d } of weights) {
        const display = selectorsOf(r).every((s) => displaySelectors.has(s));
        expect(display ? ['600', '700', '800'] : ['400', '600'], at(file, r, d)).toContain(d.value);
      }
      // A section heading (a rule on the h2 or h3 itself) stays at 600, the weight of every heading tag of the
      // app outside the homepage (tests/ui/kit-v2-fonts.test.ts); the name, the titles and the big numbers are 800.
      const weightOf = (file: string, selector: string) => parsed.get(file)!
        .find((r) => r.media.length === 0 && selectorsOf(r).includes(selector) && r.decls.some((d) => d.prop === 'font-weight'))!
        .decls.find((d) => d.prop === 'font-weight')!.value;
      for (const [file, s] of [['EmployeeWorkspace.css', '.ew h2'], ['page/employeePage.css', '.ep-editor-head h2'], ['JobDetailV2.css', '.job-v2__h3'], ['EmployeeWorkspace.css', '.ew-trip-label']]) {
        expect(weightOf(file, s), s).toBe('600');
      }
      for (const [file, s] of [['EmployeeWorkspace.css', '.ew-name'], ['page/employeePage.css', '.ep-name'], ['page/employeePage.css', '.ep-title'],
        ['JobDetailV2.css', '.job-v2__title'], ['EmployeeWorkspace.css', '.ew-pass-time'], ['EmployeeWorkspace.css', '.ew-pass-reward'], ['EmployeeWorkspace.css', '.ew-earnings dd']]) {
        expect(weightOf(file, s), s).toBe('800');
      }
      // No rule on a bare heading tag is heavier than 600.
      for (const { file, r, d } of weights) {
        if (selectorsOf(r).some((s) => /(^|\s)h[1-6]$/.test(s))) expect(d.value, at(file, r, d)).toBe('600');
      }
      for (const [file, rules] of parsed) for (const r of rules) {
        if (!r.decls.some((d) => d.prop === 'font-family' && d.value.includes('--font-display'))) continue;
        expect(r.decls.some((d) => d.prop === 'font-weight'), `${file}: ${r.selector} names Archivo without a weight`).toBe(true);
      }
    });

    it('Archivo is condensed (78%) from 30 px up and wide (112%) up to 20 px, as in the header and on the homepage', () => {
      const widths = allDecls.filter(({ d }) => d.prop === 'font-stretch');
      expect(widths.length).toBeGreaterThan(10);
      for (const { file, r, d } of widths) {
        const size = r.decls.find((x) => x.prop === 'font-size')?.value ?? '';
        const px = Number(/(\d+)px\)?$/.exec(size)?.[1]);
        expect(Number.isFinite(px), `${at(file, r, d)}: the size is stated next to the width`).toBe(true);
        // The day inside the pass's clock is Inter again, at its normal width.
        if (selectorsOf(r).includes('.ew-pass-day')) { expect(d.value).toBe('100%'); continue; }
        expect(d.value, at(file, r, d)).toBe(px >= 30 ? '78%' : '112%');
        expect(px >= 30 || px <= 20, at(file, r, d)).toBe(true);
      }
      // Every Archivo rule states its width where it names the face.
      for (const u of DISPLAY) {
        const rule = parsed.get(u.file)!.find((r) => selectorsOf(r).includes(u.selector) && r.decls.some((d) => d.prop === 'font-family'))!;
        expect(rule.decls.some((d) => d.prop === 'font-stretch'), `${u.file} ${u.selector}`).toBe(true);
      }
    });
  });
});

// ---------- the rendered page: every time and price sits in a mono or a display rule ----------

/** "5:30 PM", "34 min", "$8.00". A distance ("9.8 km") is neither a time nor a price. */
const NUMBER = /\b\d{1,2}:\d{2}\s?[AP]M\b|\b\d+(?:\.\d+)?\s?min\b|\$\d/;
const numberSelectors = [...MONO, ...DISPLAY].map((u) => u.selector);
const isMono = (e: El | null): boolean => !!e && e.tag !== '#root'
  && (numberSelectors.some((s) => matchesSelector(e, s)) || isMono(e.parent));
/** Hidden from sight (the live region for screen readers): no font to check. */
const isHidden = (e: El | null): boolean => !!e && ((e.attrs.class ?? '').split(/\s+/).includes('ew-sr') || isHidden(e.parent));

/** Every text node with a time, distance or reward that no mono rule reaches. */
function sansNumbers(html: string): string[] {
  const root = parseHtml(html);
  const out: string[] = [];
  for (const e of all(root, () => true)) {
    for (const c of e.children) {
      if (typeof c === 'string' && NUMBER.test(c) && !isMono(e) && !isHidden(e)) out.push(`<${e.tag} class="${e.attrs.class ?? ''}">${c.trim()}`);
    }
  }
  return out;
}
const monoTexts = (html: string) => all(parseHtml(html), (e) => isMono(e))
  .flatMap((e) => e.children.filter((c): c is string => typeof c === 'string')).join(' | ');

describe('Employee page markup: times and prices are in mono, or in Archivo when they are a big number (issue 957)', () => {
  beforeEach(() => vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', ''));
  afterEach(() => vi.unstubAllEnvs());

  it('the finder catches a time, a duration and a reward outside mono, and skips the ones inside', () => {
    const html = '<div class="ew"><p>Leaves 5:30 PM</p><p>9.8 km away</p><p>34 min more</p><p>Reward $8.00</p><p>Day 1 of 2, 15 packages</p>'
      + '<p><span class="ew-mono">Departs 5:30 PM</span></p><dl><div class="job-v2__number"><dt>Reward</dt><dd>$8.00</dd></div></dl>'
      + '<p><span class="ew-pass-time">6:06 PM</span> <span class="ew-pass-reward">$8.00</span></p>'
      + '<div class="ew-sr"><p>Reward $8.00.</p></div></div>';
    expect(sansNumbers(html)).toEqual(['<p class="">Leaves 5:30 PM', '<p class="">34 min more', '<p class="">Reward $8.00']);
  });

  it('the workspace: earnings, the boarding pass, delivery rows and the commute strips', () => {
    const html = renderToStaticMarkup(createElement(EmployeeWorkspace, { dashboard, businesses, onEditCommute: () => {} }));
    expect(sansNumbers(html)).toEqual([]);
    const mono = monoTexts(html);
    for (const s of ['Departs 5:30 PM', '34 min', 'Up to 15 min extra per trip', '$8.00', '$7.00', '+7 min']) expect(mono).toContain(s);
    expect(mono).toMatch(/Day 2, \d{1,2}:\d{2} AM/); // a quiet row's stop time
    // The big numbers are Archivo: the next job's two clocks and its reward, and the two earnings.
    const root = parseHtml(html);
    const display = (cls: string) => all(root, (e) => (e.attrs.class ?? '').split(/\s+/).includes(cls)).map((e) => e.children.filter((c) => typeof c === 'string').join(''));
    expect(display('ew-pass-time')).toEqual(['5:30 PM', '6:06 PM']);
    expect(display('ew-pass-reward')).toEqual(['$8.00']);
    expect(all(root, (e) => e.tag === 'dd' && matchesSelector(e, '.ew-earnings dd')).map((e) => e.children.join(''))).toEqual(['$5.00', '$20.00']);
    // The distance of a trip is in the body font.
    expect(all(root, (e) => (e.attrs.class ?? '') === 'ew-trip-distance').map((e) => e.children.join(''))).toEqual(['8.4 km', '8.7 km']);
  });

  it('the job view: trip line, stop times and "What it adds"', () => {
    for (const make of [eveningDirect, morningDirect, relayLeg1, relayLeg2]) {
      const html = renderToStaticMarkup(createElement(JobDetailV2, {
        job: make('assigned'), businesses: jobBusinesses, homeNeighborhood: 'Astoria', onBack: () => {},
      }));
      expect(sansNumbers(html)).toEqual([]);
      const mono = monoTexts(html);
      expect(mono).toMatch(/commute, leaves Day [12], \d{1,2}:\d{2} [AP]M/);
      expect(mono).toMatch(/\$\d+\.\d{2}/);
      expect(mono).toMatch(/\d+ min/);
    }
  });

  it('the route preview: the caption of the two commute lines, with and without a job', () => {
    const props = { employee: DASHBOARD.employee, home: HOME, trips: TRIPS, businesses: BUSINESSES, map: MAP };
    const plain = renderToStaticMarkup(createElement(CommuteRoutePreview, props));
    expect(sansNumbers(plain)).toEqual([]);
    expect(monoTexts(plain)).toContain('Evening: 34 min, 9.8 km');
    const withJob = renderToStaticMarkup(createElement(CommuteRoutePreview, { ...props, job: JOB }));
    expect(sansNumbers(withJob)).toEqual([]);
    expect(monoTexts(withJob)).toContain('Evening: leaves 5:30 PM, 34 min, 9.8 km');
    // The legend swatches are inline styles built from map/layers.ts: grey commute, carrier A blue.
    expect(withJob).toContain(`background:rgb(${BASELINE[0]}, ${BASELINE[1]}, ${BASELINE[2]})`);
    expect(withJob.toUpperCase()).toContain('BACKGROUND:#1D5075');
  });

  it('the commute form: both departure inputs and the detour minutes', () => {
    const { employee, home } = dashboard;
    const html = renderToStaticMarkup(createElement(CommuteForm, {
      employee, home, businesses, phase: 'planning',
      onSave: async () => ({ employee, home, trips: [], rematchedShipmentIds: [] }),
    }));
    const inputs = all(parseHtml(html), (e) => e.tag === 'input' && ['time', 'number'].includes(e.attrs.type));
    expect(inputs.map((e) => e.attrs.type)).toEqual(['time', 'time', 'number']);
    for (const e of inputs) expect(isMono(e), `input[type=${e.attrs.type}]`).toBe(true);
    expect(sansNumbers(html)).toEqual([]);
  });
});
