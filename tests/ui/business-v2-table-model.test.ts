import { describe, expect, it } from 'vitest';
import {
  buildRows, filterRows, nextSort, NO_FILTERS, sortRows, statusCounts, shipmentStatusLabel, hasActiveFilters,
} from '../../client/src/components/business/v2/shipmentsTableModel';
import { BUSINESSES, DASHBOARD, ME, shipment, view } from './business-v2-table-sample';

const rows = buildRows(DASHBOARD, BUSINESSES);
const byId = (id: string) => rows.find((r) => r.id === id)!;

describe('buildRows', () => {
  it('gives one row per outgoing and incoming shipment, outgoing first, newest first', () => {
    expect(rows.map((r) => r.id)).toEqual(['shp-3', 'shp-2', 'shp-1', 'shp-4']);
    expect(rows.map((r) => r.direction)).toEqual(['outgoing', 'outgoing', 'outgoing', 'incoming']);
  });

  it('outgoing direct plan: recipient, Direct, delivered time, price', () => {
    const r = byId('shp-1');
    expect(r).toMatchObject({
      directionLabel: 'Outgoing', label: 'Contracts', counterpart: 'Bakery Row',
      status: 'delivered', statusLabel: 'Delivered', planKind: 'direct', planLabel: 'Direct',
      relayPointName: null, etaMin: 1090, deliveredAtMin: 1085, priceCents: 1250, priceText: '$12.50',
      unmatchedReason: null, readyText: 'Day 1, 5:00 PM', deadlineText: 'Day 2, 1:00 AM',
    });
    expect(r.deliveryText).toBe('Delivered Day 1, 6:05 PM');
  });

  it('outgoing relay plan names the relay business and says "At relay point"', () => {
    const r = byId('shp-2');
    expect(r).toMatchObject({
      counterpart: 'Print Shop', planKind: 'relay', planLabel: 'Relay', relayPointName: 'Atlas Books',
      status: 'at_hub', statusLabel: 'At relay point', etaMin: 1980, priceText: '$18.00',
    });
    expect(r.deliveryText).toBe('ETA Day 2, 9:00 AM');
  });

  it('unmatched outgoing carries its reason, no plan, no ETA, no price', () => {
    const r = byId('shp-3');
    expect(r).toMatchObject({
      status: 'unmatched', statusLabel: 'Unmatched', planKind: null, planLabel: 'No match',
      etaMin: null, deliveredAtMin: null, deliveryText: '—', priceCents: null, priceText: '—',
      unmatchedReason: 'No commute passes both businesses before the deadline.',
    });
  });

  it('incoming plan: sender as counterpart, ETA, no price shown', () => {
    const r = byId('shp-4');
    expect(r).toMatchObject({
      directionLabel: 'Incoming', counterpart: 'Corner Cafe', planKind: 'direct',
      status: 'scheduled', etaMin: 1130, priceCents: null, priceText: '—',
    });
    expect(r.deliveryText).toBe('ETA Day 1, 6:50 PM');
  });

  it('never shows a raw place ID for an unknown business or relay point', () => {
    const odd = buildRows({
      ...DASHBOARD,
      outgoing: [view(shipment('shp-9', { destinationBusinessId: 'biz-gone' }),
        { ...DASHBOARD.outgoing[1].plan!, shipmentId: 'shp-9', relayBusinessId: 'biz-missing' }, 'scheduled')],
      incoming: [],
    }, [ME]);
    expect(odd[0].counterpart).toBe('Unknown business');
    expect(odd[0].relayPointName).toBe('Unknown place');
    expect(JSON.stringify(odd)).not.toMatch(/biz-gone|biz-missing/);
  });

  it('copies statuses, prices and ETAs from the API as-is', () => {
    for (const v of [...DASHBOARD.outgoing, ...DASHBOARD.incoming]) {
      const r = byId(v.shipment.id);
      expect(r.status).toBe(v.status);
      expect(r.etaMin).toBe(v.plan ? v.plan.deliveryMin : null);
    }
  });

  it('never says "hub" in any status label', () => {
    for (const s of ['unmatched', 'scheduled', 'picked_up', 'at_hub', 'out_for_delivery', 'delivered'] as const) {
      expect(shipmentStatusLabel(s).toLowerCase()).not.toContain('hub');
    }
    expect(shipmentStatusLabel('left_hub' as never)).toBe('Left relay point');
  });
});

describe('filterRows', () => {
  it('no filters keeps everything', () => {
    expect(filterRows(rows, NO_FILTERS)).toEqual(rows);
    expect(hasActiveFilters(NO_FILTERS)).toBe(false);
  });
  it('query matches label, ID, counterpart and relay point, case-insensitive', () => {
    const ids = (query: string) => filterRows(rows, { ...NO_FILTERS, query }).map((r) => r.id);
    expect(ids('contracts')).toEqual(['shp-1']);
    expect(ids('SHP-4')).toEqual(['shp-4']);
    expect(ids('corner')).toEqual(['shp-3', 'shp-4']);
    expect(ids('atlas')).toEqual(['shp-2']);
    expect(ids('  print ')).toEqual(['shp-2']);
    expect(ids('nothing like this')).toEqual([]);
  });
  it('filters by direction and status', () => {
    expect(filterRows(rows, { ...NO_FILTERS, direction: 'incoming' }).map((r) => r.id)).toEqual(['shp-4']);
    expect(filterRows(rows, { ...NO_FILTERS, direction: 'outgoing' })).toHaveLength(3);
    expect(filterRows(rows, { ...NO_FILTERS, status: 'at_hub' }).map((r) => r.id)).toEqual(['shp-2']);
    expect(filterRows(rows, { query: 'corner', direction: 'outgoing', status: 'all' }).map((r) => r.id)).toEqual(['shp-3']);
  });
});

describe('sortRows', () => {
  it('sorts by deadline, ties keep input order (stable) in both directions', () => {
    // shp-3 and shp-1 share deadline 1500; shp-4 is 2040; shp-2 is 2100.
    expect(sortRows(rows, 'deadline', 'asc').map((r) => r.id)).toEqual(['shp-3', 'shp-1', 'shp-4', 'shp-2']);
    expect(sortRows(rows, 'deadline', 'desc').map((r) => r.id)).toEqual(['shp-2', 'shp-4', 'shp-3', 'shp-1']);
  });
  it('sorts by status in progress order and is stable', () => {
    const many = [...rows, { ...rows[3], id: 'shp-5' }, { ...rows[0], id: 'shp-6' }];
    expect(sortRows(many, 'status', 'asc').map((r) => r.id)).toEqual(['shp-3', 'shp-6', 'shp-4', 'shp-5', 'shp-2', 'shp-1']);
    expect(sortRows(many, 'status', 'asc')).toEqual(sortRows(sortRows(many, 'status', 'asc'), 'status', 'asc'));
  });
  it('puts missing values last and does not mutate the input', () => {
    const before = rows.map((r) => r.id);
    expect(sortRows(rows, 'price', 'asc').map((r) => r.id)).toEqual(['shp-1', 'shp-2', 'shp-3', 'shp-4']);
    expect(sortRows(rows, 'price', 'desc').map((r) => r.id)).toEqual(['shp-2', 'shp-1', 'shp-3', 'shp-4']);
    expect(sortRows(rows, 'delivery', 'asc').map((r) => r.id)).toEqual(['shp-1', 'shp-4', 'shp-2', 'shp-3']);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
  it('nextSort flips the same key and starts a new key ascending', () => {
    expect(nextSort({ key: 'deadline', dir: 'asc' }, 'deadline')).toEqual({ key: 'deadline', dir: 'desc' });
    expect(nextSort({ key: 'deadline', dir: 'desc' }, 'status')).toEqual({ key: 'status', dir: 'asc' });
  });
});

describe('statusCounts', () => {
  it('counts add up to the number of rows', () => {
    const counts = statusCounts(rows);
    expect(counts.reduce((s, c) => s + c.count, 0)).toBe(rows.length);
    expect(counts.find((c) => c.status === 'at_hub')).toEqual({ status: 'at_hub', label: 'At relay point', count: 1 });
    expect(counts.find((c) => c.status === 'picked_up')?.count).toBe(0);
    expect(statusCounts([]).reduce((s, c) => s + c.count, 0)).toBe(0);
  });
});
