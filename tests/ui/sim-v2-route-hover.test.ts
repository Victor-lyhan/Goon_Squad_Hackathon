// What the tooltip says when a route is hovered on the simulator map (#595): the package and the
// carrier by name, in the network view, in focus mode and in a package journey. Each test goes
// through `buildLayerSpecs`, so it reads exactly the two lines GoogleBaseMap puts in the tooltip
// (`item.label` above `item.role`).
import { describe, expect, it } from 'vitest';
import { buildCommuteRoute } from '../../client/src/components/employee/v2/route/commuteRouteModel';
import { buildDeliveryRoute } from '../../client/src/components/business/v2/route/deliveryRouteModel';
import { buildLayerSpecs, type PathSpec } from '../../client/src/components/map/layers';
import type { LayerVisibility, MapItem, MapRoute } from '../../client/src/components/map/types';
import { simPageView, type SimReadyView } from '../../client/src/components/sim/v2/compose/simPageView';
import { buildJourney, type Journey } from '../../client/src/components/sim/v2/journey/journeyModel';
import { INITIAL_SIM_DATA, type SimDataState } from '../../client/src/components/sim/v2/live/simDataModel';
import { commuteLabel, deliveryLabel, journeyLegLabel } from '../../client/src/components/sim/v2/network/networkIndex';
import { buildNetworkView, hoverText } from '../../client/src/components/sim/v2/network/networkModel';
import { DEFAULT_LAYERS } from '../../client/src/components/sim/v2/workspaceModel';
import type { MapResponse, SimulatorResponse } from '../../shared/v2/api';
import * as businessSample from './business-v2-route-sample';
import * as employeeSample from './employee-v2-route-sample';
import { T, map as journeyMap, simAt } from './sim-v2-journey-sample';
import { makeLargeSample, makeMap, makeSim } from './sim-v2-network-fixture';

const all: LayerVisibility = { routes: true, businesses: true, homes: true, packages: true };

/** Route ID → the tooltip's two lines, as the map layers carry them. */
function tooltips(routes: MapRoute[], selectedIds: string[] = []): Map<string, MapItem> {
  const specs = buildLayerSpecs({ places: [], routes, movers: [], visible: all, selectedIds });
  const out = new Map<string, MapItem>();
  for (const s of specs) if (s.type === 'path') for (const d of (s as PathSpec).data) out.set(d.id, d.item);
  return out;
}
const lines = (item: MapItem | undefined) => [item?.label, item?.role];

/** No "undefined", no raw ID, no part said twice (parts are separated by " · " and by the line break). */
function expectClean(item: MapItem) {
  const text = `${item.label}\n${item.role}`;
  expect(text).not.toMatch(/undefined|null|NaN|hub/i);
  expect(text).not.toMatch(/\b(emp|shp|plan|biz|home|leg|baseline|journey)[-:]/);
  expect(item.label.trim()).not.toBe('');
  const parts = text.split(/ · |\n/).map((p) => p.trim().toLowerCase());
  expect(new Set(parts).size).toBe(parts.length);
  expect(parts.every((p) => p.length > 0)).toBe(true);
}

describe('network view: hovering a route', () => {
  const map = makeMap();
  const sim = makeSim();
  const view = buildNetworkView({ map, sim });
  const tips = tooltips(view.routes);

  it('a direct package: its name and its carrier above "Delivery route"', () => {
    expect(lines(tips.get('leg:plan-shp-1:0'))).toEqual(['Astoria product proofs · carried by Maya Ortiz', 'Delivery route']);
  });

  it('a relay package: both legs say which leg and who carries it', () => {
    expect(lines(tips.get('leg:plan-shp-2:0'))).toEqual(['Ceramic samples · leg 1 of 2 · carried by Sam Rivera', 'Delivery route']);
    expect(lines(tips.get('leg:plan-shp-2:1'))).toEqual(['Ceramic samples · leg 2 of 2 · carried by Li Chen', 'Delivery route']);
  });

  it('a commute: the employee\'s name above "Normal commute"', () => {
    expect(lines(tips.get('baseline:emp-2-morn'))).toEqual(['Li Chen · morning', 'Normal commute']);
    expect(lines(tips.get('baseline:emp-2-eve'))).toEqual(['Li Chen · evening', 'Normal commute']);
    expect(lines(tips.get('baseline:emp-1-eve'))).toEqual(['Maya Ortiz · evening', 'Normal commute']);
  });

  it('every route has a clean tooltip that says the same as hoverText', () => {
    expect(tips.size).toBe(view.routes.length);
    for (const r of view.routes) {
      const item = tips.get(r.id)!;
      expectClean(item);
      // hoverText is "name · role · the rest"; the tooltip has the role on its second line.
      const [first, ...rest] = item.label.split(' · ');
      expect([first, item.role, ...rest].join(' · ')).toBe(hoverText(item, map, sim));
    }
  });

  it('the same text when the route is highlighted by a selection, and in focus mode', () => {
    const selected = buildNetworkView({ map, sim, selection: { kind: 'employee', id: 'emp-3' } });
    const sel = tooltips(selected.routes, selected.selectedIds);
    expect(lines(sel.get('leg:plan-shp-2:0'))).toEqual(lines(tips.get('leg:plan-shp-2:0')));
    expect(lines(sel.get('leg:plan-shp-1:0'))).toEqual(lines(tips.get('leg:plan-shp-1:0'))); // dimmed, same words

    const focused = buildNetworkView({ map, sim, focus: { kind: 'employee', id: 'emp-3' } });
    expect(focused.routes.map((r) => r.id)).toEqual(['baseline:emp-3-eve', 'leg:plan-shp-2:0']);
    const foc = tooltips(focused.routes);
    expect(lines(foc.get('leg:plan-shp-2:0'))).toEqual(['Ceramic samples · leg 1 of 2 · carried by Sam Rivera', 'Delivery route']);
    expect(lines(foc.get('baseline:emp-3-eve'))).toEqual(['Sam Rivera · evening', 'Normal commute']);

    const business = buildNetworkView({ map, sim, focus: { kind: 'business', id: 'biz-etsy' } });
    const biz = tooltips(business.routes);
    expect(lines(biz.get('leg:plan-shp-2:1'))).toEqual(['Ceramic samples · leg 2 of 2 · carried by Li Chen', 'Delivery route']);
    for (const item of biz.values()) expectClean(item);
  });

  it('both parts of a line split by a missing polyline have the leg\'s text', () => {
    const m = makeMap();
    m.polylines = m.polylines.map((p) => (p.from === 'biz-etsy' && p.to === 'biz-studio' ? { ...p, encoded: null } : p));
    const t = tooltips(buildNetworkView({ map: m, sim }).routes);
    expect(t.get('leg:plan-shp-2:1:2')).toBeDefined();
    expect(lines(t.get('leg:plan-shp-2:1:2'))).toEqual(lines(t.get('leg:plan-shp-2:1')));
    expect(t.get('leg:plan-shp-2:1')!.label).toBe('Ceramic samples · leg 2 of 2 · carried by Li Chen');
  });

  it('the page passes the labels to the map, in the network view and with a focus', () => {
    const ready: SimDataState = { ...INITIAL_SIM_DATA, view: 'ready', sim, map };
    const net = simPageView({ data: ready, selection: null, layers: DEFAULT_LAYERS }) as SimReadyView;
    expect(tooltips(net.map.routes).get('leg:plan-shp-1:0')!.label).toBe('Astoria product proofs · carried by Maya Ortiz');
    const foc = simPageView({ data: ready, selection: null, focus: { kind: 'employee', id: 'emp-2' }, layers: DEFAULT_LAYERS }) as SimReadyView;
    expect(lines(tooltips(foc.map.routes).get('baseline:emp-2-morn'))).toEqual(['Li Chen · morning', 'Normal commute']);
  });

  it('is clean for every route of the 60-employee sample', () => {
    const big = makeLargeSample();
    const v = buildNetworkView(big);
    const t = tooltips(v.routes);
    expect(t.size).toBe(160);
    for (const item of t.values()) expectClean(item);
    expect(t.get('leg:plan-shp-3:1')!.label).toBe('Package 3 · leg 2 of 2 · carried by Employee 33');
  });
});

describe('network view: what is not known is not invented', () => {
  const withoutEmployee = (id: string): MapResponse => {
    const m = makeMap();
    m.employees = m.employees.map((e) => (e.id === id ? { ...e, name: '' } : e));
    return m;
  };
  const withoutShipment = (id: string): SimulatorResponse => {
    const s = makeSim();
    s.shipments = s.shipments.filter((x) => x.id !== id);
    return s;
  };

  it('no package name and no carrier name: today\'s text', () => {
    const t = tooltips(buildNetworkView({ map: withoutEmployee('emp-1'), sim: withoutShipment('shp-1') }).routes);
    expect(lines(t.get('leg:plan-shp-1:0'))).toEqual(['Delivery route', 'Delivery route']);
    expect(lines(t.get('baseline:emp-1-eve'))).toEqual(['Commute', 'Normal commute']);
    // The other routes are untouched.
    expect(t.get('leg:plan-shp-2:1')!.label).toBe('Ceramic samples · leg 2 of 2 · carried by Li Chen');
  });

  it('a route without a label has no `label` key at all', () => {
    const v = buildNetworkView({ map: withoutEmployee('emp-1'), sim: withoutShipment('shp-1') });
    const leg = v.routes.find((r) => r.id === 'leg:plan-shp-1:0')!;
    expect('label' in leg).toBe(false);
    expect('label' in v.routes.find((r) => r.id === 'baseline:emp-1-eve')!).toBe(false);
  });

  it('only the carrier unknown: the package and the leg, no "carried by"', () => {
    const t = tooltips(buildNetworkView({ map: withoutEmployee('emp-3'), sim: makeSim() }).routes);
    const item = t.get('leg:plan-shp-2:0')!;
    expect(lines(item)).toEqual(['Ceramic samples · leg 1 of 2', 'Delivery route']);
    expectClean(item);
  });

  it('only the package unknown or unnamed: "Package" and the carrier', () => {
    const t = tooltips(buildNetworkView({ map: makeMap(), sim: withoutShipment('shp-2') }).routes);
    expect(lines(t.get('leg:plan-shp-2:1'))).toEqual(['Package · leg 2 of 2 · carried by Li Chen', 'Delivery route']);
    const blank = makeSim();
    blank.shipments = blank.shipments.map((s) => (s.id === 'shp-1' ? { ...s, label: '   ' } : s));
    const t2 = tooltips(buildNetworkView({ map: makeMap(), sim: blank }).routes);
    expect(lines(t2.get('leg:plan-shp-1:0'))).toEqual(['Package · carried by Maya Ortiz', 'Delivery route']);
  });

  it('an employee who is not in the map answer: never the ID', () => {
    const m = makeMap();
    m.employees = m.employees.filter((e) => e.id !== 'emp-2');
    const t = tooltips(buildNetworkView({ map: m, sim: makeSim() }).routes);
    const item = t.get('leg:plan-shp-2:1')!;
    expect(item.label).toBe('Ceramic samples · leg 2 of 2');
    expectClean(item);
  });
});

describe('journey: hovering a route', () => {
  const journeyOf = (shipmentId: string, map: MapResponse = journeyMap) =>
    buildJourney({ shipmentId, sim: simAt(T.onLeg1), map }) as Journey;

  it('a direct package: "Leg 1" and the carrier; the faint line names the employee', () => {
    const t = tooltips(journeyOf('shp-1').routes);
    expect(lines(t.get('journey-shp-1-L0-leg-0'))).toEqual(['Leg 1 · carried by Ana Ruiz', 'Delivery route']);
    expect(lines(t.get('journey-shp-1-L0-baseline'))).toEqual(['Ana Ruiz · evening', 'Normal commute']);
  });

  it('a relay package: each leg line names its leg and its carrier, each commute line its employee', () => {
    const j = journeyOf('shp-2');
    const t = tooltips(j.routes);
    expect(lines(t.get('journey-shp-2-L0-leg-0'))).toEqual(['Leg 1 · carried by Cy Lam', 'Delivery route']);
    expect(lines(t.get('journey-shp-2-L1-leg-0'))).toEqual(['Leg 2 · carried by Ben Okafor', 'Delivery route']);
    expect(lines(t.get('journey-shp-2-L0-baseline'))).toEqual(['Cy Lam · evening', 'Normal commute']);
    expect(lines(t.get('journey-shp-2-L1-baseline'))).toEqual(['Ben Okafor · morning', 'Normal commute']);
    expect(t.size).toBe(j.routes.length);
    for (const item of t.values()) expectClean(item);
  });

  it('uses the legend\'s words: the leg numbers and names of `journey.carriers`', () => {
    const j = journeyOf('shp-2');
    const t = tooltips(j.routes);
    for (const c of j.carriers) {
      const label = t.get(`journey-shp-2-L${c.legIndex}-leg-0`)!.label;
      expect(label).toBe(`Leg ${c.legIndex + 1} · carried by ${c.name}`);
    }
  });

  it('every part of a leg line split by a missing polyline has the leg\'s text', () => {
    const map: MapResponse = {
      ...journeyMap,
      polylines: journeyMap.polylines.map((p) => (p.from === 'biz-dumbo' && p.to === 'biz-roast' ? { ...p, encoded: null } : p)),
    };
    const routes = journeyOf('shp-2', map).routes.filter((r) => r.id.startsWith('journey-shp-2-L0-leg'));
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) expect(r.label).toBe('Leg 1 · carried by Cy Lam');
  });

  it('a carrier who is not in the map answer: the leg only, never "Unknown carrier" or an ID', () => {
    const map: MapResponse = { ...journeyMap, employees: journeyMap.employees.filter((e) => e.id !== 'emp-3') };
    const j = journeyOf('shp-2', map);
    const t = tooltips(j.routes);
    expect(lines(t.get('journey-shp-2-L0-leg-0'))).toEqual(['Leg 1', 'Delivery route']);
    expect(lines(t.get('journey-shp-2-L0-baseline'))).toEqual(['Commute', 'Normal commute']);
    expect('label' in j.routes.find((r) => r.id === 'journey-shp-2-L0-baseline')!).toBe(false);
    expect(lines(t.get('journey-shp-2-L1-leg-0'))).toEqual(['Leg 2 · carried by Ben Okafor', 'Delivery route']);
    for (const item of t.values()) {
      expectClean(item);
      expect(item.label).not.toMatch(/unknown/i);
    }
  });

  it('the page passes the journey\'s labels to the map', () => {
    const ready: SimDataState = { ...INITIAL_SIM_DATA, view: 'ready', sim: simAt(T.onLeg1), map: journeyMap };
    const v = simPageView({ data: ready, selection: { kind: 'package', id: 'shp-2' }, layers: DEFAULT_LAYERS }) as SimReadyView;
    expect(v.mode).toBe('journey');
    const t = tooltips(v.map.routes);
    expect(t.get('journey-shp-2-L0-leg-0')!.label).toBe('Leg 1 · carried by Cy Lam');
    expect(t.get('journey-shp-2-L1-baseline')!.label).toBe('Ben Okafor · morning');
  });
});

describe('the label helpers', () => {
  it('deliveryLabel', () => {
    expect(deliveryLabel('Coffee samples', 'Cy Lam', 0, 2)).toBe('Coffee samples · leg 1 of 2 · carried by Cy Lam');
    expect(deliveryLabel(' Coffee samples ', ' Cy Lam ', 0, 1)).toBe('Coffee samples · carried by Cy Lam');
    expect(deliveryLabel(undefined, 'Cy Lam', 1, 2)).toBe('Package · leg 2 of 2 · carried by Cy Lam');
    expect(deliveryLabel('Coffee samples', undefined, 1, 2)).toBe('Coffee samples · leg 2 of 2');
    expect(deliveryLabel(undefined, undefined, 0, 2)).toBeUndefined();
    expect(deliveryLabel('  ', null, 0, 1)).toBeUndefined();
  });

  it('commuteLabel and journeyLegLabel', () => {
    expect(commuteLabel('Cy Lam', 'emp-3-eve')).toBe('Cy Lam · evening');
    expect(commuteLabel('Cy Lam', 'emp-3-morn')).toBe('Cy Lam · morning');
    expect(commuteLabel('Cy Lam', 'some-trip')).toBe('Cy Lam');
    expect(commuteLabel('', 'emp-3-eve')).toBeUndefined();
    expect(commuteLabel(undefined, 'emp-3-eve')).toBeUndefined();
    expect(journeyLegLabel('Cy Lam', 0)).toBe('Leg 1 · carried by Cy Lam');
    expect(journeyLegLabel(undefined, 1)).toBe('Leg 2');
  });
});

describe('the Business and Employee maps render as before', () => {
  it('the Business delivery map sets no route label: "Delivery route" as today', () => {
    const r = buildDeliveryRoute(businessSample.view(businessSample.relayPlan), businessSample.MAP);
    expect(r.routes.length).toBeGreaterThan(0);
    for (const route of r.routes) expect('label' in route).toBe(false);
    for (const item of tooltips(r.routes).values()) expect(lines(item)).toEqual(['Delivery route', 'Delivery route']);
  });

  it('the Employee commute map sets no route label: "Commute" and "Delivery route" as today', () => {
    const base = {
      employee: employeeSample.DASHBOARD.employee, home: employeeSample.HOME, trips: employeeSample.TRIPS,
      businesses: employeeSample.BUSINESSES, map: employeeSample.MAP,
    };
    const routes = [...buildCommuteRoute({ ...base, job: null }).routes, ...buildCommuteRoute({ ...base, job: employeeSample.JOB }).routes];
    expect(routes.some((r) => r.kind === 'baseline')).toBe(true);
    for (const route of routes) expect('label' in route).toBe(false);
    for (const item of tooltips(routes).values()) {
      expect(lines(item)).toEqual(item.kind === 'leg' ? ['Delivery route', 'Delivery route'] : ['Commute', 'Normal commute']);
    }
  });
});
