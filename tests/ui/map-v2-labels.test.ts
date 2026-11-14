// Names on the simulator map without hovering (#578): business names in the network view, the
// journey's sender / relay / recipient always named, and the package drawn above the journey symbols (#659).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NAME_BOX_HEIGHT,
  PACKAGE_HALO_WIDTH,
  SWAP_DX,
  SYMBOL_GLYPH,
  SYMBOL_SIZE,
  boxesOverlap,
  buildLayerSpecs,
  nameWidthPx,
  placeNames,
  projectPx,
  type BuildLayerInput,
  type LayerSpec,
  type NameBox,
  type ScatterSpec,
  type TextSpec,
} from '../../client/src/components/map/layers';
import { fitZoom, placesBounds } from '../../client/src/components/map/mapModel';
import type { LayerVisibility, MapMover, MapPlace } from '../../client/src/components/map/types';
import { simPageView, type SimReadyView } from '../../client/src/components/sim/v2/compose/simPageView';
import { INITIAL_SIM_DATA, type SimDataState } from '../../client/src/components/sim/v2/live/simDataModel';
import type { Selection } from '../../client/src/components/sim/v2/network/selectionModel';
import { DEFAULT_LAYERS } from '../../client/src/components/sim/v2/workspaceModel';
import { makeMap, makeSim } from './sim-v2-network-fixture';
import { T, realSim } from './sim-v2-real-helper';

const all: LayerVisibility = { routes: true, businesses: true, homes: true, packages: true };
/** The simulator's map area on a 1440 x 900 screen: 1440 minus the 320 px and 360 px panels. */
const VIEWPORT = { width: 760, height: 680 };

const byId = <S extends LayerSpec>(specs: LayerSpec[], id: string) => specs.find((s) => s.id === id) as S | undefined;
const ids = (specs: LayerSpec[]) => specs.map((s) => s.id);
const namedIds = (specs: LayerSpec[]) => (byId<TextSpec>(specs, 'labels-places')?.data ?? []).map((d) => d.id);

/** A drawn name's box, recomputed from the text datum alone (independent of placeNames' own boxes). */
function drawnBox(d: TextSpec['data'][number], zoom: number): NameBox {
  const [x, y] = projectPx(d.position[0], d.position[1], zoom);
  const [dx, dy] = d.offset ?? [0, 0];
  const w = nameWidthPx(d.text);
  return { x0: x + dx - w / 2, x1: x + dx + w / 2, y0: y + dy - NAME_BOX_HEIGHT / 2, y1: y + dy + NAME_BOX_HEIGHT / 2 };
}

function overlappingPairs(spec: TextSpec | undefined, zoom: number): string[] {
  const data = spec?.data ?? [];
  const boxes = data.map((d) => drawnBox(d, zoom));
  const bad: string[] = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) if (boxesOverlap(boxes[i], boxes[j])) bad.push(`${data[i].text} / ${data[j].text}`);
  }
  return bad;
}

// ---------- The 18 committed NYC businesses ----------
type FixtureBusiness = { id: string; name: string; neighborhood: string };
const root = resolve(__dirname, '../..');
const fixtureBusinesses = (JSON.parse(readFileSync(resolve(root, 'fixtures/nyc/businesses.json'), 'utf8')) as { businesses: FixtureBusiness[] }).businesses;
const coords = (JSON.parse(readFileSync(resolve(root, 'fixtures/nyc/matrix.json'), 'utf8')) as {
  places: Record<string, { lat: number; lng: number }>;
}).places;
const nyc: (MapPlace & { neighborhood: string })[] = fixtureBusinesses.map((b) => ({
  id: b.id, kind: 'business', lat: coords[b.id].lat, lng: coords[b.id].lng, label: b.name, neighborhood: b.neighborhood,
}));
const nycPlaces: MapPlace[] = nyc.map(({ neighborhood: _n, ...p }) => p);
const network = (zoom: number, over: Partial<BuildLayerInput> = {}) =>
  buildLayerSpecs({ places: nycPlaces, routes: [], movers: [], visible: all, labelBusinesses: true, zoom, ...over });

describe('placeNames', () => {
  const at = (id: string, text: string, always = false) => ({ id, text, lng: -73.99, lat: 40.75, gap: 14, always });

  it('puts a second name at the same place below the marker, and drops a third', () => {
    const placed = placeNames([at('a', 'Alpha'), at('b', 'Bravo'), at('c', 'Charlie')], 12);
    expect(placed.map((p) => p.id)).toEqual(['a', 'b']);
    expect(placed[0].offset[1]).toBeLessThan(0); // above
    expect(placed[1].offset[1]).toBeGreaterThan(0); // below
    expect(boxesOverlap(placed[0].box, placed[1].box)).toBe(false);
  });

  it('always draws an `always` name, placed first', () => {
    const placed = placeNames([at('a', 'Alpha'), at('b', 'Bravo'), at('c', 'Charlie', true)], 12);
    expect(placed.map((p) => p.id)).toEqual(['c', 'a']);
    const crowded = placeNames([at('x', 'X', true), at('y', 'Y', true), at('z', 'Z', true)], 12);
    expect(crowded.map((p) => p.id)).toEqual(['x', 'y', 'z']);
  });

  it('skips empty names and points without coordinates', () => {
    expect(placeNames([at('a', '  '), { ...at('b', 'Bravo'), lat: Number.NaN }], 12)).toEqual([]);
  });
});

describe('network view: business names without hovering', () => {
  const fitAll = fitZoom(placesBounds(nycPlaces)!, VIEWPORT);

  it('the zoom that fits the 18 businesses is a whole-city zoom', () => {
    expect(nycPlaces).toHaveLength(18);
    expect(fitAll).toBeGreaterThanOrEqual(10);
    expect(fitAll).toBeLessThanOrEqual(12);
  });

  it('at that zoom, no two drawn name boxes overlap, and some names wait for a closer zoom', () => {
    const specs = network(fitAll);
    const names = byId<TextSpec>(specs, 'labels-places');
    expect(names).toBeDefined();
    expect(names!.data.length).toBeGreaterThanOrEqual(6);
    expect(names!.data.length).toBeLessThan(18);
    expect(overlappingPairs(names, fitAll)).toEqual([]);
    // Same text style as the selected labels.
    const selected = byId<TextSpec>(buildLayerSpecs({ places: nycPlaces, routes: [], movers: [], visible: all, selectedIds: [nycPlaces[0].id] }), 'labels-selected')!;
    for (const k of ['sizeUnits', 'getSize', 'fontFamily', 'outlineWidth', 'outlineColor', 'fontSettings', 'getTextAnchor', 'pickable']) {
      expect(names!.props[k]).toEqual(selected.props[k]);
    }
    expect(new Set(names!.data.map((d) => String(d.color)))).toEqual(new Set([String(selected.data[0].color)]));
  });

  it('a hidden name appears when zooming in, and the names stay apart at every zoom', () => {
    const hidden = nycPlaces.filter((p) => !namedIds(network(fitAll)).includes(p.id));
    expect(hidden.length).toBeGreaterThan(0);
    for (let z = fitAll; z <= fitAll + 6; z += 0.5) {
      expect(overlappingPairs(byId<TextSpec>(network(z), 'labels-places'), z)).toEqual([]);
    }
    const shownAt = (id: string) => [1, 2, 3, 4, 5, 6].map((d) => fitAll + d).find((z) => namedIds(network(z)).includes(id));
    for (const p of hidden) expect(shownAt(p.id), p.label).toBeDefined();
  });

  it('zoomed to one neighbourhood, every business of it is named', () => {
    const hoods = [...new Set(nyc.map((b) => b.neighborhood))];
    const shared = hoods.filter((h) => nyc.filter((b) => b.neighborhood === h).length >= 2);
    expect(shared.length).toBeGreaterThanOrEqual(3);
    for (const h of hoods) {
      const own = nycPlaces.filter((_, i) => nyc[i].neighborhood === h);
      const z = fitZoom(placesBounds(own)!, VIEWPORT);
      const named = namedIds(network(z));
      for (const b of own) expect(named, `${b.label} (${h}) at zoom ${z}`).toContain(b.id);
    }
  });

  it('homes, vehicles and packages get no name; the Businesses toggle off hides the names', () => {
    const extra: MapPlace[] = [{ id: 'home-1', kind: 'home', lat: 40.6, lng: -73.8, label: 'Home of Ana' }];
    const movers: MapMover[] = [
      { id: 'emp-1', kind: 'vehicle', lat: 40.5, lng: -73.7, label: 'Ana' },
      { id: 'shp-1', kind: 'package', lat: 40.55, lng: -73.75, label: 'Proofs' },
    ];
    const specs = network(14, { places: [...nycPlaces, ...extra], movers });
    expect(namedIds(specs)).not.toContain('home-1');
    expect(namedIds(specs)).not.toContain('emp-1');
    expect(namedIds(specs)).not.toContain('shp-1');
    expect(namedIds(specs).length).toBe(18); // zoom 14: every business has room
    expect(ids(network(14, { visible: { ...all, businesses: false } }))).not.toContain('labels-places');
  });

  it('without labelBusinesses nothing is named (the Business and Employee maps are unchanged)', () => {
    expect(ids(network(14, { labelBusinesses: false }))).not.toContain('labels-places');
  });

  it('with a selection, the selected businesses are named and the dimmed ones are not', () => {
    const [a, b] = nycPlaces;
    const specs = network(14, { selectedIds: [a.id, b.id] });
    const selected = byId<TextSpec>(specs, 'labels-selected')!.data.map((d) => d.id).sort();
    expect(selected).toEqual([a.id, b.id].sort());
    expect(byId(specs, 'labels-places')).toBeUndefined();
  });
});

describe('simPageView: what the network view passes to the map', () => {
  const ready: SimDataState = { ...INITIAL_SIM_DATA, view: 'ready', sim: makeSim(), map: makeMap() };
  const view = (selection: Selection, focus?: Parameters<typeof simPageView>[0]['focus']) =>
    simPageView({ data: ready, selection, focus, layers: DEFAULT_LAYERS }) as SimReadyView;

  it('names the businesses; with a focus, the kept businesses are named', () => {
    const net = view(null);
    expect(net.map.labelBusinesses).toBe(true);
    expect(net.map.alwaysLabelIds).toEqual([]);
    const specs = buildLayerSpecs({ ...net.map, zoom: 16 });
    const businesses = net.map.places.filter((p) => p.kind === 'business').map((p) => p.id);
    expect(namedIds(specs).sort()).toEqual(businesses.sort());

    const focus = { kind: 'business' as const, id: businesses[0] };
    const focused = view(null, focus);
    const kept = focused.map.places.filter((p) => p.kind === 'business').map((p) => p.id);
    expect(kept.length).toBeLessThanOrEqual(businesses.length);
    expect(namedIds(buildLayerSpecs({ ...focused.map, zoom: 16 })).sort()).toEqual(kept.sort());
  });

  it('an unmatched package fits the map to its two businesses', () => {
    const v = view({ kind: 'package', id: 'shp-3' });
    expect(v.right.kind).toBe('unmatched');
    const shipment = ready.sim!.shipments.find((s) => s.id === 'shp-3')!;
    const ends = ready.map!.businesses.filter((b) => b.id === shipment.originBusinessId || b.id === shipment.destinationBusinessId);
    expect(ends).toHaveLength(2);
    const fit = v.map.fitTo;
    if (fit === 'places') throw new Error('expected bounds');
    for (const b of ends) {
      expect(b.lat).toBeGreaterThan(fit.south);
      expect(b.lat).toBeLessThan(fit.north);
      expect(b.lng).toBeGreaterThan(fit.west);
      expect(b.lng).toBeLessThan(fit.east);
    }
    // Tight around the two businesses: not the whole network.
    const all = placesBounds(v.map.places)!;
    expect(fit.north - fit.south).toBeLessThanOrEqual(all.north - all.south);
    // The two businesses are named (the selection labels them).
    const specs = buildLayerSpecs({ ...v.map, zoom: 14 });
    const named = byId<TextSpec>(specs, 'labels-selected')!.data.map((d) => d.id);
    for (const b of ends) expect(named).toContain(b.id);
  });
});

describe('a relay journey at 1440 (the package waits overnight at the relay point)', () => {
  function relayJourney() {
    const moment = realSim().at(1440);
    const plan = moment.sim.plans.find((p) => p.kind === 'relay' && moment.sim.snapshot.shipmentStatus[p.shipmentId] === 'at_hub');
    if (!plan || !plan.relayBusinessId) throw new Error('the default run has no package at a relay point at 1440');
    const layersOff = { ...DEFAULT_LAYERS, packages: false };
    const v = simPageView({ data: moment.data, selection: { kind: 'package', id: plan.shipmentId }, layers: layersOff }) as SimReadyView;
    if (v.right.kind !== 'journey') throw new Error('expected a journey');
    const relay = moment.map.businesses.find((b) => b.id === plan.relayBusinessId)!;
    const shipment = moment.sim.shipments.find((s) => s.id === plan.shipmentId)!;
    return { v, plan, relay, shipment, journey: v.right.journey };
  }

  it('draws the package last, as a ring with a halo around the relay diamond, even with the Packages toggle off', () => {
    const { v, relay } = relayJourney();
    expect(v.map.visible.packages).toBe(true);
    const zoom = fitZoom(v.map.fitTo === 'places' ? placesBounds(v.map.places)! : v.map.fitTo, VIEWPORT);
    const specs = buildLayerSpecs({ ...v.map, zoom });
    expect(ids(specs).slice(-4)).toEqual(['stops-symbol', 'stops-label', 'movers-package-halo', 'movers-package']);
    const ring = byId<ScatterSpec>(specs, 'movers-package')!;
    const halo = byId<ScatterSpec>(specs, 'movers-package-halo')!;
    expect(ring.props.filled).toBe(false); // hollow: the diamond under it stays visible
    expect(ring.data).toHaveLength(1);
    const [lng, lat] = ring.data[0].position;
    expect(Math.abs(lng - relay.lng)).toBeLessThan(1e-5);
    expect(Math.abs(lat - relay.lat)).toBeLessThan(1e-5);
    // Outside the diamond glyph, and the halo wider than the ring on both sides.
    expect(ring.data[0].radius - ring.data[0].lineWidth / 2).toBeGreaterThan(SYMBOL_SIZE / 2);
    expect(halo.data[0].radius).toBe(ring.data[0].radius);
    expect(halo.data[0].lineWidth).toBe(ring.data[0].lineWidth + 2 * PACKAGE_HALO_WIDTH);
    // The swap symbol beside the diamond is outside the ring and its halo.
    expect(SWAP_DX - SYMBOL_SIZE / 2).toBeGreaterThanOrEqual(ring.data[0].radius + halo.data[0].lineWidth / 2 - 2);
  }, T);

  it('the relay shows the diamond "Overnight · <relay>" and, beside it, the swap "Handed to <carrier B>"', () => {
    const { v, relay, journey } = relayJourney();
    const at = (d: { position: [number, number] }) => Math.abs(d.position[0] - relay.lng) < 1e-5 && Math.abs(d.position[1] - relay.lat) < 1e-5;
    const specs = buildLayerSpecs({ ...v.map, zoom: 13 });
    expect(ids(specs)).not.toContain('stops');
    expect(ids(specs)).not.toContain('stops-number');
    const glyphs = byId<TextSpec>(specs, 'stops-symbol')!.data.filter(at);
    expect(glyphs.map((d) => [d.text, d.offset])).toEqual([[SYMBOL_GLYPH.relay, [0, 0]], [SYMBOL_GLYPH.swap, [SWAP_DX, 0]]]);
    const labels = byId<TextSpec>(specs, 'stops-label')!.data.filter(at).map((d) => d.text);
    expect(labels).toEqual([`Overnight · ${relay.name}`, `Handed to ${journey.carriers[1].name}`]);
  }, T);

  it('names the sender, the recipient and the relay business once each, never a carrier home, without overlaps', () => {
    const { v, relay, shipment } = relayJourney();
    const want = [shipment.originBusinessId, shipment.destinationBusinessId, relay.id].sort();
    expect([...v.map.alwaysLabelIds].sort()).toEqual(want);
    const name = (id: string) => v.map.places.find((p) => p.id === id)!.label;
    // At any zoom, however crowded.
    for (const zoom of [9, 11, 13]) {
      const specs = buildLayerSpecs({ ...v.map, zoom });
      const texts = [...(byId<TextSpec>(specs, 'labels-places')?.data ?? []), ...byId<TextSpec>(specs, 'stops-label')!.data].map((d) => d.text);
      expect(texts).toContain(name(shipment.originBusinessId));
      expect(texts).toContain(`Overnight · ${relay.name}`);
      expect(texts).toContain(`To ${name(shipment.destinationBusinessId)}`);
      for (const id of want) expect(texts.filter((t) => t.includes(name(id)))).toHaveLength(1);
      const homes = v.map.places.filter((p) => p.kind === 'home').map((p) => p.id);
      expect(homes.length).toBeGreaterThan(0);
      for (const h of homes) expect(namedIds(specs)).not.toContain(h);
    }
    // At the zoom the journey opens at, no two names or symbol labels overlap.
    const fit = fitZoom(v.map.fitTo === 'places' ? placesBounds(v.map.places)! : v.map.fitTo, VIEWPORT);
    const specs = buildLayerSpecs({ ...v.map, zoom: fit });
    const together: TextSpec = {
      type: 'text', id: 'all', props: {},
      data: [...(byId<TextSpec>(specs, 'labels-places')?.data ?? []), ...byId<TextSpec>(specs, 'stops-label')!.data],
    };
    expect(together.data.length).toBeGreaterThanOrEqual(4);
    expect(overlappingPairs(together, fit)).toEqual([]);
  }, T);
});
