import { describe, expect, it } from 'vitest';
import {
  ACCENT,
  DIM_ALPHA,
  LEG1,
  LEG2,
  buildLayerSpecs,
  toneLabelColor,
  type LayerSpec,
  type PathSpec,
  type RGBA,
  type ScatterSpec,
  type TextSpec,
} from '../../client/src/components/map/layers';
import { panDecision } from '../../client/src/components/map/mapModel';
import type { LayerVisibility, MapMover, MapPanTarget, MapPlace, MapRoute, MapStop } from '../../client/src/components/map/types';

const places: MapPlace[] = [
  { id: 'biz-a', kind: 'business', lat: 40.7033, lng: -73.9881, label: 'DUMBO Café' },
  { id: 'biz-r', kind: 'business', lat: 40.7411, lng: -73.9897, label: 'Flatiron Relay' },
  { id: 'biz-b', kind: 'business', lat: 40.7527, lng: -73.9772, label: 'Midtown Agency' },
];
const routes: MapRoute[] = [
  { id: 'base-e1', kind: 'baseline', path: [[-73.98, 40.7], [-73.92, 40.76]], ownerIds: ['emp-1'] },
  { id: 'base-e2', kind: 'baseline', path: [[-73.97, 40.75], [-73.95, 40.68]], ownerIds: ['emp-2'] },
  { id: 'leg-1', kind: 'leg', path: [[-73.98, 40.7], [-73.99, 40.74]], ownerIds: ['emp-1', 'shp-1'], tone: 'leg1' },
  { id: 'leg-2', kind: 'leg', path: [[-73.99, 40.74], [-73.97, 40.75]], ownerIds: ['emp-2', 'shp-1'], tone: 'leg2' },
  { id: 'leg-x', kind: 'leg', path: [[-73.95, 40.7], [-73.94, 40.71]], ownerIds: ['emp-3'] },
];
const movers: MapMover[] = [
  { id: 'emp-1', kind: 'vehicle', lat: 40.72, lng: -73.97, label: 'Ana' },
  { id: 'shp-1', kind: 'package', lat: 40.72, lng: -73.97, label: 'Proofs' },
];
const stops: MapStop[] = [
  { id: 'stop-3', n: 3, lat: 40.7411, lng: -73.9897, label: 'Pickup at Flatiron Relay' },
  { id: 'stop-1', n: 1, lat: 40.7033, lng: -73.9881, label: 'Pickup at DUMBO Café' },
  { id: 'stop-2', n: 2, lat: 40.7411, lng: -73.9897, label: 'Drop at Flatiron Relay' },
];
const all: LayerVisibility = { routes: true, businesses: true, homes: true, packages: true };
const none: LayerVisibility = { routes: false, businesses: false, homes: false, packages: false };

const ids = (specs: LayerSpec[]) => specs.map((s) => s.id);
const byId = <T extends LayerSpec>(specs: LayerSpec[], id: string) => specs.find((s) => s.id === id) as T;
const colorOfDatum = (d: LayerSpec['data'][number]) => ('fillColor' in d ? d.fillColor : d.color);

// WCAG 2 relative luminance and contrast ratio.
function luminance([r, g, b]: RGBA | [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: RGBA | [number, number, number], b: RGBA | [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function hue([r, g, b]: RGBA): number {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const d = max - Math.min(R, G, B);
  if (d === 0) return 0;
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return (h * 60 + 360) % 360;
}
const WHITE: [number, number, number] = [255, 255, 255];

describe('journey leg colors', () => {
  it('leg 1 is the accent and leg 2 a clearly different color', () => {
    expect(LEG1).toEqual(ACCENT);
    expect(LEG2.slice(0, 3)).not.toEqual(LEG1.slice(0, 3));
    const dh = Math.abs(hue(LEG1) - hue(LEG2));
    expect(Math.min(dh, 360 - dh)).toBeGreaterThan(90);
  });

  it('both legs have at least 3:1 contrast against white; leg vs leg contrast is computed', () => {
    const c1 = contrast(LEG1, WHITE);
    const c2 = contrast(LEG2, WHITE);
    const c12 = contrast(LEG1, LEG2);
    expect(c1).toBeGreaterThanOrEqual(3);
    expect(c2).toBeGreaterThanOrEqual(3);
    // Similar lightness on purpose (both read as strong lines); they differ in hue, checked above.
    expect(c1).toBeCloseTo(6.65, 1);
    expect(c2).toBeCloseTo(5.21, 1);
    expect(c12).toBeGreaterThan(1.2);
    expect(c12).toBeLessThan(1.4);
  });

  it('toneLabelColor gives the same color as the map, as CSS hex', () => {
    expect(toneLabelColor('leg1')).toBe('#28618A');
    expect(toneLabelColor(undefined)).toBe('#28618A');
    expect(toneLabelColor('leg2')).toBe('#C03A64');
    const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    expect(hex(toneLabelColor('leg2'))).toEqual(LEG2.slice(0, 3));
  });
});

describe('buildLayerSpecs: journey routes', () => {
  it('colors leg routes by tone (leg2 = LEG2; leg1 and untoned = accent)', () => {
    const legs = byId<PathSpec>(buildLayerSpecs({ places, routes, movers, visible: all }), 'routes-leg');
    const color = (id: string) => legs.data.find((d) => d.id === id)!.color;
    expect(color('leg-2')).toEqual(LEG2);
    expect(color('leg-1')).toEqual(ACCENT);
    expect(color('leg-x')).toEqual(ACCENT);
  });

  it('draws baselines below, thinner and fainter than legs, with and without a selection', () => {
    for (const selectedIds of [[], ['shp-1']]) {
      const specs = buildLayerSpecs({ places, routes, movers, visible: all, selectedIds });
      const order = ids(specs);
      const lastBase = Math.max(order.indexOf('routes-baseline'), order.indexOf('routes-baseline-selected'));
      const firstLegSel = order.indexOf(selectedIds.length ? 'routes-leg-selected' : 'routes-leg');
      expect(lastBase).toBeGreaterThanOrEqual(0);
      expect(lastBase).toBeLessThan(firstLegSel);
    }
    const specs = buildLayerSpecs({ places, routes, movers, visible: all });
    const base = byId<PathSpec>(specs, 'routes-baseline').data;
    const legs = byId<PathSpec>(specs, 'routes-leg').data;
    expect(ids(specs).indexOf('routes-baseline')).toBeLessThan(ids(specs).indexOf('routes-leg'));
    for (const b of base) {
      for (const l of legs) {
        expect(b.width).toBeLessThan(l.width);
        expect(b.color[3]).toBeLessThan(l.color[3]);
      }
    }
  });

  it('dims unselected leg2 routes to DIM_ALPHA like other routes', () => {
    const specs = buildLayerSpecs({ places, routes, movers, visible: all, selectedIds: ['emp-1'] });
    const dimmed = byId<PathSpec>(specs, 'routes-leg').data.find((d) => d.id === 'leg-2')!;
    expect(dimmed.color).toEqual([LEG2[0], LEG2[1], LEG2[2], DIM_ALPHA]);
    const sel = byId<PathSpec>(specs, 'routes-leg-selected').data.map((d) => d.id);
    expect(sel).toEqual(['leg-1']);
  });
});

describe('buildLayerSpecs: stops', () => {
  it('draws one circle per stop and the numbers 1, 2, 3 as the top-most layers', () => {
    const specs = buildLayerSpecs({ places, routes, movers, visible: all, stops });
    expect(ids(specs).slice(-2)).toEqual(['stops', 'stops-number']);
    const circles = byId<ScatterSpec>(specs, 'stops');
    const numbers = byId<TextSpec>(specs, 'stops-number');
    expect(circles.type).toBe('scatter');
    expect(circles.data).toHaveLength(3);
    expect(circles.data.map((d) => d.id)).toEqual(['stop-1', 'stop-2', 'stop-3']);
    expect(circles.data[0].position).toEqual([-73.9881, 40.7033]);
    expect(numbers.type).toBe('text');
    expect(numbers.data.map((d) => d.text)).toEqual(['1', '2', '3']);
    expect(numbers.data.map((d) => d.position)).toEqual(circles.data.map((d) => d.position));
  });

  it('makes circles pickable with role "Stop n" and keeps the numbers unpickable', () => {
    const specs = buildLayerSpecs({ places, routes, movers, visible: all, stops });
    const circles = byId<ScatterSpec>(specs, 'stops');
    expect(circles.props.pickable).toBe(true);
    expect(circles.data[1].item).toEqual({ id: 'stop-2', kind: 'stop', label: 'Drop at Flatiron Relay', role: 'Stop 2' });
    expect(byId<TextSpec>(specs, 'stops-number').props.pickable).toBe(false);
  });

  it('keeps stops when every layer toggle is off', () => {
    const specs = buildLayerSpecs({ places, routes, movers: [], visible: none, stops });
    expect(ids(specs)).toEqual(['stops', 'stops-number']);
  });

  it('stays on top and is never dimmed with a selection', () => {
    const specs = buildLayerSpecs({ places, routes, movers, visible: all, selectedIds: ['emp-1'], stops });
    expect(ids(specs).slice(-3)).toEqual(['labels-selected', 'stops', 'stops-number']);
    for (const d of byId<ScatterSpec>(specs, 'stops').data) {
      expect(d.fillColor[3]).toBe(255);
      expect(d.lineColor[3]).toBe(255);
    }
    for (const d of byId<TextSpec>(specs, 'stops-number').data) expect(d.color[3]).toBe(255);
    // Stops are not labelled again by the selection label layer.
    const labels = byId<TextSpec>(specs, 'labels-selected').data.map((d) => d.id);
    expect(labels.some((id) => id.startsWith('stop-'))).toBe(false);
  });

  it('enlarges the hovered stop', () => {
    const plain = byId<ScatterSpec>(buildLayerSpecs({ places, routes, movers, visible: all, stops }), 'stops');
    const hovered = byId<ScatterSpec>(
      buildLayerSpecs({ places, routes, movers, visible: all, stops, hoveredId: 'stop-3' }),
      'stops',
    );
    expect(hovered.data[2].radius).toBeGreaterThan(plain.data[2].radius);
    expect(hovered.data[0].radius).toBe(plain.data[0].radius);
  });

  it('without stops (or with an empty list) the output is unchanged', () => {
    const before = buildLayerSpecs({ places, routes, movers, visible: all, selectedIds: ['emp-1'] });
    expect(buildLayerSpecs({ places, routes, movers, visible: all, selectedIds: ['emp-1'], stops: [] })).toEqual(before);
    expect(ids(before)).not.toContain('stops');
  });

  it('skips stops with non-finite coordinates', () => {
    const bad: MapStop[] = [...stops, { id: 'stop-4', n: 4, lat: Number.NaN, lng: -73.97, label: 'Delivered' }];
    const circles = byId<ScatterSpec>(buildLayerSpecs({ places, routes, movers, visible: all, stops: bad }), 'stops');
    expect(circles.data.map((d) => d.id)).toEqual(['stop-1', 'stop-2', 'stop-3']);
  });
});

describe('panDecision', () => {
  // Simulates the component: one ref holding the last key, one call per render.
  function run(sequence: (MapPanTarget | undefined)[]) {
    let last: string | null = null;
    const pans: { lat: number; lng: number }[] = [];
    for (const p of sequence) {
      const { key, target } = panDecision(last, p);
      last = key;
      if (target) pans.push(target);
    }
    return pans;
  }

  it('pans once per new key, not on re-render with the same key', () => {
    const a = { lat: 40.7, lng: -73.99, key: 'step-1' };
    const b = { lat: 40.74, lng: -73.98, key: 'step-2' };
    expect(run([a, { ...a }, { ...a }, b, { ...b }])).toEqual([
      { lat: 40.7, lng: -73.99 },
      { lat: 40.74, lng: -73.98 },
    ]);
  });

  it('never pans when panTo is undefined, and keeps the last key', () => {
    expect(run([undefined, undefined])).toEqual([]);
    expect(panDecision(null, undefined)).toEqual({ key: null, target: null });
    expect(panDecision('step-1', undefined)).toEqual({ key: 'step-1', target: null });
    const a = { lat: 40.7, lng: -73.99, key: 'step-1' };
    expect(run([a, undefined, a])).toHaveLength(1);
  });

  it('pans again when the key changes back', () => {
    const a = { lat: 40.7, lng: -73.99, key: 'step-1' };
    const b = { lat: 40.74, lng: -73.98, key: 'step-2' };
    expect(run([a, b, a])).toHaveLength(3);
  });

  it('consumes a key with a non-finite point without panning', () => {
    expect(panDecision(null, { lat: Number.NaN, lng: 0, key: 'bad' })).toEqual({ key: 'bad', target: null });
  });
});
