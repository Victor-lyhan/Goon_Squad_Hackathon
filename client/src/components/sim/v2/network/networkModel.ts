// The full-network simulator map as plain props for GoogleBaseMap (docs/mvp2-ui-redesign.md §1
// "Interactions" and "Focus mode"). Pure: no React, no DOM.
//
// It only reshapes the two polled responses (GET /api/v2/map and GET /api/v2/simulator): vehicle and
// package positions are passed through from the snapshot, never moved here (AGENTS.md hard rules).
// The static part (places, decoded polylines, baselines) is cached per MapResponse object, so a 1 s
// poll only redoes the plan legs and movers. Responses must be treated as immutable.
import type { MapItem, MapMover, MapPlace, MapRoute } from '../../../map/types';
import type { MapResponse, SimulatorResponse } from '../../../../../../shared/v2/api';
import { buildIndex, byId, planBusinessIds, shipmentsCarriedBy, shipmentsOfBusiness } from './networkIndex';
import type { NetworkIndex } from './networkIndex';
import { selectedIdsFromIndex } from './selectionModel';
import type { Selection } from './selectionModel';

/** Same shape as `Focus` in ../workspaceModel.ts (kept local so this file doesn't depend on the frame). */
export type NetworkFocus = { kind: 'none' } | { kind: 'employee' | 'business'; id: string };

export type NetworkView = {
  places: MapPlace[];
  routes: MapRoute[];
  movers: MapMover[];
  selectedIds: string[];
};

export type NetworkViewInput = {
  map: MapResponse;
  sim: SimulatorResponse;
  selection?: Selection;
  focus?: NetworkFocus;
};

type Keep = { routes: Set<string>; places: Set<string>; vehicles: Set<string>; packages: Set<string> };

/**
 * What survives focus mode. null = no focus (keep everything). An ID the run does not have (a focus
 * kept from another run, #579) is no focus too: the map never goes empty while the selector reads "All".
 */
function focusKeep(idx: NetworkIndex, focus: NetworkFocus): Keep | null {
  if (focus.kind === 'none') return null;
  const keep: Keep = { routes: new Set(), places: new Set(), vehicles: new Set(), packages: new Set() };
  const addPlanPlaces = (shipmentId: string) => {
    const plan = idx.planByShipment.get(shipmentId);
    for (const b of planBusinessIds(plan, idx.shipments.get(shipmentId))) keep.places.add(b);
  };

  if (focus.kind === 'employee') {
    const e = idx.employees.get(focus.id);
    if (!e) return null;
    keep.vehicles.add(e.id);
    keep.places.add(e.homeId).add(e.businessId);
    for (const r of idx.routes) {
      if (r.employeeId !== e.id) continue;
      keep.routes.add(r.route.id);
      for (const p of r.placeIds) keep.places.add(p);
    }
    for (const plan of idx.plans) {
      for (const leg of plan.legs) if (leg.employeeId === e.id) for (const p of leg.placeIds) keep.places.add(p);
    }
    for (const s of shipmentsCarriedBy(idx, e.id)) {
      keep.packages.add(s);
      addPlanPlaces(s);
    }
    return keep;
  }

  const b = idx.businesses.get(focus.id);
  if (!b) return null;
  keep.places.add(b.id);
  const staff = idx.employeeList.filter((e) => e.businessId === b.id);
  for (const e of staff) {
    keep.vehicles.add(e.id);
    keep.places.add(e.homeId);
  }
  const staffIds = new Set(staff.map((e) => e.id));
  const shipments = new Set(shipmentsOfBusiness(idx, b.id));
  for (const s of shipments) {
    keep.packages.add(s);
    addPlanPlaces(s);
  }
  // Its employees' routes, plus the delivery routes of the packages it sends, receives or relays.
  for (const r of idx.routes) {
    if (staffIds.has(r.employeeId) || (r.shipmentId && shipments.has(r.shipmentId))) {
      keep.routes.add(r.route.id);
      for (const p of r.placeIds) keep.places.add(p);
    }
  }
  for (const plan of idx.plans) {
    for (const leg of plan.legs) {
      if (!staffIds.has(leg.employeeId) && !shipments.has(plan.shipmentId)) continue;
      keep.vehicles.add(leg.employeeId);
      for (const p of leg.placeIds) keep.places.add(p);
    }
  }
  return keep;
}

function movers(idx: NetworkIndex, sim: SimulatorResponse): { vehicles: MapMover[]; packages: MapMover[] } {
  const vehicles: MapMover[] = [];
  const seen = new Set<string>();
  for (const m of sim.snapshot?.markers ?? []) {
    if (seen.has(m.employeeId) || !Number.isFinite(m.lat) || !Number.isFinite(m.lng)) continue;
    seen.add(m.employeeId);
    vehicles.push({ id: m.employeeId, kind: 'vehicle', lat: m.lat, lng: m.lng, label: idx.employees.get(m.employeeId)?.name || 'Carrier' });
  }
  const packages: MapMover[] = [];
  for (const [shipmentId, pos] of Object.entries(sim.snapshot?.packagePositions ?? {})) {
    if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) continue;
    packages.push({ id: shipmentId, kind: 'package', lat: pos.lat, lng: pos.lng, label: idx.shipments.get(shipmentId)?.label || 'Package' });
  }
  vehicles.sort((a, b) => byId(a.id, b.id));
  packages.sort((a, b) => byId(a.id, b.id));
  return { vehicles, packages };
}

/**
 * Places (businesses, then homes in use), routes (baselines and plan legs) and movers (vehicles, then
 * packages), each sorted by ID, plus the IDs to highlight for the selection. Focus mode removes
 * everything outside the focused employee or business; the selection is then limited to what is left.
 */
export function buildNetworkView(input: NetworkViewInput): NetworkView {
  const { map, sim } = input;
  const focus = input.focus ?? { kind: 'none' };
  const idx = buildIndex(map, sim);
  const keep = focusKeep(idx, focus);

  const { vehicles, packages } = movers(idx, sim);
  const view: NetworkView = {
    places: keep ? idx.places.filter((p) => keep.places.has(p.id)) : idx.places.slice(),
    routes: (keep ? idx.routes.filter((r) => keep.routes.has(r.route.id)) : idx.routes).map((r) => r.route),
    movers: keep
      ? [...vehicles.filter((v) => keep.vehicles.has(v.id)), ...packages.filter((p) => keep.packages.has(p.id))]
      : [...vehicles, ...packages],
    selectedIds: [],
  };

  const selected = selectedIdsFromIndex(input.selection ?? null, idx);
  if (selected.length) {
    const present = new Set<string>();
    for (const p of view.places) present.add(p.id);
    for (const m of view.movers) present.add(m.id);
    for (const r of view.routes) {
      present.add(r.id);
      for (const o of r.ownerIds) present.add(o);
    }
    view.selectedIds = selected.filter((id) => present.has(id));
  }
  return view;
}

// ---------- Hover tooltip ----------
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const join = (...parts: (string | null | undefined | false)[]) => parts.filter((p): p is string => !!p).join(' · ');

function packagePhrase(idx: NetworkIndex, sim: SimulatorResponse, shipmentId: string): string | null {
  const status = sim.snapshot?.shipmentStatus?.[shipmentId];
  const shipment = idx.shipments.get(shipmentId);
  const plan = idx.planByShipment.get(shipmentId);
  const bizName = (id: string | undefined) => (id ? idx.businesses.get(id)?.name : undefined);
  switch (status) {
    case 'unmatched': return 'not matched';
    case 'scheduled': {
      const from = bizName(shipment?.originBusinessId);
      return from ? `waiting for pickup at ${from}` : 'waiting for pickup';
    }
    case 'picked_up':
    case 'out_for_delivery': {
      const carrier = (sim.snapshot?.markers ?? []).find((m) => m.carryingShipmentId === shipmentId);
      const name = carrier ? idx.employees.get(carrier.employeeId)?.name : undefined;
      return name ? `with ${name}` : 'on the way';
    }
    case 'at_hub': {
      const relay = bizName(plan?.relayBusinessId);
      return relay ? `waiting at relay point ${relay}` : 'waiting at a relay point';
    }
    case 'delivered': {
      const to = bizName(shipment?.destinationBusinessId);
      return to ? `delivered to ${to}` : 'delivered';
    }
    default: return null;
  }
}

/**
 * Tooltip text: name and role, e.g. "Etsy · Network business · relay point for 1 package",
 * "Maya Ortiz · Commuter · carrying Astoria product proofs", "Astoria · Home neighborhood".
 * Unknown items fall back to the item's own label and role.
 */
export function hoverText(item: MapItem, map: MapResponse, sim: SimulatorResponse): string {
  const idx = buildIndex(map, sim);
  const fallback = join(item.label, item.role) || 'Map item';

  switch (item.kind) {
    case 'business': {
      const b = idx.businesses.get(item.id);
      if (!b) return fallback;
      const relayed = idx.plans.filter((p) => p.relayBusinessId === b.id).length;
      return join(b.name || 'Network business', 'Network business', relayed > 0 && `relay point for ${plural(relayed, 'package')}`);
    }
    case 'home': {
      const h = idx.homes.get(item.id);
      if (!h) return fallback;
      const n = (h.neighborhood ?? '').trim();
      return n && !/\d/.test(n) ? `${n} · Home neighborhood` : 'Home neighborhood';
    }
    case 'vehicle': {
      const e = idx.employees.get(item.id);
      if (!e) return fallback;
      const marker = (sim.snapshot?.markers ?? []).find((m) => m.employeeId === e.id);
      const carrying = marker?.carryingShipmentId ? idx.shipments.get(marker.carryingShipmentId)?.label || 'a package' : null;
      return join(e.name || 'Employee', 'Commuter', carrying && `carrying ${carrying}`);
    }
    case 'package': {
      const s = idx.shipments.get(item.id);
      if (!s) return fallback;
      return join(s.label || 'Package', 'Package', packagePhrase(idx, sim, s.id));
    }
    case 'baseline': {
      const r = idx.routeById.get(item.id);
      const e = r ? idx.employees.get(r.employeeId) : undefined;
      if (!r || !e) return fallback;
      const when = r.route.id.endsWith('-eve') ? 'evening' : r.route.id.endsWith('-morn') ? 'morning' : null;
      return join(e.name || 'Employee', 'Normal commute', when);
    }
    case 'leg': {
      const r = idx.routeById.get(item.id);
      const plan = r?.planId ? idx.plans.find((p) => p.id === r.planId) : undefined;
      if (!r || !plan) return fallback;
      const legIndex = r.legIndex ?? -1;
      const label = idx.shipments.get(plan.shipmentId)?.label || 'Package';
      const carrier = idx.employees.get(r.employeeId)?.name;
      const which = plan.legs.length > 1 && legIndex >= 0 ? `leg ${legIndex + 1} of ${plan.legs.length}` : null;
      return join(label, 'Delivery route', which, carrier && `carried by ${carrier}`);
    }
    default: return fallback;
  }
}
