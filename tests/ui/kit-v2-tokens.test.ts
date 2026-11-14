import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const tokensCss = strip(readFileSync('client/src/styles/tokens.css', 'utf8'));
const globalCss = strip(readFileSync('client/src/styles/global.css', 'utf8'));
const uiCss = strip(readFileSync('client/src/ui/ui.css', 'utf8'));

const TOKENS: Record<string, string> = {
  '--bg': '#F7F8FA',
  '--panel': '#FFFFFF',
  '--text': '#151B26',
  '--navy': 'var(--text)',
  '--muted': '#5B6472',
  '--border': '#D7DDE5',
  '--accent': '#28618A',
  '--accent-dark': '#1F4E70',
  '--accent-soft': '#E8F0F6',
  '--ok': '#2F6B4F',
  '--warn': '#8A5A00',
  '--danger': '#A4322A',
  '--radius': '2px',
  '--radius-lg': '4px',
  '--space-1': '4px',
  '--space-2': '8px',
  '--space-3': '12px',
  '--space-4': '16px',
  '--space-6': '24px',
  '--space-8': '32px',
  '--font-sans': '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
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

describe('MVP II design tokens', () => {
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

  it('ui.css has no border-radius above 4px (and no percentage/pill radii)', () => {
    const radii = [...uiCss.matchAll(/border-radius\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(radii.length).toBeGreaterThan(0);
    for (const r of radii) {
      expect(r, r).not.toMatch(/%/);
      for (const px of r.matchAll(/(\d*\.?\d+)px/g)) expect(Number(px[1]), r).toBeLessThanOrEqual(4);
      for (const v of r.matchAll(/var\((--[\w-]+)/g)) expect(['--radius', '--radius-lg']).toContain(v[1]);
    }
  });

  it('ui.css has no gradients or box shadows', () => {
    expect(uiCss).not.toMatch(/gradient/i);
    expect(uiCss).not.toMatch(/box-shadow/);
  });

  it('borders are 1px (except the toast status stripe)', () => {
    for (const m of uiCss.matchAll(/(border(?:-(?:top|right|bottom|left))?)\s*:\s*(\d+)px/g)) {
      if (m[1] === 'border-left' && m[2] === '3') continue;
      if (m[0].startsWith('border:') && m[2] === '2') continue; // spinner ring
      expect(m[0]).toMatch(/:\s*1px/);
    }
  });

  it('defines a .mono utility using --font-mono', () => {
    expect(uiCss).toMatch(/\.mono\{[^}]*font-family:var\(--font-mono\)/);
  });

  it('status pills are rectangular labels', () => {
    expect(uiCss).toMatch(/\.ui-pill\{[^}]*border-radius:var\(--radius\)/);
  });

  it('interactive kit parts have hover, focus-visible and disabled states', () => {
    for (const sel of ['.ui-btn', '.ui-drawer__close', '.ui-toast button', '.ui-field input']) {
      expect(uiCss, `${sel} focus`).toContain(`${sel}:focus-visible`);
    }
    for (const sel of ['.ui-btn--primary:hover', '.ui-btn--secondary:hover', '.ui-btn--ghost:hover', '.ui-drawer__close:hover', '.ui-toast button:hover', '.ui-card:hover', '.ui-field select:hover']) {
      expect(uiCss, sel).toContain(sel);
    }
    for (const sel of ['.ui-btn:disabled', '.ui-drawer__close:disabled', '.ui-toast button:disabled', '.ui-field input:disabled']) {
      expect(uiCss, sel).toContain(sel);
    }
  });

  // Specificity (ids, classes/attrs/pseudo-classes, elements). :where() counts as zero.
  function specificity(sel: string): [number, number, number] {
    let s = sel.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '');
    const not: string[] = [];
    s = s.replace(/:not\(((?:[^()]|\([^()]*\))*)\)/g, (_, inner: string) => (not.push(inner), ''));
    const ids = (s.match(/#[\w-]+/g) ?? []).length;
    const cls = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
    const els = (s.replace(/\.[\w-]+|\[[^\]]*\]|:[\w-]+|#[\w-]+/g, ' ').match(/[a-z][\w-]*/gi) ?? []).length;
    return not.map(specificity).reduce<[number, number, number]>((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], [ids, cls, els]);
  }
  const cmp = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const rules = [...uiCss.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m, i) => ({ sels: m[1].trim().split(','), body: m[2], i }));
  const ruleFor = (sel: string) => rules.find((r) => r.sels.includes(sel))!;
  // a rule "wins" over another for a declaration if it has higher specificity, or equal and comes later.
  const beats = (winner: string, loser: string) => {
    const c = cmp(specificity(winner), specificity(loser));
    return c > 0 || (c === 0 && ruleFor(winner).i > ruleFor(loser).i);
  };

  it('specificity helper sanity', () => {
    expect(specificity('.ui-field input:not([type=checkbox]):not([type=radio])')).toEqual([0, 3, 1]);
    expect(specificity('.ui-field input:where(:not([type=checkbox]):not([type=radio]))')).toEqual([0, 1, 1]);
  });

  it('base text input rule uses :where() so disabled and invalid states can override it', () => {
    const base = '.ui-field input:where(:not([type=checkbox]):not([type=radio]))';
    expect(ruleFor(base)).toBeDefined();
    expect(uiCss).not.toMatch(/\.ui-field input:not\(/);
  });

  it('disabled fields override the base and hover styles (inputs, selects, textareas)', () => {
    const pairs: [string, string, string][] = [
      ['.ui-field input:disabled', '.ui-field input:where(:not([type=checkbox]):not([type=radio]))', '.ui-field input:where(:not([type=checkbox]):not([type=radio])):hover'],
      ['.ui-field select:disabled', '.ui-field select', '.ui-field select:hover'],
      ['.ui-field textarea:disabled', '.ui-field textarea', '.ui-field textarea:hover'],
    ];
    for (const [dis, base, hover] of pairs) {
      expect(ruleFor(dis).body).toMatch(/background:var\(--bg\)/);
      expect(beats(dis, base), `${dis} > ${base}`).toBe(true);
      expect(beats(dis, hover), `${dis} > ${hover}`).toBe(true);
    }
  });

  it('invalid fields keep the danger border over base and hover styles', () => {
    const pairs: [string, string, string][] = [
      ['.ui-field.ui-field--invalid input', '.ui-field input:where(:not([type=checkbox]):not([type=radio]))', '.ui-field input:where(:not([type=checkbox]):not([type=radio])):hover'],
      ['.ui-field.ui-field--invalid select', '.ui-field select', '.ui-field select:hover'],
      ['.ui-field.ui-field--invalid textarea', '.ui-field textarea', '.ui-field textarea:hover'],
    ];
    for (const [inv, base, hover] of pairs) {
      expect(ruleFor(inv).body).toMatch(/border-color:var\(--danger\)/);
      expect(beats(inv, base), `${inv} > ${base}`).toBe(true);
      expect(beats(inv, hover), `${inv} > ${hover}`).toBe(true);
    }
  });
});
