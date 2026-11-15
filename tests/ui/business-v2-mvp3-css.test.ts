// #684 (docs/mvp3.md P4, lighter pass): the Business page has the MVP III look. Read from the six
// stylesheets of client/src/components/business/v2 and from the components that use them:
//   1. every colour is a token of client/src/styles/tokens.css (a literal only as the fallback of
//      var(--token, fallback), and that fallback is the token's own value, never an MVP II value);
//   2. no box-shadow beyond a 1 px hairline ring, no border-radius above 6 px;
//   3. IBM Plex Mono (--font-mono) for times, IDs, weights and prices, Inter (--font-sans) for the rest.
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
const tokens = readTokens();

/** var(--name) or var(--name, fallback); the fallback may hold one level of parentheses. */
const VAR_RE = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g;
const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i;
const NAMED_COLOR = /\b(white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|navy|teal|maroon|olive|lime|aqua|fuchsia|pink|brown|gold|tan|beige|ivory|coral|salmon|crimson|indigo|violet)\b/i;
const GRADIENT = /gradient\s*\(/i;
const COLOR_TOKENS = ['--bg', '--panel', '--text', '--navy', '--muted', '--border', '--accent', '--accent-dark', '--accent-soft', '--ok', '--warn', '--danger'];
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

describe('Business page, MVP III look (#684)', () => {
  it('reads the six Business stylesheets', () => {
    expect([...parsed.keys()].sort()).toEqual([
      'activity/activity.css', 'businessWorkspace.css', 'deliveryDetails.css', 'newDelivery.css',
      'page/businessPage.css', 'route/deliveryRoute.css',
    ]);
    for (const rules of parsed.values()) expect(rules.length).toBeGreaterThan(5);
  });

  describe('1. colours come from tokens.css', () => {
    it('the tokens hold the docs/mvp3.md P4 base colours', () => {
      expect(tokens.get('--bg')).toBe('#F7F7F4');
      expect(tokens.get('--text')).toBe('#171C24');
      expect(tokens.get('--accent')).toBe('#1D5075');
      expect(tokens.get('--border')).toBe('#E3E3DE');
    });

    it('no hex, rgb(), named colour or gradient outside a var(--token, fallback) fallback', () => {
      const bad: string[] = [];
      for (const { file, rule, decl } of decls()) {
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
          if (!tokens.has(name)) bad.push(`${where(file, rule, decl)} (${name} is not in tokens.css)`);
          if (!fb?.trim()) bad.push(`${where(file, rule, decl)} (${name} has no fallback)`);
        }
      }
      expect(bad).toEqual([]);
    });

    it('a fallback is the token\'s own value: no MVP II colour, radius or size is left', () => {
      const bad: string[] = [];
      let colours = 0;
      for (const { file, rule, decl } of decls()) {
        for (const [, name, fb] of decl.value.matchAll(VAR_RE)) {
          const token = tokens.get(name);
          if (token === undefined || !fb) continue;
          if (name.startsWith('--font-')) {
            // A font stack may be shorter than the token's, but it starts with the same family and ends
            // with the same generic one.
            const [want, got] = [families(token), families(fb)];
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

    it('a border is a 1 px hairline; only an accent stripe on the left is 2 or 3 px', () => {
      const bad: string[] = [];
      for (const { file, rule, decl } of decls()) {
        if (!/^border(-(top|right|bottom|left))?(-width)?$/.test(decl.prop)) continue;
        const px = [...decl.value.replace(VAR_RE, '').matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
        const limit = decl.prop.startsWith('border-left') ? 3 : decl.prop === 'border' && rule.selector === '.bd-step--current .bd-step__mark' ? 2 : 1;
        if (px.some((n) => n > limit)) bad.push(where(file, rule, decl));
      }
      expect(bad).toEqual([]);
    });
  });

  describe('3. IBM Plex Mono for times, IDs, weights and prices, Inter for the rest', () => {
    const SANS = /^var\(--font-sans, 'Inter', 'Geist', system-ui, sans-serif\)$/;
    const MONO = /^var\(--font-mono, 'IBM Plex Mono', ui-monospace, monospace\)$/;

    it('the tokens are Inter and IBM Plex Mono', () => {
      expect(tokens.get('--font-sans')).toMatch(/^"Inter", /);
      expect(tokens.get('--font-mono')).toMatch(/^"IBM Plex Mono", /);
    });

    it('a font-family is --font-sans or --font-mono, and the font shorthand only inherits', () => {
      const bad: string[] = [];
      for (const { file, rule, decl } of decls()) {
        if (decl.prop === 'font-family' && !SANS.test(decl.value) && !MONO.test(decl.value)) bad.push(where(file, rule, decl));
        if (decl.prop === 'font' && decl.value !== 'inherit') bad.push(where(file, rule, decl));
      }
      expect(bad).toEqual([]);
    });

    it('a font-size is a --text token (or relative to its parent)', () => {
      const bad: string[] = [];
      for (const { file, rule, decl } of decls()) {
        if (decl.prop !== 'font-size') continue;
        if (!/^var\(--text-(xs|sm|md|lg|xl), \d+px\)$/.test(decl.value) && !/^\d*\.?\d+em$/.test(decl.value)) bad.push(where(file, rule, decl));
      }
      expect(bad).toEqual([]);
    });

    /** Selectors (outside media queries too) whose rule sets the given font token, per file. */
    const using = (re: RegExp) => Object.fromEntries([...parsed].map(([file, rules]) => [
      file,
      rules.filter((r) => r.decls.some((d) => d.prop === 'font-family' && re.test(d.value))).flatMap(selectors),
    ]));

    it('exactly the data classes are mono', () => {
      expect(using(MONO)).toEqual({
        // .ba-mono is the price inside a notification sentence (#742).
        'activity/activity.css': ['.ba-header__id', '.ba-totals__value', '.ba-note__time', '.ba-note__open', '.ba-notes__count', '.ba-mono'],
        'businessWorkspace.css': ['.bw-table__count', '.bw-mono'],
        'deliveryDetails.css': ['.bd-mono'],
        'newDelivery.css': ['.nd-input--num', '.nd-input--time', '.nd-mono'],
        'page/businessPage.css': ['.bp-mono'],
        'route/deliveryRoute.css': ['.bdr__n', '.bdr__time'],
      });
    });

    it('every block starts in sans, and a label inside a mono cell goes back to sans', () => {
      expect(using(SANS)).toEqual({
        'activity/activity.css': ['.ba-header', '.ba-notes'],
        // td::before is the column label of a stacked row; the cell itself may be mono.
        'businessWorkspace.css': ['.bw-toolbar', '.bw-table', '.bw-empty', '.bw-table td::before'],
        // The "Extra" label in front of the mono minutes at 480 px and below.
        'deliveryDetails.css': ['.bd-panel', '.bd-legs td.bd-num::before'],
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
        'header.shipmentId', 'result.timeText', 'result.priceText', 'st.timeText', 'leg.extraText',
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
