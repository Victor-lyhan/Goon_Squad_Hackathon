import { describe, expect, it } from 'vitest';
import {
  LEG1,
  DIM_ALPHA,
  buildLayerSpecs,
  decodePath,
  type LayerSpec,
  type ScatterSpec,
} from '../../client/src/components/map/layers';
import type { LayerVisibility, MapMover, MapPlace, MapRoute } from '../../client/src/components/map/types';

const places: MapPlace[] = [
  { id: 'biz-a', kind: 'business', lat: 40.7033, lng: -73.9881, label: 'DUMBO Café', sublabel: 'DUMBO' },
  { id: 'biz-b', kind: 'business', lat: 40.7527, lng: -73.9772, label: 'Midtown Agency' },
  { id: 'home-1', kind: 'home', lat: 40.7644, lng: -73.9235, label: 'Astoria' },
];
const routes: MapRoute[] = [
  { id: 'base-e1', kind: 'baseline', path: [[-73.98, 40.70], [-73.92, 40.76]], ownerIds: ['emp-1'] },
  { id: 'base-e2', kind: 'baseline', path: [[-73.97, 40.75], [-73.95, 40.68]], ownerIds: ['emp-2'] },
  { id: 'leg-1', kind: 'leg', path: [[-73.98, 40.70], [-73.97, 40.75]], ownerIds: ['emp-1', 'shp-1'] },
];
const movers: MapMover[] = [
  { id: 'emp-1', kind: 'vehicle', lat: 40.72, lng: -73.97, label: 'Ana' },
  { id: 'emp-2', kind: 'vehicle', lat: 40.71, lng: -73.96, label: 'Ben' },
  { id: 'shp-1', kind: 'package', lat: 40.72, lng: -73.97, label: 'Proofs' },
];
const all: LayerVisibility = { routes: true, businesses: true, homes: true, packages: true };

const ids = (specs: LayerSpec[]) => specs.map((s) => s.id);
const byId = (specs: LayerSpec[], id: string) => specs.find((s) => s.id === id)!;

describe('decodePath', () => {
  it('decodes the Google sample polyline into [lng, lat] order', () => {
    expect(decodePath('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it('returns an empty path for an empty string', () => {
    expect(decodePath('')).toEqual([]);
  });
});

describe('buildLayerSpecs', () => {
  it('returns layers in draw order with the expected IDs and counts', () => {
    const specs = buildLayerSpecs({ places, routes, movers, visible: all });
    expect(ids(specs)).toEqual([
      'routes-baseline',
      'routes-leg',
      'places-business',
      'places-home',
      'movers-vehicle',
      'movers-package',
    ]);
    expect(specs.map((s) => s.data.length)).toEqual([2, 1, 2, 1, 2, 1]);
    expect(specs.map((s) => s.type)).toEqual(['path', 'path', 'scatter', 'scatter', 'scatter', 'scatter']);
  });

  it('uses [lng, lat] positions and keeps route paths as given', () => {
    const specs = buildLayerSpecs({ places, routes, movers, visible: all });
    const biz = byId(specs, 'places-business') as ScatterSpec;
    expect(biz.data[0].position).toEqual([-73.9881, 40.7033]);
    const legs = byId(specs, 'routes-leg');
    expect(legs.type === 'path' && legs.data[0].path[0]).toEqual([-73.98, 40.7]);
  });

  it("draws leg routes in carrier A's blue #1D5075 and baselines quieter", () => {
    const specs = buildLayerSpecs({ places, routes, movers, visible: all });
    const leg = byId(specs, 'routes-leg');
    const base = byId(specs, 'routes-baseline');
    if (leg.type !== 'path' || base.type !== 'path') throw new Error('expected path layers');
    expect(leg.data[0].color.slice(0, 3)).toEqual([0x1d, 0x50, 0x75]);
    expect(leg.data[0].color).toEqual(LEG1);
    expect(base.data[0].width).toBeLessThan(leg.data[0].width);
  });

  it('omits hidden layers (vehicles have no toggle and stay)', () => {
    const specs = buildLayerSpecs({
      places,
      routes,
      movers,
      visible: { routes: false, businesses: false, homes: false, packages: false },
    });
    expect(ids(specs)).toEqual(['movers-vehicle']);
    const onlyHomesHidden = buildLayerSpecs({ places, routes, movers, visible: { ...all, homes: false } });
    expect(ids(onlyHomesHidden)).not.toContain('places-home');
    expect(ids(onlyHomesHidden)).toHaveLength(5);
  });

  it('omits empty layers', () => {
    expect(buildLayerSpecs({ places: [], routes: [], movers: [], visible: all })).toEqual([]);
  });

  it('carries label and role for the tooltip', () => {
    const specs = buildLayerSpecs({ places, routes, movers, visible: all });
    const biz = byId(specs, 'places-business') as ScatterSpec;
    expect(biz.data[0].item).toEqual({ id: 'biz-a', kind: 'business', label: 'DUMBO Café', role: 'Network business · DUMBO' });
    const pkg = byId(specs, 'movers-package') as ScatterSpec;
    expect(pkg.data[0].item.role).toBe('Package');
  });

  it('a route\'s tooltip uses its label; without one it keeps the generic text', () => {
    const named: MapRoute[] = [
      { ...routes[0], label: 'Cy Lam · evening' },
      routes[1],
      { ...routes[2], label: 'Coffee samples · leg 1 of 2 · carried by Cy Lam' },
      { id: 'leg-blank', kind: 'leg', path: routes[2].path, ownerIds: [], label: '   ' },
    ];
    const specs = buildLayerSpecs({ places, routes: named, movers, visible: all });
    const item = (layer: string, id: string) => {
      const spec = byId(specs, layer);
      return spec.type === 'path' ? spec.data.find((d) => d.id === id)?.item : undefined;
    };
    expect(item('routes-baseline', 'base-e1')).toEqual({ id: 'base-e1', kind: 'baseline', label: 'Cy Lam · evening', role: 'Normal commute' });
    expect(item('routes-baseline', 'base-e2')).toEqual({ id: 'base-e2', kind: 'baseline', label: 'Commute', role: 'Normal commute' });
    expect(item('routes-leg', 'leg-1')).toEqual({
      id: 'leg-1', kind: 'leg', label: 'Coffee samples · leg 1 of 2 · carried by Cy Lam', role: 'Delivery route',
    });
    expect(item('routes-leg', 'leg-blank')).toEqual({ id: 'leg-blank', kind: 'leg', label: 'Delivery route', role: 'Delivery route' });

    // A selected route is drawn again on top with the same tooltip.
    const sel = buildLayerSpecs({ places, routes: named, movers, visible: all, selectedIds: ['shp-1'] });
    const top = byId(sel, 'routes-leg-selected');
    expect(top.type === 'path' && top.data.map((d) => d.item.label)).toEqual(['Coffee samples · leg 1 of 2 · carried by Cy Lam']);
  });

  it('has no dimming without a selection', () => {
    const specs = buildLayerSpecs({ places, routes, movers, visible: all, selectedIds: [] });
    for (const s of specs) {
      for (const d of s.data) {
        const c = 'fillColor' in d ? d.fillColor : d.color;
        expect(c[3]).toBeGreaterThan(DIM_ALPHA);
      }
    }
  });

  it('dims unselected items and draws selected ones (and routes they own) last', () => {
    const specs = buildLayerSpecs({ places, routes, movers, visible: all, selectedIds: ['emp-1', 'biz-a'] });
    expect(ids(specs)).toEqual([
      'routes-baseline', // base-e2 (dimmed)
      'places-business', // biz-b (dimmed)
      'places-home',
      'movers-vehicle', // emp-2 (dimmed)
      'movers-package', // shp-1 (dimmed: not owned, packages have no owners)
      'routes-baseline-selected', // base-e1 (owned by emp-1)
      'routes-leg-selected', // leg-1 (owned by emp-1)
      'places-business-selected', // biz-a
      'movers-vehicle-selected', // emp-1
      'labels-selected',
    ]);

    const dimmed = specs.filter((s) => !s.id.endsWith('-selected') && s.type !== 'text');
    for (const s of dimmed) {
      for (const d of s.data) {
        const c = 'fillColor' in d ? d.fillColor : d.color;
        expect(c[3]).toBeLessThanOrEqual(DIM_ALPHA);
      }
    }
    const top = specs.filter((s) => s.id.endsWith('-selected') && s.type !== 'text');
    expect(top.flatMap((s) => s.data.map((d) => d.id)).sort()).toEqual(['base-e1', 'biz-a', 'emp-1', 'leg-1']);
    for (const s of top) {
      for (const d of s.data) {
        const c = 'fillColor' in d ? d.fillColor : d.color;
        expect(c[3]).toBeGreaterThan(DIM_ALPHA);
      }
    }
    const labels = byId(specs, 'labels-selected');
    expect(labels.type === 'text' && labels.data.map((d) => d.text).sort()).toEqual(['Ana', 'DUMBO Café']);
  });

  it('selecting a package highlights the leg it owns', () => {
    const specs = buildLayerSpecs({ places, routes, movers, visible: all, selectedIds: ['shp-1'] });
    expect(ids(specs).filter((id) => id.endsWith('-selected'))).toEqual([
      'routes-leg-selected',
      'movers-package-selected',
      'labels-selected',
    ]);
  });

  it('keeps every item exactly once across dimmed and selected layers', () => {
    const specs = buildLayerSpecs({ places, routes, movers, visible: all, selectedIds: ['emp-2'] });
    const drawn = specs.filter((s) => s.type !== 'text').flatMap((s) => s.data.map((d) => d.id));
    expect(drawn.sort()).toEqual([...places, ...routes, ...movers].map((x) => x.id).sort());
  });

  it('enlarges the hovered marker', () => {
    const plain = byId(buildLayerSpecs({ places, routes, movers, visible: all }), 'places-business') as ScatterSpec;
    const hovered = byId(
      buildLayerSpecs({ places, routes, movers, visible: all, hoveredId: 'biz-b' }),
      'places-business',
    ) as ScatterSpec;
    expect(hovered.data[1].radius).toBeGreaterThan(plain.data[1].radius);
    expect(hovered.data[0].radius).toBe(plain.data[0].radius);
  });
});
