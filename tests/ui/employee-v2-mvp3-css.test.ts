// #685 (docs/mvp3.md P4, the lighter pass on the Employee page): the six stylesheets of
// client/src/components/employee/v2 carry the MVP III look. Three rules, read from the files:
//   1. every colour is a design token; a fallback is the token's own value, so no MVP II colour is left;
//   2. no box-shadow beyond a 1 px hairline ring, no text-shadow, no radius above 6 px;
//   3. IBM Plex Mono for times, distances and rewards, the sans token for everything else.
// Rule 3 is also checked on the rendered markup: a time, distance or reward that is not inside a mono
// rule fails, so a new number needs a mono class before it ships.
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
const MAX_RING_PX = 1; // a hairline
/** The MVP II values #651 replaced. None may be left, not even in a fallback or a comment. */
const MVP2_COLOURS = ['#F7F8FA', '#151B26', '#D7DDE5', '#28618A', '#1F4E70', '#E8F0F6'];

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

/** The px lengths of one shadow, in order: x, y, blur, spread (colours and var() removed). */
function shadowLengths(shadow: string): number[] {
  return shadow.replace(VAR_RE, ' ').replace(/[a-z-]+\([^()]*\)/gi, ' ').split(/\s+/)
    .map((t) => /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(t))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]) * (m[2] === 'rem' || m[2] === 'em' ? 16 : 1));
}

/** Rule 2: a shadow is at most a 1 px ring (no offset, no blur); a radius is a radius token of at most 6 px. */
function shapeProblems(file: string, rules: CssRule[]): string[] {
  const bad: string[] = [];
  for (const r of rules) for (const d of r.decls) {
    if (d.prop === 'text-shadow' && d.value !== 'none') bad.push(`${at(file, r, d)}: text-shadow`);
    if (/drop-shadow\(/i.test(d.value)) bad.push(`${at(file, r, d)}: drop-shadow`);
    if (d.prop === 'box-shadow' && d.value !== 'none') {
      for (const shadow of d.value.split(/,(?![^()]*\))/)) {
        const [x = 0, y = 0, blur = 0, spread = 0] = shadowLengths(shadow);
        if (x !== 0 || y !== 0 || blur !== 0 || Math.abs(spread) > MAX_RING_PX) {
          bad.push(`${at(file, r, d)}: more than a ${MAX_RING_PX} px hairline`);
        }
      }
    }
    if (d.prop.includes('radius')) {
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

type FontUse = { file: string; selector: string; font: 'sans' | 'mono' };

/** Rule 3: a font family is one of the two tokens (or inherited); returns the uses, and the problems. */
function fontUses(file: string, rules: CssRule[]): { uses: FontUse[]; bad: string[] } {
  const uses: FontUse[] = [];
  const bad: string[] = [];
  for (const r of rules) for (const d of r.decls) {
    if (d.prop === 'font' && d.value !== 'inherit') bad.push(`${at(file, r, d)}: font shorthand`);
    if (d.prop !== 'font-family' || d.value === 'inherit') continue;
    const m = /^var\(\s*--font-(sans|mono)\s*(,[^()]*)?\)$/.exec(d.value);
    if (!m) { bad.push(`${at(file, r, d)}: not var(--font-sans) or var(--font-mono)`); continue; }
    for (const selector of selectorsOf(r)) uses.push({ file, selector, font: m[1] as 'sans' | 'mono' });
  }
  return { uses, bad };
}

const allProblems = (check: (file: string, rules: CssRule[]) => string[]) =>
  [...parsed].flatMap(([file, rules]) => check(file, rules));
const allFonts = [...parsed].map(([file, rules]) => fontUses(file, rules));
const MONO = allFonts.flatMap((f) => f.uses).filter((u) => u.font === 'mono');

describe('Employee page CSS, MVP III look (#685)', () => {
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
      .z { box-shadow: 0 0 0 2px var(--accent, #1D5075); border-radius: var(--space-2, 8px); filter: drop-shadow(0 0 2px var(--text, #171C24)); }
      .ok:focus-visible { color: var(--text, #171C24); box-shadow: 0 0 0 1px var(--accent, #1D5075), inset 0 0 0 1px var(--panel, #FFFFFF);
           border-radius: var(--radius-lg, 6px) 2px; font-family: var(--font-mono, "IBM Plex Mono", monospace); font: inherit; }`);
    const colour = colourProblems('bad.css', bad).join('\n');
    for (const s of ['color: #123456 }: colour literal', 'gradient', 'rgb(0, 0, 0) }: colour literal', 'named colour',
      '--accent is #1D5075, the fallback says #28618A', '--space-2 is 8px, the fallback says 6px', '--space-5 is not in tokens.css',
      'the fallback says \'IBM Plex Sans\', system-ui, sans-serif']) expect(colour).toContain(s);
    const shape = shapeProblems('bad.css', bad).join('\n');
    for (const s of ['.y { box-shadow: 0 1px 2px', '.z { box-shadow: 0 0 0 2px', 'text-shadow', 'drop-shadow',
      '.y { border-radius: 8px }: radius above 6 px', '--space-2 is not a radius token']) expect(shape).toContain(s);
    const font = fontUses('bad.css', bad);
    expect(font.bad.join('\n')).toContain('.y { font-family: Arial }');
    expect(font.bad.join('\n')).toContain('font shorthand');
    expect(font.uses).toEqual([
      { file: 'bad.css', selector: '.x', font: 'sans' },
      { file: 'bad.css', selector: '.ok:focus-visible', font: 'mono' },
    ]);
    for (const text of [colour, shape, font.bad.join('\n')]) expect(text).not.toContain('.ok:focus-visible');
  });

  describe('1. colours', () => {
    it('no hex colour, rgb() or gradient outside a var(--token, fallback), and every fallback is the token value', () => {
      expect(allProblems(colourProblems)).toEqual([]);
    });

    it('no MVP II colour and no IBM Plex Sans is left anywhere in the files, comments included', () => {
      for (const [file, css] of sources) {
        for (const old of MVP2_COLOURS) expect(css.toUpperCase(), `${file}: ${old}`).not.toContain(old);
        expect(css, file).not.toMatch(/IBM Plex Sans/i);
        expect(css, file).not.toMatch(/mvp2-ui-redesign|MVP II\b/);
      }
    });

    it('the fallbacks carry the docs/mvp3.md P4 base colours', () => {
      const css = [...sources.values()].join('\n');
      for (const s of ['var(--text, #171C24)', 'var(--accent, #1D5075)', 'var(--border, #E3E3DE)', 'var(--bg, #F7F7F4)']) {
        expect(css).toContain(s);
      }
    });

    it('the route preview takes its line colours from map/layers.ts, not from the stylesheet', () => {
      const swatches = parsed.get('route/commuteRoute.css')!.filter((r) => r.selector.includes('ecr__swatch'));
      expect(swatches.length).toBeGreaterThan(0);
      for (const r of swatches) for (const d of r.decls) expect(COLOUR_PROP.test(d.prop), at('route/commuteRoute.css', r, d)).toBe(false);
      expect(toneLabelColor('leg1').toUpperCase()).toBe('#1D5075'); // carrier A
      expect(toneLabelColor('leg2').toUpperCase()).toBe('#0F8A5F'); // carrier B
    });
  });

  describe('2. shadows and radius', () => {
    it('no box-shadow beyond a 1 px hairline ring, no text-shadow, no radius above 6 px or outside a radius token', () => {
      expect(allProblems(shapeProblems)).toEqual([]);
    });

    it('every radius is written with a radius token, and the tokens are at most 6 px', () => {
      for (const name of ['--radius', '--radius-lg']) expect(Number.parseFloat(tokens.get(name)!), name).toBeLessThanOrEqual(MAX_RADIUS_PX);
      const radii = [...parsed.values()].flat().flatMap((r) => r.decls.filter((d) => d.prop.includes('radius')));
      expect(radii.length).toBeGreaterThan(10);
      for (const d of radii) expect(d.value).toMatch(/^var\(--radius(-lg)?, \d+px\)$/);
    });

    it('a shadow is only ever the focus ring', () => {
      for (const [file, rules] of parsed) for (const r of rules) for (const d of r.decls) {
        if (d.prop !== 'box-shadow' || d.value === 'none') continue;
        expect(selectorsOf(r).every((s) => /:focus-visible\b/.test(s)), at(file, r, d)).toBe(true);
      }
    });
  });

  describe('3. fonts', () => {
    it('every font family is var(--font-sans) or var(--font-mono); the font shorthand is only "inherit"', () => {
      expect(allFonts.flatMap((f) => f.bad)).toEqual([]);
    });

    it('each stylesheet sets the sans token on its root', () => {
      for (const [file, rules] of parsed) {
        const root = rules[0];
        const family = root.decls.find((d) => d.prop === 'font-family')?.value;
        expect(family, `${file} ${root.selector}`).toMatch(/^var\(--font-sans, "Inter", /);
      }
    });

    it('mono is used for times, distances and rewards only: exactly these selectors', () => {
      expect(MONO.map((u) => `${u.file} ${u.selector}`).sort()).toEqual([
        "CommuteForm.css .cf input[type='number']", // the detour minutes
        "CommuteForm.css .cf input[type='time']", // the two departures
        'EmployeeWorkspace.css .ew-mono', // commute times and distances, stop times, extra time, reward, earnings
        'JobDetailV2.css .job-v2__number dd', // reward, extra time, extra distance, usual commute
        'JobDetailV2.css .job-v2__time', // a stop's time
        'JobDetailV2.css .job-v2__trip', // "Evening commute, leaves Day 1, 5:15 PM"
        'route/commuteRoute.css .ecr__summary', // "Evening: leaves 5:30 PM, 34 min, 9.8 km"
      ].sort());
    });

    it('a mono rule that follows "font: inherit" on the same element comes after it', () => {
      // `.cf input[type='time'] { font: inherit }` would reset the family if it came later.
      const rules = parsed.get('CommuteForm.css')!;
      const index = (pred: (r: CssRule) => boolean) => rules.findIndex(pred);
      const inherit = index((r) => selectorsOf(r).includes(".cf input[type='time']") && r.decls.some((d) => d.prop === 'font'));
      const mono = index((r) => selectorsOf(r).includes(".cf input[type='time']") && r.decls.some((d) => d.prop === 'font-family'));
      expect(inherit).toBeGreaterThanOrEqual(0);
      expect(mono).toBeGreaterThan(inherit);
    });

    it('mono text is never bolder than 500, the heaviest IBM Plex Mono the app loads', () => {
      const loaded = [...readFileSync('client/src/styles/fonts.css', 'utf8').matchAll(/ibm-plex-mono\/latin-(\d+)\.css/g)].map((m) => Number(m[1]));
      expect(loaded.length).toBeGreaterThan(0);
      const monoSelectors = new Set(MONO.map((u) => u.selector));
      for (const [file, rules] of parsed) for (const r of rules) for (const d of r.decls) {
        if (d.prop !== 'font-weight') continue;
        // The element of the rule's last compound: `.job-v2__number[data-number="reward"] dd` styles `.job-v2__number dd`.
        const plain = selectorsOf(r).map((s) => s.replace(/\[data-[^\]]*\]/g, ''));
        if (plain.some((s) => monoSelectors.has(s))) expect(Number(d.value), at(file, r, d)).toBeLessThanOrEqual(Math.max(...loaded));
      }
    });
  });
});

// ---------- the rendered page: every time, distance and reward sits in a mono rule ----------

/** "5:30 PM", "34 min", "9.8 km" / "850 m", "$8.00". */
const NUMBER = /\b\d{1,2}:\d{2}\s?[AP]M\b|\b\d+(?:\.\d+)?\s?(?:min|km|m)\b|\$\d/;
const monoSelectors = MONO.map((u) => u.selector);
const isMono = (e: El | null): boolean => !!e && e.tag !== '#root'
  && (monoSelectors.some((s) => matchesSelector(e, s)) || isMono(e.parent));
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

describe('Employee page markup: times, distances and rewards are in mono (#685)', () => {
  beforeEach(() => vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', ''));
  afterEach(() => vi.unstubAllEnvs());

  it('the finder catches a time, a distance and a reward outside mono, and skips the ones inside', () => {
    const html = '<div class="ew"><p>Leaves 5:30 PM</p><p>9.8 km away</p><p>Reward $8.00</p><p>Day 1 of 2, 15 packages</p>'
      + '<p><span class="ew-mono">Departs 5:30 PM</span></p><dl><div class="job-v2__number"><dt>Reward</dt><dd>$8.00</dd></div></dl>'
      + '<div class="ew-sr"><p>Reward $8.00.</p></div></div>';
    expect(sansNumbers(html)).toEqual(['<p class="">Leaves 5:30 PM', '<p class="">9.8 km away', '<p class="">Reward $8.00']);
  });

  it('the workspace: commute card, delivery rows and earnings', () => {
    const html = renderToStaticMarkup(createElement(EmployeeWorkspace, { dashboard, businesses, onEditCommute: () => {} }));
    expect(sansNumbers(html)).toEqual([]);
    const mono = monoTexts(html);
    for (const s of ['Departs 5:30 PM', '34 min', '8.4 km', 'Up to 15 min extra per trip', '$8.00']) expect(mono).toContain(s);
    expect(mono).toMatch(/Day 1, \d{1,2}:\d{2} PM/); // a stop's time
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
