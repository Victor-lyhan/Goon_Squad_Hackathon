import { describe, expect, it } from 'vitest';
import { buildNetworkView, hoverText } from '../../client/src/components/sim/v2/network/networkModel';
import type { NetworkView } from '../../client/src/components/sim/v2/network/networkModel';
import { roleOf } from '../../client/src/components/map/layers';
import type { MapItem } from '../../client/src/components/map/types';
import type { MapResponse, SimulatorResponse } from '../../shared/v2/api';
import { makeLargeSample, makeMap, makeSim, shuffled } from './sim-v2-network-fixture';

const items = (v: NetworkView): MapItem[] => [
  ...v.places.map((p) => ({ id: p.id, kind: p.kind, label: p.label, role: roleOf(p.kind) })),
  ...v.routes.map((r) => ({ id: r.id, kind: r.kind, label: '', role: roleOf(r.kind) })),
  ...v.movers.map((m) => ({ id: m.id, kind: m.kind, label: m.label, role: roleOf(m.kind) })),
];

describe('buildNetworkView: places, routes, movers', () => {
  const view = buildNetworkView({ map: makeMap(), sim: makeSim(), selection: null, focus: { kind: 'none' } });

  it('has every business and only the homes in use', () => {
    expect(view.places.map((p) => p.id)).toEqual(['biz-bakery', 'biz-etsy', 'biz-studio', 'home-001', 'home-002', 'home-story-sam']);
    expect(view.places.find((p) => p.id === 'biz-etsy')).toMatchObject({ kind: 'business', label: 'Etsy', sublabel: 'DUMBO' });
    expect(view.places.some((p) => p.id === 'home-003')).toBe(false);
  });

  it('labels homes by neighborhood only: no digits, no address, no sublabel', () => {
    const homes = view.places.filter((p) => p.kind === 'home');
    expect(homes.map((h) => h.label)).toEqual(['Astoria', 'Park Slope', 'Long Island City']);
    for (const h of homes) {
      expect(h.label).not.toMatch(/\d/);
      expect(h.sublabel).toBeUndefined();
    }
  });

  it('draws one baseline per cached commute and one route per plan leg; none for the null polyline', () => {
    expect(view.routes.map((r) => r.id)).toEqual([
      'baseline:emp-1-eve', 'baseline:emp-1-morn', 'baseline:emp-2-eve', 'baseline:emp-2-morn', 'baseline:emp-3-eve',
      'leg:plan-shp-1:0', 'leg:plan-shp-2:0', 'leg:plan-shp-2:1',
    ]);
    expect(view.routes.filter((r) => r.kind === 'baseline')).toHaveLength(5);
    expect(view.routes.filter((r) => r.kind === 'leg')).toHaveLength(3);
    expect(view.routes.some((r) => r.id === 'baseline:emp-3-morn')).toBe(false);
    for (const r of view.routes) expect(r.path.length).toBeGreaterThanOrEqual(2);
  });

  it('joins a leg\'s neighbouring pairs into one [lng, lat] path', () => {
    const leg = view.routes.find((r) => r.id === 'leg:plan-shp-2:1')!;
    // home-002 → biz-etsy → biz-studio → biz-etsy, shared endpoints not repeated
    expect(leg.path).toHaveLength(4);
    expect(leg.path[0]).toEqual([-73.98140, 40.67100]);
    expect(leg.path[2]).toEqual([-74.00140, 40.74650]);
  });

  it('gives each route the right owners', () => {
    const owners = Object.fromEntries(view.routes.map((r) => [r.id, r.ownerIds]));
    expect(owners['baseline:emp-1-eve']).toEqual(['emp-1']);
    expect(owners['leg:plan-shp-1:0']).toEqual(['emp-1', 'shp-1', 'biz-bakery', 'biz-studio']);
    expect(owners['leg:plan-shp-2:0']).toEqual(['emp-3', 'shp-2', 'biz-bakery', 'biz-etsy', 'biz-studio']);
    expect(owners['leg:plan-shp-2:1']).toEqual(['emp-2', 'shp-2', 'biz-bakery', 'biz-etsy', 'biz-studio']);
  });

  it('gives each route its hover label: package and carrier for a leg, the employee for a commute', () => {
    expect(Object.fromEntries(view.routes.map((r) => [r.id, r.label]))).toEqual({
      'baseline:emp-1-eve': 'Maya Ortiz · evening',
      'baseline:emp-1-morn': 'Maya Ortiz · morning',
      'baseline:emp-2-eve': 'Li Chen · evening',
      'baseline:emp-2-morn': 'Li Chen · morning',
      'baseline:emp-3-eve': 'Sam Rivera · evening',
      'leg:plan-shp-1:0': 'Astoria product proofs · carried by Maya Ortiz',
      'leg:plan-shp-2:0': 'Ceramic samples · A · Sam Rivera',
      'leg:plan-shp-2:1': 'Ceramic samples · B · Li Chen',
    });
  });

  it('passes vehicles and packages through from the snapshot', () => {
    expect(view.movers).toEqual([
      { id: 'emp-1', kind: 'vehicle', lat: 40.755, lng: -73.96, label: 'Maya Ortiz' },
      { id: 'emp-3', kind: 'vehicle', lat: 40.73, lng: -73.95, label: 'Sam Rivera' },
      { id: 'shp-1', kind: 'package', lat: 40.755, lng: -73.96, label: 'Astoria product proofs' },
      { id: 'shp-2', kind: 'package', lat: 40.73, lng: -73.95, label: 'Ceramic samples' },
      { id: 'shp-3', kind: 'package', lat: 40.7033, lng: -73.9881, label: 'Spare keys' },
    ]);
    expect(view.selectedIds).toEqual([]);
  });

  it('splits a leg where a middle pair has no polyline instead of drawing a straight line', () => {
    const map = makeMap();
    map.polylines = map.polylines.map((p) => (p.from === 'biz-etsy' && p.to === 'biz-studio' ? { ...p, encoded: null } : p));
    const v = buildNetworkView({ map, sim: makeSim() });
    const parts = v.routes.filter((r) => r.id.startsWith('leg:plan-shp-2:1'));
    expect(parts.map((r) => r.id)).toEqual(['leg:plan-shp-2:1', 'leg:plan-shp-2:1:2']);
    expect(parts[0].path.at(-1)).toEqual([-73.9881, 40.7033]); // stops at Etsy
    expect(parts[1].path[0]).toEqual([-74.0014, 40.7465]); // resumes at the studio
    expect(parts[1].ownerIds).toEqual(parts[0].ownerIds);
  });

  it('a leg with no cached pair at all adds no route, and skips non-finite positions', () => {
    const map = makeMap();
    map.polylines = map.polylines.filter((p) => !(p.from === 'biz-studio' && p.to === 'biz-bakery') && !(p.from === 'biz-bakery' && p.to === 'home-001'));
    const sim = makeSim();
    sim.snapshot.packagePositions['shp-3'] = { lat: Number.NaN, lng: -73.9 };
    const v = buildNetworkView({ map, sim });
    expect(v.routes.some((r) => r.id.startsWith('leg:plan-shp-1'))).toBe(false);
    expect(v.movers.some((m) => m.id === 'shp-3')).toBe(false);
  });
});

describe('stable and clean output', () => {
  it('is identical when every input array is shuffled', () => {
    const base = buildNetworkView({ map: makeMap(), sim: makeSim(), selection: { kind: 'package', id: 'shp-2' } });
    for (const seed of [1, 7, 42, 1234]) {
      const m = makeMap();
      const s = makeSim();
      const map: MapResponse = { ...m, businesses: shuffled(m.businesses, seed), homes: shuffled(m.homes, seed + 1), employees: shuffled(m.employees, seed + 2), polylines: shuffled(m.polylines, seed + 3) };
      const pp = s.snapshot.packagePositions;
      const sim: SimulatorResponse = {
        ...s,
        plans: shuffled(s.plans, seed + 4),
        shipments: shuffled(s.shipments, seed + 5),
        snapshot: { ...s.snapshot, markers: shuffled(s.snapshot.markers, seed + 6), packagePositions: Object.fromEntries(shuffled(Object.entries(pp), seed + 7)) },
      };
      expect(buildNetworkView({ map, sim, selection: { kind: 'package', id: 'shp-2' } })).toEqual(base);
    }
  });

  it('never outputs undefined, NaN or "hub", in the view or in any hover text', () => {
    const map = makeMap();
    for (const status of ['scheduled', 'picked_up', 'at_hub', 'out_for_delivery', 'delivered', 'unmatched'] as const) {
      const sim = makeSim();
      sim.snapshot.shipmentStatus = { 'shp-1': status, 'shp-2': status, 'shp-3': status };
      for (const selection of [null, { kind: 'business', id: 'biz-etsy' }, { kind: 'employee', id: 'emp-3' }, { kind: 'package', id: 'shp-2' }] as const) {
        const view = buildNetworkView({ map, sim, selection });
        const texts = items(view).map((it) => hoverText(it, map, sim));
        const all = JSON.stringify(view) + texts.join('\n');
        expect(all).not.toMatch(/undefined|NaN|hub/i);
      }
    }
  });
});

describe('hoverText', () => {
  const map = makeMap();
  const sim = makeSim();
  const view = buildNetworkView({ map, sim });
  const text = (id: string) => hoverText(items(view).find((i) => i.id === id)!, map, sim);

  it('names the item and its role', () => {
    expect(text('biz-etsy')).toBe('Etsy · Network business · relay point for 1 package');
    expect(text('biz-bakery')).toBe('Sunrise Bakery · Network business');
    expect(text('emp-1')).toBe('Maya Ortiz · Commuter · carrying Astoria product proofs');
    expect(text('home-001')).toBe('Astoria · Home neighborhood');
    expect(text('shp-1')).toBe('Astoria product proofs · Package · with Maya Ortiz');
    expect(text('shp-3')).toBe('Spare keys · Package · not matched');
    expect(text('baseline:emp-2-morn')).toBe('Li Chen · Normal commute · morning');
    expect(text('leg:plan-shp-2:1')).toBe('Ceramic samples · Delivery route · B · Li Chen');
    expect(text('leg:plan-shp-1:0')).toBe('Astoria product proofs · Delivery route · carried by Maya Ortiz');
  });

  it('says "relay point" for a package waiting overnight', () => {
    const s = makeSim();
    s.snapshot.shipmentStatus['shp-2'] = 'at_hub';
    expect(hoverText({ id: 'shp-2', kind: 'package', label: 'Ceramic samples', role: 'Package' }, map, s))
      .toBe('Ceramic samples · Package · waiting at relay point Etsy');
  });

  it('falls back to the item\'s own label and role for unknown IDs', () => {
    expect(hoverText({ id: 'biz-gone', kind: 'business', label: 'Gone', role: 'Network business' }, map, sim)).toBe('Gone · Network business');
    expect(hoverText({ id: 'x', kind: 'leg', label: '', role: '' }, map, sim)).toBe('Map item');
  });
});

describe('performance', () => {
  it('builds the 60-employee view 2,000 times in under 2,500 ms (order-of-magnitude check only)', { timeout: 20_000 }, () => {
    const { map, sim } = makeLargeSample();
    const first = buildNetworkView({ map, sim });
    expect(first.places.filter((p) => p.kind === 'home')).toHaveLength(60);
    expect(first.routes.filter((r) => r.kind === 'baseline')).toHaveLength(120);
    expect(first.routes.filter((r) => r.kind === 'leg')).toHaveLength(40);

    // Every call gets its own simulator response object, like a 1 s poll; the map response is reused.
    const sims = Array.from({ length: 2000 }, (_, i) => ({ ...sim, version: i, snapshot: { ...sim.snapshot, timeMin: 1000 + i } }));
    const selections = [null, { kind: 'business', id: 'biz-b03' }, { kind: 'employee', id: 'emp-7' }, { kind: 'package', id: 'shp-3' }] as const;
    const batch = () => {
      const t0 = performance.now();
      for (let i = 0; i < 2000; i++) {
        buildNetworkView({ map, sim: sims[i], selection: selections[i % 4], focus: i % 5 === 0 ? { kind: 'business', id: 'biz-b02' } : { kind: 'none' } });
      }
      return performance.now() - t0;
    };
    // Best of three batches, so a busy parallel test run doesn't make this flaky.
    const ms = Math.min(batch(), batch(), batch());
    // Order-of-magnitude check only (DECISIONS pass 52): CI runners are 1.5x–3.5x slower than a laptop.
    // Measured on an Apple-silicon laptop: 88–91 ms alone, 105–235 ms inside the full parallel
    // `bash scripts/test.sh` run. Limit = 10x the worst measured run.
    expect(ms).toBeLessThan(2500);
  });
});
