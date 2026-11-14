// Visual QA for the assembled MVP II simulator page (#511, M9): compose/compose.css and
// page/page.css against docs/mvp2-ui-redesign.md "Visual direction (design tokens)", with the same
// rules sim-v2-qa-css.test.ts applies to the other simulator pieces (#479 left these two files out):
// radius 2 to 4 px, no gradients, no decorative shadows, colours only from the tokens, every var()
// a real token with its own fallback, a visible :focus-visible style for every control the page
// renders, and every transition or animation switched off under prefers-reduced-motion: reduce.
import { describe, expect, it } from 'vitest';
import { NARROW_QUERY } from '../../client/src/components/sim/v2/page/simPageState';
import {
  ALLOWED_COLORS, COLOR_PROPS, FOCUS_SELECTORS, LOCAL_VARS, NAMED_COLORS, TOKENS,
  colorLiterals, key, parseCss, read, resolveVars, splitTop, where, type Rule,
} from './sim-v2-qa-css-rules';
import { isMvp2Fallback } from './kit-v2-legacy-tokens';

const COMPOSE = 'client/src/components/sim/v2/compose/compose.css';
const PAGE = 'client/src/components/sim/v2/page/page.css';
const FILES = [COMPOSE, PAGE];
const RULES: Rule[] = FILES.flatMap((f) => parseCss(read(f), f));
const decls = (r: Rule, prop: string) => r.decls.filter(([p]) => p === prop).map(([, v]) => v);

describe('compose.css + page.css: the redesign rules', () => {
  it('reads both files and finds rules in each', () => {
    for (const f of FILES) expect(RULES.some((r) => r.file === f), f).toBe(true);
    expect(TOKENS.get('--radius')).toBeDefined();
  });

  it('every border-radius is 2 to 4px (square corners, never 0 or round)', () => {
    const bad: string[] = [];
    let seen = 0;
    for (const r of RULES) {
      for (const [prop, value] of r.decls) {
        if (!prop.includes('radius')) continue;
        seen += 1;
        for (const part of resolveVars(value).split(/[\s/]+/).filter(Boolean)) {
          const px = Number(/^(\d*\.?\d+)px$/.exec(part)?.[1] ?? NaN);
          if (!(px >= 2 && px <= 4)) bad.push(`${where(r)}: ${value}`);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  it('no gradients, no filters or backdrops', () => {
    for (const f of FILES) {
      const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css, f).not.toMatch(/gradient\(/i);
      expect(css, f).not.toMatch(/(^|[\s;{])(filter|backdrop-filter)\s*:/);
    }
  });

  it('no shadows except a focus ring on :focus-visible', () => {
    const bad: string[] = [];
    for (const r of RULES) {
      for (const prop of ['box-shadow', 'text-shadow']) {
        for (const value of decls(r, prop)) {
          if (value === 'none') continue;
          const ring = prop === 'box-shadow' && /^0 0 0 \d+px\b/.test(value) && splitTop(value, ',').length === 1;
          if (!ring || !r.selectors.every((s) => s.includes(':focus-visible'))) bad.push(`${where(r)}: ${prop}: ${value}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('every colour is a token from tokens.css or a map layer constant; no named colours', () => {
    const bad: string[] = [];
    for (const r of RULES) {
      for (const [prop, value] of r.decls) {
        for (const c of colorLiterals(value)) {
          if (!c.rgb || !ALLOWED_COLORS.has(key(c.rgb))) bad.push(`${where(r)}: ${prop}: ${c.text}`);
        }
        if (COLOR_PROPS.test(prop) && NAMED_COLORS.test(value.replace(/var\([^)]*\)/g, ''))) bad.push(`${where(r)}: ${prop}: ${value}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('every colour property reads a token through var(), never a bare literal', () => {
    const bad: string[] = [];
    for (const r of RULES) {
      for (const [prop, value] of r.decls) {
        if (!/^(color|background(-color)?|border(-\w+)?-color|outline-color)$/.test(prop)) continue;
        if (/^(transparent|inherit|currentcolor)$/i.test(value)) continue;
        if (!/^var\(--[\w-]+/.test(value)) bad.push(`${where(r)}: ${prop}: ${value}`);
      }
    }
    expect(bad).toEqual([]);
  });

  // A fallback may still be the MVP II value until this module's restyle pass (kit-v2-legacy-tokens.ts, #651).
  it('every var() names a real token, and a fallback equals the token value', () => {
    const bad: string[] = [];
    for (const r of RULES) {
      for (const [prop, value] of r.decls) {
        for (const m of value.matchAll(/var\((--[\w-]+)\s*(?:,\s*([^)]*))?\)/g)) {
          const [, name, fallback] = m;
          if (LOCAL_VARS.has(name)) continue;
          const token = TOKENS.get(name);
          if (token === undefined) { bad.push(`${where(r)}: ${prop}: unknown ${name}`); continue; }
          if (fallback === undefined || name.startsWith('--font-')) continue;
          const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
          if (norm(fallback) !== norm(token) && !isMvp2Fallback(name, fallback)) bad.push(`${where(r)}: ${prop}: ${name} fallback ${fallback} ≠ ${token}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('borders are 1px, except the error and playing-step accents on the left edge', () => {
    const bad: string[] = [];
    for (const r of RULES) {
      for (const [prop, value] of r.decls) {
        if (!/^border(-(top|right|bottom|left))?(-width)?$/.test(prop)) continue;
        const widths = [...value.matchAll(/(\d+)px/g)].map((m) => Number(m[1]));
        const leftAccent = prop === 'border-left-width' && widths.every((w) => w <= 4);
        if (!leftAccent && widths.some((w) => w !== 1)) bad.push(`${where(r)}: ${prop}: ${value}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('never removes the focus outline without a replacement', () => {
    for (const r of RULES) {
      for (const [prop, value] of r.decls) {
        if (prop === 'outline' && /^(none|0)$/.test(value)) {
          expect(r.decls.some(([p]) => p === 'box-shadow'), where(r)).toBe(true);
        }
      }
    }
  });
});

describe('compose.css + page.css: reduced motion', () => {
  const moving = (d: [string, string][]) =>
    d.filter(([p, v]) => /^(transition|animation)(-name|-duration)?$/.test(p) && !/^(none|0s?)$/.test(v));

  it('every rule that animates or transitions is switched off under prefers-reduced-motion: reduce', () => {
    const bad: string[] = [];
    for (const r of RULES.filter((x) => !x.media?.includes('prefers-reduced-motion'))) {
      for (const [prop] of moving(r.decls)) {
        const kind = prop.startsWith('transition') ? 'transition' : 'animation';
        const off = RULES.some((o) =>
          o.file === r.file
          && /prefers-reduced-motion:\s*reduce/.test(o.media ?? '')
          && r.selectors.every((s) => o.selectors.includes(s))
          && o.decls.some(([p, v]) => p === kind && v === 'none'));
        if (!off) bad.push(`${where(r)}: ${prop}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('nothing under reduced motion turns motion back on', () => {
    for (const r of RULES.filter((x) => x.media?.includes('prefers-reduced-motion'))) expect(moving(r.decls), where(r)).toEqual([]);
  });

  it('no keyframes and no scroll-behavior: smooth (the page itself does not move)', () => {
    for (const f of FILES) {
      const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css, f).not.toMatch(/@keyframes/);
      expect(css, f).not.toMatch(/scroll-behavior\s*:\s*smooth/);
    }
  });
});

// ---------- :focus-visible for every control the page files render ----------
/** Focus rules of the two page files plus the ones they build on (sim pieces, the UI kit's Button). */
const uiRules = parseCss(read('client/src/ui/ui.css'), 'client/src/ui/ui.css');
const visibleFocus = (rules: Rule[]) => new Set(
  rules.flatMap((r) => r.selectors
    .filter((s) => s.endsWith(':focus-visible'))
    .filter(() => r.decls.some(([p, v]) => (p === 'outline' && !/^(none|0)$/.test(v)) || p === 'box-shadow'))
    .map((s) => s.replace(/:focus-visible$/, ''))),
);
const PAGE_FOCUS = visibleFocus(RULES);
const ALL_FOCUS = new Set([...FOCUS_SELECTORS, ...PAGE_FOCUS, ...visibleFocus(uiRules)]);

/**
 * Every control rendered by compose/ and page/ with its classes (read from the source below):
 * at least one of them has a :focus-visible rule. `own` = the rule lives in compose.css or page.css.
 */
const PAGE_CONTROLS: { control: string; classes: string[]; own: boolean }[] = [
  { control: 'Back to network (right panel)', classes: ['.sw-btn', '.spc-back'], own: false },
  { control: 'Dismiss (failed action)', classes: ['.sw-btn'], own: false },
  { control: 'Play / Pause and Back to start (controls/PlaybackControls.tsx)', classes: ['.ctl-btn'], own: false },
  { control: 'Retry (503 and error screens)', classes: ['.ui-btn'], own: false },
  { control: 'Choose a workspace (desktop-only notice)', classes: ['.sim-desktop-notice a'], own: true },
];

describe('compose.css + page.css: keyboard focus', () => {
  it('the control classes listed above are the ones the source renders', () => {
    const body = read('client/src/components/sim/v2/compose/SimPageBody.tsx');
    const play = read('client/src/components/sim/v2/controls/PlaybackControls.tsx');
    const card = read('client/src/components/sim/v2/compose/OvernightCard.tsx');
    const notice = read('client/src/components/sim/v2/page/DesktopOnlyNotice.tsx');
    expect(body).toContain('className="sw-btn spc-back"');
    expect(body).toMatch(/className="sw-btn" onClick=\{handlers\.dismissActionError\}/);
    expect(body).toMatch(/<Button variant="secondary" onClick=\{onRetry\}>Retry<\/Button>/);
    // #648: the one Play/Pause button and "Back to start", both `.ctl-btn`; the overnight card has no control.
    expect(play.match(/className="ctl-btn[ "]/g)).toHaveLength(2);
    expect(card).not.toMatch(/<(button|a|input|select|textarea)\b/);
    expect(notice).toMatch(/<a href="\/">Choose a workspace<\/a>/);
    // No other raw interactive element in these files.
    for (const src of [body, play, notice]) {
      expect((src.match(/<(button|a|input|select|textarea)\b/g) ?? []).length).toBeLessThanOrEqual(2);
    }
  });

  it.each(PAGE_CONTROLS)('$control has a visible :focus-visible style', ({ classes, own }) => {
    expect(classes.some((c) => ALL_FOCUS.has(c)), classes.join(' ')).toBe(true);
    if (own) expect(classes.some((c) => PAGE_FOCUS.has(c))).toBe(true);
  });

  it('the focus rings in these files are the accent colour, 2px', () => {
    const rings = RULES.filter((x) => x.selectors.some((s) => s.endsWith(':focus-visible')));
    expect(rings.length).toBeGreaterThan(0);
    for (const r of rings) {
      const outline = r.decls.find(([p]) => p === 'outline')?.[1];
      if (outline) expect(outline, where(r)).toMatch(/^2px solid var\(--accent(, #28618A)?\)$/);
    }
  });

  it("the notice link's focus ring sits in the same block as the link, which only shows below 900 px", () => {
    const link = RULES.find((r) => r.selectors.includes('.sim-desktop-notice a:focus-visible'));
    expect(link?.media).toContain('max-width: 899.98px');
    expect(RULES.find((r) => r.selectors.includes('.sim-desktop-notice') && !r.media)?.decls).toContainEqual(['display', 'none']);
  });
});

describe('page.css: the desktop-only breakpoint', () => {
  it('uses the same query as the page code (900 px)', () => {
    const narrow = RULES.filter((r) => r.file === PAGE && r.media);
    expect(narrow.length).toBeGreaterThan(0);
    for (const r of narrow) expect(r.media).toBe(`@media ${NARROW_QUERY}`);
  });
});
