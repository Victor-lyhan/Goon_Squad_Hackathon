import { describe, expect, it } from 'vitest';
import { buildNetworkView } from '../../client/src/components/sim/v2/network/networkModel';
import type { NetworkView } from '../../client/src/components/sim/v2/network/networkModel';
import { makeMap, makeSim } from './sim-v2-network-fixture';

const map = makeMap();
const sim = makeSim();
const ids = (v: NetworkView) => ({
  places: v.places.map((p) => p.id),
  routes: v.routes.map((r) => r.id),
  movers: v.movers.map((m) => m.id),
});

describe('focus mode', () => {
  it('employee focus keeps only their routes, packages, home and the businesses those touch', () => {
    expect(ids(buildNetworkView({ map, sim, focus: { kind: 'employee', id: 'emp-1' } }))).toEqual({
      places: ['biz-bakery', 'biz-studio', 'home-001'],
      routes: ['baseline:emp-1-eve', 'baseline:emp-1-morn', 'leg:plan-shp-1:0'],
      movers: ['emp-1', 'shp-1'],
    });
    // Li carries leg 2 of the relay package: the sender (bakery) is kept through the package.
    expect(ids(buildNetworkView({ map, sim, focus: { kind: 'employee', id: 'emp-2' } }))).toEqual({
      places: ['biz-bakery', 'biz-etsy', 'biz-studio', 'home-002'],
      routes: ['baseline:emp-2-eve', 'baseline:emp-2-morn', 'leg:plan-shp-2:1'],
      movers: ['shp-2'], // Li's vehicle is not on the road at this time
    });
  });

  it('business focus keeps its employees\' routes, the packages it sends, receives or relays and their businesses', () => {
    expect(ids(buildNetworkView({ map, sim, focus: { kind: 'business', id: 'biz-etsy' } }))).toEqual({
      places: ['biz-bakery', 'biz-etsy', 'biz-studio', 'home-002', 'home-story-sam'],
      routes: ['baseline:emp-2-eve', 'baseline:emp-2-morn', 'leg:plan-shp-2:0', 'leg:plan-shp-2:1'],
      movers: ['emp-3', 'shp-2', 'shp-3'],
    });
  });

  it('removes (does not dim) everything else', () => {
    const v = buildNetworkView({ map, sim, focus: { kind: 'employee', id: 'emp-1' } });
    expect(v.routes.some((r) => r.ownerIds.includes('emp-3'))).toBe(false);
    expect(v.selectedIds).toEqual([]);
  });

  it('an unknown focus ID gives an empty view without throwing', () => {
    const empty = { places: [], routes: [], movers: [], selectedIds: [] };
    expect(buildNetworkView({ map, sim, focus: { kind: 'employee', id: 'emp-x' } })).toEqual(empty);
    expect(buildNetworkView({ map, sim, focus: { kind: 'business', id: 'biz-x' }, selection: { kind: 'business', id: 'biz-etsy' } })).toEqual(empty);
  });

  it('focus and selection work together: selection is limited to what the focus keeps', () => {
    const inFocus = buildNetworkView({ map, sim, focus: { kind: 'employee', id: 'emp-1' }, selection: { kind: 'package', id: 'shp-1' } });
    expect(inFocus.selectedIds).toEqual(['biz-bakery', 'biz-studio', 'emp-1', 'leg:plan-shp-1:0', 'shp-1']);
    expect(inFocus.routes).toHaveLength(3); // selection never removes anything

    const outside = buildNetworkView({ map, sim, focus: { kind: 'employee', id: 'emp-1' }, selection: { kind: 'business', id: 'biz-etsy' } });
    expect(outside.selectedIds).toEqual([]);

    const relay = buildNetworkView({ map, sim, focus: { kind: 'business', id: 'biz-etsy' }, selection: { kind: 'employee', id: 'emp-3' } });
    expect(relay.selectedIds).toEqual(['biz-bakery', 'emp-3', 'home-story-sam', 'leg:plan-shp-2:0', 'shp-2']);
  });

  it('without focus, the selection is the full highlight list', () => {
    expect(buildNetworkView({ map, sim, selection: { kind: 'employee', id: 'emp-2' } }).selectedIds).toEqual([
      'baseline:emp-2-eve', 'baseline:emp-2-morn', 'biz-etsy', 'emp-2', 'home-002', 'leg:plan-shp-2:1', 'shp-2',
    ]);
  });
});
