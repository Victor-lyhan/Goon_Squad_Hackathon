// #478: visual QA rules for every stylesheet of the MVP II Employee workspace
// (docs/mvp2-ui-redesign.md §2: square corners, no shadows or gradients, tokens only, works at 390 px).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCss, readTokens, v2CssFiles, type CssRule } from './employee-v2-qa-helpers';

const files = v2CssFiles();
const tokens = readTokens();
const parsed: Array<[string, CssRule[]]> = files.map((f) => [f, parseCss(readFileSync(f, 'utf8'))]);

const MAX_RADIUS_PX = 4;
const MAX_FIXED_WIDTH_PX = 358; // 390 px screen minus 2 × 16 px padding
const COLOR_PROPS = /^(color|background(-color)?|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|box-shadow|accent-color|caret-color|fill|stroke|text-decoration(-color)?|column-rule(-color)?)$/;
const NAMED_COLOR = /\b(white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|navy|teal|maroon|olive|lime|aqua|fuchsia|pink|brown|gold|tan|beige|ivory|coral|salmon|crimson|indigo|violet)\b/i;
const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const VAR_RE = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g;

const where = (file: string, r: CssRule, d: { prop: string; value: string }) =>
  `${file}: ${r.media.length ? `${r.media.join(' ')} ` : ''}${r.selector} { ${d.prop}: ${d.value} }`;
const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, '');
const isFocusSelector = (s: string) => s.split(',').every((p) => /:focus(-visible)?\b/.test(p));
const reducedMotion = (r: CssRule) => r.media.some((m) => /prefers-reduced-motion:\s*reduce/.test(m));

describe('employee v2 CSS QA (#478)', () => {
  it('covers all six stylesheets', () => {
    expect(files.map((f) => f.replace(/^.*employee\/v2\//, ''))).toEqual(expect.arrayContaining([
      'AddressSearch.css', 'CommuteForm.css', 'EmployeeWorkspace.css', 'JobDetailV2.css',
      'page/employeePage.css', 'route/commuteRoute.css',
    ]));
  });

  it('border-radius is at most 4 px', () => {
    const bad: string[] = [];
    for (const [file, rules] of parsed) for (const r of rules) for (const d of r.decls) {
      if (!d.prop.includes('radius')) continue;
      const value = d.value.replace(VAR_RE, (_, name: string, fb?: string) => {
        if (!['--radius', '--radius-lg'].includes(name)) bad.push(`${where(file, r, d)} (not a radius token)`);
        return fb ?? '';
      });
      const px = [...value.matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
      if (px.some((n) => n > MAX_RADIUS_PX) || /%|\d(r?em)\b/.test(value)) bad.push(where(file, r, d));
    }
    expect(bad).toEqual([]);
  });

  it('box-shadow only as a focus ring', () => {
    const bad: string[] = [];
    for (const [file, rules] of parsed) for (const r of rules) for (const d of r.decls) {
      if (d.prop === 'box-shadow' && d.value !== 'none' && !isFocusSelector(r.selector)) bad.push(where(file, r, d));
    }
    expect(bad).toEqual([]);
  });

  it('no gradients', () => {
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/gradient\(/i);
  });

  it('no fixed width or min-width above 358 px outside a min-width media query', () => {
    const bad: string[] = [];
    for (const [file, rules] of parsed) for (const r of rules) {
      if (r.media.some((m) => /min-width/.test(m))) continue;
      for (const d of r.decls) {
        if (d.prop !== 'width' && d.prop !== 'min-width') continue;
        const px = [...d.value.matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
        if (px.some((n) => n > MAX_FIXED_WIDTH_PX) || /\d(r?em|vw)\b/.test(d.value)) bad.push(where(file, r, d));
      }
    }
    expect(bad).toEqual([]);
  });

  it('every var() is a design token, and a colour fallback equals that token', () => {
    const bad: string[] = [];
    for (const [file, rules] of parsed) for (const r of rules) for (const d of r.decls) {
      for (const [, name, fb] of d.value.matchAll(VAR_RE)) {
        const token = tokens.get(name);
        if (token === undefined) { bad.push(`${where(file, r, d)} (${name} is not in tokens.css)`); continue; }
        if (fb && (COLOR_LITERAL.test(fb) || NAMED_COLOR.test(fb)) && norm(fb) !== norm(token)) {
          bad.push(`${where(file, r, d)} (${name} is ${token}, fallback ${fb})`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('no colour outside a token', () => {
    const bad: string[] = [];
    for (const [file, rules] of parsed) for (const r of rules) for (const d of r.decls) {
      const rest = d.value.replace(VAR_RE, '');
      if (COLOR_LITERAL.test(rest)) bad.push(where(file, r, d));
      else if (COLOR_PROPS.test(d.prop) && NAMED_COLOR.test(rest)) bad.push(where(file, r, d));
    }
    expect(bad).toEqual([]);
  });

  it('under prefers-reduced-motion: reduce nothing animates or transitions', () => {
    for (const [file, rules] of parsed) {
      const root = rules[0].selector.match(/^\.[\w-]+/)?.[0];
      expect(root, file).toBeTruthy();
      const off = rules.filter((r) => reducedMotion(r)
        && r.selector.split(',').map((s) => s.trim()).includes(`${root} *`)
        && r.decls.some((d) => d.prop === 'animation' && /^none/.test(d.value))
        && r.decls.some((d) => d.prop === 'transition' && /^none/.test(d.value)));
      expect(off.length, `${file} needs a reduced-motion block for ${root} *`).toBeGreaterThan(0);
      // No animation is declared anywhere else that the block could miss (e.g. on ::before of another root).
      for (const r of rules) for (const d of r.decls) {
        if (/^(animation|transition)/.test(d.prop) && !reducedMotion(r)) {
          expect(r.selector.startsWith(root!) || r.selector.includes(` ${root}`), where(file, r, d)).toBe(true);
        }
        if (d.prop === 'scroll-behavior') expect(d.value, where(file, r, d)).not.toBe('smooth');
      }
    }
  });

  it('the route preview map is capped at 240 px tall at 390 px wide (320 px on desktop)', () => {
    const rules = parsed.find(([f]) => f.endsWith('commuteRoute.css'))![1];
    const heights = (pred: (r: CssRule) => boolean) => rules
      .filter((r) => r.selector.split(',').map((s) => s.trim()).includes('.ecr__map') && pred(r))
      .flatMap((r) => r.decls.filter((d) => d.prop === 'height' || d.prop === 'max-height'));
    const narrow = heights((r) => r.media.some((m) => {
      const w = m.match(/max-width:\s*(\d+)px/);
      return !!w && Number(w[1]) >= 390;
    }));
    expect(narrow.map((d) => d.value)).toContain('240px');
    for (const d of narrow) expect(Number.parseInt(d.value, 10)).toBeLessThanOrEqual(240);
    expect(heights((r) => r.media.length === 0).map((d) => d.value)).toContain('320px');
  });
});
