// Style rules for the map legend (docs/mvp2-ui-redesign.md §1): no shadow, no gradient, tokens only,
// and narrow enough (≤ 240px) that it does not cover the map. #864: it is a control on the map, so it
// is a dark translucent pill like Play (sim-v2-map-controls-css.test.ts has the look and the contrast).
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

  it('the legend and its toggle are round like the Play pill (#864); only the round marker swatches use 50%', () => {
    const radii: Array<[string, string]> = [];
    for (const [selector, body] of rules) {
      for (const m of body.matchAll(/border-radius:\s*([^;]+);/g)) {
        const v = m[1].trim();
        if (v === '50%') expect(selector).toMatch(/^\.ml__swatch--(dot|ring|numbered)$/);
        else radii.push([selector, v]);
      }
    }
    // The toggle is 1px inside the legend (its padding), so its radius is 1px less.
    expect(radii).toEqual([['.ml', '14px'], ['.ml__toggle', '13px']]);
  });

  it('the legend box: no border, the dark pill fill, the fonts through the tokens, at most 240px wide', () => {
    const ml = block('.ml');
    expect(noComments).not.toMatch(/border(-\w+)?:\s*1px/);
    expect(ml).toMatch(/background:\s*color-mix\(in srgb, var\(--text\) 72%, transparent\);/);
    expect(ml).toMatch(/color:\s*var\(--panel\);/);
    expect(ml).toMatch(/font-family:\s*var\(--font-sans\);/);
    // #874: at most 240px, and at most its corner box, so it fits a 220px map too.
    const max = ml.match(/max-width:\s*min\((\d+)px, 100%\);/);
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

  it('every class MapLegend.tsx writes has a rule here: no dead hooks (#874 dropped ml__chevron)', () => {
    // The fixed class names; the `ml__row--${row.key}` and `ml__swatch--${row.shape}` modifiers are data.
    const written = [...tsx.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\})/g)]
      .flatMap((m) => (m[1] ?? m[2]).split(/\s+/))
      .filter((c) => c && !c.includes('${'));
    expect(written.length).toBeGreaterThan(5);
    const styled = new Set(rules.flatMap(([s]) => [...s.matchAll(/\.([\w-]+)/g)].map((m) => m[1])));
    expect(written.filter((c) => !styled.has(c))).toEqual([]);
    expect(tsx).not.toContain('ml__chevron');
  });

  it('never stores the open state in localStorage', () => {
    expect(tsx).not.toMatch(/localStorage|sessionStorage/);
  });
});
