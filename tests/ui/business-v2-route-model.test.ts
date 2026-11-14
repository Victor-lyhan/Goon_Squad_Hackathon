// The Business delivery route model (#549): places, legs and numbered stops from one ShipmentView and the map.
import { describe, expect, it } from 'vitest';
import {
  NO_ROUTE_NOTE, STRAIGHT_NOTE, buildDeliveryRoute, legStopPairs, mapCoversPlan, planKey,
} from '../../client/src/components/business/v2/route/deliveryRouteModel';
import { formatMin } from '../../client/src/ui/format';
import { MAP, RECIPIENT, RELAY, SENDER, directPlan, relayPlan, view, withLine } from './business-v2-route-sample';

const homeIds = MAP.homes.map((h) => h.id);

describe('relay delivery', () => {
  const r = buildDeliveryRoute(view(relayPlan), MAP);

  it('has exactly the sender, the recipient and the relay point as places, never a home', () => {
    expect(r.places.map((p) => p.id)).toEqual([SENDER.id, RECIPIENT.id, RELAY.id]);
    expect(r.places.every((p) => p.kind === 'business')).toBe(true);
    expect(r.places.map((p) => p.sublabel)).toEqual(['Sender · Chelsea', 'Recipient · Williamsburg', 'Relay point · Long Island City']);
    expect(r.places.some((p) => homeIds.includes(p.id))).toBe(false);
  });

  it('draws two leg routes in leg1 and leg2 on the road lines between the stops only', () => {
    expect(r.routes.map((x) => [x.kind, x.tone])).toEqual([['leg', 'leg1'], ['leg', 'leg2']]);
    expect(r.routes[0].path).toEqual([[-74.001, 40.742], [-73.97, 40.75], [-73.948, 40.744]]);
    expect(r.routes[1].path).toEqual([[-73.948, 40.744], [-73.955, 40.73], [-73.961, 40.714]]);
    expect(r.straight).toBe(false);
    expect(r.tones).toEqual(['leg1', 'leg2']);
  });

  it('numbers the four stops in order, with the plan\'s times', () => {
    expect(r.stops.map((s) => [s.n, s.label])).toEqual([
      [1, 'Pickup · Acme Studio'],
      [2, 'Drop at relay point · Atlas Books'],
      [3, 'Pickup next morning · Atlas Books'],
      [4, 'Delivered · Bakery Row'],
    ]);
    expect(r.stops.map((s) => [s.lat, s.lng])).toEqual([
      [SENDER.lat, SENDER.lng], [RELAY.lat, RELAY.lng], [RELAY.lat, RELAY.lng], [RECIPIENT.lat, RECIPIENT.lng],
    ]);
    // Times are the plan's serviceStartMin, formatted by the kit.
    expect(r.stopTexts.map((s) => s.time)).toEqual([1050, 1090, 1930, 1985].map(formatMin));
    expect(r.stopTexts[0].time).toMatch(/^Day 1, /);
    expect(r.stopTexts[3].time).toMatch(/^Day 2, /);
  });

  it('fits the map to the places and the lines', () => {
    expect(r.fitTo).not.toBeNull();
    expect(r.fitTo!.north).toBeGreaterThan(40.75);
    expect(r.fitTo!.west).toBeLessThan(-74.001);
  });
});

describe('direct delivery', () => {
  it('has two places, one leg and stops 1 and 2', () => {
    const r = buildDeliveryRoute(view(directPlan), MAP);
    expect(r.places.map((p) => p.id)).toEqual([SENDER.id, RECIPIENT.id]);
    expect(r.routes.map((x) => x.tone)).toEqual(['leg1']);
    expect(r.stops.map((s) => [s.n, s.label])).toEqual([[1, 'Pickup · Acme Studio'], [2, 'Delivered · Bakery Row']]);
  });
});

describe('unmatched delivery', () => {
  it('has the sender and recipient only, no route and no stop', () => {
    const r = buildDeliveryRoute(view(null), MAP);
    expect(r.places.map((p) => p.id)).toEqual([SENDER.id, RECIPIENT.id]);
    expect(r.routes).toEqual([]);
    expect(r.stops).toEqual([]);
    expect(r.stopTexts).toEqual([]);
    expect(NO_ROUTE_NOTE).not.toMatch(/hub/i);
  });
});

describe('missing route lines', () => {
  it('draws a stop pair with no line in the response as the straight line between its places', () => {
    const r = buildDeliveryRoute(view(relayPlan), withLine(SENDER.id, RELAY.id, null));
    expect(r.routes[0].path).toEqual([[SENDER.lng, SENDER.lat], [RELAY.lng, RELAY.lat]]);
    expect(r.routes[1].path.length).toBe(3); // the other leg keeps its road line
    expect(r.straight).toBe(true);
    expect(STRAIGHT_NOTE).toMatch(/straight line/);
  });

  it('also when the pair is not listed at all, or the line is unreadable', () => {
    const unlisted = { ...MAP, polylines: MAP.polylines.filter((p) => p.from !== RELAY.id || p.to !== RECIPIENT.id) };
    expect(buildDeliveryRoute(view(relayPlan), unlisted).routes[1].path).toEqual([[RELAY.lng, RELAY.lat], [RECIPIENT.lng, RECIPIENT.lat]]);
    const broken = withLine(RELAY.id, RECIPIENT.id, '\u0001');
    expect(buildDeliveryRoute(view(relayPlan), broken).routes[1].path).toEqual([[RELAY.lng, RELAY.lat], [RECIPIENT.lng, RECIPIENT.lat]]);
  });

  it('skips a place the map does not know instead of inventing a point', () => {
    const noRelay = { ...MAP, businesses: [SENDER, RECIPIENT] };
    const r = buildDeliveryRoute(view(relayPlan), noRelay);
    expect(r.places.map((p) => p.id)).toEqual([SENDER.id, RECIPIENT.id]);
    expect(r.stops.map((s) => s.n)).toEqual([1, 4]);
    expect(r.stopTexts.map((s) => s.placeName)).toEqual(['Acme Studio', 'Unknown place', 'Unknown place', 'Bakery Row']);
    // The road lines still come from the response.
    expect(r.routes).toHaveLength(2);
  });
});

describe('plan coverage (when the page refetches the map)', () => {
  it('uses the stop pairs of each leg, never a home pair', () => {
    expect(relayPlan.legs.map(legStopPairs)).toEqual([[[SENDER.id, RELAY.id]], [[RELAY.id, RECIPIENT.id]]]);
  });

  it('a map that lists every stop pair covers the plan, even without a cached line', () => {
    expect(mapCoversPlan(MAP, relayPlan)).toBe(true);
    expect(mapCoversPlan(withLine(SENDER.id, RELAY.id, null), relayPlan)).toBe(true);
    const missing = { ...MAP, polylines: MAP.polylines.filter((p) => p.from !== SENDER.id || p.to !== RELAY.id) };
    expect(mapCoversPlan(missing, relayPlan)).toBe(false);
  });

  it('planKey changes with the plan ID or its stops', () => {
    expect(planKey(relayPlan)).not.toBe(planKey(directPlan));
    expect(planKey(relayPlan)).toBe(planKey(JSON.parse(JSON.stringify(relayPlan))));
  });
});
