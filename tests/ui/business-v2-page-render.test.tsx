import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ShipmentResponse } from '../../shared/v2/api';
import { ApiRequestError } from '../../client/src/api/v2';
import {
  RECONNECTING_TEXT, RUN_CHANGED_NOTE, TRAVEL_DATA_MISSING_TEXT, businessWorkspaceReducer, initialBusinessWorkspaceState,
  type BusinessWorkspaceState,
} from '../../client/src/components/business/v2/live/businessWorkspaceState';
import { NewDeliveryFormView } from '../../client/src/components/business/v2/NewDeliveryForm';
import { emptyDraft, statusForError } from '../../client/src/components/business/v2/newDeliveryModel';
import { BusinessPageView, type BusinessPageViewProps } from '../../client/src/components/business/v2/page/BusinessPageView';
import { INITIAL_TABLE, NEW_DELIVERY_CLOSED_TEXT, heldHereText } from '../../client/src/components/business/v2/page/businessPageModel';
import {
  ACME, ATLAS, ATLAS_DASHBOARD, BUSINESSES, DASHBOARD, DIRECT, RELAY, UNMATCHED_REASON, ready, withHeld,
} from './business-v2-page-sample';

const text = (html: string) =>
  html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const noop = () => {};
const never = async (): Promise<ShipmentResponse> => { throw new Error('not called'); };

function render(state: BusinessWorkspaceState, p: Partial<BusinessPageViewProps> = {}) {
  return renderToStaticMarkup(
    <BusinessPageView
      state={state} shipmentId={null} createShipment={never} matchShipment={never} refetchNow={async () => {}}
      dismissRunChanged={noop} onOpenShipment={noop} onCloseShipment={noop}
      businessHref={(id) => `/nyc/business/${id}`} {...p}
    />,
  );
}

/** No "hub", NaN or undefined in what a user can read. */
function expectClean(html: string) {
  expect(html).not.toMatch(/NaN|undefined/);
  expect(text(html)).not.toMatch(/\bhub\b/i);
}

describe('hook states', () => {
  it('loading', () => {
    const h = render(initialBusinessWorkspaceState);
    expect(text(h)).toContain('Loading your workspace');
    expectClean(h);
  });

  it('unknown business links to a business that exists and to /, without redirecting', () => {
    const h = render({ ...initialBusinessWorkspaceState, view: 'not_found', fallbackBusinessId: 'biz-bakery' });
    expect(text(h)).toContain('This business is not in the current city');
    expect(h).toContain('href="/nyc/business/biz-bakery"');
    expect(h).toContain('href="/"');
    expectClean(h);
    const none = render({ ...initialBusinessWorkspaceState, view: 'not_found', fallbackBusinessId: null });
    expect(text(none)).toContain('no businesses in the current city');
    expect(none).not.toContain('/nyc/business/');
  });

  it('503 travel_data_missing shows the fixed text and a Retry', () => {
    const s = businessWorkspaceReducer(initialBusinessWorkspaceState, {
      type: 'dashboardFailed',
      error: new ApiRequestError(503, 'Service Unavailable', undefined, 'http', 'travel_data_missing'),
    });
    const h = render(s);
    expect(text(h)).toContain('NYC travel data is not loaded on this server yet.');
    expect(h).toMatch(/<button[^>]*>Retry<\/button>/);
    expectClean(h);
    // The text comes from the state, also when set directly.
    const direct = render({ ...initialBusinessWorkspaceState, view: 'unavailable', unavailable: { code: 'travel_data_missing', message: TRAVEL_DATA_MISSING_TEXT } });
    expect(text(direct)).toContain(TRAVEL_DATA_MISSING_TEXT);
  });

  it('error before the first success has a Retry button', () => {
    const h = render({ ...initialBusinessWorkspaceState, view: 'error', error: 'Internal server error' });
    expect(text(h)).toContain('Internal server error');
    expect(h).toMatch(/<button[^>]*>Retry<\/button>/);
  });

  it('reconnecting keeps the last data and says so', () => {
    const s = businessWorkspaceReducer(ready(), { type: 'dashboardFailed', error: new ApiRequestError(0, 'Network error') });
    expect(s.reconnecting).toBe(true);
    const h = render(s);
    const t = text(h);
    expect(t).toContain(RECONNECTING_TEXT);
    expect(t).toContain('Acme Studio');
    expect(t).toContain('Sample boxes');
    expectClean(h);
  });

  it('a changed city shows a dismissable note', () => {
    const h = render({ ...ready(), runChanged: true });
    expect(text(h)).toContain(RUN_CHANGED_NOTE);
    expect(h).toMatch(/<button[^>]*>Dismiss<\/button>/);
  });
});

describe('workspace', () => {
  it('renders the header, notifications, toolbar and both directions of deliveries', () => {
    const h = render(ready());
    const t = text(h);
    for (const part of ['Acme Studio', 'Notifications', 'New delivery', 'Search', 'Outgoing', 'Incoming',
      'Sample boxes', 'Fabric rolls', 'Spare keys', 'Invoices', 'Delivery arranged']) expect(t).toContain(part);
    expect(h).toContain('class="ba-header"');
    expect(h).toContain('class="bw-table"');
    expect(h).not.toContain('class="nd"'); // the form is behind the button
    expectClean(h);
  });

  it('numbers and prices come from the API response', () => {
    const t = text(render(ready()));
    expect(t).toContain('$12.50'); // directPlan.customerPriceCents 1250
    expect(t).toContain('$16.00'); // relayPlan.customerPriceCents 1600
    expect(t).toContain('$28.50'); // totals.spendCents 2850
    expect(t).toContain(UNMATCHED_REASON);
  });

  it('opens New delivery from the sending business', () => {
    const h = render(ready(), { initialNewOpen: true });
    expect(h).toContain('class="nd"');
    expect(text(h)).toContain('From Acme Studio');
  });

  it('applies the local search and filters to the rows', () => {
    const h = render(ready(), { initialTable: { ...INITIAL_TABLE, filters: { query: 'keys', direction: 'all', status: 'all' } } });
    const t = text(h);
    expect(t).toContain('Spare keys');
    expect(t).not.toContain('Fabric rolls');
    expect(h).toContain('value="keys"');
    const incoming = text(render(ready(), { initialTable: { ...INITIAL_TABLE, filters: { query: '', direction: 'incoming', status: 'all' } } }));
    expect(incoming).toContain('Invoices');
    expect(incoming).not.toContain('Spare keys');
  });

  it('an empty business shows the empty table with New delivery', () => {
    const h = render(ready({ ...DASHBOARD, outgoing: [], incoming: [], notifications: [] }));
    expect(text(h)).toContain('No deliveries yet');
  });
});

describe('?shipment= details', () => {
  it('a matched direct delivery', () => {
    const h = render(ready(), { shipmentId: 'shp-7' });
    const t = text(h);
    expect(h).toContain('class="bd-panel"');
    expect(t).toContain('Direct');
    expect(t).toContain('Maya Chen');
    expect(h).toMatch(/<tr[^>]*aria-selected="true"/);
    expectClean(h);
  });

  it('a matched relay delivery names the relay business "relay point"', () => {
    const h = render(ready(), { shipmentId: 'shp-8' });
    const t = text(h);
    expect(t).toContain('Relay via Atlas Books (relay point)');
    expect(t).toContain('Luis Ortega');
    expectClean(h);
  });

  it('an unmatched delivery shows its reason and Try matching again', () => {
    const h = render(ready(), { shipmentId: 'shp-9' });
    const t = text(h);
    expect(t).toContain(UNMATCHED_REASON);
    expect(t).toContain('Try matching again');
  });

  it('an incoming delivery opens too', () => {
    const t = text(render(ready(), { shipmentId: 'shp-10' }));
    expect(t).toContain('Invoices');
    expect(t).toContain('Bakery Row');
  });

  it('a delivery that is not this business\'s shows a message with a way back, never a blank panel', () => {
    const h = render(withHeld(ready(), 'shp-404', null), { shipmentId: 'shp-404' });
    const t = text(h);
    expect(t).toContain('This delivery is not in the current city');
    expect(t).toContain('shp-404');
    expect(h).toMatch(/<button[^>]*>Back to deliveries<\/button>/);
    expect(h).toContain('href="/simulator?package=shp-404&amp;play=1"');
    expect(h).not.toContain('class="bd-panel"');
    expect(t).toContain('Sample boxes'); // the table is still there
  });
});

describe('New delivery refusals show the server\'s message in the form', () => {
  const formView = (error: unknown) => renderToStaticMarkup(
    <NewDeliveryFormView
      origin={ACME} businesses={BUSINESSES} phase="planning" draft={emptyDraft()} errors={{}}
      status={statusForError(error)} onChange={noop} onSubmit={noop} onOpenDelivery={noop} onCancel={noop}
    />,
  );

  it('409 locked', () => {
    const t = text(formView(new ApiRequestError(409, 'Start a new planning cycle to change deliveries')));
    expect(t).toContain('Start a new planning cycle to change deliveries');
  });

  it('400 invalid', () => {
    const e = new ApiRequestError(400, 'Deadline must be after ready time', { deadlineMin: 'Deadline must be after ready time' });
    expect(text(formView(e))).toContain('Deadline must be after ready time');
  });
});

describe('a same-version poll', () => {
  it('returns the same state object, so the view keeps its form, search and filters', () => {
    const s = ready();
    const again = businessWorkspaceReducer(s, { type: 'dashboard', dashboard: { ...DASHBOARD }, runId: 'run-1' });
    expect(again).toBe(s);
    expect(again.dashboard).toBe(s.dashboard);
  });

  it('the details follow the newest response', () => {
    const delivered = { ...DIRECT, status: 'delivered' as const, deliveredAtMin: 1108 };
    const s = businessWorkspaceReducer(ready(), {
      type: 'dashboard', dashboard: { ...DASHBOARD, outgoing: [delivered, ...DASHBOARD.outgoing.slice(1)], version: 8 }, runId: 'run-1',
    });
    expect(text(render(s, { shipmentId: 'shp-7' }))).toMatch(/Delivered/);
  });
});

// #581
describe('relay point, locked run and the single <main>', () => {
  const atlas = () => ready(ATLAS_DASHBOARD);

  it('renders no <main> in any state: the shell has the only one', () => {
    const states: [BusinessWorkspaceState, Partial<BusinessPageViewProps>][] = [
      [initialBusinessWorkspaceState, {}],
      [{ ...initialBusinessWorkspaceState, view: 'not_found', fallbackBusinessId: 'biz-x' }, {}],
      [{ ...initialBusinessWorkspaceState, view: 'error', error: 'E' }, {}],
      [{ ...initialBusinessWorkspaceState, view: 'unavailable', unavailable: { code: 'travel_data_missing', message: 'M' } }, {}],
      [ready(), {}],
      [ready(), { shipmentId: 'shp-7' }],
      [withHeld(ready(), 'shp-404', null), { shipmentId: 'shp-404' }],
      [withHeld(atlas(), 'shp-8', RELAY), { shipmentId: 'shp-8' }],
    ];
    for (const [state, props] of states) {
      const h = render(state, props);
      expect(h).not.toMatch(/<main\b/);
      expect(h).toMatch(/^<div class="bp">/);
    }
  });

  it('a package held here opens with the relay line above the normal details', () => {
    const h = render(withHeld(atlas(), 'shp-8', RELAY), { shipmentId: 'shp-8' });
    const t = text(h);
    expect(h).toContain(`<p class="bp-notice bp-held">${heldHereText(ATLAS.name)}</p>`);
    expect(h.indexOf('bp-held')).toBeLessThan(h.indexOf('class="bd-panel"'));
    expect(t).toContain('Fabric rolls');
    expect(t).toContain('Acme Studio');
    expect(t).toContain('Bakery Row');
    expect(t).toContain('Maya Chen');
    expect(t).toContain('Luis Ortega');
    expect(h).toContain('<span class="bd-eyebrow">Relay point</span>');
    expect(h).toMatch(/<span class="ba-note__time">5:00 PM<\/span>/);
    expect(t).not.toContain('This delivery is not in the current city');
    expectClean(h);
    // One of its own deliveries has no such line.
    expect(render(ready(), { shipmentId: 'shp-8' })).not.toContain('bp-held');
  });

  it('while the package is being read the panel says so, with a way back', () => {
    const h = render(atlas(), { shipmentId: 'shp-8' });
    const t = text(h);
    expect(t).toContain('Loading this delivery');
    expect(t).not.toContain('This delivery is not in the current city');
    expect(h).toMatch(/<button[^>]*>Back to deliveries<\/button>/);
    expect(h).not.toContain('class="bd-panel"');
    expect(h).toMatch(/<span class="ba-note__time">—<\/span>/);
    const failed = businessWorkspaceReducer(atlas(), { type: 'heldFailed', shipmentId: 'shp-8' });
    expect(text(render(failed, { shipmentId: 'shp-8' }))).toContain('The delivery could not be loaded. Trying again');
  });

  it('a locked run disables New delivery and says why; planning does neither', () => {
    const locked = render(ready({ ...DASHBOARD, phase: 'locked' }));
    expect(locked).toMatch(/<button[^>]*class="bw-btn bw-btn--primary bw-toolbar__new"[^>]*disabled=""[^>]*>New delivery<\/button>/);
    expect(locked).toContain(`<p class="bp-notice bp-closed">${NEW_DELIVERY_CLOSED_TEXT.replace(/'/g, '&#x27;')}</p>`);
    const open = render(ready());
    expect(open).not.toMatch(/<button[^>]*disabled/);
    expect(open).not.toContain('bp-closed');
    // The empty table's button follows the toolbar's.
    const empty = render(ready({ ...DASHBOARD, outgoing: [], incoming: [], phase: 'locked' }));
    expect(empty.match(/<button[^>]*disabled=""[^>]*>New delivery<\/button>/g)).toHaveLength(2);
  });
});
