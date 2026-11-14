// #497: the MVP II Business workspace by keyboard and screen reader. Static renders walked in DOM
// order: every control is reachable, named and has a :focus-visible style from the business folder;
// results and errors are announced; statuses and "New" are text; the table is labelled and stacks at 390 px.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ShipmentResponse } from '../../shared/v2/api';
import { ApiRequestError } from '../../client/src/api/v2';
import { NotificationsList } from '../../client/src/components/business/v2/activity/NotificationsPanel';
import type { NotificationRow } from '../../client/src/components/business/v2/activity/activityModel';
import { TRAVEL_DATA_MISSING_TEXT, type BusinessWorkspaceState } from '../../client/src/components/business/v2/live/businessWorkspaceState';
import { NewDeliveryFormView } from '../../client/src/components/business/v2/NewDeliveryForm';
import {
  RESULT_COPY, emptyDraft, statusForError, validate, type FieldErrors, type SubmitStatus,
} from '../../client/src/components/business/v2/newDeliveryModel';
import { BusinessPageView, type BusinessPageViewProps } from '../../client/src/components/business/v2/page/BusinessPageView';
import {
  accessibleName, all, byId, focusVisibleSelectors, matchesSelector, parseCss, parseHtml, tabOrder, textOf, v2CssFiles,
  type El,
} from './employee-v2-qa-helpers';
import { ACME, BUSINESSES, DASHBOARD, DIRECT, UNMATCHED_REASON, ready, withHeld } from './business-v2-page-sample';

const BUSINESS_DIR = 'client/src/components/business/v2';
const focusSelectors = v2CssFiles(BUSINESS_DIR).flatMap((f) => focusVisibleSelectors(parseCss(readFileSync(f, 'utf8'))));
const noop = () => {};
const never = async (): Promise<ShipmentResponse> => { throw new Error('not called'); };
const ROW_COUNT = DASHBOARD.outgoing.length + DASHBOARD.incoming.length;

function page(state: BusinessWorkspaceState, p: Partial<BusinessPageViewProps> = {}): El {
  return parseHtml(renderToStaticMarkup(
    <BusinessPageView
      state={state} shipmentId={null} createShipment={never} matchShipment={never} refetchNow={async () => {}}
      dismissRunChanged={noop} onOpenShipment={noop} onCloseShipment={noop}
      businessHref={(id) => `/nyc/business/${id}`} {...p}
    />,
  ));
}

function form(status: SubmitStatus, errors: FieldErrors = {}): El {
  return parseHtml(renderToStaticMarkup(
    <NewDeliveryFormView
      origin={ACME} businesses={BUSINESSES} phase="planning" draft={emptyDraft()} errors={errors} status={status}
      onChange={noop} onSubmit={noop} onOpenDelivery={noop} onCancel={noop}
    />,
  ));
}

const cls = (e: El) => (e.attrs.class ?? '').split(/\s+/);
const describeEl = (e: El) => `<${e.tag}${e.attrs.class ? ` class="${e.attrs.class}"` : ''}>`;

/** Every tab stop has a name and a :focus-visible style from this folder; returns the names in tab order. */
function walkTabs(root: El): string[] {
  return tabOrder(root).map((e) => {
    const name = accessibleName(root, e);
    expect(name, `${describeEl(e)} has no accessible name`).not.toBe('');
    expect(focusSelectors.some((s) => matchesSelector(e, s)), `${describeEl(e)} "${name}" has no :focus-visible style`).toBe(true);
    return name;
  });
}

const TOOLBAR = ['Search', 'All', 'Outgoing', 'Incoming', 'Status', 'New delivery'];
const SORTS = ['Package', 'Shipment ID', 'Business', 'Status', 'Plan', 'Ready', 'Deadline', 'Delivery', 'Price'];
const FORM = [
  'Recipient', 'Package name', 'Type', 'Weight (kg)', 'Contents',
  'Pickup instructions (optional)', 'Drop-off instructions (optional)',
  'Ready for pickup (Day 1)', 'Deliver by: day', 'Deliver by: time', 'Send request', 'Cancel',
];

describe('keyboard walk (#497)', () => {
  it('workspace: search, filters and New delivery first, then sort headers and every delivery row, then notifications', () => {
    const root = page(ready());
    const names = walkTabs(root);
    expect(names.slice(0, TOOLBAR.length)).toEqual(TOOLBAR);
    expect(names.slice(TOOLBAR.length, TOOLBAR.length + SORTS.length).map((n) => n.replace(/[▲▼]/g, '').trim())) // the arrow is aria-hidden.toEqual(SORTS);
    const rows = tabOrder(root).filter((e) => e.tag === 'tr');
    expect(rows).toHaveLength(ROW_COUNT);
    // Rows come right after the sort headers, before the side panel.
    const firstRow = tabOrder(root).indexOf(rows[0]);
    expect(firstRow).toBe(TOOLBAR.length + SORTS.length);
    // Each row is named by its cells (package, ID, status...), so a screen reader reads the delivery.
    for (const r of rows) expect(accessibleName(root, r)).toMatch(/shp-\d+/);
    // Notification buttons follow the table.
    const rest = names.slice(firstRow + ROW_COUNT);
    expect(rest.length).toBeGreaterThan(0);
    for (const n of rest) expect(n).toMatch(/Open delivery shp-|Show all/);
  });

  it('direction filters say which is on with aria-pressed, inside a named group', () => {
    const root = page(ready());
    const group = all(root, (e) => e.attrs.role === 'group' && cls(e).includes('bw-segmented'))[0];
    expect(accessibleName(root, group)).toBe('Direction');
    const btns = all(group, (e) => e.tag === 'button');
    expect(btns.map((b) => [textOf(b), b.attrs['aria-pressed']])).toEqual([['All', 'true'], ['Outgoing', 'false'], ['Incoming', 'false']]);
    // The status filter is a labelled select whose options carry counts as text.
    const status = tabOrder(root).find((e) => e.tag === 'select')!;
    expect(accessibleName(root, status)).toBe('Status');
    expect(textOf(status)).toMatch(/All statuses \(\d+\)/);
    // The toolbar is a named search landmark.
    const search = all(root, (e) => e.attrs.role === 'search')[0];
    expect(search.attrs['aria-label']).toBe('Shipments');
  });

  it('New delivery open: the form follows the toolbar, every field and both actions in order', () => {
    const names = walkTabs(page(ready(), { initialNewOpen: true }));
    expect(names.slice(0, TOOLBAR.length + FORM.length)).toEqual([...TOOLBAR, ...FORM]);
  });

  it('a delivery open: Close, Try matching again and View journey (the simulator link) are reachable', () => {
    const root = page(ready(), { shipmentId: 'shp-9' });
    const names = walkTabs(root);
    const close = names.indexOf('Close delivery details');
    expect(close).toBeGreaterThan(TOOLBAR.length + SORTS.length + ROW_COUNT - 1);
    expect(names.slice(close, close + 3)).toEqual(['Close delivery details', 'Try matching again', 'View journey']);
    const journey = tabOrder(root)[close + 2];
    expect(journey.attrs.href).toBe('/simulator?package=shp-9');
    // The selected row says so.
    expect(all(root, (e) => e.tag === 'tr' && e.attrs['aria-selected'] === 'true')).toHaveLength(1);
  });

  it('a matched relay delivery: the carrier links and View journey are reachable', () => {
    const names = walkTabs(page(ready(), { shipmentId: 'shp-8' }));
    const close = names.indexOf('Close delivery details');
    expect(close).toBeGreaterThan(0);
    expect(names.slice(close)).toContain('View journey');
    expect(names.slice(close, names.indexOf('View journey')).length).toBeGreaterThan(1); // carrier link(s)
  });

  it('result cards: View delivery and Watch in simulator in a matched result, View delivery in an unmatched one', () => {
    const matched = walkTabs(form({ kind: 'matched', shipmentId: DIRECT.shipment.id, response: { ...DIRECT, matched: true } }));
    expect(matched.slice(-4)).toEqual(['View delivery', 'Watch in simulator', 'Send request', 'Cancel']);
    const unmatched = walkTabs(form({ kind: 'unmatched', shipmentId: 'shp-2', reason: UNMATCHED_REASON }));
    expect(unmatched.slice(-3)).toEqual(['View delivery', 'Send request', 'Cancel']);
  });

  it('problem states: Retry, Dismiss and Back to deliveries are reachable and named', () => {
    expect(walkTabs(page({ ...ready(), view: 'unavailable', unavailable: { code: 'travel_data_missing', message: TRAVEL_DATA_MISSING_TEXT } })))
      .toEqual(['Retry']);
    expect(walkTabs(page({ ...ready(), runChanged: true }))[0]).toBe('Dismiss');
    const missing = walkTabs(page(withHeld(ready(), 'shp-404', null), { shipmentId: 'shp-404' }));
    expect(walkTabs(page(ready(), { shipmentId: 'shp-404' }))).toContain('Back to deliveries'); // still loading
    expect(missing).toContain('Back to deliveries');
    expect(missing).toContain('Look for it in the simulator');
  });

  it('empty and no-match tables keep a named, focus-styled button', () => {
    expect(walkTabs(page(ready({ ...DASHBOARD, outgoing: [], incoming: [], notifications: [] }))))
      .toEqual([...TOOLBAR, 'New delivery']);
    const filtered = page(ready(), { initialTable: { sort: { key: 'label', dir: 'asc' }, filters: { query: 'zzz', direction: 'all', status: 'all' } } });
    expect(walkTabs(filtered).slice(TOOLBAR.length)).toContain('Clear filters');
  });
});

describe('announcements (#497)', () => {
  it('every field error is tied to its input with aria-describedby and the input is aria-invalid', () => {
    const errors = validate({ ...emptyDraft(), weightKg: '3', readyTime: '', deadlineTime: '' }, ACME.id);
    expect(Object.keys(errors).length).toBeGreaterThanOrEqual(3);
    const root = form({ kind: 'idle' }, errors);
    const msgs = all(root, (e) => cls(e).includes('nd-error'));
    expect(msgs).toHaveLength(Object.keys(errors).length);
    for (const msg of msgs) {
      const owners = all(root, (e) => (e.attrs['aria-describedby'] ?? '').split(/\s+/).includes(msg.attrs.id));
      expect(owners, `"${textOf(msg)}" is not tied to a control`).toHaveLength(1);
      expect(owners[0].attrs['aria-invalid']).toBe('true');
    }
  });

  it('"Delivery arranged" and "No matching commute yet" with the reason are in a status region', () => {
    const ok = form({ kind: 'matched', shipmentId: DIRECT.shipment.id, response: { ...DIRECT, matched: true } });
    const region = all(ok, (e) => e.attrs.role === 'status')[0];
    expect(textOf(region)).toContain(RESULT_COPY.matched);
    const none = form({ kind: 'unmatched', shipmentId: 'shp-2', reason: UNMATCHED_REASON });
    const r2 = all(none, (e) => e.attrs.role === 'status')[0];
    expect(textOf(r2)).toContain(RESULT_COPY.unmatched);
    expect(textOf(r2)).toContain(UNMATCHED_REASON);

    // The details panel announces its result too.
    const matched = page(ready(), { shipmentId: 'shp-7' });
    expect(all(matched, (e) => e.attrs.role === 'status' && textOf(e).startsWith('Delivery arranged'))).toHaveLength(1);
    const unmatched = page(ready(), { shipmentId: 'shp-9' });
    const st = all(unmatched, (e) => e.attrs.role === 'status' && textOf(e).startsWith('No matching commute yet'));
    expect(st).toHaveLength(1);
    expect(textOf(st[0])).toContain(UNMATCHED_REASON);
  });

  it('the 503 message is an alert, in the form and on the page', () => {
    const root = form(statusForError(new ApiRequestError(503, 'x', undefined, 'http', 'travel_data_missing')));
    const alert = all(root, (e) => e.attrs.role === 'alert')[0];
    expect(textOf(alert)).toBe(RESULT_COPY.unavailable);
    const p = page({ ...ready(), view: 'unavailable', unavailable: { code: 'travel_data_missing', message: TRAVEL_DATA_MISSING_TEXT } });
    expect(textOf(all(p, (e) => e.attrs.role === 'alert')[0])).toContain(TRAVEL_DATA_MISSING_TEXT);
  });

  it('a delivery status is text in its cell, not colour alone', () => {
    const root = page(ready());
    const cells = all(root, (e) => e.tag === 'td' && e.attrs['data-label'] === 'Status');
    expect(cells).toHaveLength(ROW_COUNT);
    for (const c of cells) {
      const badge = all(c, (e) => cls(e).includes('bw-status'))[0];
      expect(textOf(badge).length, 'status badge has no text').toBeGreaterThan(2);
    }
    // The unmatched row says why, in words.
    expect(textOf(root)).toContain(UNMATCHED_REASON);
  });

  it('the "New" mark on a notification is text and is in the button name', () => {
    const row: NotificationRow = {
      id: 'n1', time: '4:00 PM', message: 'Delivery arranged.', role: 'sender', tag: null, isNew: true, shipmentId: 'shp-7',
    };
    const root = parseHtml(renderToStaticMarkup(<NotificationsList rows={[row]} showAll={false} onShowAll={noop} onOpen={noop} />));
    const mark = all(root, (e) => cls(e).includes('ba-note__new'))[0];
    expect(textOf(mark)).toBe('New');
    const btn = tabOrder(root)[0];
    expect(accessibleName(root, btn)).toMatch(/^New\. /);
  });

  it('the shipments table has a caption and scope="col" on every header', () => {
    const root = page(ready());
    const table = all(root, (e) => e.tag === 'table' && cls(e).includes('bw-table'))[0];
    const caption = all(table, (e) => e.tag === 'caption')[0];
    expect(textOf(caption)).toMatch(/^Shipments/);
    const ths = all(table, (e) => e.tag === 'th');
    expect(ths.length).toBe(10);
    for (const th of ths) expect(th.attrs.scope).toBe('col');
    // The sorted column says so.
    expect(ths.filter((th) => th.attrs['aria-sort'])).toHaveLength(1);
    // Every cell carries the column label the stacked 390 px layout shows.
    const heads = ths.map((th) => textOf(th).replace(/[▲▼]/g, '').trim());
    for (const tr of all(table, (e) => e.tag === 'tr' && cls(e).includes('bw-row'))) {
      expect(all(tr, (e) => e.tag === 'td').map((td) => td.attrs['data-label'])).toEqual(heads);
    }
  });

  it('the carriers table in the details has a caption and scoped headers', () => {
    const root = page(ready(), { shipmentId: 'shp-8' });
    const legs = all(root, (e) => e.tag === 'table' && cls(e).includes('bd-legs'))[0];
    expect(textOf(all(legs, (e) => e.tag === 'caption')[0])).not.toBe('');
    for (const th of all(legs, (e) => e.tag === 'th')) expect(th.attrs.scope).toBe('col');
  });

  it('no "hub" in anything a user reads', () => {
    for (const id of [null, 'shp-7', 'shp-8', 'shp-9']) {
      const root = page(ready(), { shipmentId: id, initialNewOpen: true });
      expect(textOf(root)).not.toMatch(/\bhub\b/i);
      for (const e of tabOrder(root)) expect(accessibleName(root, e)).not.toMatch(/\bhub\b/i);
    }
  });

  it('the details heading takes focus when a delivery opens (tabindex -1, not a tab stop)', () => {
    const root = page(ready(), { shipmentId: 'shp-7' });
    const panel = all(root, (e) => cls(e).includes('bd-panel'))[0];
    const heading = byId(root, panel.attrs['aria-labelledby'])!;
    expect(heading.tag).toBe('h2');
    expect(heading.attrs.tabindex).toBe('-1');
  });
});
