// #780 (docs/mvp4.md F2): in the network view a package waiting overnight at its relay point gets the relay
// diamond with "Overnight", and a delivered package the flag, as a journey shows them. The reason is read
// from the snapshot's `shipmentStatus` (`withWaiting`), never computed; the map only draws it.
import { describe, expect, it } from 'vitest';
import * as L from '../../client/src/components/map/layers';
import { buildLayerSpecs, type LayerSpec, type ScatterSpec, type TextSpec } from '../../client/src/components/map/layers';
import { NYC_ZOOM } from '../../client/src/components/map/mapStyle';
import type { MapMover, MapPlace } from '../../client/src/components/map/types';
import { simPageView, withWaiting } from '../../client/src/components/sim/v2/compose/simPageView';
import { INITIAL_SIM_DATA } from '../../client/src/components/sim/v2/live/simDataModel';
import { DEFAULT_LAYERS } from '../../client/src/components/sim/v2/workspaceModel';
import { COORD, map, simAt } from './sim-v2-journey-sample';

const spec = <S extends LayerSpec>(specs: LayerSpec[], id: string) => specs.find((s) => s.id === id) as S | undefined;
const biz = (id: string): MapPlace => ({ id, kind: 'business', lat: COORD[id][0], lng: COORD[id][1], label: id });
const pkg = (id: string, at: string, waiting?: MapMover['waiting']): MapMover => ({
  id, kind: 'package', lat: COORD[at][0], lng: COORD[at][1], label: id, ...(waiting ? { waiting } : {}),
});
const places = [biz('biz-roast'), biz('biz-etsy'), biz('biz-dumbo')];
const build = (movers: MapMover[], extra: Partial<L.BuildLayerInput> = {}) =>
  buildLayerSpecs({ places, routes: [], movers, visible: DEFAULT_LAYERS, labelBusinesses: true, zoom: NYC_ZOOM, ...extra });

describe('withWaiting: the reason from the snapshot status (#780)', () => {
  it('at_hub is overnight, delivered is delivered; carried and scheduled packages get nothing', () => {
    const sim = simAt(1500, { 'shp-2': 'at_hub' });
    const statuses = { ...sim.snapshot.shipmentStatus, 'shp-1': 'delivered' as const, 'shp-3': 'scheduled' as const };
    const s = { ...sim, snapshot: { ...sim.snapshot, shipmentStatus: statuses } };
    const out = withWaiting([pkg('shp-1', 'biz-etsy'), pkg('shp-2', 'biz-roast'), pkg('shp-3', 'biz-dumbo'),
      { ...pkg('shp-9', 'biz-dumbo'), carrierId: 'emp-1' }], { ...s, snapshot: { ...s.snapshot, shipmentStatus: { ...statuses, 'shp-9': 'at_hub' } } });
    expect(out.map((m) => m.waiting)).toEqual(['delivered', 'overnight', undefined, undefined]);
  });

  it('the network view of the page sets it; a journey keeps its own stops and symbols instead', () => {
    // Overnight: nobody carries the package, which waits at the relay business.
    const base = simAt(1500, { 'shp-2': 'at_hub' });
    const [lat, lng] = COORD['biz-roast'];
    const sim = {
      ...base,
      snapshot: {
        ...base.snapshot,
        markers: base.snapshot.markers.map(({ carryingShipmentId: _drop, ...m }) => m),
        packagePositions: { ...base.snapshot.packagePositions, 'shp-2': { lat, lng } },
      },
    };
    const data = { ...INITIAL_SIM_DATA, view: 'ready' as const, sim, map };
    const net = simPageView({ data, selection: null, layers: DEFAULT_LAYERS });
    if (net.view !== 'ready') throw new Error('not ready');
    expect(net.map.movers.find((m) => m.id === 'shp-2')?.waiting).toBe('overnight');
    const journey = simPageView({ data, selection: { kind: 'package', id: 'shp-2' }, layers: DEFAULT_LAYERS });
    if (journey.view !== 'ready') throw new Error('not ready');
    expect(journey.map.movers.find((m) => m.id === 'shp-2')?.waiting).toBeUndefined();
  });
});

describe('network layers: the diamond with "Overnight", the delivered flag (#780)', () => {
  it('one glyph per business and reason, in ink, not pickable; the label counts the packages', () => {
    const specs = build([pkg('a', 'biz-roast', 'overnight'), pkg('b', 'biz-roast', 'overnight'), pkg('c', 'biz-etsy', 'delivered'), pkg('d', 'biz-dumbo')]);
    const glyphs = spec<TextSpec>(specs, 'movers-package-waiting')!;
    expect(glyphs.props.pickable).toBe(false);
    expect(glyphs.props.getSize).toBe(L.WAITING_SYMBOL_SIZE);
    expect(glyphs.data.map((d) => [d.text, d.position, d.color])).toEqual([
      [L.WAITING_GLYPH.overnight, [COORD['biz-roast'][1], COORD['biz-roast'][0]], L.RELAY_INK],
      [L.WAITING_GLYPH.delivered, [COORD['biz-etsy'][1], COORD['biz-etsy'][0]], L.RELAY_INK],
    ]);
    const labels = spec<TextSpec>(specs, 'movers-package-label')!;
    expect(labels.data.map((d) => d.text)).toEqual(['Overnight · 2 packages']);
    expect(L.overnightLabel(1)).toBe('Overnight');
    // The labels and the business names never overlap (placed together).
    const names = spec<TextSpec>(specs, 'labels-places')!.data;
    const roastName = names.find((n) => n.id === 'biz-roast');
    if (roastName) expect(roastName.offset).not.toEqual(labels.data[0].offset);
  });

  it('a waiting package\'s dot rides on the glyph\'s rim; a package at its sender stays on the business', () => {
    const specs = build([pkg('a', 'biz-roast', 'overnight'), pkg('d', 'biz-dumbo')]);
    const dots = spec<ScatterSpec>(specs, 'movers-package')!.data;
    const rim = L.offsetByPx([COORD['biz-roast'][1], COORD['biz-roast'][0]], L.PACKAGE_BADGE_OFFSET[0], L.PACKAGE_BADGE_OFFSET[1], NYC_ZOOM);
    expect(dots.find((d) => d.id === 'a')!.position).toEqual(rim);
    expect(dots.find((d) => d.id === 'd')!.position).toEqual([COORD['biz-dumbo'][1], COORD['biz-dumbo'][0]]);
  });

  it('dimmed with a selection that holds neither the package nor the business; its label then drops', () => {
    const movers = [pkg('a', 'biz-roast', 'overnight'), pkg('c', 'biz-etsy', 'delivered')];
    const specs = build(movers, { selectedIds: ['c'] });
    const glyphs = spec<TextSpec>(specs, 'movers-package-waiting')!.data;
    expect(glyphs.find((g) => g.text === L.WAITING_GLYPH.overnight)!.color[3]).toBe(L.DIM_ALPHA);
    expect(glyphs.find((g) => g.text === L.WAITING_GLYPH.delivered)!.color).toEqual(L.RELAY_INK);
    expect(spec(specs, 'movers-package-label')).toBeUndefined();
    // Selecting the relay business keeps its diamond and label.
    const byBusiness = build(movers, { selectedIds: ['biz-roast'] });
    expect(spec<TextSpec>(byBusiness, 'movers-package-label')!.data.map((d) => d.text)).toEqual(['Overnight']);
  });

  it('nothing with the packages hidden, nothing in a journey (stops draw the symbols there), nothing without a reason', () => {
    const movers = [pkg('a', 'biz-roast', 'overnight')];
    expect(spec(build(movers, { visible: { ...DEFAULT_LAYERS, packages: false } }), 'movers-package-waiting')).toBeUndefined();
    const stops = [{ id: 's', n: 1, lat: COORD['biz-roast'][0], lng: COORD['biz-roast'][1], label: 'Overnight · Roast', symbol: 'relay' as const }];
    const journey = build(movers, { stops });
    expect(spec(journey, 'movers-package-waiting')).toBeUndefined();
    expect(spec(journey, 'movers-package-label')).toBeUndefined();
    expect(spec(build([pkg('d', 'biz-dumbo')]), 'movers-package-waiting')).toBeUndefined();
  });
});
