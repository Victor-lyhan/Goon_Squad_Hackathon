import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShipmentsTable } from '../../client/src/components/business/v2/ShipmentsTable';
import { ShipmentsToolbar } from '../../client/src/components/business/v2/ShipmentsToolbar';
import { buildRows, sortRows, statusCounts } from '../../client/src/components/business/v2/shipmentsTableModel';
import { BUSINESSES, DASHBOARD } from './business-v2-table-sample';

const noop = () => {};
const rows = buildRows(DASHBOARD, BUSINESSES);

/** Visible text + attribute values, without our own class names (which contain no IDs anyway). */
function expectClean(html: string) {
  expect(html).not.toMatch(/NaN|undefined/);
  expect(html).not.toMatch(/\b(biz|home)-[a-z0-9]/i);
  expect(html.toLowerCase()).not.toContain('hub');
}

const table = (over: Partial<Parameters<typeof ShipmentsTable>[0]> = {}) => renderToStaticMarkup(
  <ShipmentsTable rows={sortRows(rows, 'deadline', 'asc')} totalCount={rows.length}
    sort={{ key: 'deadline', dir: 'asc' }} onSort={noop} selectedId="shp-2" onSelect={noop}
    onNewDelivery={noop} onClearFilters={noop} {...over} />,
);

describe('ShipmentsTable', () => {
  it('renders a real table with caption, aria-sort and the selected row', () => {
    const html = table();
    expect(html).toContain('<table');
    // The caption holds the list's h2 "Deliveries" and the count; "deliveries" is for a screen reader only (#881).
    expect(html).toMatch(/<caption[^>]*><h2 class="bw-table__title">Deliveries<\/h2>/);
    expect(html).toContain('<span class="bw-table__count">4<span class="bw-visually-hidden"> deliveries</span></span>');
    expect(html.match(/aria-sort=/g)).toHaveLength(1);
    expect(html).toMatch(/<th[^>]*aria-sort="ascending"[^>]*><button[^>]*>Deadline/);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toMatch(/<tr[^>]*aria-selected="true"[^>]*>.*?Sample boxes/);
    expect(html.match(/<tr class="bw-row"/g)).toHaveLength(4);
    expect(html.match(/tabindex="0"/g)).toHaveLength(4);
    expectClean(html);
  });

  it('shows the relay point, the unmatched reason, ETA, delivered time and price', () => {
    const html = table();
    expect(html).toContain('via Atlas Books');
    expect(html).toContain('At relay point');
    expect(html).toContain('No commute passes both businesses before the deadline.');
    expect(html).toContain('ETA Day 2, 9:00 AM');
    expect(html).toContain('Delivered Day 1, 6:05 PM');
    expect(html).toContain('$12.50');
  });

  it('puts IDs, times and money in mono cells and labels every cell for stacked rows', () => {
    const html = table();
    // The raw ID is the row's key in the markup, never on screen (#881): the cell and its header are `hidden`.
    expect(html).toMatch(/<td data-label="Shipment ID" class="bw-mono bw-col--drop2" hidden="">shp-1<\/td>/);
    expect(html).toMatch(/<th scope="col" class="bw-col--drop2" hidden="">/);
    expect(html.match(/hidden=""/g)).toHaveLength(5); // one header and four cells, nothing else
    expect(html).toMatch(/<td data-label="Deadline" class="bw-mono bw-col--drop1">Day 2, 1:00 AM<\/td>/);
    expect(html).toMatch(/<td data-label="Price" class="bw-mono bw-num">\$18.00<\/td>/);
    const cells = html.match(/<td /g)!.length;
    expect(html.match(/<td data-label="/g)!.length).toBe(cells);
    expect(html).toMatch(/class="bw-status bw-status--warn">At relay point/);
  });

  it('marks the columns that drop in a narrow box, header and cells alike (#581)', () => {
    const html = table();
    const drop = (label: string) => {
      const th = new RegExp(`<th scope="col"(?: class="([^"]*)")?[^>]*>(?:<button[^>]*>)?${label}<`).exec(html);
      expect(th, label).not.toBeNull();
      const tds = [...html.matchAll(new RegExp(`<td data-label="${label}"(?: class="([^"]*)")?(?: hidden="")?>`, 'g'))];
      expect(tds).toHaveLength(4);
      const cls = (c: string | undefined) => (c ?? '').split(' ').filter((x) => x.startsWith('bw-col--drop')).join(' ');
      for (const td of tds) expect(cls(td[1]), label).toBe(cls(th![1]));
      return cls(th![1]);
    };
    // Ready and Deadline go first, then the ID, then the direction; the rest always stay.
    expect(drop('Ready')).toBe('bw-col--drop1');
    expect(drop('Deadline')).toBe('bw-col--drop1');
    expect(drop('Shipment ID')).toBe('bw-col--drop2');
    expect(drop('Direction')).toBe('bw-col--drop3');
    for (const keep of ['Package', 'Business', 'Status', 'Plan', 'Delivery', 'Price']) expect(drop(keep), keep).toBe('');
  });

  it('descending sort is reflected in aria-sort', () => {
    expect(table({ sort: { key: 'status', dir: 'desc' } })).toMatch(/aria-sort="descending"[^>]*><button[^>]*>Status/);
  });

  it('shows "x of y" when filtered', () => {
    expect(table({ rows: rows.slice(0, 2) })).toContain('<span class="bw-table__count">2 of 4<span class="bw-visually-hidden"> deliveries</span></span>');
  });

  it('keeps the Plan cell to one child: relay point and unmatched reason sit inside it (#609)', () => {
    const html = table();
    const plans = [...html.matchAll(/<td data-label="Plan"[^>]*>(.*?)<\/td>/g)].map((m) => m[1]);
    expect(plans).toHaveLength(4);
    // One wrapper element holds the whole value, so the stacked 390 px cell stays label + value.
    for (const p of plans) expect(p).toMatch(/^<div class="bw-plan">(?:(?!<\/?div).)*<\/div>$/);
    expect(plans).toContain('<div class="bw-plan">Relay <span class="bw-muted">via Atlas Books</span></div>');
    expect(plans).toContain(
      '<div class="bw-plan">No match<span class="bw-reason">No commute passes both businesses before the deadline.</span></div>',
    );
    expect(plans.filter((p) => p === '<div class="bw-plan">Direct</div>')).toHaveLength(2);
  });

  it('the caption and the empty titles can take focus without being tab stops (#609)', () => {
    expect(table()).toMatch(/<caption class="bw-table__caption" tabindex="-1">/);
    expect(table({ rows: [], totalCount: 4 })).toMatch(/<h2 class="bw-empty__title" tabindex="-1">No deliveries match/);
    expect(table({ rows: [], totalCount: 0 })).toMatch(/<h2 class="bw-empty__title" tabindex="-1">No deliveries yet/);
  });

  it('empty state: no deliveries yet, with New delivery', () => {
    const html = table({ rows: [], totalCount: 0 });
    expect(html).toContain('No deliveries yet');
    expect(html).toContain('New delivery');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('disabled');
    // Locked run: the page disables this button like the toolbar's (#581).
    expect(table({ rows: [], totalCount: 0, newDeliveryDisabled: true })).toMatch(/<button[^>]*disabled=""[^>]*>New delivery</);
    expectClean(html);
  });

  it('empty state: no rows match the filters, with Clear filters', () => {
    const html = table({ rows: [], totalCount: 4 });
    expect(html).toContain('No deliveries match the filters');
    expect(html).toContain('Clear filters');
    expect(html).toContain('4 deliveries in total.');
    expectClean(html);
  });
});

describe('ShipmentsToolbar', () => {
  const toolbar = (over: Partial<Parameters<typeof ShipmentsToolbar>[0]> = {}) => renderToStaticMarkup(
    <ShipmentsToolbar initialQuery="" onQueryChange={noop} direction="outgoing" onDirectionChange={noop}
      status="all" onStatusChange={noop} counts={statusCounts(rows)} total={rows.length}
      onNewDelivery={noop} {...over} />,
  );

  it('renders a labelled search, direction filter, status filter with counts and New delivery', () => {
    const html = toolbar();
    const searchId = html.match(/<input id="([^"]+)" type="search"/)![1];
    expect(html).toContain(`<label for="${searchId}" class="bw-toolbar__label">Search</label>`);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Outgoing</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>All</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Incoming</);
    expect(html).toContain('All statuses (4)');
    expect(html).toContain('At relay point (1)');
    expect(html).toContain('Unmatched (1)');
    expect(html).toContain('Delivered (1)');
    expect(html).toContain('Scheduled (1)');
    expect(html).not.toContain('Picked up (0)');
    expect(html).toContain('>New delivery</button>');
    expectClean(html);
  });

  it('keeps a selected status that has no rows in the list', () => {
    expect(toolbar({ status: 'picked_up' })).toContain('Picked up (0)');
  });

  it('starts from initialQuery', () => {
    expect(toolbar({ initialQuery: 'atlas' })).toContain('value="atlas"');
  });

  it('keeps the search text in local state (not a prop that a poll could overwrite)', () => {
    const src = readFileSync('client/src/components/business/v2/ShipmentsToolbar.tsx', 'utf8');
    expect(src).toMatch(/useState\(props\.initialQuery/);
    expect(src).not.toMatch(/useEffect/);
  });
});
