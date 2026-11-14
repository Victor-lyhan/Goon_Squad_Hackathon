import { describe, expect, it } from 'vitest';
import * as L from '../../client/src/components/map/layers';
import type { PathSpec, ScatterSpec, TextSpec } from '../../client/src/components/map/layers';
import {
  buildJourney, statusLabelOf, UNKNOWN_PLACE, type Journey, type JourneyResult,
} from '../../client/src/components/sim/v2/journey/journeyModel';
import type { ShipmentProgress } from '../../shared/v2/types';
import { T, decoded, map, simAt } from './sim-v2-journey-sample';

function journeyOf(r: JourneyResult | null): Journey {
  if (!r || r.kind !== 'journey') throw new Error(`expected a journey, got ${JSON.stringify(r)}`);
  return r;
}
const relayAt = (t: number, status?: ShipmentProgress) =>
  journeyOf(buildJourney({ shipmentId: 'shp-2', sim: simAt(t, status ? { 'shp-2': status } : {}), map }));
const directAt = (t: number) => journeyOf(buildJourney({ shipmentId: 'shp-1', sim: simAt(t), map }));

describe('buildJourney: steps', () => {
  it('direct: 1 Pickup at sender, 2 Delivered at recipient', () => {
    const j = directAt(T.beforePickup);
    expect(j.planKind).toBe('direct');
    expect(j.title).toBe('Signed contracts');
    expect(j.steps.map((s) => [s.n, s.label, s.placeName])).toEqual([
      [1, 'Pickup at sender', 'DUMBO Studio'],
      [2, 'Delivered to recipient', 'Etsy'],
    ]);
    expect(j.steps.map((s) => s.timeMin)).toEqual([1052, 1072]); // serviceEndMin of each stop
    expect(j.steps.every((s) => s.carrierName === 'Ana Ruiz' && s.extraMin === 6)).toBe(true);
  });

  it('relay: pickup, drop at relay point, pickup at relay point, delivered', () => {
    const j = relayAt(T.beforePickup);
    expect(j.planKind).toBe('relay');
    expect(j.steps.map((s) => [s.n, s.label, s.placeId, s.placeName, s.carrierName, s.extraMin, s.timeMin])).toEqual([
      [1, 'Pickup at sender', 'biz-dumbo', 'DUMBO Studio', 'Cy Lam', 5, 1042],
      [2, 'Drop at relay point', 'biz-roast', 'Brooklyn Roasting', 'Cy Lam', 5, 1062],
      [3, 'Pickup at relay point', 'biz-roast', 'Brooklyn Roasting', 'Ben Okafor', 4, 1952],
      [4, 'Delivered to recipient', 'biz-etsy', 'Etsy', 'Ben Okafor', 4, 1977],
    ]);
    expect(j.steps.every((s) => typeof s.lat === 'number' && typeof s.lng === 'number')).toBe(true);
    expect(j.stops.map((s) => s.n)).toEqual([1, 2, 3, 4]);
    expect(j.stops[1].detail).toBe('Drop at relay point · Brooklyn Roasting');
  });
});

describe('buildJourney: step states from occurred events', () => {
  it('before pickup: step 1 is current, the rest upcoming', () => {
    expect(relayAt(T.beforePickup).steps.map((s) => s.state)).toEqual(['current', 'upcoming', 'upcoming', 'upcoming']);
  });
  it('overnight at the relay point: 1-2 done, 3 current', () => {
    const j = relayAt(T.overnight, 'at_hub');
    expect(j.steps.map((s) => s.state)).toEqual(['done', 'done', 'current', 'upcoming']);
    expect(j.statusLabel).toBe('At the relay point');
  });
  it('after delivery: every step done, none current', () => {
    const j = relayAt(T.afterDelivery, 'delivered');
    expect(j.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done']);
    expect(j.statusLabel).toBe('Delivered');
  });
  it('direct after delivery', () => {
    expect(directAt(T.afterDelivery).steps.map((s) => s.state)).toEqual(['done', 'done']);
  });
});

describe('buildJourney: status wording', () => {
  it('never says hub', () => {
    const all: ShipmentProgress[] = ['unmatched', 'scheduled', 'picked_up', 'at_hub', 'out_for_delivery', 'delivered'];
    for (const s of all) expect(statusLabelOf(s)).not.toMatch(/hub/i);
    expect(statusLabelOf(undefined)).toBe('Status unavailable');
  });
});

describe('buildJourney: places, carriers and movers', () => {
  it('relay: only sender, recipient, relay business and the two carrier homes', () => {
    const j = relayAt(T.overnight);
    expect(j.places.map((p) => p.id).sort()).toEqual(['biz-dumbo', 'biz-etsy', 'biz-roast', 'home-007', 'home-story-ben']);
    expect(j.places.find((p) => p.id === 'biz-roast')?.sublabel).toBe('Relay point · DUMBO');
    expect(j.places.find((p) => p.id === 'home-007')).toMatchObject({ kind: 'home', label: 'Home of Cy Lam', sublabel: 'Crown Heights' });
  });
  it('direct: only sender, recipient and the one carrier home', () => {
    expect(directAt(T.beforePickup).places.map((p) => p.id).sort()).toEqual(['biz-dumbo', 'biz-etsy', 'home-story-ana']);
  });
  it('relay has two carriers with two tones; direct has one with leg1', () => {
    expect(relayAt(T.overnight).carriers).toEqual([
      { employeeId: 'emp-3', name: 'Cy Lam', legIndex: 0, tone: 'leg1', letter: 'A', homeNeighborhood: 'Crown Heights', extraMin: 5, rewardCents: 300 },
      { employeeId: 'emp-2', name: 'Ben Okafor', legIndex: 1, tone: 'leg2', letter: 'B', homeNeighborhood: 'Park Slope', extraMin: 4, rewardCents: 300 },
    ]);
    const direct = directAt(T.beforePickup);
    expect(direct.carriers.map((c) => [c.tone, c.letter])).toEqual([['leg1', 'A']]);
    expect(new Set(direct.routes.filter((r) => r.kind === 'leg').map((r) => r.tone))).toEqual(new Set(['leg1']));
    expect(new Set(relayAt(T.overnight).routes.filter((r) => r.kind === 'leg').map((r) => r.tone))).toEqual(new Set(['leg1', 'leg2']));
  });
  it('movers: the package and its carriers only, from the snapshot', () => {
    const j = relayAt(T.overnight);
    expect(j.movers.map((m) => [m.id, m.kind]).sort()).toEqual([['emp-2', 'vehicle'], ['emp-3', 'vehicle'], ['shp-2', 'package']]);
    expect(j.movers.find((m) => m.id === 'shp-2')).toMatchObject({ lat: 40.7041, lng: -73.9867 });
  });
});

describe('buildJourney: routes', () => {
  it('per carrier: the whole commute (thin) and the carried part (thick), in [lng, lat] order; no grey baseline', () => {
    const j = directAt(T.beforePickup);
    expect(j.routes.filter((r) => r.kind === 'baseline')).toHaveLength(0);
    const trip = j.routes.filter((r) => r.carried === false);
    const carried = j.routes.filter((r) => r.carried === true);
    expect(j.routes).toHaveLength(2);
    // dumbo → etsy → home: the whole evening commute, joined without repeating etsy
    expect(trip).toHaveLength(1);
    expect(trip[0]).toMatchObject({ kind: 'leg', tone: 'leg1' });
    expect(trip[0].path).toEqual([...decoded('biz-dumbo', 'biz-etsy'), ...decoded('biz-etsy', 'home-story-ana').slice(1)]);
    expect(trip[0].path[0]).toEqual([-73.9881, 40.7033]);
    // pickup (dumbo) → delivery (etsy): the part with the package
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({ kind: 'leg', tone: 'leg1' });
    expect(carried[0].path).toEqual(decoded('biz-dumbo', 'biz-etsy'));
    for (const r of j.routes) expect(r.ownerIds).toContain('shp-1');
  });

  it('relay: each carrier\'s whole commute in its tone, the carried part from its pickup to its drop', () => {
    const j = relayAt(T.overnight);
    const of = (tone: string, carried: boolean) => j.routes.filter((r) => r.tone === tone && r.carried === carried).map((r) => r.path);
    // Cy (A): dumbo → roast → home, carrying dumbo → roast.
    expect(of('leg1', false)).toEqual([[...decoded('biz-dumbo', 'biz-roast'), ...decoded('biz-roast', 'home-007').slice(1)]]);
    expect(of('leg1', true)).toEqual([decoded('biz-dumbo', 'biz-roast')]);
    // Ben (B): home → roast → etsy; roast → etsy has no cached polyline, so only home → roast is drawn
    // and the carried part (roast → etsy) has no line.
    expect(of('leg2', false)).toEqual([decoded('home-story-ben', 'biz-roast')]);
    expect(of('leg2', true)).toEqual([]);
  });

  it('a null polyline draws no line for that pair (never an invented one)', () => {
    const j = relayAt(T.overnight);
    const leg2 = j.routes.filter((r) => r.kind === 'leg' && r.tone === 'leg2');
    // home → roast is cached; roast → etsy is null, so the line stops at the relay point.
    expect(leg2).toHaveLength(1);
    expect(leg2[0].path).toEqual(decoded('home-story-ben', 'biz-roast'));
    const etsy: [number, number] = [-73.9893, 40.7008];
    expect(leg2[0].path).not.toContainEqual(etsy);
  });

  it('a pair missing from the response draws nothing either', () => {
    const sparse = { ...map, polylines: map.polylines.filter((p) => !(p.from === 'biz-dumbo' && p.to === 'home-story-ana')) };
    const j = journeyOf(buildJourney({ shipmentId: 'shp-1', sim: simAt(T.beforePickup), map: sparse }));
    expect(j.routes.filter((r) => r.kind === 'baseline')).toHaveLength(0);
  });
});

describe('buildJourney: bounds', () => {
  it('contains every step, place and route point', () => {
    for (const j of [relayAt(T.overnight), directAt(T.beforePickup)]) {
      const b = j.bounds!;
      expect(b).not.toBeNull();
      const inside = (lat: number, lng: number) => lat <= b.north && lat >= b.south && lng <= b.east && lng >= b.west;
      for (const s of j.steps) expect(inside(s.lat!, s.lng!)).toBe(true);
      for (const p of j.places) expect(inside(p.lat, p.lng)).toBe(true);
      for (const r of j.routes) for (const [lng, lat] of r.path) expect(inside(lat, lng)).toBe(true);
    }
  });
});

describe('buildJourney: unknown and unmatched', () => {
  it('unknown shipment gives null', () => {
    expect(buildJourney({ shipmentId: 'shp-404', sim: simAt(T.overnight), map })).toBeNull();
  });
  it('unmatched gives the reason', () => {
    expect(buildJourney({ shipmentId: 'shp-3', sim: simAt(T.overnight), map })).toEqual({
      kind: 'unmatched', shipmentId: 'shp-3', title: 'Archive box',
      reason: 'No commuter passes both businesses within their detour limit.',
    });
  });
  it('a place missing from the map response is "Unknown place", never its ID, and gets no marker', () => {
    const noEtsy = { ...map, businesses: map.businesses.filter((b) => b.id !== 'biz-etsy') };
    const j = journeyOf(buildJourney({ shipmentId: 'shp-2', sim: simAt(T.overnight), map: noEtsy }));
    expect(j.steps[3].placeName).toBe(UNKNOWN_PLACE);
    expect(j.stops.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(j.places.map((p) => p.id)).not.toContain('biz-etsy');
  });
});

// #659 (docs/mvp3.md P1 + P4): what a judge sees on the map for a relay and a direct journey.
describe('the journey on the map: colors, widths, symbols, labels, badges and draw order', () => {
  const all = { routes: true, businesses: true, homes: true, packages: true };
  const specsOf = (j: Journey, selectedIds: string[] = []) =>
    L.buildLayerSpecs({
      places: j.places, routes: j.routes, movers: j.movers, stops: j.stops, visible: all, selectedIds,
      alwaysLabelIds: j.places.filter((p) => p.kind === 'business').map((p) => p.id), zoom: 14,
    });
  const spec = <S extends L.LayerSpec>(specs: L.LayerSpec[], id: string) => specs.find((x) => x.id === id) as S | undefined;
  const hex = (c: L.RGBA) => `#${c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  const withDelivered = (t: number, at: Record<string, number>) => {
    const sim = simAt(t, { 'shp-2': 'delivered', 'shp-1': 'delivered' });
    return { ...sim, snapshot: { ...sim.snapshot, deliveredAtMin: at } };
  };

  it('the palette: A blue, B green, package orange, relay ink, faded grey', () => {
    expect(hex(L.LEG1)).toBe('#1D5075');
    expect(hex(L.LEG2)).toBe('#0F8A5F');
    expect(hex(L.PACKAGE_FILL)).toBe('#E8590C');
    expect(hex(L.RELAY_INK)).toBe('#171C24');
    expect(hex(L.FADED)).toBe('#A8ABB2');
    expect(hex(L.HOME_FILL)).toBe('#A8ABB2');
    expect(hex(L.BASELINE)).toBe('#A8ABB2');
  });

  it('relay: sender square, relay diamond, swap and recipient flag with short labels', () => {
    const j = relayAt(T.overnight, 'at_hub');
    expect(j.stops.map((s) => [s.n, s.symbol, s.label])).toEqual([
      [1, 'sender', 'DUMBO Studio'],
      [2, 'relay', 'Overnight · Brooklyn Roasting'],
      [3, 'swap', 'Handed to Ben Okafor'],
      [4, 'recipient', 'To Etsy'],
    ]);
    // The old step text stays as the tooltip's second line.
    expect(j.stops.map((s) => s.detail)).toEqual([
      'Pickup at sender · DUMBO Studio',
      'Drop at relay point · Brooklyn Roasting',
      'Pickup at relay point · Brooklyn Roasting',
      'Delivered to recipient · Etsy',
    ]);
  });

  it('the flag says "Delivered <clock time>" once the snapshot has deliveredAtMin, never computed', () => {
    const sim = withDelivered(T.afterDelivery, { 'shp-2': 1979, 'shp-1': 1072 });
    const relay = journeyOf(buildJourney({ shipmentId: 'shp-2', sim, map }));
    expect(relay.stops.at(-1)!.label).toBe('Delivered 8:59 AM'); // 1979 = Day 2, 8:59 AM: the clock time only
    const direct = journeyOf(buildJourney({ shipmentId: 'shp-1', sim, map }));
    expect(direct.stops.at(-1)!.label).toBe('Delivered 5:52 PM');
    // Without the field it is still "To <recipient>".
    expect(relayAt(T.afterDelivery, 'delivered').stops.at(-1)!.label).toBe('To Etsy');
  });

  it('direct: a square and a flag, no diamond and no swap', () => {
    const j = directAt(T.beforePickup);
    expect(j.stops.map((s) => [s.symbol, s.label])).toEqual([['sender', 'DUMBO Studio'], ['recipient', 'To Etsy']]);
    const glyphs = spec<TextSpec>(specsOf(j), 'stops-symbol')!.data.map((d) => d.text);
    expect(glyphs).toEqual([L.SYMBOL_GLYPH.sender, L.SYMBOL_GLYPH.recipient]);
  });

  it('relay layers: no grey baseline, no numbered stops; thin whole commutes below thick carried parts', () => {
    const specs = specsOf(relayAt(T.onLeg1));
    const order = specs.map((x) => x.id);
    expect(order).not.toContain('routes-baseline');
    expect(order).not.toContain('stops');
    expect(order).not.toContain('stops-number');
    expect(order.indexOf('routes-commute')).toBeLessThan(order.indexOf('routes-leg'));
    const thin = spec<PathSpec>(specs, 'routes-commute')!.data;
    const thick = spec<PathSpec>(specs, 'routes-leg')!.data;
    expect(thin.map((d) => [hex(d.color), d.width])).toEqual([['#1D5075', L.COMMUTE_WIDTH], ['#0F8A5F', L.COMMUTE_WIDTH]]);
    expect(thick.map((d) => [hex(d.color), d.width])).toEqual([['#1D5075', L.CARRIED_WIDTH]]);
    expect(L.CARRIED_WIDTH).toBeGreaterThanOrEqual(L.LEG_WIDTH);
    expect(L.COMMUTE_WIDTH).toBeLessThan(L.LEG_WIDTH);
  });

  it('relay layers: symbols in ink in stop order, pickable with their tooltip; labels outside the package ring', () => {
    const specs = specsOf(relayAt(T.overnight, 'at_hub'));
    const symbols = spec<TextSpec>(specs, 'stops-symbol')!;
    expect(symbols.data.map((d) => d.text)).toEqual(['\u25A0', '\u25C6', '\u21C4', '\u2691']);
    for (const d of symbols.data) expect(d.color).toEqual(L.RELAY_INK);
    expect(symbols.props.pickable).toBe(true);
    expect(symbols.props.characterSet).toEqual(Object.values(L.SYMBOL_GLYPH));
    expect(symbols.data[1].item).toEqual({ id: 'stop-shp-2-2', kind: 'stop', label: 'Overnight · Brooklyn Roasting', role: 'Drop at relay point · Brooklyn Roasting' });
    // The swap sits beside the diamond, at the same place.
    expect(symbols.data[2].position).toEqual(symbols.data[1].position);
    expect(symbols.data[2].offset).toEqual([L.SWAP_DX, 0]);
    const labels = spec<TextSpec>(specs, 'stops-label')!;
    expect(labels.data.map((d) => d.text)).toEqual(['DUMBO Studio', 'Overnight · Brooklyn Roasting', 'Handed to Ben Okafor', 'To Etsy']);
    for (const d of labels.data) expect(Math.abs(d.offset![1])).toBeGreaterThanOrEqual(L.SYMBOL_LABEL_GAP);
    expect(labels.props.characterSet).toBe('auto');
    // A business named by its symbol's label is not named a second time.
    expect(spec<TextSpec>(specs, 'labels-places')).toBeUndefined();
  });

  it('carrier vehicles carry their letter, in their colour; a direct journey has only A', () => {
    const specs = specsOf(relayAt(T.onLeg1));
    const vehicles = spec<ScatterSpec>(specs, 'movers-vehicle')!.data;
    expect(vehicles.map((d) => [d.id, hex(d.fillColor), d.radius])).toEqual([
      ['emp-3', '#1D5075', L.BADGED_VEHICLE_RADIUS],
      ['emp-2', '#0F8A5F', L.BADGED_VEHICLE_RADIUS],
    ]);
    const badges = spec<TextSpec>(specs, 'movers-vehicle-badge')!;
    expect(badges.data.map((d) => [d.id, d.text, d.position])).toEqual(vehicles.map((v, i) => [v.id, ['A', 'B'][i], v.position]));
    expect(badges.props.pickable).toBe(false);
    expect(specs.map((x) => x.id).indexOf('movers-vehicle-badge')).toBe(specs.map((x) => x.id).indexOf('movers-vehicle') + 1);
    const sim = simAt(T.onLeg1);
    const withAna = { ...sim, snapshot: { ...sim.snapshot, markers: [...sim.snapshot.markers, { employeeId: 'emp-1', lat: 40.7, lng: -73.99, servicing: false }] } };
    const direct = journeyOf(buildJourney({ shipmentId: 'shp-1', sim: withAna, map }));
    expect(direct.carriers.map((c) => c.letter)).toEqual(['A']);
    expect(direct.movers.filter((m) => m.kind === 'vehicle').map((m) => [m.id, m.badge, m.tone])).toEqual([['emp-1', 'A', 'leg1']]);
  });

  it('the package: orange ring about twice the old size, with a white halo, drawn last and never dimmed', () => {
    for (const j of [relayAt(T.onLeg1), relayAt(T.overnight, 'at_hub'), directAt(T.beforePickup)]) {
      for (const selectedIds of [[], ['emp-9']]) {
        const specs = specsOf(j, selectedIds);
        expect(specs.slice(-2).map((x) => x.id)).toEqual(['movers-package-halo', 'movers-package']);
        const [halo, ring] = specs.slice(-2) as ScatterSpec[];
        expect(ring.data).toHaveLength(1);
        expect(ring.data[0].lineColor).toEqual([232, 89, 12, 255]);
        expect(ring.data[0].lineWidth).toBe(6); // was 3
        expect(ring.data[0].radius).toBeGreaterThanOrEqual(18); // was 10 alone
        expect(halo.data[0].lineColor.slice(0, 3)).toEqual([255, 255, 255]);
        expect(halo.data[0].lineWidth).toBeGreaterThan(ring.data[0].lineWidth);
      }
    }
    // Waiting overnight: around the relay diamond, outside the glyph.
    const night = specsOf(relayAt(T.overnight, 'at_hub'));
    const ring = night.at(-1) as ScatterSpec;
    const diamond = spec<TextSpec>(night, 'stops-symbol')!.data[1];
    expect(ring.data[0].position[0]).toBeCloseTo(-73.9867, 6);
    expect(ring.data[0].radius).toBe(L.PACKAGE_RING_AT_SYMBOL);
    expect(diamond.position).toEqual([-73.9867, 40.7041]);
  });
});
