// Shared reader for the #479 visual QA tests (sim-v2-qa-*.test.ts(x)): the CSS files in scope, a
// small CSS parser (flat rules plus @media), the design tokens and the map layer colours.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as layers from '../../client/src/components/map/layers';
import { MVP2_TOKEN_COLORS } from './kit-v2-legacy-tokens';

const root = resolve(__dirname, '../..');
export const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

export const QA_CSS_FILES = [
  'client/src/components/sim/v2/SimWorkspace.css',
  'client/src/components/sim/v2/controls/controls.css',
  'client/src/components/sim/v2/inspector/inspector.css',
  'client/src/components/sim/v2/journey/journey.css',
  'client/src/components/sim/v2/legend/legend.css',
  'client/src/components/sim/v2/packages/packages.css',
  'client/src/components/sim/v2/compare/compare.css',
  'client/src/components/map/map.css',
];

// ---------- A small CSS reader (flat rules plus @media blocks) ----------
export type Rule = { file: string; selectors: string[]; decls: [string, string][]; media: string | null };

export const splitTop = (s: string, sep: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
};

export function parseCss(src: string, file: string): Rule[] {
  const css = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  const walk = (text: string, media: string | null) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const prelude = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      if (prelude.startsWith('@media')) walk(body, prelude);
      else {
        const decls = splitTop(body, ';').map((d) => {
          const k = d.indexOf(':');
          return [d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).trim()] as [string, string];
        });
        out.push({ file, selectors: splitTop(prelude, ','), decls, media });
      }
      i = j;
    }
  };
  walk(css, null);
  return out;
}

export const RULES = QA_CSS_FILES.flatMap((f) => parseCss(read(f), f));
export const where = (r: Rule) => `${r.file} ${r.media ? `${r.media} ` : ''}${r.selectors.join(', ')}`;

// ---------- Tokens and map constants ----------
const tokenCss = read('client/src/styles/tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');
export const TOKENS = new Map([...tokenCss.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
/** Custom properties set by the app shell rather than tokens.css. */
export const LOCAL_VARS = new Set(['--app-header-h']);

export type RGB = [number, number, number];
const hexToRgb = (hex: string): RGB | null => {
  let h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join('');
  else if (h.length === 6 || h.length === 8) h = h.slice(0, 6);
  else return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
};
export const key = (c: RGB) => c.join(',');

const tokenColors = [...TOKENS.values()].filter((v) => /^#[0-9a-f]+$/i.test(v)).map((v) => hexToRgb(v)!);
const isRgba = (v: unknown): v is number[] => Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number');
const layerColors = Object.values(layers as Record<string, unknown>).filter(isRgba).map((c) => [c[0], c[1], c[2]] as RGB);
/** MVP II token colours: still allowed as var() fallbacks in legend.css and journey.css until #699
 *  restyles them. The other simulator files and map.css moved to the MVP III values in #701
 *  (sim-v2-mvp3-css.test.ts fails on an MVP II value there). */
const legacyColors = MVP2_TOKEN_COLORS.map((v) => hexToRgb(v)!);
export const ALLOWED_COLORS = new Set([...tokenColors, ...legacyColors, ...layerColors].map(key));

/** Every colour literal in a value: hex, rgb()/rgba(), hsl()/hsla(). */
export function colorLiterals(value: string): { text: string; rgb: RGB | null }[] {
  const out: { text: string; rgb: RGB | null }[] = [];
  for (const m of value.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) out.push({ text: m[0], rgb: hexToRgb(m[0]) });
  for (const m of value.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)[^)]*\)/g)) {
    out.push({ text: m[0], rgb: [Number(m[1]), Number(m[2]), Number(m[3])] });
  }
  for (const m of value.matchAll(/hsla?\([^)]*\)/g)) out.push({ text: m[0], rgb: null });
  return out;
}

export const NAMED_COLORS = /\b(white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|navy|teal|maroon|olive|lime|aqua|fuchsia|brown|crimson|gold|indigo|violet|beige|ivory|tan|coral|salmon)\b/i;
export const COLOR_PROPS = /(^|-)(color|background|border|outline|fill|stroke|shadow)(-|$)/;

/** Round markers and status dots: the only selectors that may use a 50% radius. */
export const ROUND_SELECTORS = ['.ml__swatch--dot', '.ml__swatch--ring', '.ml__swatch--numbered'];

/**
 * #852 (human feedback): the floating Play/Pause control on the map is a dark translucent pill, not a
 * flat panel: `.spc-playbar` (compose.css) is the pill, `.ctl-btn` (controls.css) its two buttons.
 * #864 (QUESTIONS 22:25): every control on the map has that look: the banners and the overnight card
 * (compose.css), the legend and its toggle (legend.css) and the day/night badge (map.css).
 * They are the only selectors that may have a radius above the token and the only ones that may blur
 * what is behind them, and the focus ring of their buttons is white (on the ink of the pill), not the accent.
 */
export const PILL_RADII: Record<string, string> = {
  '.spc-playbar': '26px',
  '.ctl-btn': '22px',
  '.spc-banner': '14px',
  '.spc-overnight': '24px',
  '.ml': '14px',
  '.ml__toggle': '13px',
  '.map-v2__daynight': '14px',
};
export const PILL_SELECTORS = Object.keys(PILL_RADII);
/** The pill's fill: the --text ink at 72%. legend.css writes its tokens without a fallback (sim-v2-legend-css.test.ts). */
export const PILL_BACKGROUND = 'color-mix(in srgb, var(--text, #171C24) 72%, transparent)';
export const PILL_BLUR = 'blur(8px)';
export const PILL_FOCUS_RING = '2px solid var(--panel, #FFFFFF)';
export const isPillRule = (r: Rule) => r.media === null && r.selectors.length === 1 && PILL_SELECTORS.includes(r.selectors[0]);

export const resolveVars = (value: string) =>
  value.replace(/var\((--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_, name: string, fb?: string) => TOKENS.get(name) ?? fb ?? '');

/** Selectors (without :focus-visible) that have a visible focus style in these files. */
export const FOCUS_SELECTORS = new Set(
  RULES.flatMap((r) => r.selectors
    .filter((s) => s.endsWith(':focus-visible'))
    .filter(() => r.decls.some(([p, v]) => (p === 'outline' && !/^(none|0)$/.test(v)) || p === 'box-shadow'))
    .map((s) => s.replace(/:focus-visible$/, ''))),
);
