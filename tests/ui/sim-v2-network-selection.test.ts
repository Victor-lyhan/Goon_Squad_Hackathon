import { describe, expect, it } from 'vitest';
import { selectedIdsFor, selectionFromMapId } from '../../client/src/components/sim/v2/network/selectionModel';
import { makeMap, makeSim } from './sim-v2-network-fixture';

const map = makeMap();
const sim = makeSim();

describe('selectionFromMapId', () => {
  it('resolves each kind of clicked map item', () => {
    expect(selectionFromMapId('biz-etsy', map, sim)).toEqual({ kind: 'business', id: 'biz-etsy' });
    expect(selectionFromMapId('emp-1', map, sim)).toEqual({ kind: 'employee', id: 'emp-1' }); // vehicle
    expect(selectionFromMapId('shp-2', map, sim)).toEqual({ kind: 'package', id: 'shp-2' }); // package marker
    expect(selectionFromMapId('leg:plan-shp-2:1', map, sim)).toEqual({ kind: 'package', id: 'shp-2' });
    expect(selectionFromMapId('baseline:emp-1-eve', map, sim)).toEqual({ kind: 'employee', id: 'emp-1' });
    expect(selectionFromMapId('home-002', map, sim)).toEqual({ kind: 'employee', id: 'emp-2' });
  });

  it('returns null for unknown IDs, empty IDs and homes nobody lives in', () => {
    expect(selectionFromMapId('nope', map, sim)).toBeNull();
    expect(selectionFromMapId('', map, sim)).toBeNull();
    expect(selectionFromMapId('home-003', map, sim)).toBeNull();
    expect(selectionFromMapId('baseline:emp-3-morn', map, sim)).toBeNull(); // null polyline ⇒ no such route
  });

  it('resolves the second part of a split leg to its package', () => {
    const m = makeMap();
    m.polylines = m.polylines.map((p) => (p.from === 'biz-etsy' && p.to === 'biz-studio' ? { ...p, encoded: null } : p));
    expect(selectionFromMapId('leg:plan-shp-2:1:2', m, sim)).toEqual({ kind: 'package', id: 'shp-2' });
  });
});

describe('selectedIdsFor', () => {
  it('null selection → nothing', () => {
    expect(selectedIdsFor(null, map, sim)).toEqual([]);
  });

  it('business → itself, its employees\' routes and the packages it sends, receives or relays', () => {
    expect(selectedIdsFor({ kind: 'business', id: 'biz-etsy' }, map, sim)).toEqual([
      'baseline:emp-2-eve', 'baseline:emp-2-morn', 'biz-etsy', 'leg:plan-shp-2:1', 'shp-2', 'shp-3',
    ]);
    expect(selectedIdsFor({ kind: 'business', id: 'biz-bakery' }, map, sim)).toEqual([
      'baseline:emp-3-eve', 'biz-bakery', 'leg:plan-shp-2:0', 'shp-1', 'shp-2', 'shp-3',
    ]);
  });

  it('employee → their vehicle, routes, home, workplace and packages', () => {
    expect(selectedIdsFor({ kind: 'employee', id: 'emp-1' }, map, sim)).toEqual([
      'baseline:emp-1-eve', 'baseline:emp-1-morn', 'biz-studio', 'emp-1', 'home-001', 'leg:plan-shp-1:0', 'shp-1',
    ]);
    expect(selectedIdsFor({ kind: 'employee', id: 'emp-2' }, map, sim)).toEqual([
      'baseline:emp-2-eve', 'baseline:emp-2-morn', 'biz-etsy', 'emp-2', 'home-002', 'leg:plan-shp-2:1', 'shp-2',
    ]);
  });

  it('package → its plan\'s routes, carriers and businesses', () => {
    expect(selectedIdsFor({ kind: 'package', id: 'shp-2' }, map, sim)).toEqual([
      'biz-bakery', 'biz-etsy', 'biz-studio', 'emp-2', 'emp-3', 'leg:plan-shp-2:0', 'leg:plan-shp-2:1', 'shp-2',
    ]);
    expect(selectedIdsFor({ kind: 'package', id: 'shp-3' }, map, sim)).toEqual(['biz-bakery', 'biz-etsy', 'shp-3']); // unmatched
  });

  it('unknown IDs → nothing', () => {
    expect(selectedIdsFor({ kind: 'business', id: 'biz-x' }, map, sim)).toEqual([]);
    expect(selectedIdsFor({ kind: 'employee', id: 'emp-x' }, map, sim)).toEqual([]);
    expect(selectedIdsFor({ kind: 'package', id: 'shp-x' }, map, sim)).toEqual([]);
  });
});
