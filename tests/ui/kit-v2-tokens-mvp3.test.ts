// #651 (docs/mvp3.md P4, first step): the design tokens carry the MVP III look. Checks, from the files:
// the base colours and the 6px radius limit, --accent-dark / --accent-soft derived from --accent,
// Inter then Geist then the system stack, no gradient and no heavy shadow in client/src/styles/ and
// client/src/ui/, and text contrast computed from the token values.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const read = (p: string) => strip(readFileSync(p, 'utf8'));

const root = /:root\s*\{([^}]*)\}/.exec(read('client/src/styles/tokens.css'))![1];
const RAW = new Map([...root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const token = (name: string): string => {
  const v = RAW.get(name);
  if (v === undefined) throw new Error(`${name} is not in tokens.css`);
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  return ref ? token(ref[1]) : v;
};

const cssIn = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => join(dir, f));
const STYLESHEETS = [...cssIn('client/src/styles'), ...cssIn('client/src/ui')];

type RGB = [number, number, number];
const rgb = (hex: string): RGB => {
  expect(hex, hex).toMatch(/^#[0-9a-f]{6}$/i);
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** WCAG 2.x relative luminance and contrast ratio. */
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * The "night-shift transit ops" direction (#955, the humans' bold redesign): the values the issue gives for
 * the header and the homepage, and for the Business and Employee pages after them (#956, #957). The MVP III
 * tokens above them stay as they are, so the pages not yet redrawn do not change.
 */
const NIGHT_SHIFT: Record<string, string> = {
  '--ink': '#0B0F17',
  '--ink-line': '#262D3A',
  '--on-ink': '#F4F2EC',
  '--on-ink-muted': '#A3A9B5',
  '--danger-on-ink': '#FF9B8E',
  '--paper': '#F4F2EC',
  '--paper-text': '#14171F',
  '--paper-muted': '#5A5F6B',
  '--paper-line': '#DCD8CE',
  '--signal': '#FF6A1A',
  '--signal-hover': '#FF8748',
  '--carrier-a': '#3D8BFF',
  '--carrier-b': '#22C08A',
  '--font-display': '"Archivo Variable", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
};

describe('the "night-shift transit ops" tokens (#955)', () => {
  it('have the issue\'s values: ink, paper, text and secondary on paper, hairline, orange, the carriers\' blue and green', () => {
    for (const [name, value] of Object.entries(NIGHT_SHIFT)) expect(token(name), name).toBe(value);
    expect(token('--on-ink')).toBe(token('--paper')); // the light on ink is the paper itself
  });

  it('text is readable on both grounds: 4.5:1 or more', () => {
    for (const [fg, bg] of [
      ['--on-ink', '--ink'], ['--on-ink-muted', '--ink'], ['--danger-on-ink', '--ink'],
      ['--paper-text', '--paper'], ['--paper-muted', '--paper'],
      // The primary button: ink text on the orange, also under the pointer. The second one: paper on ink text.
      ['--ink', '--signal'], ['--ink', '--signal-hover'], ['--paper', '--paper-text'], ['--paper', '--ink-line'],
    ]) expect(contrast(token(fg), token(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    // White on the orange would not do (under 3:1), which is why the button's text is ink.
    expect(contrast('#FFFFFF', token('--signal'))).toBeLessThan(3);
  });

  it('the orange and the two carriers stand out on ink (3:1 for a mark or a line); on paper they only decorate', () => {
    for (const fg of ['--signal', '--carrier-a', '--carrier-b']) expect(contrast(token(fg), token('--ink')), fg).toBeGreaterThanOrEqual(3);
    // On paper the issue's blue and green are under 3:1 (2.96 and about 2.2). So nothing on paper is told
    // by them alone: the homepage's route line has its stations in the text's ink, and the steps are text.
    for (const fg of ['--carrier-a', '--carrier-b']) expect(contrast(token(fg), token('--paper')), fg).toBeLessThan(3);
    const steps = read('client/src/styles/landing.css');
    expect(steps).toMatch(/\.landing-steps li::before \{[^}]*border: 2px solid var\(--paper-text, #14171F\);/);
  });

  it('the hairlines are quiet on their ground, but not the ground itself', () => {
    for (const [line, bg] of [['--ink-line', '--ink'], ['--paper-line', '--paper']]) {
      const c = contrast(token(line), token(bg));
      expect(c, line).toBeLessThan(1.6);
      expect(c, line).toBeGreaterThan(1.1);
    }
  });

  it('--signal-hover is --signal at 80% over white', () => {
    const want = rgb(token('--signal')).map((c) => c * 0.8 + 255 * 0.2);
    rgb(token('--signal-hover')).forEach((c, i) => expect(Math.abs(c - want[i]!), 'channel').toBeLessThanOrEqual(1));
  });
});

describe('MVP III base look in tokens.css (#651)', () => {
  it('background, ink, primary and hairline are the docs/mvp3.md P4 colours', () => {
    expect(token('--bg')).toBe('#F7F7F4');
    expect(token('--text')).toBe('#171C24');
    expect(token('--navy')).toBe('#171C24');
    expect(token('--accent')).toBe('#1D5075');
    expect(token('--border')).toBe('#E3E3DE');
  });

  it('--accent-dark and --accent-soft are --accent mixed with black and with white (same hue)', () => {
    const accent = rgb(token('--accent'));
    const mix = (other: number, share: number) => accent.map((c) => c * share + other * (1 - share));
    const near = (hex: string, want: number[]) => rgb(hex).forEach((c, i) => expect(Math.abs(c - want[i]), hex).toBeLessThanOrEqual(1));
    near(token('--accent-dark'), mix(0, 0.78));
    near(token('--accent-soft'), mix(255, 0.10));
    expect(lum(token('--accent-dark'))).toBeLessThan(lum(token('--accent')));
    expect(lum(token('--accent-soft'))).toBeGreaterThan(lum(token('--accent')));
  });

  it('--radius and --radius-lg are at most 6px, and --radius is not the larger one', () => {
    for (const name of ['--radius', '--radius-lg']) {
      expect(token(name), name).toMatch(/^\d+px$/);
      expect(Number.parseFloat(token(name)), name).toBeLessThanOrEqual(6);
      expect(Number.parseFloat(token(name)), name).toBeGreaterThan(0);
    }
    expect(Number.parseFloat(token('--radius'))).toBeLessThanOrEqual(Number.parseFloat(token('--radius-lg')));
  });

  it('--font-sans is Inter, then Geist, then the system stack; --font-mono starts with IBM Plex Mono', () => {
    const sans = token('--font-sans').split(',').map((s) => s.trim());
    expect(sans.slice(0, 3)).toEqual(['"Inter"', '"Geist"', 'system-ui']);
    expect(sans.at(-1)).toBe('sans-serif');
    expect(token('--font-sans')).not.toMatch(/IBM Plex Sans/);
    const mono = token('--font-mono').split(',').map((s) => s.trim());
    expect(mono[0]).toBe('"IBM Plex Mono"');
    expect(mono.at(-1)).toBe('monospace');
  });

  it('every token name of the #324 contract is still defined', () => {
    const names = [
      '--bg', '--panel', '--text', '--navy', '--muted', '--border', '--accent', '--accent-dark', '--accent-soft',
      '--ok', '--warn', '--danger', '--radius', '--radius-lg',
      '--space-1', '--space-2', '--space-3', '--space-4', '--space-6', '--space-8',
      '--font-sans', '--font-mono', '--text-xs', '--text-sm', '--text-md', '--text-lg', '--text-xl',
      // Added by #895 (the app-wide keyboard focus ring); pinned in global-focus-motion.test.ts.
      '--focus-ring', '--focus-ring-on-dark', '--focus-ring-offset',
      // Added by #955 ("night-shift transit ops"): the ink and paper grounds, the signal orange, the two
      // carriers and the display face. Their values are pinned in the describe block below.
      ...Object.keys(NIGHT_SHIFT),
    ];
    expect([...RAW.keys()].sort()).toEqual([...names].sort());
  });
});

describe('contrast computed from the token values (#651)', () => {
  const SURFACES = ['--bg', '--panel'];

  for (const fg of ['--text', '--muted']) {
    for (const bg of SURFACES) {
      it(`${fg} on ${bg} is at least 4.5:1`, () => {
        expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('link and status colours are at least 4.5:1 on --bg, --panel and --accent-soft', () => {
    for (const fg of ['--accent', '--accent-dark', '--ok', '--warn', '--danger']) {
      for (const bg of [...SURFACES, '--accent-soft']) {
        expect(contrast(token(fg), token(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('the label of a primary button and of the connection banner (--panel on a fill) is at least 4.5:1', () => {
    for (const fill of ['--accent', '--accent-dark', '--warn']) {
      expect(contrast(token('--panel'), token(fill)), fill).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the hairline border is quiet: under 1.5:1 on --bg and --panel, but not the same colour', () => {
    for (const bg of SURFACES) {
      const c = contrast(token('--border'), token(bg));
      expect(c, bg).toBeLessThan(1.5);
      expect(c, bg).toBeGreaterThan(1.1);
    }
  });

  it('the contrast helper gives the known values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });
});

// ---- no gradients, no heavy shadows ----
/** Split on commas that are not inside parentheses. */
function splitTop(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Blur radius in px of every shadow in a box-shadow value (the third length; 0 when left out). */
function blurs(value: string, tokens: Map<string, string> = RAW): number[] {
  const resolved = value.replace(/var\((--[\w-]+)(?:,[^()]*)?\)/g, (_, n: string) => tokens.get(n) ?? '');
  return splitTop(resolved).filter((s) => !/^(none|inherit|initial|unset)$/.test(s)).map((shadow) => {
    const lengths = shadow.replace(/[a-z-]+\([^()]*(\([^()]*\)[^()]*)*\)/gi, ' ').split(/\s+/)
      .map((t) => /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(t))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]) * (m[2] === 'rem' || m[2] === 'em' ? 16 : 1));
    return lengths[2] ?? 0;
  });
}

const shadowValues = (css: string) => [...css.matchAll(/box-shadow\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
const GRADIENT = /\b(repeating-)?(linear|radial|conic)-gradient\s*\(/i;
/**
 * A mask is not a painted gradient: it only fades what is already drawn, and the flat ground behind shows
 * through. The homepage's map fades into the hero that way (#869, asked for in the issue), so the value of
 * a `mask-image` is left out of the check. A gradient in any other property still fails.
 */
const withoutMasks = (css: string) => css.replace(/(?:-webkit-)?mask-image\s*:[^;}]*/g, '');
const MAX_BLUR_PX = 8;

describe('no gradients and no heavy shadows in client/src/styles/ and client/src/ui/ (#651)', () => {
  it('reads tokens.css, fonts.css, global.css, ui.css and shell.css', () => {
    expect(STYLESHEETS).toEqual(expect.arrayContaining([
      join('client/src/styles', 'tokens.css'), join('client/src/styles', 'fonts.css'), join('client/src/styles', 'global.css'),
      join('client/src/ui', 'ui.css'), join('client/src/ui', 'shell.css'),
    ]));
  });

  it('the blur reader finds the third length of each shadow', () => {
    expect(blurs('0 1px 2px rgba(0, 0, 0, .1)')).toEqual([2]);
    expect(blurs('0 0 0 2px var(--accent)')).toEqual([0]);
    expect(blurs('inset 0 1px #000, 0 12px 32px -4px rgba(23, 28, 36, .2)')).toEqual([0, 32]);
    expect(blurs('0 .25rem 1rem color-mix(in srgb, var(--text) 20%, transparent)')).toEqual([16]);
    expect(blurs('none')).toEqual([]);
    expect(GRADIENT.test('linear-gradient(#fff, #000)')).toBe(true);
    expect(GRADIENT.test('repeating-radial-gradient(circle, #fff, #000 10px)')).toBe(true);
    expect(GRADIENT.test('var(--panel)')).toBe(false);
    const masked = '.a { -webkit-mask-image: linear-gradient(to right, transparent, #000 22%); mask-image: linear-gradient(to right, transparent, #000 22%); }';
    expect(GRADIENT.test(withoutMasks(masked))).toBe(false);
    expect(GRADIENT.test(withoutMasks('.a { mask-image: none; background: linear-gradient(#fff, #000); }'))).toBe(true);
    expect(GRADIENT.test(withoutMasks('.a { background-image: linear-gradient(#fff, #000) }'))).toBe(true);
  });

  for (const file of STYLESHEETS) {
    it(`${file}: no gradient, and no box-shadow blur over ${MAX_BLUR_PX}px`, () => {
      const css = read(file);
      expect(withoutMasks(css)).not.toMatch(GRADIENT);
      for (const value of shadowValues(css)) {
        for (const blur of blurs(value)) expect(blur, `box-shadow: ${value}`).toBeLessThanOrEqual(MAX_BLUR_PX);
      }
    });
  }
});
