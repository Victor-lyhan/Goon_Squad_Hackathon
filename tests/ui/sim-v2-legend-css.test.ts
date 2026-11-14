// Style rules for the map legend (docs/mvp2-ui-redesign.md §1): square corners, no shadow, no
// gradient, tokens only, and narrow enough (≤ 240px) that it does not cover the map.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../client/src/components/sim/v2/legend/legend.css'), 'utf8');
const tsx = readFileSync(resolve(__dirname, '../../client/src/components/sim/v2/legend/MapLegend.tsx'), 'utf8');
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** [selector, body] pairs of the flat stylesheet. */
const rules = [...noComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]] as const);
const block = (selector: string) => rules.find(([s]) => s === selector)?.[1] ?? '';

describe('legend.css', () => {
  it('has no box-shadow and no gradient', () => {
    expect(noComments).not.toMatch(/box-shadow/);
    expect(noComments).not.toMatch(/gradient\(/);
    expect(tsx).not.toMatch(/boxShadow|gradient/);
  });

  it('corner radius is at most var(--radius); only the round marker swatches use 50%', () => {
    for (const [selector, body] of rules) {
      for (const m of body.matchAll(/border-radius:\s*([^;]+);/g)) {
        const v = m[1].trim();
        if (v === '50%') expect(selector).toMatch(/^\.ml__swatch--(dot|ring|numbered)$/);
        else expect(['0', 'var(--radius)']).toContain(v);
      }
    }
    expect(block('.ml')).toMatch(/border-radius:\s*var\(--radius\);/);
  });

  it('the legend box: 1px border, panel background, IBM Plex through the tokens, at most 240px wide', () => {
    const ml = block('.ml');
    expect(ml).toMatch(/border:\s*1px solid var\(--border\);/);
    expect(ml).toMatch(/background:\s*var\(--panel\);/);
    expect(ml).toMatch(/font-family:\s*var\(--font-sans\);/);
    const max = ml.match(/max-width:\s*(\d+)px;/);
    expect(max).not.toBeNull();
    expect(Number(max![1])).toBeLessThanOrEqual(240);
    expect(ml).not.toMatch(/(^|[^-])width:\s*\d{3,}px/);
    for (const [, body] of rules) {
      for (const m of body.matchAll(/(?:^|[\s;])(?:min-)?width:\s*(\d+)px/g)) expect(Number(m[1])).toBeLessThanOrEqual(240);
    }
  });

  it('uses only token variables for colors (no fallbacks needed, no literals)', () => {
    for (const m of noComments.matchAll(/var\(--[\w-]+\s*,/g)) throw new Error(`fallback in ${m[0]}`);
    expect(noComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('never stores the open state in localStorage', () => {
    expect(tsx).not.toMatch(/localStorage|sessionStorage/);
  });
});
