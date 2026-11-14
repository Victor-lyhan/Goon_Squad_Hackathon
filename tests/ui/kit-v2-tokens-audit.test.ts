// #477: visual QA of the UI kit and global styles; since #651 against docs/mvp3.md P4 (the MVP III look).
// Reads ui.css, global.css and tokens.css and fails on: radius above 6px, shadows other than a focus ring,
// gradients, and colours / font families / spacing that are not tokens. Also checks focus rings,
// disabled states that are not colour-only, reduced motion per animating selector, and the StatusPill shape.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { statusLabel, type PillStatus } from '../../client/src/ui/StatusPill';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const read = (p: string) => strip(readFileSync(p, 'utf8'));

const FILES = {
  ui: 'client/src/ui/ui.css',
  global: 'client/src/styles/global.css',
  tokens: 'client/src/styles/tokens.css',
} as const;

// ---- tiny CSS walker: rules with their enclosing at-rule preludes; @keyframes and @import skipped ----
type Decl = { prop: string; value: string };
type Rule = { selectors: string[]; decls: Decl[]; at: string[] };
function parse(css: string, at: string[] = []): Rule[] {
  const out: Rule[] = [];
  css = css.replace(/@import[^;]+;/g, '');
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    const prelude = css.slice(i, open).trim();
    const inner = css.slice(open + 1, j - 1);
    if (prelude.startsWith('@')) {
      if (!prelude.startsWith('@keyframes')) out.push(...parse(inner, [...at, prelude]));
    } else {
      const decls = inner.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
        const k = d.indexOf(':');
        return { prop: d.slice(0, k).trim().toLowerCase(), value: d.slice(k + 1).trim() };
      });
      out.push({ selectors: prelude.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), decls, at });
    }
    i = j;
  }
  return out;
}

const RULES = { ui: parse(read(FILES.ui)), global: parse(read(FILES.global)), tokens: parse(read(FILES.tokens)) };
const STYLE_RULES = [...RULES.ui.map((r) => ({ file: FILES.ui, r })), ...RULES.global.map((r) => ({ file: FILES.global, r }))];

// ---- tokens ----
const rootDecls = RULES.tokens.find((r) => r.selectors.includes(':root'))!.decls;
const TOKENS = new Map(rootDecls.filter((d) => d.prop.startsWith('--')).map((d) => [d.prop, d.value]));
const resolve = (v: string): string => {
  const m = /^var\((--[\w-]+)\)$/.exec(v.trim());
  return m ? resolve(TOKENS.get(m[1])!) : v.trim();
};

/** The doc's base colours (docs/mvp3.md P4) plus the white panel; white may be written as a keyword or hex. */
const DOC_COLOURS = ['#171c24', '#f7f7f4', '#e3e3de', '#1d5075', '#ffffff', '#fff', 'white'];
/** Selectors allowed a full circle (spinner ring, status dot). Everything else stays at 6px or less. */
/** docs/mvp3.md P4: 6px radius max. */
const MAX_RADIUS_PX = 6;
const FULL_CIRCLE_OK = ['.ui-spinner', '.ui-pill::before'];

const COLOUR_PROP = /^(color|background(-color)?|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|fill|stroke|caret-color|accent-color|text-decoration(-color)?|column-rule(-color)?)$/;
const COLOUR_KEYWORDS_OK = new Set([
  'transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'none', 'white',
  'solid', 'dashed', 'dotted', 'double', 'underline', 'line-through', 'auto',
  'color-mix', 'in', 'srgb', 'thin',
]);
const SPACING_PROP = /^(padding|margin)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$|^(gap|row-gap|column-gap|inset|top|right|bottom|left)$/;

type Problem = string;

/** Pure checker so it can be fed a known-bad sample below. */
function auditRules(rules: Rule[], tokens: Map<string, string>): Problem[] {
  const problems: Problem[] = [];
  for (const r of rules) {
    const where = r.selectors.join(',');
    for (const { prop, value } of r.decls) {
      if (prop.startsWith('--')) { problems.push(`${where}: defines ${prop} outside tokens.css`); continue; }
      const v = value.toLowerCase();
      // Every var() must name a token from tokens.css.
      for (const m of v.matchAll(/var\((--[\w-]+)/g)) if (!tokens.has(m[1])) problems.push(`${where}: ${prop} uses unknown var ${m[1]}`);
      if (/gradient\(/.test(v)) problems.push(`${where}: ${prop} uses a gradient`);
      if (prop === 'box-shadow' && v !== 'none' && !r.selectors.every((s) => s.includes(':focus-visible'))) {
        problems.push(`${where}: box-shadow outside a focus ring`);
      }
      if (prop === 'border-radius' || /^border-(top|bottom)-(left|right)-radius$/.test(prop)) {
        const full = /(^|\s)(50%|100%|9{3,}px)/.test(v);
        if (full) {
          if (!r.selectors.every((s) => FULL_CIRCLE_OK.includes(s))) problems.push(`${where}: full-circle radius not allowed here`);
        } else {
          if (/%/.test(v)) problems.push(`${where}: percentage radius ${v}`);
          for (const m of v.matchAll(/var\((--[\w-]+)\)/g)) {
            if (m[1] !== '--radius' && m[1] !== '--radius-lg') problems.push(`${where}: radius token ${m[1]}`);
          }
          for (const m of v.replace(/var\([^)]*\)/g, '').matchAll(/(\d*\.?\d+)(px|rem|em)/g)) {
            const px = m[2] === 'px' ? Number(m[1]) : Number(m[1]) * 16;
            if (px > MAX_RADIUS_PX) problems.push(`${where}: border-radius ${v} above ${MAX_RADIUS_PX}px`);
          }
        }
      }
      if (COLOUR_PROP.test(prop) || /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/.test(v)) {
        const bare = v.replace(/var\(--[\w-]+\)/g, ' ');
        for (const m of bare.matchAll(/#[0-9a-f]{3,8}\b/g)) if (!DOC_COLOURS.includes(m[0])) problems.push(`${where}: ${prop} colour ${m[0]} is not a token`);
        if (/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/.test(bare)) problems.push(`${where}: ${prop} raw colour function`);
        if (COLOUR_PROP.test(prop)) {
          const words = bare.replace(/#[0-9a-f]{3,8}\b/g, ' ').replace(/-?\d*\.?\d+(px|em|rem|%)?/g, ' ').match(/[a-z][a-z-]*/g) ?? [];
          for (const w of words) if (!COLOUR_KEYWORDS_OK.has(w)) problems.push(`${where}: ${prop} named colour "${w}"`);
        }
      }
      if (prop === 'font-family') {
        if (!/^(var\(--font-(sans|mono)\)|inherit)$/.test(v)) problems.push(`${where}: font-family ${value} is not a token`);
      }
      if (prop === 'font' && v !== 'inherit') problems.push(`${where}: font shorthand ${value}`);
      if (SPACING_PROP.test(prop)) {
        let s = v.replace(/var\(--space-\d+\)/g, 'S');
        s = s.replace(/calc\(([^()]*)\)/g, (_, inner: string) => (/^[\sS\d.*+\-/]*$/.test(inner) ? 'S' : 'BAD'));
        for (const term of s.split(/\s+/)) {
          if (!['S', '0', '0px', 'auto', '-S'].includes(term)) problems.push(`${where}: ${prop} ${value} is not on the spacing scale`);
        }
      }
    }
  }
  return problems;
}

describe('kit and global styles use only design tokens (#477)', () => {
  it('the checker catches a known-bad sample', () => {
    const bad = parse(`.x{border-radius:8px;box-shadow:0 1px 2px var(--text);background:linear-gradient(red,blue);color:#123456;
      font-family:Arial;padding:3px var(--space-2);border:1px solid tomato;margin:var(--space-5)}
      .y{border-radius:50%} .z:focus-visible{box-shadow:0 0 0 2px var(--accent)}`);
    const p = auditRules(bad, TOKENS).join('\n');
    for (const s of ['above 6px', 'box-shadow outside', 'gradient', '#123456', 'font-family Arial', 'padding 3px', '"tomato"', 'unknown var --space-5', '.y: full-circle']) {
      expect(p).toContain(s);
    }
    expect(p).not.toContain('.z:focus-visible');
  });

  it('ui.css passes the audit', () => {
    expect(auditRules(RULES.ui, TOKENS)).toEqual([]);
  });

  it('global.css passes the audit', () => {
    expect(auditRules(RULES.global, TOKENS)).toEqual([]);
  });

  it('tokens.css only defines tokens in :root, with radius <= 6px, a 4px spacing scale and the token fonts', () => {
    expect(RULES.tokens.map((r) => r.selectors.join(','))).toEqual([':root']);
    expect(Number.parseFloat(TOKENS.get('--radius')!)).toBeLessThanOrEqual(MAX_RADIUS_PX);
    expect(Number.parseFloat(TOKENS.get('--radius-lg')!)).toBeLessThanOrEqual(MAX_RADIUS_PX);
    expect(Number.parseFloat(TOKENS.get('--radius')!)).toBeLessThanOrEqual(Number.parseFloat(TOKENS.get('--radius-lg')!));
    for (const [k, v] of TOKENS) if (/^--space-\d+$/.test(k)) expect(Number.parseFloat(v) % 4, `${k}: ${v}`).toBe(0);
    expect(TOKENS.get('--font-sans')).toMatch(/^"Inter", "Geist", system-ui/);
    expect(TOKENS.get('--font-mono')).toMatch(/^"IBM Plex Mono"/);
    // Non-token declarations in :root are limited to color-scheme.
    expect(rootDecls.filter((d) => !d.prop.startsWith('--')).map((d) => d.prop)).toEqual(['color-scheme']);
    for (const c of ['#171C24', '#F7F7F4', '#FFFFFF', '#E3E3DE', '#1D5075']) expect([...TOKENS.values()]).toContain(c);
    expect(read(FILES.tokens)).not.toMatch(/gradient\(|box-shadow/);
  });
});

// ---- contrast (WCAG 2.x) ----
function lum(hex: string): number {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h, 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

/** Every interactive kit element, plus the global link focus. */
const KIT_CONTROLS = ['.ui-btn', '.ui-field input', '.ui-field select', '.ui-field textarea', '.ui-drawer__close', '.ui-toast button'];
/** Surfaces a control can sit on (the ring is offset outside the control, so it is drawn on these). */
const SURFACES = ['--bg', '--panel', '--accent-soft'].map((t) => resolve(`var(${t})`));

function focusRule(rules: Rule[], sel: string): Rule | undefined {
  return rules.find((r) => r.at.length === 0 && r.selectors.includes(sel));
}
function ring(rule: Rule): { width: number; colour: string; offset: number } {
  const outline = rule.decls.find((d) => d.prop === 'outline')!.value;
  const offset = rule.decls.find((d) => d.prop === 'outline-offset')?.value ?? '0';
  return {
    width: Number(/(\d+)px/.exec(outline)![1]),
    colour: resolve(/var\(--[\w-]+\)/.exec(outline)![0]),
    offset: Number.parseFloat(offset),
  };
}

describe('visible keyboard focus on every kit control (#477)', () => {
  for (const sel of KIT_CONTROLS) {
    it(`${sel}:focus-visible has a >= 2px ring with >= 3:1 contrast, outside the control`, () => {
      const rule = focusRule(RULES.ui, `${sel}:focus-visible`);
      expect(rule, sel).toBeDefined();
      const r = ring(rule!);
      expect(r.width).toBeGreaterThanOrEqual(2);
      expect(r.offset).toBeGreaterThan(0);
      for (const bg of SURFACES) expect(contrast(r.colour, bg), `${sel} on ${bg}`).toBeGreaterThanOrEqual(3);
    });
  }

  it('links (the kit link style) get the global :focus-visible ring with >= 3:1 contrast', () => {
    const rule = focusRule(RULES.global, ':focus-visible')!;
    const r = ring(rule);
    expect(r.width).toBeGreaterThanOrEqual(2);
    for (const bg of SURFACES) expect(contrast(r.colour, bg)).toBeGreaterThanOrEqual(3);
  });

  it('no focus rule removes the outline or uses a low-contrast colour', () => {
    for (const { file, r } of STYLE_RULES) {
      if (!r.selectors.some((s) => s.includes(':focus'))) continue;
      for (const d of r.decls) {
        if (d.prop === 'outline' && /none|\b0\b/.test(d.value)) throw new Error(`${file} ${r.selectors}: outline removed`);
        if (d.prop === 'outline' || d.prop === 'outline-color') {
          const v = /var\(--[\w-]+\)/.exec(d.value);
          if (!v) continue;
          for (const bg of SURFACES) expect(contrast(resolve(v[0]), bg), `${r.selectors} ${d.value}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });
});

describe('disabled states are not shown by colour alone (#477)', () => {
  const dashed = (r: Rule) => r.decls.some((d) => (d.prop === 'border-style' && d.value === 'dashed') || (d.prop === 'border' && /\bdashed\b/.test(d.value)));
  for (const sel of KIT_CONTROLS) {
    it(`${sel}:disabled gets a dashed border`, () => {
      const rule = RULES.ui.find((r) => r.selectors.includes(`${sel}:disabled`));
      expect(rule, sel).toBeDefined();
      expect(dashed(rule!)).toBe(true);
    });
  }

  it('no disabled rule hides that border again (e.g. the ghost button)', () => {
    for (const r of RULES.ui.filter((x) => x.selectors.some((s) => s.includes(':disabled')))) {
      for (const d of r.decls) {
        if (d.prop === 'border-color') expect(d.value, `${r.selectors}`).not.toBe('transparent');
        if (d.prop === 'border' || d.prop === 'border-style') expect(d.value, `${r.selectors}`).not.toMatch(/^(0|none)$/);
      }
    }
  });

  it('pending links in global.css (.nav-pending) also get a dashed border', () => {
    const rule = RULES.global.find((r) => r.selectors.includes('.nav-pending'))!;
    expect(dashed(rule)).toBe(true);
  });
});

describe('reduced motion covers every animating kit selector (#477)', () => {
  const isReduce = (r: Rule) => r.at.some((a) => /prefers-reduced-motion\s*:\s*reduce/.test(a));
  const motion = (r: Rule, kind: 'animation' | 'transition') => r.decls.filter((d) => d.prop === kind || d.prop.startsWith(`${kind}-`));
  /** Longest time in a value, in seconds; `none` is 0. */
  const seconds = (v: string) => (v.trim() === 'none' ? 0 : Math.max(0, ...[...v.matchAll(/(\d*\.?\d+)(ms|s)\b/g)].map((m) => Number(m[1]) / (m[2] === 'ms' ? 1000 : 1))));

  const animating = (kind: 'animation' | 'transition') =>
    RULES.ui.filter((r) => !isReduce(r) && motion(r, kind).some((d) => d.prop === kind || d.prop.endsWith('-duration') || d.prop.endsWith('-name'))).flatMap((r) => r.selectors);

  it('the spinner, drawer, backdrop and toast are among the animating selectors', () => {
    expect(animating('animation')).toEqual(expect.arrayContaining(['.ui-spinner', '.ui-drawer', '.ui-drawer__backdrop', '.ui-toast']));
  });

  for (const kind of ['animation', 'transition'] as const) {
    it(`every selector with a ${kind} is reset to <= 0.01s under prefers-reduced-motion: reduce`, () => {
      const reduce = RULES.ui.filter(isReduce);
      const missing: string[] = [];
      for (const sel of animating(kind)) {
        const over = reduce.filter((r) => r.selectors.includes(sel)).flatMap((r) => motion(r, kind));
        const ok = over.some((d) => (d.prop === kind || d.prop === `${kind}-duration`) && seconds(d.value) <= 0.01);
        if (!ok) missing.push(sel);
      }
      expect(missing).toEqual([]);
    });
  }

  it('the global safeguard caps every animation and transition at <= 0.01s', () => {
    const blanket = RULES.global.find((r) => isReduce(r) && r.selectors.includes('*'))!;
    expect(blanket).toBeDefined();
    for (const p of ['animation-duration', 'transition-duration']) {
      const d = blanket.decls.find((x) => x.prop === p)!;
      expect(seconds(d.value.replace('!important', ''))).toBeLessThanOrEqual(0.01);
    }
  });
});

describe('StatusPill: no pill-shaped everything (#477)', () => {
  const pill = RULES.ui.find((r) => r.selectors.includes('.ui-pill'))!;
  const get = (p: string) => pill.decls.find((d) => d.prop === p)?.value;

  it('radius is 2 to 6px', () => {
    const px = Number.parseFloat(resolve(get('border-radius')!));
    expect(px).toBeGreaterThanOrEqual(2);
    expect(px).toBeLessThanOrEqual(MAX_RADIUS_PX);
  });

  it('label is set in IBM Plex Mono at a loaded weight (Mono ships 400/500)', () => {
    expect(get('font-family')).toBe('var(--font-mono)');
    expect(['400', '500']).toContain(get('font-weight'));
  });

  it('status-to-label map is unchanged', () => {
    const expected: Record<string, string> = {
      unmatched: 'Unmatched', scheduled: 'Scheduled', picked_up: 'Picked up', at_hub: 'At hub',
      out_for_delivery: 'Out for delivery', delivered: 'Delivered', assigned: 'Assigned',
      in_progress: 'In progress', completed: 'Completed', direct: 'Direct', relay: 'Relay',
    };
    for (const [s, label] of Object.entries(expected)) expect(statusLabel(s as PillStatus)).toBe(label);
  });
});
