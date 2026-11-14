import { describe, expect, it } from 'vitest';
import { initialBusinessWorkspaceState } from '../../client/src/components/business/v2/live/businessWorkspaceState';
import {
  INITIAL_TABLE, MATCH_FAILED_TEXT, findDelivery, matchErrorText, pageScreen, siblingBusinessPath, simulatorHref,
  tableModel, withShipment,
} from '../../client/src/components/business/v2/page/businessPageModel';
import { BUSINESSES, DASHBOARD, INCOMING, RELAY, ready } from './business-v2-page-sample';

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
    expect(pageScreen(ready(), 'shp-404')).toEqual({ kind: 'delivery_missing', shipmentId: 'shp-404' });
    expect(findDelivery(DASHBOARD, 'nope')).toBeNull();
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
