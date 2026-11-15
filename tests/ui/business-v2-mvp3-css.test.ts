// The look of the Business page, read from the stylesheets of client/src/components/business/v2 and from
// the components that use them. First the MVP III look (#684, docs/mvp3.md P4); since #956 the night-shift
// transit look, which the human set for this page in place of the MVP III fonts and colours:
//   1. every colour is a named property: one of the page's palette (the --ns-* block at the top of
//      page/businessPage.css: ink, paper, hairline, package orange, the two carrier colours) or a state
//      colour of client/src/styles/tokens.css (--ok, --warn, --danger). A literal appears only as the
//      fallback of var(--name, fallback), and that fallback is the property's own value;
//   2. no box-shadow beyond a 1 px ring, no border-radius above 6 px; a border is a hairline, or 2 px for a
//      rule, a route mark or a stripe;
//   3. Archivo (--ns-display) for headings, the typed sentence and an option's price, IBM Plex Mono
//      (--font-mono) for times, IDs, weights and the prices of the list, Inter (--font-sans) for the rest.
// The 390 px layout rules are pinned by the other business-v2-*-css tests.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCss, readTokens, v2CssFiles, type CssRule, type Decl } from './employee-v2-qa-helpers';
import { MVP2_TOKEN_COLORS } from './kit-v2-legacy-tokens';

const DIR = 'client/src/components/business/v2';
const short = (f: string) => f.replace(/^.*business\/v2\//, '');
const files = v2CssFiles(DIR);
const source = new Map(files.map((f) => [short(f), readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')]));
const parsed = new Map(files.map((f) => [short(f), parseCss(readFileSync(f, 'utf8'))]));
/** The page's own palette and display type: the --ns-* block of page/businessPage.css. */
const palette = new Map([...readTokens(`${DIR}/page/businessPage.css`)].filter(([name]) => name.startsWith('--ns-')));
/** Every name a Business stylesheet may use: the kit's tokens and the page's palette. */
const tokens = new Map([...readTokens(), ...palette]);

/** var(--name) or var(--name, fallback); the fallback may hold one level of parentheses. */
const VAR_RE = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g;
const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i;
const NAMED_COLOR = /\b(white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|navy|teal|maroon|olive|lime|aqua|fuchsia|pink|brown|gold|tan|beige|ivory|coral|salmon|crimson|indigo|violet)\b/i;
const GRADIENT = /gradient\s*\(/i;
/** The colours of the page: its palette, and the kit's three state colours. */
const PALETTE_COLORS = [
  '--ns-ink', '--ns-paper', '--ns-paper-deep', '--ns-sheet', '--ns-text', '--ns-muted', '--ns-line', '--ns-signal',
  '--ns-signal-deep', '--ns-blue', '--ns-green', '--ns-on-ink-muted', '--ns-ink-line', '--ns-ink-field', '--ns-alert-on-ink',
];
const COLOR_TOKENS = [...PALETTE_COLORS, '--ok', '--warn', '--danger'];
/** The MVP III colours the page no longer uses (#956): the primary blue and the kit's grounds and greys. */
const RETIRED = ['--bg', '--panel', '--text', '--navy', '--muted', '--border', '--accent', '--accent-dark', '--accent-soft'];
const MAX_RADIUS_PX = 6;

const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, '').replace(/"/g, "'");
const selectors = (r: CssRule) => r.selector.split(',').map((s) => s.trim());
const where = (file: string, r: CssRule, d: Decl) =>
  `${file}: ${r.media.length ? `${r.media.join(' ')} ` : ''}${r.selector} { ${d.prop}: ${d.value} }`;

/** Every declaration of every Business stylesheet. */
function* decls(): Generator<{ file: string; rule: CssRule; decl: Decl }> {
  for (const [file, rules] of parsed) for (const rule of rules) for (const decl of rule.decls) yield { file, rule, decl };
}
const families = (value: string) => value.split(',').map((s) => norm(s));
/** The font stack a property stands for: --ns-display is var(--font-display, …), so it is that token's stack. */
const stackOf = (value: string): string => {
  const m = /^var\(\s*(--[\w-]+)\s*,\s*([^()]+)\)$/.exec(value.trim());
  return m ? tokens.get(m[1]) ?? m[2] : value;
};

describe('Business page, night-shift transit look (#956; MVP III look #684 before it)', () => {
  it('reads the seven Business stylesheets', () => {
    expect([...parsed.keys()].sort()).toEqual([
      'activity/activity.css', 'businessWorkspace.css', 'deliveryDetails.css', 'lineBadge.css', 'newDelivery.css',
      'page/businessPage.css', 'route/deliveryRoute.css',
    ]);
    for (const rules of parsed.values()) expect(rules.length).toBeGreaterThan(5);
  });

  describe('1. colours come from the page\'s palette', () => {
    it('the palette holds the direction\'s colours (issue 956)', () => {
      expect(Object.fromEntries(PALETTE_COLORS.slice(0, 11).map((name) => [name, palette.get(name)]))).toEqual({
        '--ns-ink': '#0B0F17', // the sentence box and the rules
        '--ns-paper': '#F4F2EC', // the work surface
        '--ns-paper-deep': '#E9E6DC',
        '--ns-sheet': '#FFFFFF',
        '--ns-text': '#14171F',
        '--ns-muted': '#5A5F6B',
        '--ns-line': '#DCD8CE', // hairlines
        '--ns-signal': '#FF6A1A', // package orange, the one signal colour
        '--ns-signal-deep': '#E85A0C',
        '--ns-blue': '#3D8BFF', // first carrier
        '--ns-green': '#22C08A', // second carrier
      });
      // Every palette colour is declared, once, in the one block.
      for (const name of PALETTE_COLORS) expect(palette.get(name), name).toMatch(/^#[0-9A-F]{6}$/);
      const page = source.get('page/businessPage.css')!;
      expect(page.match(/:root \{/g)).toHaveLength(1);
      for (const name of palette.keys()) expect(page.split(`${name}:`).length - 1, name).toBe(1);
      // No other Business stylesheet declares a property of its own.
      for (const [file, css] of source) if (file !== 'page/businessPage.css') expect(css, file).not.toMatch(/(?:^|[{;\s])--[\w-]+\s*:/);
    });

    it('the MVP III primary blue, grounds and greys are gone from the page', () => {
      for (const [file, css] of source) for (const name of RETIRED) expect(css, `${file}: ${name}`).not.toContain(`var(${name},`);
    });

    it('package orange is a fill or a line, never the colour of text (2.6:1 on paper)', () => {
      const bad: string[] = [];
      for (const { file, rule, decl } of decls()) {
        if (decl.prop === 'color' && /--ns-(signal|signal-deep|blue|green)\b/.test(decl.value)) bad.push(where(file, rule, decl));
      }
      expect(bad).toEqual([]);
      // Text on an orange fill is ink (6.7:1), in every rule that fills with it.
      const filled = [...decls()].filter((x) => x.decl.prop === 'background' && /--ns-signal\b/.test(x.decl.value)
        && /btn/.test(x.rule.selector) && !/:hover/.test(x.rule.selector));
      expect(filled.length).toBeGreaterThanOrEqual(4);
      for (const { file, rule } of filled) {
        expect(rule.decls.find((d) => d.prop === 'color')?.value, `${file}: ${rule.selector}`).toBe('var(--ns-ink, #0B0F17)');
      }
    });

    it('no hex, rgb(), named colour or gradient outside a var(--token, fallback) fallback', () => {
      const bad: string[] = [];
      for (const { file, rule, decl } of decls()) {
        if (decl.prop.startsWith('--ns-')) continue; // the palette block is where the values are written
        const rest = decl.value.replace(VAR_RE, '');
        if (COLOR_LITERAL.test(rest) || NAMED_COLOR.test(rest)) bad.push(where(file, rule, decl));
      }
      expect(bad).toEqual([]);
      // A gradient is not allowed inside a fallback either.
      for (const [file, css] of source) expect(css, file).not.toMatch(GRADIENT);
    });

    it('every var() names a token, always with a fallback', () => {
      const bad: string[] = [];
      for (const { file, rule, decl } of decls()) {
        for (const [, name, fb] of decl.value.matchAll(VAR_RE)) {
          if (!tokens.has(name)) bad.push(`${where(file, rule, decl)} (${name} is not in tokens.css or the palette)`);
          if (!fb?.trim()) bad.push(`${where(file, rule, decl)} (${name} has no fallback)`);
        }
      }
      expect(bad).toEqual([]);
    });

    it('a fallback is the property\'s own value: no MVP II or MVP III colour, radius or size is left', () => {
      const bad: string[] = [];
      let colours = 0;
      for (const { file, rule, decl } of decls()) {
        for (const [, name, fb] of decl.value.matchAll(VAR_RE)) {
          const token = tokens.get(name);
          if (token === undefined || !fb) continue;
          if (name.startsWith('--font-') || name === '--ns-display') {
            // A font stack may be shorter than the token's, but it starts with the same family and ends
            // with the same generic one.
            const [want, got] = [families(stackOf(token)), families(fb)];
            if (got[0] !== want[0] || got.at(-1) !== want.at(-1)) bad.push(`${where(file, rule, decl)} (${name} is ${token})`);
          } else if (norm(fb) !== norm(token)) {
            bad.push(`${where(file, rule, decl)} (${name} is ${token}, fallback ${fb})`);
          }
          if (COLOR_TOKENS.includes(name)) colours++;
        }
      }
      expect(bad).toEqual([]);
      expect(colours).toBeGreaterThan(100);
      for (const [file, css] of source) {
        for (const old of MVP2_TOKEN_COLORS) expect(css.toLowerCase(), `${file}: ${old}`).not.toContain(old.toLowerCase());
        expect(css, file).not.toMatch(/IBM Plex Sans/);
      }
    });

    it('a colour property takes a colour token, not a size or font token', () => {
      const COLOR_PROPS = /^(color|background(-color)?|border(-(top|right|bottom|left))?-color|outline-color)$/;
      const bad: string[] = [];
      for (const { file, rule, decl } of decls()) {
        if (!COLOR_PROPS.test(decl.prop)) continue;
        for (const [, name] of decl.value.matchAll(VAR_RE)) if (!COLOR_TOKENS.includes(name)) bad.push(where(file, rule, decl));
      }
      expect(bad).toEqual([]);
    });

    it('the route preview takes its colours from map/layers.ts, not from the stylesheet', () => {
      const swatch = parsed.get('route/deliveryRoute.css')!.find((r) => r.selector === '.bdr__swatch')!;
      expect(swatch.decls.map((d) => d.prop).sort()).toEqual(['display', 'height', 'width']);
      const tsx = readFileSync(`${DIR}/route/DeliveryRoutePreview.tsx`, 'utf8');
      expect(tsx).toMatch(/import \{ toneLabelColor \} from '..\/..\/..\/map\/layers';/);
      expect(tsx).toMatch(/className="bdr__swatch" style=\{\{ background: toneLabelColor\(tone\) \}\}/);
      // No colour of its own in the component ("#549" in a comment is an issue number, so six digits).
      expect(tsx).not.toMatch(/#[0-9a-f]{6}\b|\brgba?\(/i);
    });
  });

  describe('2. flat: hairline shadows only, radius at most 6 px', () => {
    it('a box-shadow is none or a 1 px ring in a token colour (no offset, no blur)', () => {
      const RING = /^0 0 0 1px var\(--[\w-]+, #[0-9A-Fa-f]{6}\)$/;
      const bad: string[] = [];
      for (const { file, rule, decl } of decls()) {
        if (decl.prop === 'box-shadow' && decl.value !== 'none' && !RING.test(decl.value)) bad.push(where(file, rule, decl));
        if (/^(filter|backdrop-filter|text-shadow)$/.test(decl.prop)) bad.push(where(file, rule, decl));
      }
      expect(bad).toEqual([]);
    });

    it('a border-radius is 0 or a radius token, and the tokens are at most 6 px', () => {
      for (const name of ['--radius', '--radius-lg']) {
        expect(tokens.get(name), name).toMatch(/^\d+px$/);
        expect(Number.parseFloat(tokens.get(name)!), name).toBeLessThanOrEqual(MAX_RADIUS_PX);
      }
      const bad: string[] = [];
      let radii = 0;
      for (const { file, rule, decl } of decls()) {
        if (!decl.prop.includes('radius')) continue;
        radii++;
        const parts = decl.value.replace(VAR_RE, (_, name: string) => (name === '--radius' || name === '--radius-lg' ? 'TOKEN' : name)).split(/\s+/);
        if (!parts.every((p) => p === 'TOKEN' || p === '0')) bad.push(where(file, rule, decl));
        for (const [, , fb] of decl.value.matchAll(VAR_RE)) {
          if (Number.parseFloat(fb ?? '') > MAX_RADIUS_PX) bad.push(`${where(file, rule, decl)} (fallback above ${MAX_RADIUS_PX}px)`);
        }
      }
      expect(bad).toEqual([]);
      expect(radii).toBeGreaterThan(20);
    });

    it('a border is a 1 px hairline; a rule above a list and a station ring are 2 px; a stripe on the left is 2 or 3 px', () => {
      /** The 2 px borders of the look: the ink rule above the timetable and the board, and the rings of stations. */
      const TWO_PX = [
        '.bw-table', '.nd-options__list', '.bw-status--warn::before', '.lb-stop--relay', '.nd-route::after',
        '.bd-step__mark', '.bd-step--current .bd-step__mark',
      ];
      const bad: string[] = [];
      const twoPx: string[] = [];
      for (const { file, rule, decl } of decls()) {
        if (!/^border(-(top|right|bottom|left))?(-width)?$/.test(decl.prop)) continue;
        const px = [...decl.value.replace(VAR_RE, '').matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
        const limit = decl.prop.startsWith('border-left') ? 3 : TWO_PX.includes(rule.selector) ? 2 : 1;
        if (px.some((n) => n > limit)) bad.push(where(file, rule, decl));
        if (!decl.prop.startsWith('border-left') && px.includes(2)) twoPx.push(rule.selector);
      }
      expect(bad).toEqual([]);
      expect([...new Set(twoPx)].sort()).toEqual([...TWO_PX].sort());
    });
  });

  describe('3. Archivo for headings and big numbers, IBM Plex Mono for times, IDs, weights and prices, Inter for the rest', () => {
    const SANS = /^var\(--font-sans, 'Inter', 'Geist', system-ui, sans-serif\)$/;
    const MONO = /^var\(--font-mono, 'IBM Plex Mono', ui-monospace, monospace\)$/;
    const DISPLAY = /^var\(--ns-display, 'Archivo Variable', 'Inter', system-ui, sans-serif\)$/;
    /** Selectors (outside media queries too) whose rule sets the given font token, per file. */
    const using = (re: RegExp) => Object.fromEntries([...parsed].map(([file, rules]) => [
      file,
      rules.filter((r) => r.decls.some((d) => d.prop === 'font-family' && re.test(d.value))).flatMap(selectors),
    ]));

    it('the tokens are Inter and IBM Plex Mono, and the page\'s heading face is Archivo with Inter behind it', () => {
      expect(tokens.get('--font-sans')).toMatch(/^"Inter", /);
      expect(tokens.get('--font-mono')).toMatch(/^"IBM Plex Mono", /);
      // The heading face is the app's (#955): the palette names the kit's token, with the same stack behind
      // it as every use has, so the page's headings follow the header and the homepage.
      expect(palette.get('--ns-display')).toBe("var(--font-display, 'Archivo Variable', 'Inter', system-ui, sans-serif)");
      expect(tokens.get('--font-display')).toMatch(/^"Archivo Variable", "Inter", /);
      expect(stackOf(palette.get('--ns-display')!)).toBe(tokens.get('--font-display'));
      expect(stackOf("'Inter', sans-serif")).toBe("'Inter', sans-serif");
    });

    it('a font-family is --font-sans, --font-mono or --ns-display, and the font shorthand only inherits', () => {
      const bad: string[] = [];
      for (const { file, rule, decl } of decls()) {
        if (decl.prop === 'font-family' && !SANS.test(decl.value) && !MONO.test(decl.value) && !DISPLAY.test(decl.value)) bad.push(where(file, rule, decl));
        if (decl.prop === 'font' && decl.value !== 'inherit') bad.push(where(file, rule, decl));
      }
      expect(bad).toEqual([]);
    });

    it('a font-size is a --text token, a display size of the palette, or relative to its parent', () => {
      expect(Object.fromEntries([...palette].filter(([name]) => name.startsWith('--ns-size-')))).toEqual({
        '--ns-size-title': '20px', '--ns-size-sentence': '26px', '--ns-size-figure': '32px', '--ns-size-name': '40px',
      });
      const bad: string[] = [];
      for (const { file, rule, decl } of decls()) {
        if (decl.prop !== 'font-size') continue;
        if (!/^var\(--(text-(xs|sm|md|lg|xl)|ns-size-(title|sentence|figure|name)), \d+px\)$/.test(decl.value) && !/^\d*\.?\d+em$/.test(decl.value)) bad.push(where(file, rule, decl));
      }
      expect(bad).toEqual([]);
    });

    it('Archivo is never asked for a weight above 600: its heavier cut comes from the weight axis, so the Inter behind it is never a faked bold', () => {
      // fonts.css loads Inter at 400, 500 and 600 only (#737). A rule in the heading face keeps font-weight
      // at 500 or 600, the weight the fallback is drawn in, and sets Archivo's own weight (up to 800) with
      // font-variation-settings, which a font without that axis ignores.
      const bad: string[] = [];
      let heavy = 0;
      for (const [file, rules] of parsed) {
        for (const rule of rules) {
          const get = (prop: string) => rule.decls.find((d) => d.prop === prop)?.value;
          const axis = get('font-variation-settings');
          if (axis === undefined) continue;
          heavy++;
          const m = /^'wght' (\d{3})$/.exec(axis);
          if (!m || Number(m[1]) < 600 || Number(m[1]) > 800) bad.push(`${file}: ${rule.selector} { font-variation-settings: ${axis} }`);
          // The axis is set where the face is: in a rule that names Archivo, or on a button that does.
          if (!DISPLAY.test(get('font-family') ?? '')) bad.push(`${file}: ${rule.selector} sets the axis without the heading face`);
        }
        for (const rule of rules) {
          const weight = rule.decls.find((d) => d.prop === 'font-weight')?.value;
          if (weight !== undefined && !['400', '500', '600'].includes(weight)) bad.push(`${file}: ${rule.selector} { font-weight: ${weight} }`);
        }
      }
      expect(bad).toEqual([]);
      expect(heavy).toBeGreaterThanOrEqual(8);
    });

    it('exactly the headings, the typed sentence, an option\'s price and the orange buttons are in the heading face', () => {
      expect(using(DISPLAY)).toEqual({
        'activity/activity.css': ['.ba-header__name'],
        'businessWorkspace.css': ['.bw-btn--primary', '.bw-table__title'],
        'deliveryDetails.css': ['.bd-title'],
        'lineBadge.css': [],
        'newDelivery.css': ['.nd-title', '.nd-btn--primary', '.nd-request__text', '.nd-parsed__text', '.nd-options__title', '.nd-option__cents'],
        'page/businessPage.css': ['.bp-state h1'],
        'route/deliveryRoute.css': [],
      });
    });

    it('exactly the data classes are mono', () => {
      expect(using(MONO)).toEqual({
        // .ba-mono is the price inside a notification sentence (#742).
        'activity/activity.css': ['.ba-header__id', '.ba-totals__value', '.ba-note__time', '.ba-note__open', '.ba-notes__count', '.ba-mono'],
        'businessWorkspace.css': ['.bw-table__count', '.bw-mono'],
        'deliveryDetails.css': ['.bd-mono'],
        'lineBadge.css': [],
        'newDelivery.css': ['.nd-input--num', '.nd-input--time', '.nd-mono'],
        'page/businessPage.css': ['.bp-mono'],
        'route/deliveryRoute.css': ['.bdr__n', '.bdr__time'],
      });
    });

    it('every block starts in sans, and a label inside a mono cell goes back to sans', () => {
      expect(using(SANS)).toEqual({
        'activity/activity.css': ['.ba-header', '.ba-notes'],
        // td::before is the column label of a stacked row; the cell itself may be mono.
        'businessWorkspace.css': ['.bw-toolbar', '.bw-table', '.bw-empty', '.bw-stale', '.bw-table td::before'],
        // The "Extra" label in front of the mono minutes at 480 px and below.
        'deliveryDetails.css': ['.bd-panel', '.bd-legs td.bd-num::before'],
        // The badge is drawn inside the list and the Options card and takes their face.
        'lineBadge.css': [],
        'newDelivery.css': ['.nd'],
        'page/businessPage.css': ['.bp'],
        'route/deliveryRoute.css': ['.bdr'],
      });
    });

    // Where each time, ID, weight and price is rendered: the JSX element that holds the value as text
    // carries a mono class of its stylesheet.
    const DATA: Array<[file: string, mono: RegExp, values: string[]]> = [
      ['ShipmentsTable.tsx', /\bbw-mono\b/, ['r.id', 'r.readyText', 'r.deadlineText', 'r.deliveryText', 'r.priceText']],
      ['DeliveryDetails.tsx', /\bbd-mono\b/, [
        // No header.shipmentId: the panel no longer shows the raw ID (#881).
        'result.timeText', 'result.priceText', 'st.timeText', 'leg.extraText',
        'facts.weight', 'facts.ready', 'facts.deadline',
      ]],
      // f.value is mono when the model says so (ETA and price; business-v2-new-delivery-result.test.tsx).
      // windowTime.start/end are the two times of the "Simulation window" hint (#742).
      ['NewDeliveryForm.tsx', /\bnd-mono\b/, [
        'card.shipmentId', 'p.shipmentId', 'st.timeText', 'f.value', 'windowTime.start', 'windowTime.end',
      ]],
      ['activity/BusinessHeader.tsx', /\bba-(header__id|totals__value)\b/, ['m.id', 't.value']],
      // part.text in a mono element is a price cut out of the server's sentence (#742).
      ['activity/NotificationsPanel.tsx', /\bba-(note__time|note__open|notes__count|mono)\b/, [
        'r.time', 'r.shipmentId', 'rows.length', 'part.text',
      ]],
      ['page/BusinessPageView.tsx', /\bbp-mono\b/, ['screen.shipmentId']],
      ['route/DeliveryRoutePreview.tsx', /\bbdr__(n|time)\b/, ['s.n', 's.time']],
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
      it(`${file}: ${values.join(', ')} are rendered in a mono element`, () => {
        const src = readFileSync(`${DIR}/${file}`, 'utf8');
        for (const expr of values) {
          const tags = tagsRendering(src, expr);
          expect(tags.length, `${file}: {${expr}} is rendered`).toBeGreaterThan(0);
          for (const tag of tags) expect(tag, `${file}: {${expr}}`).toMatch(mono);
        }
      });
    }

    it('the weight and time inputs of the New delivery form are mono', () => {
      const src = readFileSync(`${DIR}/NewDeliveryForm.tsx`, 'utf8');
      const inputs = [...src.matchAll(/<input\b[\s\S]*?\/>/g)].map((m) => m[0]);
      const time = inputs.filter((t) => /type="time"/.test(t));
      const weight = inputs.filter((t) => /weightKg/.test(t));
      expect(time).toHaveLength(2);
      expect(weight).toHaveLength(1);
      for (const t of time) expect(t).toMatch(/className="nd-input nd-input--time"/);
      expect(weight[0]).toMatch(/className="nd-input nd-input--num"/);
      // No other control is mono.
      expect(src.match(/nd-input--(num|time)/g)).toHaveLength(3);
    });
  });
});
