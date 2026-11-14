import { describe, expect, it } from 'vitest';
import { initialBusinessWorkspaceState } from '../../client/src/components/business/v2/live/businessWorkspaceState';
import {
  INITIAL_TABLE, MATCH_FAILED_TEXT, NEW_DELIVERY_CLOSED_TEXT, findDelivery, heldHereText, isHeldHere, matchErrorText,
  newDeliveryClosedText, pageScreen, siblingBusinessPath, simulatorHref, tableModel, withShipment,
} from '../../client/src/components/business/v2/page/businessPageModel';
import { businessWorkspaceReducer } from '../../client/src/components/business/v2/live/businessWorkspaceState';
import { RESULT_COPY } from '../../client/src/components/business/v2/newDeliveryModel';
import { ATLAS, ATLAS_DASHBOARD, BAKERY, BUSINESSES, DASHBOARD, DIRECT, INCOMING, RELAY, ready, withHeld } from './business-v2-page-sample';

describe('pageScreen', () => {
  it('maps the hook views', () => {
    expect(pageScreen(initialBusinessWorkspaceState, null)).toEqual({ kind: 'loading' });
    expect(pageScreen({ ...initialBusinessWorkspaceState, view: 'not_found', fallbackBusinessId: 'biz-x' }, null))
      .toEqual({ kind: 'not_found', fallbackBusinessId: 'biz-x' });
    expect(pageScreen({ ...initialBusinessWorkspaceState, view: 'unavailable', unavailable: { code: 'travel_data_missing', message: 'M' } }, null))
      .toEqual({ kind: 'unavailable', text: 'M' });
    expect(pageScreen({ ...initialBusinessWorkspaceState, view: 'error', error: 'E' }, null)).toEqual({ kind: 'error', text: 'E' });
  });

  it('finds ?shipment= in outgoing and incoming, and reports a foreign one', () => {
    expect(pageScreen(ready(), null)).toEqual({ kind: 'workspace' });
    expect(pageScreen(ready(), 'shp-8')).toEqual({ kind: 'delivery', view: RELAY });
    expect(pageScreen(ready(), 'shp-10')).toEqual({ kind: 'delivery', view: INCOMING });
    expect(pageScreen(withHeld(ready(), 'shp-404', null), 'shp-404')).toEqual({ kind: 'delivery_missing', shipmentId: 'shp-404' });
    expect(findDelivery(DASHBOARD, 'nope')).toBeNull();
  });
});

describe('pageScreen for a delivery the dashboard does not list (#581)', () => {
  const atlas = () => ready(ATLAS_DASHBOARD);

  it('is loading until GET /shipments/:id answered for that ID', () => {
    expect(pageScreen(atlas(), 'shp-8')).toEqual({ kind: 'delivery_loading', shipmentId: 'shp-8', failed: false });
    // An answer for another delivery does not count.
    expect(pageScreen(withHeld(atlas(), 'shp-7', DIRECT), 'shp-8')).toEqual({ kind: 'delivery_loading', shipmentId: 'shp-8', failed: false });
    const failed = businessWorkspaceReducer(atlas(), { type: 'heldFailed', shipmentId: 'shp-8' });
    expect(pageScreen(failed, 'shp-8')).toEqual({ kind: 'delivery_loading', shipmentId: 'shp-8', failed: true });
    // A state without the field (older callers) is loading too, never a crash.
    const { held: _held, ...bare } = atlas();
    expect(pageScreen(bare, 'shp-8').kind).toBe('delivery_loading');
  });

  it('opens the package this business holds as the plan\'s relay point', () => {
    expect(isHeldHere(RELAY, ATLAS.id)).toBe(true);
    expect(pageScreen(withHeld(atlas(), 'shp-8', RELAY), 'shp-8')).toEqual({ kind: 'delivery', view: RELAY, heldHere: true });
  });

  it('keeps the "another business" state for a delivery this business has no part in', () => {
    // A direct delivery of two other businesses; a relay through another business; an unmatched request.
    expect(isHeldHere(DIRECT, ATLAS.id)).toBe(false);
    expect(pageScreen(withHeld(atlas(), 'shp-7', DIRECT), 'shp-7')).toEqual({ kind: 'delivery_missing', shipmentId: 'shp-7' });
    const elsewhere = { ...RELAY, plan: { ...RELAY.plan!, relayBusinessId: BAKERY.id } };
    expect(pageScreen(withHeld(atlas(), 'shp-8', elsewhere), 'shp-8')).toEqual({ kind: 'delivery_missing', shipmentId: 'shp-8' });
    expect(pageScreen(withHeld(atlas(), 'shp-8', { ...RELAY, plan: null }), 'shp-8').kind).toBe('delivery_missing');
    expect(pageScreen(withHeld(atlas(), 'shp-404', null), 'shp-404')).toEqual({ kind: 'delivery_missing', shipmentId: 'shp-404' });
  });

  it('an own delivery never waits for the extra request and is not marked as held', () => {
    expect(pageScreen(withHeld(ready(), 'shp-8', RELAY), 'shp-8')).toEqual({ kind: 'delivery', view: RELAY });
  });

  it('names the business in the relay line', () => {
    expect(heldHereText('Atlas Books')).toBe('Held here overnight: Atlas Books is the relay point for this package.');
  });
});

describe('newDeliveryClosedText', () => {
  it('is null while planning and the form\'s own text while the run is locked', () => {
    expect(newDeliveryClosedText('planning')).toBeNull();
    expect(newDeliveryClosedText('locked')).toBe(NEW_DELIVERY_CLOSED_TEXT);
    expect(NEW_DELIVERY_CLOSED_TEXT).toBe(RESULT_COPY.locked);
    expect(NEW_DELIVERY_CLOSED_TEXT).toMatch(/closed until the next planning cycle/);
  });
});

describe('links and the query string', () => {
  it('keeps the route prefix', () => {
    expect(siblingBusinessPath('/nyc/business/biz-old', 'biz-new')).toBe('/nyc/business/biz-new');
    expect(siblingBusinessPath('/business/biz-old/', 'biz new')).toBe('/business/biz%20new');
    expect(simulatorHref('shp-1')).toBe('/simulator?package=shp-1');
  });

  it('sets and removes only ?shipment=', () => {
    const p = new URLSearchParams('demo=1');
    const open = withShipment(p, 'shp-7');
    expect(open.toString()).toBe('demo=1&shipment=shp-7');
    expect(p.toString()).toBe('demo=1');
    expect(withShipment(open, null).toString()).toBe('demo=1');
  });
});

describe('tableModel', () => {
  it('builds every row and filters by direction', () => {
    const m = tableModel(DASHBOARD, BUSINESSES, INITIAL_TABLE);
    expect(m.all.map((r) => r.id).sort()).toEqual(['shp-10', 'shp-7', 'shp-8', 'shp-9']);
    const inc = tableModel(DASHBOARD, BUSINESSES, { ...INITIAL_TABLE, filters: { ...INITIAL_TABLE.filters, direction: 'incoming' } });
    expect(inc.rows.map((r) => r.id)).toEqual(['shp-10']);
    expect(inc.all).toHaveLength(4);
  });
});

it('matchErrorText uses the server text', () => {
  expect(matchErrorText(new Error('Start a new planning cycle to change deliveries'))).toBe('Start a new planning cycle to change deliveries');
  expect(matchErrorText(null)).toBe(MATCH_FAILED_TEXT);
});
