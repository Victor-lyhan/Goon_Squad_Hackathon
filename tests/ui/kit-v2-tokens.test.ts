import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const tokensCss = strip(readFileSync('client/src/styles/tokens.css', 'utf8'));
const globalCss = strip(readFileSync('client/src/styles/global.css', 'utf8'));
const uiCss = strip(readFileSync('client/src/ui/ui.css', 'utf8'));

const TOKENS: Record<string, string> = {
  '--bg': '#F7F7F4',
  '--panel': '#FFFFFF',
  '--text': '#171C24',
  '--navy': 'var(--text)',
  '--muted': '#5B6472',
  '--border': '#E3E3DE',
  '--accent': '#1D5075',
  '--accent-dark': '#173E5B',
  '--accent-soft': '#E8EEF1',
  '--ok': '#2F6B4F',
  '--warn': '#8A5A00',
  '--danger': '#A4322A',
  '--radius': '4px',
  '--radius-lg': '6px',
  '--space-1': '4px',
  '--space-2': '8px',
  '--space-3': '12px',
  '--space-4': '16px',
  '--space-6': '24px',
  '--space-8': '32px',
  '--font-sans': '"Inter", "Geist", system-ui, -apple-system, "Segoe UI", sans-serif',
  '--font-mono': '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  '--text-xs': '12px',
  '--text-sm': '13px',
  '--text-md': '14px',
  '--text-lg': '18px',
  '--text-xl': '28px',
};

function declared(css: string): Map<string, string> {
  const root = css.match(/:root\s*\{([^}]*)\}/)![1];
  return new Map([...root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

// Values are the MVP III look (docs/mvp3.md P4, #651); the names are the #324 contract.
describe('MVP III design tokens', () => {
  const defs = declared(tokensCss);
  for (const [name, value] of Object.entries(TOKENS)) {
    it(`${name} = ${value}`, () => {
      expect(defs.get(name)).toBe(value);
    });
  }

  it('global.css imports tokens.css first and no longer defines color variables', () => {
    const first = globalCss.trim().split('\n')[0];
    expect(first).toMatch(/^@import\s+['"]\.\/tokens\.css['"];/);
    expect(globalCss).not.toMatch(/--(bg|panel|text|navy|muted|border|accent|accent-dark)\s*:/);
  });

  it('global.css keeps the reduced-motion safeguard', () => {
    expect(globalCss).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});

describe('UI kit uses only tokens', () => {
  it('ui.css has no hex colors', () => {
    expect(uiCss.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });

  it('ui.css has no border-radius above 6px (and no percentage/pill radii)', () => {
    const radii = [...uiCss.matchAll(/border-radius\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(radii.length).toBeGreaterThan(0);
    for (const r of radii) {
      expect(r, r).not.toMatch(/%/);
      for (const px of r.matchAll(/(\d*\.?\d+)px/g)) expect(Number(px[1]), r).toBeLessThanOrEqual(6);
      for (const v of r.matchAll(/var\((--[\w-]+)/g)) expect(['--radius', '--radius-lg']).toContain(v[1]);
    }
  });

  it('ui.css has no gradients or box shadows', () => {
    expect(uiCss).not.toMatch(/gradient/i);
    expect(uiCss).not.toMatch(/box-shadow/);
  });

  it('borders are 1px (except the spinner ring)', () => {
    for (const m of uiCss.matchAll(/(border(?:-(?:top|right|bottom|left))?)\s*:\s*(\d+)px/g)) {
      if (m[0].startsWith('border:') && m[2] === '2') continue; // spinner ring
      expect(m[0]).toMatch(/:\s*1px/);
    }
  });

  it('defines a .mono utility using --font-mono', () => {
    expect(uiCss).toMatch(/\.mono\{[^}]*font-family:var\(--font-mono\)/);
  });

  it('interactive kit parts have hover, focus-visible and disabled states', () => {
    expect(uiCss).toContain('.ui-btn:focus-visible');
    for (const sel of ['.ui-btn--primary:hover', '.ui-btn--secondary:hover', '.ui-btn--ghost:hover']) {
      expect(uiCss, sel).toContain(sel);
    }
    expect(uiCss).toContain('.ui-btn:disabled');
  });
});
