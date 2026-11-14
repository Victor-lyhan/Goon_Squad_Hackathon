// #497: visual QA rules for every stylesheet of the Business workspace: tokens only, no shadows or
// gradients, works at 390 px. Since #684 the look is MVP III (docs/mvp3.md P4): radius at most 6 px and no
// MVP II fallback value; business-v2-mvp3-css.test.ts pins the colours, shadows and fonts in full.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCss, readTokens, v2CssFiles, type CssRule } from './employee-v2-qa-helpers';

const files = v2CssFiles('client/src/components/business/v2');
const tokens = readTokens();
const parsed: Array<[string, CssRule[]]> = files.map((f) => [f, parseCss(readFileSync(f, 'utf8'))]);

const MAX_RADIUS_PX = 6;
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

describe('business v2 CSS QA (#497)', () => {
  it('covers all six stylesheets', () => {
    expect(files.map((f) => f.replace(/^.*business\/v2\//, ''))).toEqual(expect.arrayContaining([
      'businessWorkspace.css', 'deliveryDetails.css', 'newDelivery.css', 'activity/activity.css', 'page/businessPage.css',
      'route/deliveryRoute.css',
    ]));
  });

  it('border-radius is at most 6 px', () => {
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

  // No MVP II fallback is accepted any more: this module had its restyle pass (#684).
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

  // Each file styles one class family (bw-, bd-, nd, ba-, bp). The reduced-motion block turns motion off
  // for every element of that family, its descendants and pseudo-elements, so a transition added later
  // anywhere in the file is covered too.
  const PREFIX: Record<string, string> = {
    'businessWorkspace.css': 'bw-', 'deliveryDetails.css': 'bd-', 'newDelivery.css': 'nd',
    'activity/activity.css': 'ba-', 'page/businessPage.css': 'bp', 'route/deliveryRoute.css': 'bdr',
  };
  const short = (f: string) => f.replace(/^.*business\/v2\//, '');
  const SHELL_WIDTH_SELECTOR = '.app-main:has(.bp)';

  it('every class in a stylesheet belongs to its family', () => {
    for (const [file, rules] of parsed) {
      const prefix = PREFIX[short(file)];
      expect(prefix, file).toBeTruthy();
      for (const r of rules) {
        // The one rule about the shell: the Business page widens the shell's <main> around itself (#581).
        if (short(file) === 'page/businessPage.css' && r.selector === SHELL_WIDTH_SELECTOR) {
          expect(r.decls).toEqual([{ prop: 'max-width', value: '1320px' }]);
          continue;
        }
        for (const [, cls] of r.selector.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
          expect(cls.startsWith(prefix), `${file}: .${cls} is outside ${prefix}`).toBe(true);
        }
      }
    }
  });

  it('under prefers-reduced-motion: reduce nothing animates or transitions', () => {
    for (const [file, rules] of parsed) {
      const prefix = PREFIX[short(file)];
      const fam = `[class*='${prefix}']`;
      const block = rules.find((r) => reducedMotion(r)
        && [fam, `${fam} *`, `${fam}::before`, `${fam}::after`].every((s) => r.selector.split(',').map((x) => x.trim()).includes(s))
        && r.decls.some((d) => d.prop === 'animation' && /^none/.test(d.value))
        && r.decls.some((d) => d.prop === 'transition' && /^none/.test(d.value)));
      expect(block, `${file} needs a reduced-motion block for ${fam}`).toBeTruthy();
      for (const d of block!.decls) expect(d.value, where(file, block!, d)).toMatch(/!important$/);
      for (const r of rules) for (const d of r.decls) {
        if (d.prop === 'scroll-behavior' && !reducedMotion(r)) expect(d.value, where(file, r, d)).not.toBe('smooth');
        // An animation or transition outside the block must be on an element of the family.
        if (/^(animation|transition)/.test(d.prop) && !reducedMotion(r)) {
          expect(r.selector.split(',').every((x) => x.includes(`.${prefix}`)), where(file, r, d)).toBe(true);
        }
      }
    }
  });

  it('the stacked table at 640 px and below: header hidden until a sort button has focus, no sideways scroll', () => {
    const rules = parsed.find(([f]) => f.endsWith('businessWorkspace.css'))![1];
    const narrow = rules.filter((r) => r.media.some((m) => /max-width:\s*640px/.test(m)));
    const has = (sel: string, prop: string, value: RegExp) => narrow.some((r) =>
      r.selector.split(',').map((x) => x.trim()).includes(sel) && r.decls.some((d) => d.prop === prop && value.test(d.value)));
    expect(has('.bw-table', 'display', /^block$/)).toBe(true);
    expect(has('.bw-table tr', 'display', /^block$/)).toBe(true);
    expect(has('.bw-table td', 'display', /^(block|grid)$/)).toBe(true);
    expect(has('.bw-table td::before', 'content', /attr\(data-label\)/)).toBe(true);
    expect(has('.bw-table-wrap', 'overflow-x', /^hidden$/)).toBe(true);
    expect(has('.bw-table thead', 'clip', /rect/)).toBe(true);
    expect(has('.bw-table thead:focus-within', 'clip', /^auto$/)).toBe(true);
    expect(has('.bw-table thead:focus-within', 'position', /^static$/)).toBe(true);
    // No overflow-x: auto/scroll at the stacked width: the table stacks, it does not scroll sideways.
    // Above it (inside a min-width query) the table's own box may scroll, so the page never does (#581).
    for (const [file, rs] of parsed) for (const r of rs) for (const d of r.decls) {
      if (r.media.some((m) => /min-width/.test(m))) continue;
      if (d.prop === 'overflow-x' || d.prop === 'overflow') expect(d.value, where(file, r, d)).not.toMatch(/auto|scroll/);
    }
  });
});
