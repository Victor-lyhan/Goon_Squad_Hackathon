// What a click on the network map selects, and which map IDs that selection highlights
// (docs/mvp2-ui-redesign.md §1 "Interactions"). Pure: no React, no DOM.
import type { MapResponse, SimulatorResponse } from '../../../../../../shared/v2/api';
import { buildIndex, planBusinessIds, shipmentsCarriedBy, shipmentsOfBusiness, sortedUnique } from './networkIndex';
import type { NetworkIndex } from './networkIndex';

export type SelectionKind = 'business' | 'employee' | 'package';
export type Selection = { kind: SelectionKind; id: string } | null;

/**
 * Resolve a clicked map item ID to a selection:
 * business → that business; home → the employee who lives there; vehicle or normal commute → the employee;
 * package or delivery route → the package. Unknown IDs → null.
 */
export function selectionFromMapId(id: string, map: MapResponse, sim: SimulatorResponse): Selection {
  return selectionFromIndex(id, buildIndex(map, sim));
}

export function selectionFromIndex(id: string, idx: NetworkIndex): Selection {
  if (!id) return null;
  if (idx.businesses.has(id)) return { kind: 'business', id };
  if (idx.employees.has(id)) return { kind: 'employee', id };
  if (idx.shipments.has(id)) return { kind: 'package', id };
  const route = idx.routeById.get(id);
  if (route) {
    return route.shipmentId ? { kind: 'package', id: route.shipmentId } : { kind: 'employee', id: route.employeeId };
  }
  if (idx.homes.has(id)) {
    const resident = idx.employeeList.find((e) => e.homeId === id); // sorted by ID ⇒ stable
    return resident ? { kind: 'employee', id: resident.id } : null;
  }
  return null;
}

/**
 * The map IDs to highlight for a selection (sorted, unique):
 * - business: itself, its employees' routes, and the packages it sends, receives or holds as relay point;
 * - employee: their vehicle, their routes, home, workplace and the packages they carry;
 * - package: itself, its plan's routes, its carriers and its businesses.
 * `null` or an unknown ID → [].
 */
export function selectedIdsFor(selection: Selection, map: MapResponse, sim: SimulatorResponse): string[] {
  return selectedIdsFromIndex(selection, buildIndex(map, sim));
}

export function selectedIdsFromIndex(selection: Selection, idx: NetworkIndex): string[] {
  if (!selection) return [];
  const { kind, id } = selection;
  if (kind === 'business') {
    if (!idx.businesses.has(id)) return [];
    const staff = new Set(idx.employeeList.filter((e) => e.businessId === id).map((e) => e.id));
    const routes = idx.routes.filter((r) => staff.has(r.employeeId)).map((r) => r.route.id);
    return sortedUnique([id, ...routes, ...shipmentsOfBusiness(idx, id)]);
  }
  if (kind === 'employee') {
    const e = idx.employees.get(id);
    if (!e) return [];
    const routes = idx.routes.filter((r) => r.employeeId === id).map((r) => r.route.id);
    return sortedUnique([id, ...routes, e.homeId, e.businessId, ...shipmentsCarriedBy(idx, id)]);
  }
  if (kind === 'package') {
    const shipment = idx.shipments.get(id);
    const plan = idx.planByShipment.get(id);
    if (!shipment && !plan) return [];
    const routes = plan ? idx.routes.filter((r) => r.planId === plan.id).map((r) => r.route.id) : [];
    const carriers = plan ? plan.legs.map((l) => l.employeeId) : [];
    return sortedUnique([id, ...routes, ...carriers, ...planBusinessIds(plan, shipment)]);
  }
  return [];
}
