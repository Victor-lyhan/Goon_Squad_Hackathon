// #895: one keyboard focus ring and one reduced-motion rule for the whole app. Read from the CSS files:
//   1. tokens.css has the ring's colour, its colour on a dark ground, and its offset. The first is the
//      primary of docs/mvp3.md and is 3:1 or more on the light surfaces; the second is 3:1 or more on ink
//      (the homepage hero) and on the map pills over a day map and over a night map;
//   2. global.css has one bare `:focus-visible` rule that draws a 2px outline from those tokens and nothing
//      else, one weak rule that turns it white on the dark grounds, every other focus rule in the file uses
//      the same tokens, and no rule in the two files removes an outline without drawing a replacement;
//   3. global.css has one `prefers-reduced-motion: reduce` block that ends every CSS animation and
//      transition at once (near zero, not `none`).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const read = (p: string) => strip(readFileSync(p, 'utf8'));
const GLOBAL = 'client/src/styles/global.css';
const TOKENS = 'client/src/styles/tokens.css';
/** The dark grounds that global.css names, and the stylesheet that draws each. */
const DARK_GROUNDS: Record<string, string> = {
  '.landing-hero': 'client/src/styles/landing.css',
  '.spc-playbar': 'client/src/components/sim/v2/compose/compose.css',
  '.ml': 'client/src/components/sim/v2/legend/legend.css',
};
/** The two that are translucent ink over the map, so their ground is lighter over a day map. */
const MAP_PILLS = ['.spc-playbar', '.ml'];

// ---- tiny CSS walker: rules with the at-rules around them; @keyframes and @import are skipped ----
type Decl = { prop: string; value: string };
type Rule = { selectors: string[]; decls: Decl[]; at: string[] };
/** Split on commas that are not inside parentheses. */
function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}
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
    const prelude = css.slice(i, open).trim().replace(/\s+/g, ' ');
    const inner = css.slice(open + 1, j - 1);
    if (prelude.startsWith('@')) {
      if (!prelude.startsWith('@keyframes')) out.push(...parse(inner, [...at, prelude]));
    } else {
      const decls = inner.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
        const k = d.indexOf(':');
        return { prop: d.slice(0, k).trim().toLowerCase(), value: d.slice(k + 1).trim().replace(/\s+/g, ' ') };
      });
      out.push({ selectors: splitTop(prelude), decls, at });
    }
    i = j;
  }
  return out;
}
const value = (r: Rule, prop: string) => r.decls.find((d) => d.prop === prop)?.value;

const globalRules = parse(read(GLOBAL));
const tokenRules = parse(read(TOKENS));
const root = tokenRules.find((r) => r.selectors.includes(':root'))!;
const raw = (name: string): string => {
  const v = value(root, name);
  if (v === undefined) throw new Error(`${name} is not in tokens.css`);
  return v;
};
const token = (name: string): string => {
  const ref = /^var\((--[\w-]+)\)$/.exec(raw(name));
  return ref ? token(ref[1]) : raw(name);
};

// ---- WCAG 2.x contrast ----
type RGB = [number, number, number];
const rgb = (hex: string): RGB => {
  expect(hex, hex).toMatch(/^#[0-9a-f]{6}$/i);
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lum = (c: RGB) => {
  const [r, g, b] = c.map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** `colour` at `share` (0 to 1) over a flat grey `under` (0 = black, 255 = white). */
const over = (colour: RGB, share: number, under: number): RGB => colour.map((c) => c * share + under * (1 - share)) as RGB;

describe('the focus-ring tokens in tokens.css (#895)', () => {
  it('--focus-ring is the primary of docs/mvp3.md, --focus-ring-on-dark is the white of the panels', () => {
    expect(raw('--focus-ring')).toBe('var(--accent)');
    expect(raw('--focus-ring-on-dark')).toBe('var(--panel)');
    expect(token('--focus-ring')).toBe('#1D5075');
    expect(token('--focus-ring-on-dark')).toBe('#FFFFFF');
  });

  it('--focus-ring-offset puts the ring outside the control, with a small gap', () => {
    expect(raw('--focus-ring-offset')).toMatch(/^\d+px$/);
    const offset = Number.parseFloat(raw('--focus-ring-offset'));
    expect(offset).toBeGreaterThanOrEqual(1);
    expect(offset).toBeLessThanOrEqual(4);
  });

  for (const surface of ['--bg', '--panel', '--accent-soft']) {
    it(`the ring is at least 3:1 on the light surface ${surface}`, () => {
      expect(contrast(rgb(token('--focus-ring')), rgb(token(surface)))).toBeGreaterThanOrEqual(3);
    });
  }

  it('the ring on a dark ground is at least 3:1 on ink, the ground of the homepage hero', () => {
    expect(contrast(rgb(token('--focus-ring-on-dark')), rgb(token('--text')))).toBeGreaterThanOrEqual(3);
  });

  for (const pill of MAP_PILLS) {
    it(`the ring on a dark ground is at least 3:1 on ${pill}, over a day map and over a night map`, () => {
      const rule = parse(read(DARK_GROUNDS[pill])).find((r) => r.at.length === 0 && r.selectors.includes(pill))!;
      expect(rule, pill).toBeDefined();
      // The pill is the ink, part see-through, over the map: lightest over a white map, darkest over a black one.
      const m = /^color-mix\(in srgb, var\(--text(?:, #171C24)?\) (\d+)%, transparent\)$/.exec(value(rule, 'background') ?? '');
      expect(m, value(rule, 'background')).not.toBeNull();
      const share = Number(m![1]) / 100;
      const ring = rgb(token('--focus-ring-on-dark'));
      expect(contrast(ring, over(rgb(token('--text')), share, 255))).toBeGreaterThanOrEqual(3);
      expect(contrast(ring, over(rgb(token('--text')), share, 0))).toBeGreaterThanOrEqual(3);
    });
  }

  it('the helpers give known values', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(over([0, 0, 0], 0.5, 255)).toEqual([127.5, 127.5, 127.5]);
    expect(splitTop(':where(.a, .b) :focus-visible, .c')).toEqual([':where(.a, .b) :focus-visible', '.c']);
  });
});

// ---- focus rules ----
const isFocus = (r: Rule) => r.selectors.some((s) => /:focus(-visible|-within)?\b/.test(s));
const RING_COLOURS = ['var(--focus-ring)', 'var(--focus-ring-on-dark)'];

/** Problems of the focus rules of a stylesheet: a ring that does not come from the tokens. */
function ringProblems(rules: Rule[]): string[] {
  const problems: string[] = [];
  for (const r of rules.filter(isFocus)) {
    const where = r.selectors.join(', ');
    for (const d of r.decls) {
      if (d.prop === 'outline' && !/^\d+px solid var\(--focus-ring\)$/.test(d.value)) problems.push(`${where}: outline ${d.value}`);
      if (d.prop === 'outline-color' && !RING_COLOURS.includes(d.value)) problems.push(`${where}: outline-color ${d.value}`);
      if (d.prop === 'outline-offset' && d.value !== 'var(--focus-ring-offset)') problems.push(`${where}: outline-offset ${d.value}`);
      if (d.prop === 'outline-width' && Number.parseFloat(d.value) < 2) problems.push(`${where}: outline-width ${d.value}`);
      if (d.prop === 'outline-style' && d.value !== 'solid') problems.push(`${where}: outline-style ${d.value}`);
    }
  }
  return problems;
}

/** Rules that remove an outline and draw nothing in its place (a box-shadow or a border in the same rule). */
function removedOutlines(rules: Rule[]): string[] {
  const gone = (d: Decl) =>
    (d.prop === 'outline' && /^0(px)?(\s|$)|\bnone\b/.test(d.value))
    || (d.prop === 'outline-style' && d.value === 'none')
    || (d.prop === 'outline-width' && /^0(px)?$/.test(d.value));
  const drawn = (r: Rule) => r.decls.some((d) => (d.prop === 'box-shadow' || /^border(-color)?$/.test(d.prop)) && !/^(none|0)$/.test(d.value));
  return rules.filter((r) => r.decls.some(gone) && !drawn(r)).map((r) => r.selectors.join(', '));
}

describe('the app-wide :focus-visible rule in global.css (#895)', () => {
  const bare = globalRules.filter((r) => r.selectors.includes(':focus-visible'));

  it('there is exactly one, for every element, outside any media query', () => {
    expect(bare).toHaveLength(1);
    expect(bare[0].selectors).toEqual([':focus-visible']);
    expect(bare[0].at).toEqual([]);
  });

  it('it draws a solid outline of 2px or more in --focus-ring, offset by --focus-ring-offset', () => {
    const m = /^(\d+)px solid var\(--focus-ring\)$/.exec(value(bare[0], 'outline') ?? '');
    expect(m, value(bare[0], 'outline')).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(2);
    expect(value(bare[0], 'outline-offset')).toBe('var(--focus-ring-offset)');
  });

  it('it is an outline only: no box-shadow, which a component with its own outline would keep', () => {
    expect(bare[0].decls.map((d) => d.prop).sort()).toEqual(['border-radius', 'outline', 'outline-offset']);
  });

  it('every other focus rule in global.css takes its ring from the same tokens', () => {
    expect(globalRules.filter(isFocus).length).toBeGreaterThanOrEqual(4);
    expect(ringProblems(globalRules)).toEqual([]);
  });

  it('the picker button of a time or date field, a tab stop no :focus-visible rule reaches, gets the same ring', () => {
    // A rule of its own: a browser that does not know the pseudo-element drops this rule and no other.
    const picker = globalRules.find((r) => r.selectors.some((s) => s.includes('::-webkit-calendar-picker-indicator')))!;
    expect(picker.selectors).toEqual(['input:focus-within:not(:focus)::-webkit-calendar-picker-indicator']);
    expect(picker.at).toEqual([]);
    expect(value(picker, 'outline')).toBe(value(bare[0], 'outline'));
    expect(value(picker, 'outline-offset')).toBe(value(bare[0], 'outline-offset'));
  });

  it('no rule in global.css or tokens.css removes an outline without drawing a replacement', () => {
    expect(removedOutlines(globalRules)).toEqual([]);
    expect(removedOutlines(tokenRules)).toEqual([]);
  });

  it('the checkers catch known-bad samples', () => {
    const bad = parse(`.a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .b:focus { outline: none; } .c:focus-visible { outline: 0; } .d { outline-style: none; }
      .e:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--focus-ring); }
      .f:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-ring-offset); }
      .g:focus-visible { outline-color: var(--accent-dark); } .h:focus-visible { outline-color: var(--focus-ring-on-dark); }`);
    const ring = ringProblems(bad).join('\n');
    for (const s of ['.a:focus-visible: outline 2px solid var(--accent)', '.a:focus-visible: outline-offset 2px', '.b:focus: outline none', '.g:focus-visible: outline-color var(--accent-dark)']) {
      expect(ring).toContain(s);
    }
    expect(ring).not.toContain('.f:focus-visible');
    expect(ring).not.toContain('.h:focus-visible');
    expect(removedOutlines(bad)).toEqual(['.b:focus', '.c:focus-visible', '.d']);
  });
});

describe('the ring on a dark ground in global.css (#895)', () => {
  const onDark = globalRules.filter((r) => r.decls.some((d) => d.value.includes('--focus-ring-on-dark')));

  it('one rule changes only the colour of the ring, after the app-wide rule', () => {
    expect(onDark).toHaveLength(1);
    expect(onDark[0].at).toEqual([]);
    expect(onDark[0].decls).toEqual([{ prop: 'outline-color', value: 'var(--focus-ring-on-dark)' }]);
    const bareAt = globalRules.findIndex((r) => r.selectors.includes(':focus-visible'));
    expect(globalRules.indexOf(onDark[0])).toBeGreaterThan(bareAt);
  });

  it('every selector is as weak as the app-wide rule, so a component focus rule wins over it', () => {
    // Everything but the final :focus-visible is inside :where(), which adds nothing to the specificity.
    for (const s of onDark[0].selectors) expect(s, s).toMatch(/^:where\((?:[^()]|\([^()]*\))*\) ?:focus-visible$/);
  });

  it('it covers controls inside the hero, the Play pill and the legend, and the main area of the homepage', () => {
    const inside = onDark[0].selectors.find((s) => / :focus-visible$/.test(s))!;
    expect(splitTop(/^:where\((.*)\) :focus-visible$/.exec(inside)![1]).sort()).toEqual(Object.keys(DARK_GROUNDS).sort());
    expect(onDark[0].selectors).toContain(':where(.app-main:has(.landing-hero)):focus-visible');
  });

  for (const [name, file] of Object.entries(DARK_GROUNDS)) {
    it(`${name} is still a class that ${file} draws`, () => {
      expect(parse(read(file)).some((r) => r.selectors.includes(name) && r.decls.some((d) => d.prop === 'background'))).toBe(true);
    });
  }
});

// ---- reduced motion ----
/** Longest time in a value, in milliseconds. */
const ms = (v: string) => Math.max(...[...v.matchAll(/(\d*\.?\d+)(ms|s)\b/g)].map((m) => Number(m[1]) * (m[2] === 's' ? 1000 : 1)));

describe('the app-wide reduced-motion rule in global.css (#895)', () => {
  const reduce = globalRules.filter((r) => r.at.some((a) => /prefers-reduced-motion\s*:\s*reduce/.test(a)));

  it('there is exactly one block, with one rule, for every element and its ::before and ::after', () => {
    expect(read(GLOBAL).match(/@media[^{]*prefers-reduced-motion/g)).toHaveLength(1);
    expect(reduce).toHaveLength(1);
    expect(reduce[0].at).toEqual(['@media (prefers-reduced-motion: reduce)']);
    expect(reduce[0].selectors).toEqual(['*', '*::before', '*::after']);
  });

  for (const prop of ['animation-duration', 'transition-duration']) {
    it(`${prop} is cut to 10ms or less, over every component rule, and is not zero`, () => {
      const v = value(reduce[0], prop)!;
      expect(v, prop).toMatch(/!important$/);
      expect(ms(v)).toBeLessThanOrEqual(10);
      // Not 0 and not `none`: the animation still lands on its last frame and its end events still fire.
      expect(ms(v)).toBeGreaterThan(0);
    });
  }

  it('a looping animation runs once, and scrolling is not smooth', () => {
    expect(value(reduce[0], 'animation-iteration-count')).toBe('1 !important');
    expect(value(reduce[0], 'scroll-behavior')).toBe('auto !important');
  });

  it('the rule does not switch animations or transitions off by name', () => {
    expect(reduce[0].decls.map((d) => d.prop).sort()).toEqual(['animation-duration', 'animation-iteration-count', 'scroll-behavior', 'transition-duration']);
  });
});
