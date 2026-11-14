// Visual QA for the merged MVP II simulator pieces and the map (#479, M9) against
// docs/mvp2-ui-redesign.md §1/§2 and client/src/styles/tokens.css: square corners, no decorative
// shadows or gradients, colours only from the tokens or the map layer constants, a :focus-visible
// style for every control class, and no animation or transition under reduced motion.
// sim/v2/compose/ and sim/v2/page/ are not covered here (#459, #460 own them).
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_COLORS, COLOR_PROPS, FOCUS_SELECTORS, LOCAL_VARS, NAMED_COLORS, QA_CSS_FILES, ROUND_SELECTORS, RULES, TOKENS,
  colorLiterals, key, read, resolveVars, splitTop, where,
} from './sim-v2-qa-css-rules';
import { isMvp2Fallback } from './kit-v2-legacy-tokens';

describe('sim v2 + map CSS: the redesign rules', () => {
  it('reads every file and finds rules in each', () => {
    for (const f of QA_CSS_FILES) expect(RULES.some((r) => r.file === f), f).toBe(true);
    expect(ALLOWED_COLORS.has('40,97,138')).toBe(true); // accent
    expect(ALLOWED_COLORS.has('15,138,95')).toBe(true); // LEG2 from layers.ts
  });

  it('border-radius is at most 4px; 50% only on the listed round markers and status dots', () => {
    const bad: string[] = [];
    for (const r of RULES) {
      for (const [prop, value] of r.decls) {
        if (!prop.includes('radius')) continue;
        for (const part of resolveVars(value).split(/[\s/]+/).filter(Boolean)) {
          if (part === '50%') {
            if (!r.selectors.every((s) => ROUND_SELECTORS.includes(s))) bad.push(`${where(r)}: ${value}`);
            continue;
          }
          const px = part === '0' ? 0 : Number(/^(\d*\.?\d+)px$/.exec(part)?.[1] ?? NaN);
          if (!(px <= 4)) bad.push(`${where(r)}: ${value}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('box-shadow only as a focus ring on :focus-visible', () => {
    const bad: string[] = [];
    for (const r of RULES) {
      for (const [prop, value] of r.decls) {
        if (prop !== 'box-shadow' || value === 'none') continue;
        const ring = /^0 0 0 \d+px\b/.test(value) && splitTop(value, ',').length === 1;
        if (!ring || !r.selectors.every((s) => s.includes(':focus-visible'))) bad.push(`${where(r)}: ${value}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('no gradients', () => {
    for (const f of QA_CSS_FILES) expect(read(f).replace(/\/\*[\s\S]*?\*\//g, ''), f).not.toMatch(/gradient\(/i);
  });

  it('every colour is a token from tokens.css or a constant from map/layers.ts', () => {
    const bad: string[] = [];
    for (const r of RULES) {
      for (const [prop, value] of r.decls) {
        for (const c of colorLiterals(value)) {
          if (!c.rgb || !ALLOWED_COLORS.has(key(c.rgb))) bad.push(`${where(r)}: ${prop}: ${c.text}`);
        }
        if (COLOR_PROPS.test(prop) && NAMED_COLORS.test(value.replace(/var\([^)]*\)/g, ''))) {
          bad.push(`${where(r)}: ${prop}: ${value}`);
        }
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
          // Font stacks are shortened on purpose; every other fallback must match exactly.
          if (fallback === undefined || name.startsWith('--font-')) continue;
          const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
          if (norm(fallback) !== norm(token) && !isMvp2Fallback(name, fallback)) bad.push(`${where(r)}: ${prop}: ${name} fallback ${fallback} ≠ ${token}`);
        }
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

describe('sim v2 + map CSS: reduced motion', () => {
  const moving = (decls: [string, string][]) =>
    decls.filter(([p, v]) => /^(transition|animation)(-name|-duration)?$/.test(p) && !/^(none|0s?)$/.test(v));

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
    for (const r of RULES.filter((x) => x.media?.includes('prefers-reduced-motion'))) {
      expect(moving(r.decls), where(r)).toEqual([]);
    }
  });

  it('the workspace panel slide is the one transition, and it has its reduced-motion rule', () => {
    const moved = RULES.filter((r) => !r.media && moving(r.decls).length > 0).map(where);
    expect(moved).toEqual(['client/src/components/sim/v2/SimWorkspace.css .sw-panel']);
  });
});

// ---------- :focus-visible for every control class ----------
/** The control classes the panels render (buttons, inputs, selects), and the file that styles them. */
export const CONTROL_CLASSES: [string, string][] = [
  ['.sw-toggle', 'SimWorkspace.css'],
  ['.sw-btn', 'SimWorkspace.css'],
  ['.sw-pkg', 'SimWorkspace.css'],
  ['.sw-field select', 'SimWorkspace.css'],
  ['.ctl-btn', 'controls.css'],
  ['.insp-row-main', 'inspector.css'],
  ['.insp-link', 'inspector.css'],
  ['.insp-btn', 'inspector.css'],
  ['.insp-close', 'inspector.css'],
  ['.jt-step__button', 'journey.css'],
  ['.ml__toggle', 'legend.css'],
  ['.pk-search input', 'packages.css'],
  ['.pk-chip', 'packages.css'],
  ['.pk-clear', 'packages.css'],
];

describe('sim v2 + map CSS: keyboard focus', () => {
  it.each(CONTROL_CLASSES)('%s has a visible :focus-visible style (%s)', (selector, file) => {
    expect(FOCUS_SELECTORS.has(selector)).toBe(true);
    const r = RULES.find((x) => x.file.endsWith(file) && x.selectors.includes(`${selector}:focus-visible`));
    expect(r, `${selector}:focus-visible in ${file}`).toBeDefined();
  });

  it('the focus ring is the accent colour, 2px', () => {
    for (const r of RULES.filter((x) => x.selectors.some((s) => s.endsWith(':focus-visible')))) {
      const outline = r.decls.find(([p]) => p === 'outline')?.[1];
      if (outline) expect(outline, where(r)).toMatch(/^2px solid var\(--accent(, #28618A)?\)$/);
    }
  });
});
