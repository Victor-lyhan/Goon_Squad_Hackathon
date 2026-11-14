import { describe, expect, it } from 'vitest';
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
    expect(j.stops[1].label).toBe('Drop at relay point · Brooklyn Roasting');
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
      { employeeId: 'emp-3', name: 'Cy Lam', legIndex: 0, tone: 'leg1', homeNeighborhood: 'Crown Heights', extraMin: 5, rewardCents: 300 },
      { employeeId: 'emp-2', name: 'Ben Okafor', legIndex: 1, tone: 'leg2', homeNeighborhood: 'Park Slope', extraMin: 4, rewardCents: 300 },
    ]);
    const direct = directAt(T.beforePickup);
    expect(direct.carriers.map((c) => c.tone)).toEqual(['leg1']);
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
  it('per carrier: a baseline commute and the actual route, in [lng, lat] order', () => {
    const j = directAt(T.beforePickup);
    const base = j.routes.filter((r) => r.kind === 'baseline');
    const legs = j.routes.filter((r) => r.kind === 'leg');
    expect(base).toHaveLength(1);
    expect(base[0].path).toEqual(decoded('biz-dumbo', 'home-story-ana'));
    expect(base[0].path[0]).toEqual([-73.9881, 40.7033]);
    expect(legs).toHaveLength(1);
    // dumbo → etsy → home, joined without repeating etsy
    expect(legs[0].path).toEqual([...decoded('biz-dumbo', 'biz-etsy'), ...decoded('biz-etsy', 'home-story-ana').slice(1)]);
    expect(legs[0].ownerIds).toContain('shp-1');
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
