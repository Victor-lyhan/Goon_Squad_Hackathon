// #762 (docs/mvp4.md F2): the employee is the big moving marker (carrier colour + white letter), the
// package rides on it as a small orange badge while carried and waits at the business (Overnight
// diamond, delivered flag) otherwise; an uncached place pair is a straight dashed line, never a crash;
// the deck.gl text layers ask for the loaded face (Inter 600).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as L from '../../client/src/components/map/layers';
import { buildLayerSpecs, type LayerSpec, type PathSpec, type ScatterSpec, type TextSpec } from '../../client/src/components/map/layers';
import { withNightCasing } from '../../client/src/components/map/dayNight';
import { selectedItemText } from '../../client/src/components/map/mapModel';
import { NYC_ZOOM } from '../../client/src/components/map/mapStyle';
import type { MapMover } from '../../client/src/components/map/types';
import {
  firstNameInitial, simPageView, uncachedJourneyRoutes, withCarriers, type SimReadyView,
} from '../../client/src/components/sim/v2/compose/simPageView';
import { JourneyLegend, CARRIER_MARKER_TEXT } from '../../client/src/components/sim/v2/journey/JourneyLegend';
import { INITIAL_SIM_DATA, type SimDataState } from '../../client/src/components/sim/v2/live/simDataModel';
import { DEFAULT_LAYERS } from '../../client/src/components/sim/v2/workspaceModel';
import type { MapResponse, SimulatorResponse } from '../../shared/v2/api';
import { COORD, T, map, simAt } from './sim-v2-journey-sample';

const data = (sim: SimulatorResponse, m: MapResponse = map): SimDataState => ({
  ...INITIAL_SIM_DATA, view: 'ready', sim, map: m,
});
const pageView = (sim: SimulatorResponse, selection: { kind: 'package'; id: string } | null, m: MapResponse = map): SimReadyView => {
  const v = simPageView({ data: data(sim, m), selection, layers: DEFAULT_LAYERS });
  if (v.view !== 'ready') throw new Error('expected a ready view');
  return v;
};
const specsOf = (v: SimReadyView): LayerSpec[] => buildLayerSpecs({ ...v.map });
const spec = <S extends LayerSpec>(specs: LayerSpec[], id: string) => specs.find((s) => s.id === id) as S | undefined;
const hex = ([r, g, b]: L.RGBA) => `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
const lngLat = (id: string): [number, number] => [COORD[id][1], COORD[id][0]];

/** The relay sample with the package at `pos`, nobody carrying it (overnight at the relay, or delivered). */
function waitingAt(timeMin: number, placeId: string, status: 'at_hub' | 'delivered'): SimulatorResponse {
  const sim = simAt(timeMin, { 'shp-2': status });
  const [lat, lng] = COORD[placeId];
  return {
    ...sim,
    snapshot: {
      ...sim.snapshot,
      markers: sim.snapshot.markers.map(({ carryingShipmentId: _drop, ...m }) => m),
      packagePositions: { ...sim.snapshot.packagePositions, 'shp-2': { lat, lng } },
      ...(status === 'delivered' ? { deliveredAtMin: { 'shp-2': 1977 } } : {}),
    },
  };
}

describe('vehicles are the largest movers: radius, white outline, colour and letter', () => {
  it('journey: A blue / B green, radius VEHICLE_RADIUS (14-16 px) with a white outline and the white letter', () => {
    expect(L.VEHICLE_RADIUS).toBeGreaterThanOrEqual(14);
    expect(L.VEHICLE_RADIUS).toBeLessThanOrEqual(16);
    expect(L.OUTLINE).toEqual([255, 255, 255, 255]);
    // #851: one carrier at a time: A on the evening commute, B on the next morning's.
    for (const [t, status, id, color, letter] of [
      [T.onLeg1, 'picked_up', 'emp-3', '#1D5075', 'A'], [T.onLeg2, 'out_for_delivery', 'emp-2', '#0F8A5F', 'B'],
    ] as const) {
      const specs = specsOf(pageView(simAt(t, { 'shp-2': status }), { kind: 'package', id: 'shp-2' }));
      const vehicles = spec<ScatterSpec>(specs, 'movers-vehicle')!.data;
      expect(vehicles.map((d) => [d.id, hex(d.fillColor), d.radius, d.lineColor, d.lineWidth])).toEqual([
        [id, color, 15, L.OUTLINE, L.VEHICLE_OUTLINE_WIDTH],
      ]);
      const letters = spec<TextSpec>(specs, 'movers-vehicle-badge')!;
      expect(letters.data.map((d) => [d.id, d.text, d.color])).toEqual([[id, letter, L.BADGE_TEXT]]);
      expect(letters.props.getSize).toBe(L.VEHICLE_LETTER_SIZE);
    }
  });

  it('the carrier marker is larger than every other mover and every stop circle', () => {
    expect(L.VEHICLE_RADIUS).toBeGreaterThan(L.PACKAGE_BADGE_RADIUS * 2);
    expect(L.VEHICLE_RADIUS).toBeGreaterThan(L.STOP_RADIUS);
  });

  it('network Play: every moving carrier in the network vehicle colour with its first-name initial (MapResponse.employees)', () => {
    const specs = specsOf(pageView(simAt(T.onLeg1), null));
    const vehicles = spec<ScatterSpec>(specs, 'movers-vehicle')!.data;
    expect(vehicles.map((d) => [d.id, hex(d.fillColor), d.radius])).toEqual([
      ['emp-2', '#1D5075', 15], ['emp-3', '#1D5075', 15], ['emp-9', '#1D5075', 15],
    ]);
    expect(hex(L.VEHICLE_FILL)).toBe('#1D5075');
    // Ben Okafor, Cy Lam, Dee Park.
    expect(spec<TextSpec>(specs, 'movers-vehicle-badge')!.data.map((d) => [d.id, d.text])).toEqual([
      ['emp-2', 'B'], ['emp-3', 'C'], ['emp-9', 'D'],
    ]);
  });

  it('firstNameInitial: first letter of the first name, upper case; nothing without a name', () => {
    expect(firstNameInitial('Maya Ortiz')).toBe('M');
    expect(firstNameInitial('  élodie  Brun')).toBe('É');
    expect(firstNameInitial('')).toBeUndefined();
    expect(firstNameInitial(undefined)).toBeUndefined();
  });

  it('an employee missing from MapResponse.employees gets no letter (never a guess)', () => {
    const m = { ...map, employees: map.employees.filter((e) => e.id !== 'emp-9') };
    const movers = pageView(simAt(T.onLeg1), null, m).map.movers;
    expect(movers.find((x) => x.id === 'emp-9')?.badge).toBeUndefined();
    expect(movers.find((x) => x.id === 'emp-3')?.badge).toBe('C');
  });
});

describe('the package rides on its carrier while carried', () => {
  it('carried (marker carryingShipmentId): a small orange badge on the carrier marker, no separate ring', () => {
    const v = pageView(simAt(T.onLeg1, { 'shp-2': 'picked_up' }), { kind: 'package', id: 'shp-2' });
    expect(v.map.movers.find((m) => m.id === 'shp-2')?.carrierId).toBe('emp-3');
    const specs = specsOf(v);
    expect(spec(specs, 'movers-package')).toBeUndefined();
    expect(spec(specs, 'movers-package-halo')).toBeUndefined();
    const badge = spec<ScatterSpec>(specs, 'movers-package-badge')!;
    expect(badge.data).toHaveLength(1);
    const [d] = badge.data;
    expect(d.fillColor).toEqual(L.PACKAGE_FILL);
    expect(d.radius).toBe(L.PACKAGE_BADGE_RADIUS);
    expect(d.lineColor).toEqual(L.OUTLINE);
    expect(d.item).toMatchObject({ id: 'shp-2', kind: 'package', label: 'Coffee samples', role: 'Package · with Cy Lam' });
    // Offset up and right of the carrier's centre by PACKAGE_BADGE_OFFSET pixels, on its rim.
    const carrier = spec<ScatterSpec>(specs, 'movers-vehicle')!.data.find((x) => x.id === 'emp-3')!;
    // Without a zoom from the map (tests), the builder places it at NYC_ZOOM.
    const [cx, cy] = L.projectPx(carrier.position[0], carrier.position[1], NYC_ZOOM);
    const [bx, by] = L.projectPx(d.position[0], d.position[1], NYC_ZOOM);
    expect(bx - cx).toBeCloseTo(L.PACKAGE_BADGE_OFFSET[0], 6);
    expect(by - cy).toBeCloseTo(L.PACKAGE_BADGE_OFFSET[1], 6);
    expect(Math.hypot(bx - cx, by - cy)).toBeLessThanOrEqual(L.VEHICLE_RADIUS + 1);
    // Drawn last, on top of the carrier, its letter and the stop symbols.
    expect(specs[specs.length - 1].id).toBe('movers-package-badge');
  });

  it('the badge follows the carrier as drawn this frame (tweened), not the package\'s own polled point', () => {
    const v = pageView(simAt(T.onLeg1, { 'shp-2': 'picked_up' }), { kind: 'package', id: 'shp-2' });
    const moved = v.map.movers.map((m) => (m.id === 'emp-3' ? { ...m, lat: m.lat + 0.01, lng: m.lng + 0.01 } : m));
    const specs = buildLayerSpecs({ ...v.map, movers: moved, zoom: 14 });
    const carrier = moved.find((m) => m.id === 'emp-3')!;
    const want = L.offsetByPx([carrier.lng, carrier.lat], L.PACKAGE_BADGE_OFFSET[0], L.PACKAGE_BADGE_OFFSET[1], 14);
    expect(spec<ScatterSpec>(specs, 'movers-package-badge')!.data[0].position).toEqual(want);
  });

  it('overnight: no carrier, the package waits at the relay business, ringed around the Overnight diamond', () => {
    const v = pageView(waitingAt(T.overnight, 'biz-roast', 'at_hub'), { kind: 'package', id: 'shp-2' });
    expect(v.map.movers.find((m) => m.id === 'shp-2')?.carrierId).toBeUndefined();
    const specs = specsOf(v);
    expect(spec(specs, 'movers-package-badge')).toBeUndefined();
    const ring = spec<ScatterSpec>(specs, 'movers-package')!.data[0];
    expect(ring.position).toEqual(lngLat('biz-roast'));
    expect(ring.radius).toBe(L.PACKAGE_RING_AT_SYMBOL);
    const relay = spec<TextSpec>(specs, 'stops-symbol')!.data.find((d) => d.text === L.SYMBOL_GLYPH.relay)!;
    expect(relay.position).toEqual(lngLat('biz-roast'));
    expect(spec<TextSpec>(specs, 'stops-label')!.data.map((d) => d.text)).toContain('Overnight · Brooklyn Roasting');
  });

  it('delivered: the package is left at the recipient with the delivered flag', () => {
    const v = pageView(waitingAt(T.afterDelivery, 'biz-etsy', 'delivered'), { kind: 'package', id: 'shp-2' });
    const specs = specsOf(v);
    expect(spec(specs, 'movers-package-badge')).toBeUndefined();
    const ring = spec<ScatterSpec>(specs, 'movers-package')!.data[0];
    expect(ring.position).toEqual(lngLat('biz-etsy'));
    const flag = spec<TextSpec>(specs, 'stops-symbol')!.data.find((d) => d.text === L.SYMBOL_GLYPH.recipient)!;
    expect(flag.position).toEqual(lngLat('biz-etsy'));
    expect(spec<TextSpec>(specs, 'stops-label')!.data.some((d) => d.text.startsWith('Delivered'))).toBe(true);
  });

  it('network view: a carried package is a badge on its carrier, a waiting one a dot at its business', () => {
    const specs = specsOf(pageView(simAt(T.onLeg1, { 'shp-2': 'picked_up' }), null));
    expect(spec<ScatterSpec>(specs, 'movers-package-badge')!.data.map((d) => d.id)).toEqual(['shp-2']);
    expect(spec<ScatterSpec>(specs, 'movers-package')!.data.map((d) => d.id)).toEqual(['shp-1']);
    const ids = specs.map((s) => s.id);
    expect(ids.indexOf('movers-package-badge')).toBe(ids.indexOf('movers-vehicle-badge') + 1);
  });

  it('network selection: the badge dims with neither its package nor its carrier selected', () => {
    const v = pageView(simAt(T.onLeg1, { 'shp-2': 'picked_up' }), null);
    const dimmed = buildLayerSpecs({ ...v.map, selectedIds: ['emp-2'] });
    expect(spec<ScatterSpec>(dimmed, 'movers-package-badge')!.data[0].fillColor[3]).toBe(L.DIM_ALPHA);
    const lit = buildLayerSpecs({ ...v.map, selectedIds: ['emp-3'] });
    expect(spec<ScatterSpec>(lit, 'movers-package-badge')!.data[0].fillColor).toEqual(L.PACKAGE_FILL);
  });

  it('a carrier not on the map (focus): the package falls back to its own marker, nothing floats', () => {
    const pkg: MapMover = { id: 'p', kind: 'package', lat: 40.7, lng: -73.99, label: 'P', carrierId: 'gone' };
    const specs = buildLayerSpecs({ places: [], routes: [], movers: [pkg], visible: DEFAULT_LAYERS });
    expect(spec(specs, 'movers-package-badge')).toBeUndefined();
    expect(spec<ScatterSpec>(specs, 'movers-package')!.data.map((d) => d.id)).toEqual(['p']);
  });

  it('withCarriers reads carryingShipmentId from the snapshot markers only', () => {
    const sim = simAt(T.onLeg1);
    const out = withCarriers(
      [{ id: 'shp-2', kind: 'package', lat: 0, lng: 0, label: 'x' }, { id: 'shp-1', kind: 'package', lat: 0, lng: 0, label: 'y' }],
      sim, map, true,
    );
    expect(out.map((m) => m.carrierId)).toEqual(['emp-3', undefined]);
  });

  it('the selected carried package names its carrier for screen readers', () => {
    const v = pageView(simAt(T.onLeg1, { 'shp-2': 'picked_up' }), null);
    expect(selectedItemText(['shp-2'], v.map.places, v.map.movers)).toBe('Coffee samples, Package · with Cy Lam');
  });
});

describe('an uncached place pair is a straight dashed line, never a crash', () => {
  // emp-3's evening home pair is uncached (encoded null) and emp-2's morning home pair has no entry.
  const sparse: MapResponse = {
    ...map,
    polylines: map.polylines
      .filter((p) => !(p.from === 'home-story-ben' && p.to === 'biz-roast'))
      .map((p) => (p.from === 'biz-roast' && p.to === 'home-007' ? { ...p, encoded: null } : p)),
  };

  it('builds the layers for a journey with uncached home pairs without throwing, by day and by night', () => {
    const v = pageView(simAt(T.onLeg1, { 'shp-2': 'picked_up' }), { kind: 'package', id: 'shp-2' }, sparse);
    expect(() => specsOf(v)).not.toThrow();
    expect(() => withNightCasing(specsOf(v))).not.toThrow();
  });

  it('each uncached pair is one dashed straight route in its leg tone; thin outside the carried part, thick inside', () => {
    const routes = uncachedJourneyRoutes(simAt(T.onLeg1), sparse, 'shp-2');
    expect(routes.map((r) => [r.id, r.tone, r.carried, r.dashed, r.path])).toEqual([
      ['journey-shp-2-L0-straight-1', 'leg1', false, true, [lngLat('biz-roast'), lngLat('home-007')]],
      ['journey-shp-2-L1-straight-0', 'leg2', false, true, [lngLat('home-story-ben'), lngLat('biz-roast')]],
      // roast → etsy is uncached in the sample too; it is the package's carried part of leg 2.
      ['journey-shp-2-L1-straight-1', 'leg2', true, true, [lngLat('biz-roast'), lngLat('biz-etsy')]],
    ]);
    expect(routes[0].label).toBe('Cy Lam · evening');
    expect(routes[0].ownerIds).toEqual(['shp-2', 'plan-shp-2', 'emp-3']);
  });

  it('the page passes them to the map after the cached lines; cached pairs get none', () => {
    const v = pageView(simAt(T.onLeg1), { kind: 'package', id: 'shp-2' }, sparse);
    const dashed = v.map.routes.filter((r) => r.dashed);
    expect(dashed.map((r) => r.id)).toEqual([
      'journey-shp-2-L0-straight-1', 'journey-shp-2-L1-straight-0', 'journey-shp-2-L1-straight-1',
    ]);
    expect(v.map.routes.filter((r) => !r.dashed).every((r) => r.path.length >= 2)).toBe(true);
    expect(uncachedJourneyRoutes(simAt(T.onLeg1), map, 'shp-1')).toEqual([]);
  });

  it('drawn as dash pieces in the commute (thin) or leg (thick) layer, each reporting the route on hover', () => {
    const v = pageView(simAt(T.onLeg1), { kind: 'package', id: 'shp-2' }, sparse);
    const specs = specsOf(v);
    const commute = spec<PathSpec>(specs, 'routes-commute')!.data.filter((d) => d.id === 'journey-shp-2-L0-straight-1');
    expect(commute.length).toBeGreaterThan(3);
    expect(commute.every((d) => d.width === L.COMMUTE_WIDTH && d.path.length === 2)).toBe(true);
    expect(commute[0].path[0]).toEqual(lngLat('biz-roast'));
    expect(commute[0].item).toMatchObject({ id: 'journey-shp-2-L0-straight-1', kind: 'leg', label: 'Cy Lam · evening' });
    expect(commute[0].item.role).toBe('Whole commute · Straight line: street route not loaded');
    const carried = spec<PathSpec>(specs, 'routes-leg')!.data.filter((d) => d.id === 'journey-shp-2-L1-straight-1');
    expect(carried.length).toBeGreaterThan(0);
    expect(carried.every((d) => d.width === L.CARRIED_WIDTH)).toBe(true);
  });

  it('dashPieces: dash and gap lengths, the ends on the line, a cap on the count, junk dropped', () => {
    const a: [number, number] = [-73.99, 40.70];
    const b: [number, number] = [-73.99, 40.72]; // about 2.2 km due north
    const pieces = L.dashPieces([a, b]);
    const period = L.DASH_M + L.DASH_GAP_M;
    expect(pieces.length).toBe(Math.ceil((0.02 * 110_540) / period));
    expect(pieces[0][0]).toEqual(a);
    const lenM = (p: [number, number][]) => Math.abs(p[p.length - 1][1] - p[0][1]) * 110_540;
    expect(lenM(pieces[0])).toBeCloseTo(L.DASH_M, 3);
    expect((pieces[1][0][1] - pieces[0][0][1]) * 110_540).toBeCloseTo(period, 3);
    for (const p of pieces) for (const [lng, lat] of p) {
      expect(lng).toBeCloseTo(-73.99, 9);
      expect(lat).toBeGreaterThanOrEqual(40.70 - 1e-12);
      expect(lat).toBeLessThanOrEqual(40.72 + 1e-12);
    }
    expect(L.dashPieces([a, [-73.99, 70]]).length).toBeLessThanOrEqual(L.MAX_DASHES);
    expect(L.dashPieces([a, a])).toEqual([]);
    expect(L.dashPieces([a, [Number.NaN, 40.71]])).toEqual([]);
    expect(L.dashPieces([a, [-73.99, 40.7001]])).toEqual([[a, [-73.99, 40.7001]]]);
  });
});

describe('text layers ask for the loaded face: Inter, at most 600', () => {
  it('no text layer names IBM Plex Sans or a 700 weight, in a journey and in the network view', () => {
    // On the evening leg, so the journey has a carrier letter (overnight it has no carrier, #851).
    const journey = specsOf(pageView(simAt(T.onLeg1, { 'shp-2': 'picked_up' }), { kind: 'package', id: 'shp-2' }));
    const net = pageView(simAt(T.onLeg1), null).map;
    const network = [...buildLayerSpecs({ ...net }), ...buildLayerSpecs({ ...net, selectedIds: ['emp-3'] })];
    const texts = [...journey, ...network].filter((s): s is TextSpec => s.type === 'text');
    expect(new Set(texts.map((t) => t.id))).toEqual(new Set([
      'movers-vehicle-badge', 'labels-places', 'stops-symbol', 'stops-label', 'labels-selected',
    ]));
    for (const t of texts) {
      expect(t.props.fontFamily, t.id).toBe(L.MAP_FONT_FAMILY);
      expect(String(t.props.fontFamily)).toMatch(/^Inter\b/);
      expect(String(t.props.fontFamily)).not.toMatch(/Plex/i);
      if (t.props.fontWeight !== undefined) expect(t.props.fontWeight, t.id).toBe(600);
    }
    expect(spec<TextSpec>(journey, 'movers-vehicle-badge')!.props.fontWeight).toBe(600);
    expect(spec<TextSpec>(journey, 'stops-label')!.props.fontWeight).toBe(600);
  });
});

describe('the journey legend describes the new marker', () => {
  it('each carrier row: the letter marker with the package badge, "A carrier, the package rides on it"', () => {
    const v = pageView(simAt(T.onLeg1), { kind: 'package', id: 'shp-2' });
    if (v.right.kind !== 'journey') throw new Error('expected a journey');
    const html = renderToStaticMarkup(<JourneyLegend carriers={v.right.journey.carriers} />);
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain(`A ${CARRIER_MARKER_TEXT} · from Crown Heights`);
    expect(text).toContain(`B ${CARRIER_MARKER_TEXT} · from Park Slope`);
    expect(CARRIER_MARKER_TEXT).toBe('carrier, the package rides on it');
    expect(html.match(/class="jl__rider" style="background:rgba\(232, 89, 12, 1\)"/g)).toHaveLength(2);
  });
});
