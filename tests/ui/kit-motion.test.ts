import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FILES = ['client/src/styles/global.css', 'client/src/ui/ui.css', 'client/src/ui/shell.css'];
const read = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// ---- tiny CSS walker: returns rules with their enclosing at-rule prelude ----
interface Rule { selectors: string[]; body: string; at: string[] }
function parse(css: string, at: string[] = []): Rule[] {
  const out: Rule[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    let depth = 1, j = open + 1;
    while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    const prelude = css.slice(i, open).trim();
    const inner = css.slice(open + 1, j - 1);
    if (prelude.startsWith('@')) {
      if (!prelude.startsWith('@keyframes')) out.push(...parse(inner, [...at, prelude]));
    } else {
      out.push({ selectors: prelude.split(',').map((s) => s.trim()), body: inner, at });
    }
    i = j;
  }
  return out;
}
const isReduce = (r: Rule) => r.at.some((a) => /prefers-reduced-motion\s*:\s*reduce/.test(a));
const hasMotion = (body: string) => /(^|[;\s])(transition|animation)(-[a-z-]+)?\s*:/.test(body);

// ---- contrast helper (WCAG 2.x) ----
function lum(hex: string): number {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h, 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function tokens(): Record<string, string> {
  const css = read(FILES[0]);
  const root = css.match(/:root\s*\{([^}]*)\}/)![1];
  return Object.fromEntries([...root.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6})/g)].map((m) => [m[1], m[2]]));
}

describe('reduced motion', () => {
  for (const file of FILES) {
    it(`${file}: every transition/animation has a reduced-motion override`, () => {
      const rules = parse(read(file));
      const reduce = rules.filter(isReduce);
      const blanket = reduce.some((r) => r.selectors.includes('*') && /animation-duration\s*:/.test(r.body) && /transition-duration\s*:/.test(r.body));
      const reduced = new Set(reduce.filter((r) => hasMotion(r.body)).flatMap((r) => r.selectors));
      const missing = rules
        .filter((r) => !isReduce(r) && hasMotion(r.body))
        .flatMap((r) => r.selectors)
        .filter((s) => !blanket && !reduced.has(s));
      expect(missing).toEqual([]);
    });
    it(`${file}: reduced-motion overrides are none/near-zero`, () => {
      for (const r of parse(read(file)).filter(isReduce)) {
        for (const m of r.body.matchAll(/(transition|animation)(-duration)?\s*:\s*([^;}]+)/g)) {
          const v = m[3].trim();
          expect(v === 'none' || /^\.001ms/.test(v) || /^0(s|ms)?\b/.test(v), `${r.selectors}: ${m[0]}`).toBe(true);
        }
      }
    });
  }
  it('smooth scrolling is never enabled outside reduced-motion safeguards', () => {
    const css = FILES.map(read).join('\n');
    const rules = FILES.flatMap((f) => parse(read(f)));
    if (/scroll-behavior\s*:\s*smooth/.test(css)) {
      expect(rules.some((r) => isReduce(r) && /scroll-behavior\s*:\s*auto/.test(r.body))).toBe(true);
    }
    expect(rules.some((r) => isReduce(r) && /scroll-behavior\s*:\s*auto/.test(r.body))).toBe(true);
  });
});

describe('focus rings and text contrast', () => {
  const t = tokens();
  const surfaces = [t.bg, t.panel, '#ffffff'];
  it('global :focus-visible outline is >= 2px', () => {
    const rule = parse(read(FILES[0])).find((r) => r.selectors.includes(':focus-visible'))!;
    expect(Number(/outline:\s*(\d+)px/.exec(rule.body)![1])).toBeGreaterThanOrEqual(2);
  });
  it('kit focus rings cover buttons, drawer close, inputs and selects at >= 2px', () => {
    const rule = parse(read(FILES[1])).find((r) => r.selectors.includes('.ui-btn:focus-visible'))!;
    for (const s of ['.ui-drawer__close:focus-visible', '.ui-field input:focus-visible', '.ui-field select:focus-visible']) {
      expect(rule.selectors).toContain(s);
    }
    expect(Number(/outline:\s*(\d+)px/.exec(rule.body)![1])).toBeGreaterThanOrEqual(2);
  });
  it('focus colours reach 3:1 on every surface', () => {
    for (const bg of surfaces) {
      expect(contrast(t.accent, bg)).toBeGreaterThanOrEqual(3);
    }
    expect(contrast('#7dd3d8', '#1e293b')).toBeGreaterThanOrEqual(3); // toast button ring
  });
  it('body text tokens reach 4.5:1', () => {
    for (const bg of surfaces) {
      expect(contrast(t.navy, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.muted, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['accent-dark'], bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast('#ffffff', t.accent)).toBeGreaterThanOrEqual(4.5); // primary button label
    expect(contrast('#ffffff', t['accent-dark'])).toBeGreaterThanOrEqual(4.5);
  });
});
