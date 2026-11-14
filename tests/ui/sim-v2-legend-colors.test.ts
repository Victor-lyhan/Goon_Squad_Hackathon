// The legend must never drift from the map: every swatch is compared with the map layer constant it
// stands for, and the legend files may not contain color literals of their own.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as L from '../../client/src/components/map/layers';
import { cssColor, journeySymbolRows, legendRows, type LegendRow } from '../../client/src/components/sim/v2/legend/legendModel';

/** Parse `rgba(r, g, b, a)` back to the map's 0–255 RGBA. */
function parse(css: string): L.RGBA {
  const m = css.match(/^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/);
  if (!m) throw new Error(`not an rgba() color: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), Math.round(Number(m[4]) * 255)];
}

function expectSame(css: string, c: L.RGBA) {
  const p = parse(css);
  expect(p.slice(0, 3)).toEqual(c.slice(0, 3));
  expect(p[3]).toBe(c[3]); // three-decimal alpha round-trips exactly
  expect(css).toBe(cssColor(c));
}

const dim = (c: L.RGBA): L.RGBA => [c[0], c[1], c[2], Math.min(c[3], L.DIM_ALPHA)];

const NETWORK: Record<string, { color: L.RGBA; width?: number }> = {
  business: { color: L.BUSINESS_FILL },
  home: { color: L.HOME_FILL },
  vehicle: { color: L.VEHICLE_FILL },
  package: { color: L.PACKAGE_FILL },
  baseline: { color: L.BASELINE, width: L.BASELINE_WIDTH },
  // Network routes carry no tone; the map draws them in the leg 1 color.
  route: { color: L.toneColor(undefined), width: L.LEG_WIDTH },
  dimmed: { color: dim(L.BUSINESS_FILL) },
};

function check(rows: LegendRow[], table: Record<string, { color: L.RGBA; width?: number }>) {
  expect(rows.map((r) => r.key).sort()).toEqual(Object.keys(table).sort());
  for (const r of rows) {
    const want = table[r.key];
    expectSame(r.color, want.color);
    if (want.width !== undefined) expect(r.width).toBe(want.width);
  }
}

describe('legend swatches match map/layers.ts', () => {
  it('network mode (with the dimmed row)', () => {
    check(legendRows({ mode: 'network', hasSelection: true }), NETWORK);
  });

  it('journey mode has no rows of its own (JourneyLegend explains the journey map, #699)', () => {
    expect(legendRows({ mode: 'journey' })).toEqual([]);
  });

  it('journey symbol key: the package ring and halo, and every symbol in the map\'s ink and glyph', () => {
    for (const relay of [true, false]) {
      for (const r of journeySymbolRows(relay)) {
        if (r.key === 'package') {
          expectSame(r.color, L.PACKAGE_FILL);
          expectSame(r.halo, L.PACKAGE_HALO);
        } else {
          expectSame(r.color, L.RELAY_INK);
          expect(r.glyph).toBe(L.SYMBOL_GLYPH[r.key]);
        }
      }
    }
  });

  it('the dimmed alpha is the map DIM_ALPHA', () => {
    const dimmedRow = legendRows({ mode: 'network', hasSelection: true }).find((r) => r.key === 'dimmed')!;
    expect(parse(dimmedRow.color)[3]).toBe(L.DIM_ALPHA);
  });

  it('cssColor converts alpha 0–255 to 0–1', () => {
    expect(cssColor([0, 0, 0, 255])).toBe('rgba(0, 0, 0, 1)');
    expect(cssColor([0, 0, 0, 0])).toBe('rgba(0, 0, 0, 0)');
    expect(cssColor([40, 97, 138, 235])).toBe('rgba(40, 97, 138, 0.922)');
  });

  it('the legend files contain no color literal', () => {
    const dir = resolve(__dirname, '../../client/src/components/sim/v2/legend');
    for (const f of ['legendModel.ts', 'MapLegend.tsx', 'legend.css']) {
      const src = readFileSync(resolve(dir, f), 'utf8');
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src, f).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(\s*\d/);
      expect(src, f).not.toMatch(/:\s*(white|black|red|blue|green|gray|grey)\b/);
    }
  });

  it('the map palette is MVP III: primary #1D5075 and ink #171C24, alphas kept (#699)', () => {
    const rgb = (c: L.RGBA) => c.slice(0, 3);
    for (const c of [L.ACCENT, L.VEHICLE_FILL]) expect(rgb(c)).toEqual([0x1d, 0x50, 0x75]);
    for (const c of [L.BUSINESS_FILL, L.LABEL, L.RELAY_INK]) expect(rgb(c)).toEqual([0x17, 0x1c, 0x24]);
    expect([L.ACCENT[3], L.VEHICLE_FILL[3], L.BUSINESS_FILL[3], L.LABEL[3]]).toEqual([235, 255, 235, 255]);
    // The numbered-stop constants went with the legend's numbered row.
    expect(L).not.toHaveProperty('STOP_FILL');
    expect(L).not.toHaveProperty('STOP_TEXT');
    const src = readFileSync(resolve(__dirname, '../../client/src/components/map/layers.ts'), 'utf8');
    expect(src).not.toMatch(/#28618A|#151B26/i);
    expect(src).not.toMatch(/\[40, 97, 138,|\[21, 27, 38,/);
  });
});
