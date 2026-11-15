// #701 (docs/mvp3.md P4, the lighter pass on the simulator): the simulator's stylesheets and the map
// chrome carry the MVP III look of client/src/styles/tokens.css. Read from the eight files:
//   1. every colour is a design token; a literal appears only as the fallback of var(--token, fallback)
//      and repeats the token's own value, so no MVP II colour is left; no gradient;
//   2. no box-shadow beyond a 1 px hairline ring (a focus ring is one), no radius above 6 px;
//   3. IBM Plex Mono (--font-mono) for times, distances, IDs, minutes and prices, Inter (--font-sans)
//      for everything else, checked on the selectors and on the elements that render the numbers;
//   4. the Play/Pause button and the Overnight card stay legible, and the focus ring is visible.
// #852 (human feedback) makes one exception to rule 2: the floating Play/Pause control on the map is a
// dark translucent pill (round, with a blur of the map behind it) whose buttons have a white focus ring.
// Its colours are still tokens. #864 (QUESTIONS 22:25) gives the other controls on the map the same look:
// the banners and the overnight card (compose.css) and the day/night badge (map.css). The exceptions are
// listed below, declaration by declaration.
// Not read here: sim/v2/legend/legend.css and sim/v2/journey/journey.css (the journey timeline's
// times), which #699 restyles together with its legend change.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCss, readTokens, type CssRule, type Decl } from './employee-v2-qa-helpers';
import { MVP2_TOKEN_COLORS } from './kit-v2-legacy-tokens';

const SIM = 'client/src/components/sim/v2';
const MAP = 'client/src/components/map';
const FILES = [
  `${SIM}/SimWorkspace.css`,
  `${SIM}/compare/compare.css`,
  `${SIM}/compose/compose.css`,
  `${SIM}/controls/controls.css`,
  `${SIM}/inspector/inspector.css`,
  `${SIM}/packages/packages.css`,
  `${SIM}/page/page.css`,
  `${MAP}/map.css`,
];
const short = (f: string) => f.replace(`${SIM}/`, '').replace('client/src/components/', '');
const raw = new Map(FILES.map((f) => [short(f), readFileSync(f, 'utf8')]));
const parsed = new Map([...raw].map(([f, css]) => [f, parseCss(css)]));
const tokens = readTokens();

const MAX_RADIUS_PX = 6; // docs/mvp3.md P4: "6px radius max"
const MAX_RING_PX = 1; // a hairline
const COLOUR_TOKENS = ['--bg', '--panel', '--text', '--navy', '--muted', '--border', '--accent', '--accent-dark', '--accent-soft', '--ok', '--warn', '--danger'];
/** Set by the app shell on the page, not by tokens.css. */
const LOCAL_VARS = ['--app-header-h'];

/** var(--name) or var(--name, fallback); the fallback may hold one level of parentheses. */
const VAR_RE = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g;
const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const NAMED_COLOUR = /\b(white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|navy|teal|maroon|olive|lime|aqua|fuchsia|pink|brown|gold|tan|beige|ivory|coral|salmon|crimson|indigo|violet)\b/i;
const COLOUR_PROP = /^(color|background(-color)?|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|box-shadow|accent-color|caret-color|fill|stroke|text-decoration(-color)?)$/;
const GRADIENT = /gradient\s*\(/i;

const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, '');
const families = (v: string) => v.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '').toLowerCase()).filter(Boolean);
/** True when `part` is `whole` with some families left out: same first family, same order. */
function isFontSubset(part: string, whole: string): boolean {
  const [a, b] = [families(part), families(whole)];
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
const at = (file: string, r: CssRule, d: Decl) =>
  `${file}: ${r.media.length ? `${r.media.join(' ')} ` : ''}${r.selector.replace(/\s+/g, ' ')} { ${d.prop}: ${d.value} }`;

/** Every declaration of the stylesheets given (default: all eight). */
function* decls(source: Map<string, CssRule[]> = parsed): Generator<{ file: string; rule: CssRule; decl: Decl }> {
  for (const [file, rules] of source) for (const rule of rules) for (const decl of rule.decls) yield { file, rule, decl };
}

// ---------- The three rules, as functions of a stylesheet (so the test can show each one fails) ----------

/** Rule 1: colours come from tokens.css, and a fallback repeats the token's value. */
function colourProblems(source: Map<string, CssRule[]>): string[] {
  const bad: string[] = [];
  for (const { file, rule, decl } of decls(source)) {
    const here = at(file, rule, decl);
    for (const [, name, fb] of decl.value.matchAll(VAR_RE)) {
      if (LOCAL_VARS.includes(name)) continue;
      const token = tokens.get(name);
      if (token === undefined) { bad.push(`${here}: ${name} is not in tokens.css`); continue; }
      if (!fb?.trim()) { bad.push(`${here}: ${name} has no fallback`); continue; }
      const same = name.startsWith('--font-') ? isFontSubset(fb, token) : norm(fb) === norm(token);
      if (!same) bad.push(`${here}: ${name} is ${token}, the fallback says ${fb.trim()}`);
      if (COLOUR_PROP.test(decl.prop) && decl.prop !== 'box-shadow' && !/^(border|outline)/.test(decl.prop) && !COLOUR_TOKENS.includes(name)) {
        bad.push(`${here}: ${name} is not a colour token`);
      }
    }
    const rest = decl.value.replace(VAR_RE, ' ');
    if (GRADIENT.test(decl.value)) bad.push(`${here}: gradient`);
    else if (COLOUR_LITERAL.test(rest)) bad.push(`${here}: colour literal outside a token`);
    else if (COLOUR_PROP.test(decl.prop) && NAMED_COLOUR.test(rest)) bad.push(`${here}: named colour`);
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

/** Rule 2: a shadow is at most a 1 px ring (no offset, no blur); a radius is 0 or a radius token of at most 6 px. */
function shapeProblems(source: Map<string, CssRule[]>): string[] {
  const bad: string[] = [];
  for (const { file, rule, decl } of decls(source)) {
    const here = at(file, rule, decl);
    if (/^(text-shadow|filter|backdrop-filter)$/.test(decl.prop) && decl.value !== 'none') bad.push(`${here}: ${decl.prop}`);
    if (/drop-shadow\(/i.test(decl.value)) bad.push(`${here}: drop-shadow`);
    if (decl.prop === 'box-shadow' && decl.value !== 'none') {
      for (const shadow of decl.value.split(/,(?![^()]*\))/)) {
        const [x = 0, y = 0, blur = 0, spread = 0] = shadowLengths(shadow);
        if (x !== 0 || y !== 0 || blur !== 0 || Math.abs(spread) > MAX_RING_PX) bad.push(`${here}: more than a ${MAX_RING_PX} px hairline`);
        if (/\binset\b/.test(shadow) && spread === 0) bad.push(`${here}: not a ring`);
      }
    }
    if (decl.prop.includes('radius')) {
      const value = decl.value.replace(VAR_RE, (_, name: string, fb?: string) => {
        if (name !== '--radius' && name !== '--radius-lg') bad.push(`${here}: ${name} is not a radius token`);
        if (Number.parseFloat(fb ?? '') > MAX_RADIUS_PX) bad.push(`${here}: fallback above ${MAX_RADIUS_PX} px`);
        return ` ${tokens.get(name) ?? ''} `;
      });
      const px = [...value.matchAll(/(\d*\.?\d+)px/g)].map((m) => Number(m[1]));
      if (px.some((n) => n > MAX_RADIUS_PX) || /%|\d(r?em)\b/.test(value)) bad.push(`${here}: radius above ${MAX_RADIUS_PX} px`);
    }
  }
  return bad;
}

type FontUse = { file: string; selector: string; font: 'sans' | 'mono'; rule: CssRule };

/** Rule 3: a font family is one of the two tokens (or inherited). Returns the uses and the problems. */
function fontUses(source: Map<string, CssRule[]>): { uses: FontUse[]; bad: string[] } {
  const uses: FontUse[] = [];
  const bad: string[] = [];
  for (const { file, rule, decl } of decls(source)) {
    if (decl.prop === 'font' && decl.value !== 'inherit') bad.push(`${at(file, rule, decl)}: font shorthand`);
    if (decl.prop !== 'font-family' || decl.value === 'inherit') continue;
    const m = /^var\(\s*--font-(sans|mono)\s*(,[^()]*)?\)$/.exec(decl.value);
    if (!m) { bad.push(`${at(file, rule, decl)}: not var(--font-sans) or var(--font-mono)`); continue; }
    for (const selector of selectorsOf(rule)) uses.push({ file, selector, font: m[1] as 'sans' | 'mono', rule });
  }
  return { uses, bad };
}

const sheet = (css: string) => new Map([['sample.css', parseCss(css)]]);

// ---------- Colour maths for the legibility checks ----------
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** The last value of `prop` among the rules of `file` that list `selector` outside a media query. */
function valueOf(file: string, selector: string, prop: string): string | undefined {
  return parsed.get(file)!
    .filter((r) => r.media.length === 0 && selectorsOf(r).includes(selector))
    .flatMap((r) => r.decls)
    .filter((d) => d.prop === prop)
    .map((d) => d.value)
    .pop();
}
/** The token a declaration reads, e.g. `var(--accent, #1D5075)` gives `--accent`. */
const tokenOf = (value: string | undefined) => /^var\(\s*(--[\w-]+)/.exec(value ?? '')?.[1];
const colourOf = (file: string, selector: string, prop: string) => tokens.get(tokenOf(valueOf(file, selector, prop)) ?? '') ?? '';

describe('Simulator CSS, MVP III look (#701)', () => {
  it('reads the seven simulator stylesheets and map.css; legend.css and journey.css are left to #699', () => {
    expect([...parsed.keys()]).toEqual([
      'SimWorkspace.css', 'compare/compare.css', 'compose/compose.css', 'controls/controls.css',
      'inspector/inspector.css', 'packages/packages.css', 'page/page.css', 'map/map.css',
    ]);
    for (const [file, rules] of parsed) expect(rules.length, file).toBeGreaterThan(5);
    expect(existsSync(`${SIM}/legend/legend.css`)).toBe(true);
    expect(existsSync(`${SIM}/journey/journey.css`)).toBe(true);
  });

  describe('1. colours come from tokens.css', () => {
    it('the tokens hold the docs/mvp3.md P4 base colours', () => {
      expect(tokens.get('--bg')).toBe('#F7F7F4');
      expect(tokens.get('--text')).toBe('#171C24');
      expect(tokens.get('--accent')).toBe('#1D5075');
      expect(tokens.get('--border')).toBe('#E3E3DE');
      expect(tokens.get('--panel')).toBe('#FFFFFF');
    });

    it('no hex, rgb(), named colour or gradient outside a var(--token, fallback); a fallback is the token value', () => {
      expect(colourProblems(parsed)).toEqual([]);
      // A gradient is not allowed inside a fallback either.
      for (const [file, css] of raw) expect(css.replace(/\/\*[\s\S]*?\*\//g, ''), file).not.toMatch(GRADIENT);
    });

    it('the rule fails on each kind of colour it is there to stop', () => {
      const problems = (css: string) => colourProblems(sheet(css)).join('\n');
      expect(problems('.a { color: #1D5075; }')).toContain('colour literal outside a token');
      expect(problems('.a { background: rgba(247, 248, 250, 0.85); }')).toContain('colour literal outside a token');
      expect(problems('.a { border: 1px solid white; }')).toContain('named colour');
      expect(problems('.a { background: linear-gradient(var(--bg, #F7F7F4), var(--panel, #FFFFFF)); }')).toContain('gradient');
      expect(problems('.a { background: radial-gradient(circle, var(--bg, #F7F7F4), var(--panel, #FFFFFF)); }')).toContain('gradient');
      expect(problems('.a { color: var(--accent, #28618A); }')).toContain('--accent is #1D5075, the fallback says #28618A');
      expect(problems('.a { color: var(--accent); }')).toContain('--accent has no fallback');
      expect(problems('.a { color: var(--brand, #1D5075); }')).toContain('--brand is not in tokens.css');
      expect(problems('.a { color: var(--space-2, 8px); }')).toContain('--space-2 is not a colour token');
      expect(problems('.a { font-family: var(--font-sans, \'IBM Plex Sans\', system-ui, sans-serif); }')).toContain('the fallback says');
      // What the files do write is accepted.
      expect(problems('.a { color: var(--accent, #1D5075); border: 1px solid var(--border, #E3E3DE); top: var(--app-header-h, 57px); }')).toBe('');
      expect(problems('.a { background: color-mix(in srgb, var(--bg, #F7F7F4) 85%, transparent); }')).toBe('');
      expect(problems('.a { font-family: var(--font-sans, \'Inter\', system-ui, sans-serif); }')).toBe('');
    });

    it('no MVP II colour, font or radius is left anywhere in the files, comments included', () => {
      for (const [file, css] of raw) {
        for (const old of MVP2_TOKEN_COLORS) expect(css.toLowerCase(), `${file}: ${old}`).not.toContain(old.toLowerCase());
        expect(css, file).not.toMatch(/IBM Plex Sans/i);
        expect(css, file).not.toMatch(/var\(--radius, 2px\)|var\(--radius-lg, 4px\)/);
        expect(css, file).not.toMatch(/mvp2-ui-redesign/);
      }
    });

    it('the colour tokens are in use in every file', () => {
      for (const [file, rules] of parsed) {
        const used = rules.flatMap((r) => r.decls).flatMap((d) => [...d.value.matchAll(VAR_RE)].map((m) => m[1])).filter((n) => COLOUR_TOKENS.includes(n));
        expect(used.length, file).toBeGreaterThan(3);
      }
    });

    it('the map load overlay is the --bg token at 85%, not a literal', () => {
      expect(valueOf('map/map.css', '.map-v2__overlay', 'background')).toBe('color-mix(in srgb, var(--bg, #F7F7F4) 85%, transparent)');
      expect(valueOf('map/map.css', '.map-v2__overlay--solid', 'background')).toBe('var(--bg, #F7F7F4)');
    });
  });

  describe('2. flat: hairline shadows only, radius at most 6 px', () => {
    it('no box-shadow beyond a 1 px ring, no text-shadow, filter or backdrop; no radius above 6 px; the pills on the map are the one exception (#852, #864)', () => {
      expect(shapeProblems(parsed)).toEqual([
        'compose/compose.css: .spc-banner { backdrop-filter: blur(8px) }: backdrop-filter',
        'compose/compose.css: .spc-banner { border-radius: 14px }: radius above 6 px',
        'compose/compose.css: .spc-playbar { backdrop-filter: blur(8px) }: backdrop-filter',
        'compose/compose.css: .spc-playbar { border-radius: 26px }: radius above 6 px',
        'compose/compose.css: .spc-overnight { backdrop-filter: blur(8px) }: backdrop-filter',
        'compose/compose.css: .spc-overnight { border-radius: 24px }: radius above 6 px',
        'controls/controls.css: .ctl-btn { border-radius: 22px }: radius above 6 px',
        'map/map.css: .map-v2__daynight { backdrop-filter: blur(8px) }: backdrop-filter',
        'map/map.css: .map-v2__daynight { border-radius: 14px }: radius above 6 px',
      ]);
      // The prefixed copy of the blur (Safari before 18) is the same value on the same rule.
      const prefixed = [...decls()].filter(({ decl }) => decl.prop === '-webkit-backdrop-filter').map(({ file, rule, decl }) => at(file, rule, decl));
      expect(prefixed).toEqual([
        'compose/compose.css: .spc-banner { -webkit-backdrop-filter: blur(8px) }',
        'compose/compose.css: .spc-playbar { -webkit-backdrop-filter: blur(8px) }',
        'compose/compose.css: .spc-overnight { -webkit-backdrop-filter: blur(8px) }',
        'map/map.css: .map-v2__daynight { -webkit-backdrop-filter: blur(8px) }',
      ]);
      for (const name of ['--radius', '--radius-lg']) {
        expect(tokens.get(name), name).toMatch(/^\d+px$/);
        expect(Number.parseFloat(tokens.get(name)!), name).toBeLessThanOrEqual(MAX_RADIUS_PX);
      }
    });

    it('the rule fails on a heavy shadow and on a radius above 6 px', () => {
      const problems = (css: string) => shapeProblems(sheet(css)).join('\n');
      expect(problems('.a { box-shadow: 0 2px 8px var(--border, #E3E3DE); }')).toContain('more than a 1 px hairline');
      expect(problems('.a { box-shadow: 0 0 0 3px var(--accent, #1D5075); }')).toContain('more than a 1 px hairline');
      expect(problems('.a { box-shadow: 0 0 0 1px var(--border, #E3E3DE), 0 4px 12px var(--border, #E3E3DE); }')).toContain('more than a 1 px hairline');
      expect(problems('.a { text-shadow: 0 1px 0 var(--panel, #FFFFFF); }')).toContain('text-shadow');
      expect(problems('.a { filter: drop-shadow(0 1px 2px var(--text, #171C24)); }')).toContain('drop-shadow');
      expect(problems('.a { border-radius: 8px; }')).toContain('radius above 6 px');
      expect(problems('.a { border-radius: 50%; }')).toContain('radius above 6 px');
      expect(problems('.a { border-radius: var(--radius-lg, 8px); }')).toContain('fallback above 6 px');
      expect(problems('.a { border-radius: var(--space-2, 8px); }')).toContain('--space-2 is not a radius token');
      // A hairline ring, a focus ring of 1 px and the radius tokens pass.
      expect(problems('.a { box-shadow: 0 0 0 1px var(--border, #E3E3DE); border-radius: var(--radius-lg, 6px); }')).toBe('');
      expect(problems('.a:focus-visible { box-shadow: 0 0 0 1px var(--panel, #FFFFFF); border-radius: var(--radius, 4px); }')).toBe('');
      expect(problems('.a { box-shadow: none; border-radius: 0; }')).toBe('');
    });

    it('there is no shadow at all; every radius is 0 or the --radius token, except the pills on the map and the Play buttons (#852, #864)', () => {
      const shadows = [...decls()].filter(({ decl }) => decl.prop === 'box-shadow').map(({ file, rule, decl }) => at(file, rule, decl));
      expect(shadows).toEqual([]);
      const radii = [...decls()].filter(({ decl }) => decl.prop.includes('radius'));
      expect(radii.length).toBeGreaterThan(20);
      const round = radii.filter(({ decl }) => !/^(0|var\(--radius, 4px\))$/.test(decl.value)).map(({ file, rule, decl }) => at(file, rule, decl));
      expect(round).toEqual([
        'compose/compose.css: .spc-banner { border-radius: 14px }',
        'compose/compose.css: .spc-playbar { border-radius: 26px }',
        'compose/compose.css: .spc-overnight { border-radius: 24px }',
        'controls/controls.css: .ctl-btn { border-radius: 22px }',
        'map/map.css: .map-v2__daynight { border-radius: 14px }',
      ]);
    });
  });

  describe('3. type: IBM Plex Mono for the numbers, Inter for the rest', () => {
    const { uses, bad } = fontUses(parsed);
    const using = (font: 'sans' | 'mono') => Object.fromEntries([...parsed.keys()].map((file) => [
      file, uses.filter((u) => u.file === file && u.font === font).map((u) => u.selector),
    ]));

    it('the tokens name Inter and IBM Plex Mono', () => {
      expect(families(tokens.get('--font-sans')!)[0]).toBe('inter');
      expect(families(tokens.get('--font-mono')!)[0]).toBe('ibm plex mono');
    });

    it('a font family is var(--font-sans) or var(--font-mono), and a font shorthand only inherits', () => {
      expect(bad).toEqual([]);
      const problems = (css: string) => fontUses(sheet(css)).bad.join('\n');
      expect(problems('.a { font-family: Georgia, serif; }')).toContain('not var(--font-sans) or var(--font-mono)');
      expect(problems('.a { font: 12px/1.4 monospace; }')).toContain('font shorthand');
    });

    it('exactly the classes that hold times, IDs, counts, minutes and prices are mono', () => {
      expect(using('mono')).toEqual({
        // The run summary numbers and the package row's status column (RunSummary.tsx, PackageList.tsx).
        'SimWorkspace.css': ['.sw-mono'],
        // The compare table's numbers and its "+3 matched with relay points" line.
        'compare/compare.css': ['.cmp-summary', '.cmp-num'],
        // The Overnight card says "Overnight at <relay point>": a name, no time, so no mono here.
        'compose/compose.css': [],
        'controls/controls.css': [],
        // Inspector values: ETA and delivered times, rewards, extra minutes, the ID line, counts, stop times.
        'inspector/inspector.css': ['.insp-mono', '.insp-ident', '.insp-count', '.insp-stop-time', '.insp-leg-nums dd'],
        // The number on a status filter chip.
        'packages/packages.css': ['.pk-count'],
        'page/page.css': [],
        // The day/night badge's time, and the env variable name in the "no key" message.
        'map/map.css': ['.map-v2__panel code', '.map-v2__daynight'],
      });
    });

    it('mono numbers have digits of one width', () => {
      for (const u of uses.filter((x) => x.font === 'mono' && x.selector !== '.map-v2__panel code')) {
        expect(u.rule.decls.find((d) => d.prop === 'font-variant-numeric')?.value, `${u.file} ${u.selector}`).toBe('tabular-nums');
      }
    });

    it('every block starts in sans; labels (the journey eyebrow, the tooltip role) are not mono', () => {
      expect(using('sans')).toEqual({
        'SimWorkspace.css': ['.sim-v2'],
        'compare/compare.css': [],
        'compose/compose.css': ['.spc-state'],
        'controls/controls.css': ['.ctl-block'],
        'inspector/inspector.css': ['.insp'],
        'packages/packages.css': [],
        'page/page.css': ['.sim-desktop-notice'],
        // The map takes the page's font (global.css sets --font-sans on body).
        'map/map.css': [],
      });
      expect(valueOf('SimWorkspace.css', '.sw-eyebrow', 'font-family')).toBeUndefined();
      expect(valueOf('map/map.css', '.map-v2__tooltip-role', 'font-family')).toBeUndefined();
      expect(valueOf('compose/compose.css', '.spc-overnight', 'font-family')).toBeUndefined();
    });

    // Where each number is rendered: the JSX element that holds the value as text carries a mono class.
    const DATA: Array<[file: string, mono: RegExp, values: string[]]> = [
      [`${SIM}/RunSummary.tsx`, /\bsw-mono\b/, ['r.value']],
      [`${SIM}/PackageList.tsx`, /\bsw-mono\b/, ['p.statusLabel']],
      [`${SIM}/compare/CompareSection.tsx`, /\bcmp-(num|summary)\b/, ['row.direct', 'row.relay', 'summary.line']],
      [`${SIM}/inspector/BusinessInspector.tsx`, /\binsp-(mono|ident|count)\b/, [
        'props.ident', 'row.timeLabel', 'row.rewardLabel', 'row.extraLabel', 'props.rows.length',
      ]],
      [`${SIM}/inspector/EmployeeInspector.tsx`, /\binsp-(mono|stop-time|count)\b/, [
        's.timeLabel', 'model.earnedLabel', 'model.totalRewardLabel', 'model.legs.length',
      ]],
      [`${SIM}/packages/PackageFilterBar.tsx`, /\bpk-count\b/, ['o.count']],
      [`${MAP}/GoogleBaseMap.tsx`, /\bmap-v2__daynight-time\b/, ['clockText']],
    ];

    /** The opening tag of each JSX element that renders `{expr}` as text (not as an attribute value). */
    function tagsRendering(src: string, expr: string): string[] {
      const tags: string[] = [];
      const needle = `{${expr}}`;
      for (let i = src.indexOf(needle); i >= 0; i = src.indexOf(needle, i + 1)) {
        if (src[i - 1] === '$') continue; // inside a template string
        const before = src.slice(0, i);
        const close = before.lastIndexOf('>');
        if (/[<{}=]/.test(before.slice(close + 1))) continue; // an attribute value or an expression
        tags.push(before.slice(before.lastIndexOf('<', close), close + 1));
      }
      return tags;
    }

    it('the tag reader finds text positions only', () => {
      const src = '<tr key={r.id} title={`row ${r.id}`}><td className="x-mono">{r.id}</td><td>Open {r.id}</td></tr>';
      expect(tagsRendering(src, 'r.id')).toEqual(['<td className="x-mono">', '<td>']);
    });

    for (const [file, mono, values] of DATA) {
      it(`${short(file)}: ${values.join(', ')} are rendered in a mono element`, () => {
        const src = readFileSync(file, 'utf8');
        for (const expr of values) {
          const tags = tagsRendering(src, expr);
          expect(tags.length, `${file}: {${expr}} is rendered`).toBeGreaterThan(0);
          for (const tag of tags) expect(tag, `${file}: {${expr}}`).toMatch(mono);
        }
      });
    }

    it('the finish time, extra minutes and reward of a leg sit in the mono <dd> of .insp-leg-nums', () => {
      const src = readFileSync(`${SIM}/inspector/EmployeeInspector.tsx`, 'utf8');
      const block = /<dl className="insp-leg-nums">([\s\S]*?)<\/dl>/.exec(src)?.[1] ?? '';
      for (const expr of ['leg.finishLabel', 'leg.extraLabel', 'leg.rewardLabel']) expect(block).toContain(`<dd>{${expr}}</dd>`);
    });

    it('the day/night badge holds only its icon and the time, so the whole badge is mono', () => {
      const src = readFileSync(`${MAP}/GoogleBaseMap.tsx`, 'utf8');
      const badge = /<div className=\{`map-v2__daynight map-v2__daynight--\$\{phase\}`\}[^>]*>([\s\S]*?)<\/div>/.exec(src)?.[1] ?? '';
      expect(badge).toContain('<span className="map-v2__daynight-time">{clockText}</span>');
      expect(badge.replace(/<svg[\s\S]*?<\/svg>/, '').replace(/\{clockText \? <span[^>]*>\{clockText\}<\/span> : null\}/, '').trim()).toBe('');
    });
  });

  describe('4. the Play/Pause button and the Overnight card stay legible', () => {
    const CTL = 'controls/controls.css';
    const SPC = 'compose/compose.css';

    // #852: Play/Pause and "Back to start" float on the map in a dark translucent pill. The contrast of
    // the pill over a white and over a black map is worked out in sim-v2-playbar-css.test.ts; here: the
    // colours are the tokens.
    it('Play/Pause is white on the ink pill, read from the tokens: no accent block, no white panel', () => {
      expect(valueOf(SPC, '.spc-playbar', 'background')).toBe('color-mix(in srgb, var(--text, #171C24) 72%, transparent)');
      expect(valueOf(CTL, '.ctl-btn', 'color')).toBe('var(--panel, #FFFFFF)');
      expect(valueOf(CTL, '.ctl-btn', 'background')).toBe('transparent');
      expect(colourOf(CTL, '.ctl-btn', 'color')).toBe('#FFFFFF');
      expect(valueOf(CTL, '.ctl-primary', 'background')).toBeUndefined();
      expect(valueOf(CTL, '.ctl-primary', 'color')).toBeUndefined();
      expect(valueOf(CTL, '.ctl-primary', 'font-weight')).toBe('600');
      // White on the ink itself (the pill over a dark map); over a white map see sim-v2-playbar-css.test.ts.
      expect(contrast('#FFFFFF', tokens.get('--text')!)).toBeGreaterThanOrEqual(7);
    });

    it('it stays white on hover, and reads as disabled when it is', () => {
      // #725: the buttons are aria-disabled, so the states are keyed on that attribute, not on :disabled.
      const hover = '.ctl-btn:hover:not([aria-disabled="true"])';
      const off = '.ctl-btn[aria-disabled="true"]';
      expect(valueOf(CTL, hover, 'background')).toBe('color-mix(in srgb, var(--panel, #FFFFFF) 14%, transparent)');
      expect(valueOf(CTL, hover, 'color')).toBeUndefined();
      // Disabled: the same white, dimmed; no hover fill (the hover rule excludes it).
      expect(valueOf(CTL, off, 'color')).toBe('color-mix(in srgb, var(--panel, #FFFFFF) 60%, transparent)');
      expect(valueOf(CTL, off, 'cursor')).toBe('not-allowed');
      const order = parsed.get(CTL)!.flatMap(selectorsOf);
      expect(order.indexOf(off)).toBeGreaterThan(order.indexOf('.ctl-btn'));
    });

    it('its focus ring is visible: a 2 px white outline inside the button, on the ink of the pill', () => {
      expect(valueOf(CTL, '.ctl-btn:focus-visible', 'outline')).toBe('2px solid var(--panel, #FFFFFF)');
      expect(Number.parseFloat(valueOf(CTL, '.ctl-btn:focus-visible', 'outline-offset') ?? '')).toBeLessThan(0);
      expect(valueOf(CTL, '.ctl-btn:focus-visible', 'box-shadow')).toBeUndefined();
      expect(contrast('#FFFFFF', tokens.get('--text')!)).toBeGreaterThanOrEqual(3);
    });

    it('every other focus style in the files is the 2 px accent outline, and none is removed', () => {
      const focus = [...parsed].flatMap(([file, rules]) => rules.filter((r) => /:focus-visible/.test(r.selector)).map((rule) => ({ file, rule })));
      expect(focus.length).toBeGreaterThanOrEqual(6);
      for (const { file, rule } of focus) {
        const pill = file === CTL && rule.selector.trim() === '.ctl-btn:focus-visible';
        expect(rule.decls.find((d) => d.prop === 'outline')?.value, `${file} ${rule.selector}`)
          .toBe(pill ? '2px solid var(--panel, #FFFFFF)' : '2px solid var(--accent, #1D5075)');
      }
      for (const { file, rule, decl } of decls()) {
        if (decl.prop === 'outline') expect(decl.value, at(file, rule, decl)).not.toMatch(/^(none|0)$/);
      }
    });

    // #864: the card and the badge are the same pill as Play. Their contrast over a white and over a black
    // map is worked out in sim-v2-map-controls-css.test.ts; here: the colours are the tokens.
    it('the Overnight card is white on the ink pill, read from the tokens', () => {
      expect(valueOf(SPC, '.spc-overnight', 'background')).toBe(valueOf(SPC, '.spc-playbar', 'background'));
      expect(valueOf(SPC, '.spc-overnight', 'color')).toBe('var(--panel, #FFFFFF)');
      expect(valueOf(SPC, '.spc-overnight', 'border')).toBeUndefined();
      expect(contrast(colourOf(SPC, '.spc-overnight', 'color'), tokens.get('--text')!)).toBeGreaterThanOrEqual(7);
      // Large and bold, so it reads in the second it is up; the moon takes the text colour.
      expect(valueOf(SPC, '.spc-overnight', 'font-size')).toBe('var(--text-lg, 18px)');
      expect(valueOf(SPC, '.spc-overnight', 'font-weight')).toBe('600');
      expect(readFileSync(`${SIM}/compose/OvernightCard.tsx`, 'utf8')).toContain('fill="currentColor"');
    });

    it('the day/night badge is white on the ink pill by day and at night alike', () => {
      const M = 'map/map.css';
      expect(valueOf(M, '.map-v2__daynight', 'background')).toBe(valueOf(SPC, '.spc-playbar', 'background'));
      expect(valueOf(M, '.map-v2__daynight', 'color')).toBe('var(--panel, #FFFFFF)');
      expect(valueOf(M, '.map-v2__daynight', 'border')).toBeUndefined();
      expect(contrast(colourOf(M, '.map-v2__daynight', 'color'), tokens.get('--text')!)).toBeGreaterThanOrEqual(7);
      // No rule of its own for the night: one look for both (the icon says which it is).
      expect(parsed.get(M)!.filter((r) => /daynight--(day|night)/.test(r.selector))).toEqual([]);
    });
  });
});
