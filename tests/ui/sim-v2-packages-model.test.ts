import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildPackageRows, filterPackageRows, NO_FILTERS, packageStatusLabel, STATUS_ORDER, statusFilters, toListItems,
} from '../../client/src/components/sim/v2/packages/packageListModel';
import { makeMap, makeSim, STATUS_MORNING, UNMATCHED_REASON } from './sim-v2-packages-fixture';

const rows = buildPackageRows(makeSim(), makeMap());
const row = (id: string) => rows.find((r) => r.id === id)!;
const ids = (rs: { id: string }[]) => rs.map((r) => r.id);

describe('buildPackageRows', () => {
  it('one row per shipment in createdSeq order, labelled with the package name', () => {
    expect(ids(rows)).toEqual(['shp-1', 'shp-2', 'shp-3', 'shp-4']);
    expect(rows.map((r) => r.label)).toEqual(['Brand proofs', 'Gift box', 'Signed lease', 'Spare keys']);
  });

  it('direct row: route by business name, "Direct", status from the snapshot', () => {
    expect(row('shp-1')).toMatchObject({
      routeLabel: 'Dumbo Design Studio → Midtown Ad Agency', kind: 'direct', kindLabel: 'Direct',
      relayName: null, status: 'picked_up', statusLabel: 'Picked up', reason: null,
    });
  });

  it('relay row names the relay business and reads "At relay point"', () => {
    expect(row('shp-2')).toMatchObject({
      routeLabel: 'Vernon Bakery → Chelsea Office', kind: 'relay', kindLabel: 'Relay via Front Street Café',
      relayName: 'Front Street Café', status: 'at_hub', statusLabel: 'At relay point', reason: null,
    });
  });

  it('unmatched row says "No match" and carries the server reason', () => {
    expect(row('shp-3')).toMatchObject({
      kind: 'none', kindLabel: 'No match', status: 'unmatched', statusLabel: 'Unmatched', reason: UNMATCHED_REASON,
    });
  });

  it('a status missing from the snapshot is "Status unavailable", never derived from the plan', () => {
    const noStatus = buildPackageRows(makeSim({}), makeMap());
    expect(noStatus.map((r) => [r.id, r.kind, r.status, r.statusLabel])).toEqual([
      ['shp-1', 'direct', null, 'Status unavailable'],
      ['shp-2', 'relay', null, 'Status unavailable'],
      ['shp-3', 'none', null, 'Status unavailable'],
      ['shp-4', 'direct', null, 'Status unavailable'],
    ]);
    expect(toListItems(noStatus).map((i) => i.statusLabel)).toEqual([
      'Direct · Status unavailable', 'Relay via Front Street Café · Status unavailable',
      'No match · Status unavailable', 'Direct · Status unavailable',
    ]);
    // Such a row is under "All" only and passes no status filter.
    expect(statusFilters(noStatus)).toEqual([{ value: 'all', label: 'All', count: 4 }]);
    expect(filterPackageRows(noStatus, { status: 'scheduled', query: '' })).toEqual([]);
    expect(filterPackageRows(noStatus, { status: 'unmatched', query: '' })).toEqual([]);
    expect(packageStatusLabel(undefined)).toBe('Status unavailable');
  });

  it('a package with an empty label reads "Untitled package"', () => {
    const sim = makeSim();
    sim.shipments = sim.shipments.map((s) => (s.id === 'shp-1' ? { ...s, label: '' } : s));
    const untitled = buildPackageRows(sim, makeMap());
    expect(untitled[0]).toMatchObject({ id: 'shp-1', label: 'Untitled package' });
    expect(toListItems(untitled)[0].label).toBe('Untitled package');
  });

  it('an unresolved place reads "Unknown place", never a raw ID', () => {
    expect(row('shp-4').routeLabel).toBe('Midtown Ad Agency → Unknown place');
    expect(JSON.stringify(rows)).not.toContain('biz-closed-shop');
    const noRelay = makeSim();
    noRelay.plans = noRelay.plans.map((p) => (p.kind === 'relay' ? { ...p, relayBusinessId: 'biz-nowhere' } : p));
    expect(buildPackageRows(noRelay, makeMap())[1].kindLabel).toBe('Relay via Unknown place');
  });

  it('does not depend on the order of the input arrays', () => {
    const sim = makeSim();
    const reversed = { ...sim, plans: [...sim.plans].reverse(), shipments: [...sim.shipments].reverse() };
    expect(buildPackageRows(reversed, makeMap())).toEqual(rows);
  });
});

describe('statusFilters', () => {
  it('"All" plus each status that occurs, with counts, in a fixed order', () => {
    expect(statusFilters(rows)).toEqual([
      { value: 'all', label: 'All', count: 4 },
      { value: 'unmatched', label: 'Unmatched', count: 1 },
      { value: 'picked_up', label: 'Picked up', count: 2 },
      { value: 'at_hub', label: 'At relay point', count: 1 },
    ]);
  });

  it('keeps a chosen status that no longer occurs, with count 0', () => {
    const morning = buildPackageRows(makeSim(STATUS_MORNING), makeMap());
    expect(statusFilters(morning, 'at_hub')).toEqual([
      { value: 'all', label: 'All', count: 4 },
      { value: 'unmatched', label: 'Unmatched', count: 1 },
      { value: 'at_hub', label: 'At relay point', count: 0 },
      { value: 'out_for_delivery', label: 'Out for delivery', count: 1 },
      { value: 'delivered', label: 'Delivered', count: 2 },
    ]);
  });
});

describe('filterPackageRows', () => {
  it('no filters returns every row', () => {
    expect(filterPackageRows(rows, NO_FILTERS)).toEqual(rows);
  });

  it('filters by status', () => {
    expect(ids(filterPackageRows(rows, { status: 'at_hub', query: '' }))).toEqual(['shp-2']);
    expect(ids(filterPackageRows(rows, { status: 'picked_up', query: '' }))).toEqual(['shp-1', 'shp-4']);
  });

  it('searches label, sender, recipient and relay business, case-insensitively', () => {
    const q = (query: string) => ids(filterPackageRows(rows, { status: 'all', query }));
    expect(q('GIFT')).toEqual(['shp-2']);
    expect(q('vernon')).toEqual(['shp-2']);              // sender
    expect(q('chelsea')).toEqual(['shp-2', 'shp-3']);    // recipient of shp-2, sender of shp-3
    expect(q('front street')).toEqual(['shp-2']);        // relay business
    expect(q('  midtown ')).toEqual(['shp-1', 'shp-4']);
    expect(q('nothing like this')).toEqual([]);
  });

  it('combines status and search', () => {
    expect(ids(filterPackageRows(rows, { status: 'picked_up', query: 'proofs' }))).toEqual(['shp-1']);
    expect(ids(filterPackageRows(rows, { status: 'unmatched', query: 'proofs' }))).toEqual([]);
  });
});

describe('toListItems', () => {
  it('statusLabel carries kind and status; the unmatched row shows the reason', () => {
    expect(toListItems(rows)).toEqual([
      { id: 'shp-1', label: 'Brand proofs', statusLabel: 'Direct · Picked up', routeLabel: 'Dumbo Design Studio → Midtown Ad Agency' },
      { id: 'shp-2', label: 'Gift box', statusLabel: 'Relay via Front Street Café · At relay point', routeLabel: 'Vernon Bakery → Chelsea Office' },
      { id: 'shp-3', label: 'Signed lease', statusLabel: 'No match', routeLabel: `Chelsea Office → Dumbo Design Studio · ${UNMATCHED_REASON}` },
      { id: 'shp-4', label: 'Spare keys', statusLabel: 'Direct · Picked up', routeLabel: 'Midtown Ad Agency → Unknown place' },
    ]);
  });
});

describe('copy', () => {
  it('no status label says hub', () => {
    for (const s of STATUS_ORDER) expect(packageStatusLabel(s)).not.toMatch(/hub/i);
  });

  it('no string in the packages folder says "hub" or "synthetic" (the at_hub enum value aside)', () => {
    const dir = resolve(__dirname, '../../client/src/components/sim/v2/packages');
    const files = readdirSync(dir);
    expect(files.sort()).toEqual(['PackageFilterBar.tsx', 'PackagePanel.tsx', 'packageListModel.ts', 'packages.css', 'statusText.ts'].sort());
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8').replace(/\bat_hub\b/g, '');
      expect(src, f).not.toMatch(/hub|synthetic/i);
    }
  });
});
