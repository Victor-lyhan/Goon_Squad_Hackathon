// The delivery route map in the Business page (#549), rendered statically: above the details, the stops as
// text, the kit's key-missing state without a browser key, and one line with Retry when the map failed.
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapResponse, ShipmentResponse } from '../../shared/v2/api';
import { KEY_MISSING_TEXT } from '../../client/src/components/map/mapModel';
import { BusinessPageView } from '../../client/src/components/business/v2/page/BusinessPageView';
import { DeliveryRouteSlot } from '../../client/src/components/business/v2/route/DeliveryRoutePreview';
import {
  ROUTE_MAP_FAILED_TEXT, ROUTE_MAP_LOADING_TEXT, type DeliveryMapSlot,
} from '../../client/src/components/business/v2/route/deliveryMapLoader';
import { NO_ROUTE_NOTE, STRAIGHT_NOTE } from '../../client/src/components/business/v2/route/deliveryRouteModel';
import { BUSINESSES, DIRECT, RELAY, UNMATCHED, ready } from './business-v2-page-sample';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
const never = async (): Promise<ShipmentResponse> => { throw new Error('not called'); };
const noop = () => {};

const MAP: MapResponse = { runId: 'run-1', businesses: BUSINESSES, homes: [], employees: [], polylines: [] };

function renderPage(shipmentId: string | null, slot: DeliveryMapSlot = { kind: 'map', map: MAP }) {
  const state = ready();
  const open = [...state.dashboard!.outgoing, ...state.dashboard!.incoming].find((v) => v.shipment.id === shipmentId);
  return renderToStaticMarkup(
    <BusinessPageView
      state={state} shipmentId={shipmentId} createShipment={never} matchShipment={never} refetchNow={async () => {}}
      dismissRunChanged={noop} onOpenShipment={noop} onCloseShipment={noop} businessHref={(id) => `/nyc/business/${id}`}
      deliveryRoute={open ? <DeliveryRouteSlot slot={slot} view={open} onRetry={noop} /> : null}
    />,
  );
}

const stopItems = (html: string) => {
  const list = /<ol class="bdr__stops"[^>]*>([\s\S]*?)<\/ol>/.exec(html);
  return list ? [...list[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => text(m[1])) : [];
};

beforeEach(() => vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', ''));
afterEach(() => vi.unstubAllEnvs());

describe('route map in the Business page', () => {
  it('a relay delivery: the map above its details, four numbered stops, both legs in the legend', () => {
    const html = renderPage(RELAY.shipment.id);
    expect(html).toContain('aria-label="Delivery route on the map"');
    expect(html.indexOf('class="bdr"')).toBeLessThan(html.indexOf('class="bd-panel"'));
    const stops = stopItems(html);
    expect(stops.map((s) => s.replace(/ Day \d+,.*$/, ''))).toEqual([
      '1 Pickup · Acme Studio',
      '2 Drop at relay point · Atlas Books',
      '3 Pickup next morning · Atlas Books',
      '4 Delivered · Bakery Row',
    ]);
    expect(text(html)).toContain('First carrier');
    expect(text(html)).toContain('Second carrier, next morning');
    // No cached lines in this map: the legs are straight and the page says so.
    expect(text(html)).toContain(STRAIGHT_NOTE);
    expect(html).not.toMatch(/\bhubs?\b/i);
    expect(html).not.toMatch(/NaN|undefined/);
  });

  it('without a browser key the map area shows the kit\'s key-missing state', () => {
    const html = renderPage(RELAY.shipment.id);
    const block = /<div class="bdr__map">([\s\S]*?)<\/section>/.exec(html)![1];
    expect(block).toContain(KEY_MISSING_TEXT);
  });

  it('a direct delivery: two stops and no legend', () => {
    const html = renderPage(DIRECT.shipment.id);
    expect(stopItems(html).map((s) => s.replace(/ Day \d+,.*$/, ''))).toEqual(['1 Pickup · Acme Studio', '2 Delivered · Bakery Row']);
    expect(html).not.toContain('bdr__legend');
  });

  it('an unmatched delivery: the map with sender and recipient, no stops, a short note', () => {
    const html = renderPage(UNMATCHED.shipment.id);
    expect(html).toContain('aria-label="Delivery route on the map"');
    expect(stopItems(html)).toEqual([]);
    expect(text(html)).toContain(NO_ROUTE_NOTE);
  });

  it('while loading: one status line, the details still render', () => {
    const html = renderPage(RELAY.shipment.id, { kind: 'loading', text: ROUTE_MAP_LOADING_TEXT });
    expect(text(html)).toContain(ROUTE_MAP_LOADING_TEXT);
    expect(html).not.toContain('class="bdr"');
    expect(text(html)).toContain('Fabric rolls');
  });

  it('a failed map: one line with Retry, and the rest of the page keeps working', () => {
    const html = renderPage(RELAY.shipment.id, { kind: 'failed', text: ROUTE_MAP_FAILED_TEXT });
    expect(html).toMatch(/role="alert">Couldn(?:&#x27;|')t load the map\. <button type="button" class="bdr-retry">Retry<\/button><\/p>/);
    expect(html).not.toContain('class="bdr"');
    expect(text(html)).toContain('Fabric rolls'); // the details
    expect(html).toContain('class="bw-row'); // the table
  });

  it('no open delivery: no route map', () => {
    const html = renderPage(null);
    expect(html).not.toContain('bdr');
  });
});
