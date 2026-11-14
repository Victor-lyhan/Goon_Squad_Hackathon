import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { businessDashboard } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';
import { BusinessNotFound } from '../../client/src/components/business/BusinessNotFound';
import { StaleShipmentNotice } from '../../client/src/components/business/TrackingDetail';
import {
  STALE_SHIPMENT_MESSAGE, UNKNOWN_BUSINESS_TITLE, firstBusinessHref, isUnknownBusiness, lookupShipment,
} from '../../client/src/components/business/trackingModel';

const run = createInitialRun(loadDefaultScenario());
const { businesses, settings } = run.scenario;
const snap = snapshotAt(run, settings.simStartMin);
const dash = businessDashboard(run, snap, businesses[0].id)!;
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

describe('stale business links: model helpers', () => {
  it('isUnknownBusiness decides from the list, only once loaded', () => {
    expect(isUnknownBusiness('nope', businesses, true)).toBe(true);
    expect(isUnknownBusiness('nope', businesses, false)).toBe(false);
    expect(isUnknownBusiness(businesses[3].id, businesses, true)).toBe(false);
    expect(isUnknownBusiness('x', [], true)).toBe(true);
  });
  it('firstBusinessHref uses the first listed business', () => {
    expect(firstBusinessHref(businesses)).toBe(`/business/${businesses[0].id}`);
    expect(firstBusinessHref([])).toBeNull();
  });
  it('lookupShipment: none / found / missing', () => {
    const any = [...dash.outgoing, ...dash.incoming][0];
    expect(any).toBeTruthy();
    expect(lookupShipment(null, dash).kind).toBe('none');
    expect(lookupShipment('s-1', null).kind).toBe('none');
    expect(lookupShipment(any.shipment.id, dash)).toEqual({ kind: 'found', view: any });
    expect(lookupShipment('shp-from-old-city', dash).kind).toBe('missing');
  });
  it('an open drawer whose shipment vanishes after a new run becomes missing, not an error', () => {
    const any = [...dash.outgoing, ...dash.incoming][0];
    const emptied = { outgoing: [], incoming: [] };
    expect(lookupShipment(any.shipment.id, dash).kind).toBe('found');
    expect(() => lookupShipment(any.shipment.id, emptied)).not.toThrow();
    expect(lookupShipment(any.shipment.id, emptied).kind).toBe('missing');
  });
});

describe('stale business links: rendered states', () => {
  it('unknown business shows the message with links to the first business and /', () => {
    const html = decode(renderToStaticMarkup(<MemoryRouter><BusinessNotFound businesses={businesses} /></MemoryRouter>));
    expect(html).toContain(UNKNOWN_BUSINESS_TITLE);
    expect(html).toContain(`href="/business/${businesses[0].id}"`);
    expect(html).toContain('href="/"');
    expect(html).not.toMatch(/NaN|undefined/);
  });
  it('still offers / when the list is empty', () => {
    const html = renderToStaticMarkup(<MemoryRouter><BusinessNotFound businesses={[]} /></MemoryRouter>);
    expect(html).toContain('href="/"');
    expect(html).not.toContain('href="/business/');
  });
  it('stale shipment notice has the message and a Close button', () => {
    const html = decode(renderToStaticMarkup(<StaleShipmentNotice onClose={() => {}} />));
    expect(html).toContain(STALE_SHIPMENT_MESSAGE);
    expect(html).toMatch(/<button[^>]*>Close<\/button>/);
  });
});
