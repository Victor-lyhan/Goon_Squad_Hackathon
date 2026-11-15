// Works out what `npm run fetch:routes` still has to ask Google for, given the cache files as plain objects.
// Pure: no fs, no environment, no network, no logging. server/geo/fetchRunner.ts carries the plans out.
// Every plan is in a fixed order (IDs sorted by code unit), so the same input always gives the same requests.

import { pairKey } from '../../shared/v2/types';
import type { PolylinesFile, TravelMatrixFile } from '../../shared/v2/types';
import { planMatrixBatches } from './googleClient';

/** An ordered place pair. A→B and B→A are different pairs. */
export interface PlacePair {
  from: string;
  to: string;
}

/** A business that still needs coordinates. */
export interface GeocodeTarget {
  id: string;
  address: string;
}

export type MatrixBlock = 'business-business' | 'home-business' | 'business-home';

/**
 * One computeRouteMatrix request: every origin x every destination, at most 625 elements.
 * Every pair in it is needed and missing from the cache (no self pairs, nothing already cached).
 */
export interface MatrixBatchPlan {
  block: MatrixBlock;
  originIds: string[];
  destinationIds: string[];
}

export interface MatrixPlan {
  batches: MatrixBatchPlan[];
  /** Pairs the batches cover. */
  missingPairs: number;
  /** Needed pairs the cache already holds. */
  cachedPairs: number;
}

const has = (record: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(record, key);

/** De-duplicated, in code-unit order (not locale order, which can differ between machines). */
function sortedUnique(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

/** The businesses with no coordinates in `matrix.places` yet, by ID. */
export function planGeocodes(businesses: readonly GeocodeTarget[], matrix: TravelMatrixFile): GeocodeTarget[] {
  const byId = new Map<string, GeocodeTarget>();
  for (const business of businesses) {
    if (!byId.has(business.id) && !has(matrix.places, business.id)) byId.set(business.id, { id: business.id, address: business.address });
  }
  return sortedUnique([...byId.keys()]).map((id) => byId.get(id)!);
}

/**
 * Cuts the missing pairs of one origins x destinations block into full rectangles.
 * Origins that miss exactly the same destinations share a rectangle, so a rectangle never holds a cached pair
 * or a self pair; each rectangle is then split to the 625-element limit.
 */
function planBlock(block: MatrixBlock, originIds: string[], destinationIds: string[], matrix: TravelMatrixFile) {
  const groups = new Map<string, { originIds: string[]; destinationIds: string[] }>();
  let cached = 0;
  for (const origin of originIds) {
    const missing: string[] = [];
    for (const destination of destinationIds) {
      if (destination === origin) continue;
      if (has(matrix.pairs, pairKey(origin, destination))) cached++;
      else missing.push(destination);
    }
    if (missing.length === 0) continue;
    const key = JSON.stringify(missing);
    const group = groups.get(key);
    if (group) group.originIds.push(origin);
    else groups.set(key, { originIds: [origin], destinationIds: missing });
  }

  const batches: MatrixBatchPlan[] = [];
  let missingPairs = 0;
  for (const group of groups.values()) {
    for (const part of planMatrixBatches(group.originIds.length, group.destinationIds.length)) {
      const batch: MatrixBatchPlan = {
        block,
        originIds: group.originIds.slice(part.originStart, part.originEnd),
        destinationIds: group.destinationIds.slice(part.destinationStart, part.destinationEnd),
      };
      missingPairs += batch.originIds.length * batch.destinationIds.length;
      batches.push(batch);
    }
  }
  return { batches, missingPairs, cached };
}

/**
 * Every ordered pair the app can need and the cache lacks: business → business (both directions, no self pairs),
 * then home → business, then business → home. Homes are only commute endpoints, so there are no home → home pairs.
 */
export function planMatrixPairs(ids: { businessIds: readonly string[]; homeIds: readonly string[] }, matrix: TravelMatrixFile): MatrixPlan {
  const businessIds = sortedUnique(ids.businessIds);
  const homeIds = sortedUnique(ids.homeIds);
  const blocks = [
    planBlock('business-business', businessIds, businessIds, matrix),
    planBlock('home-business', homeIds, businessIds, matrix),
    planBlock('business-home', businessIds, homeIds, matrix),
  ];
  return {
    batches: blocks.flatMap((block) => block.batches),
    missingPairs: blocks.reduce((sum, block) => sum + block.missingPairs, 0),
    cachedPairs: blocks.reduce((sum, block) => sum + block.cached, 0),
  };
}

/** The pairs one batch asks for, origin by origin. */
export function batchPairs(batch: Pick<MatrixBatchPlan, 'originIds' | 'destinationIds'>): PlacePair[] {
  return batch.originIds.flatMap((from) => batch.destinationIds.map((to) => ({ from, to })));
}

/** The requested pairs with no cached polyline: de-duplicated, self pairs dropped, sorted by `from` then `to`. */
export function planPolylines(pairs: readonly PlacePair[], polylines: PolylinesFile): PlacePair[] {
  const wanted = new Map<string, PlacePair>();
  for (const { from, to } of pairs) {
    const key = pairKey(from, to);
    if (from === to || wanted.has(key) || has(polylines.polylines, key)) continue;
    wanted.set(key, { from, to });
  }
  return [...wanted.values()].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
}

/** Both directions of each employee's baseline commute: business → home (evening), home → business (morning). */
export function commutePairs(employees: readonly { businessId: string; homeId: string }[]): PlacePair[] {
  return employees.flatMap((employee) => [
    { from: employee.businessId, to: employee.homeId },
    { from: employee.homeId, to: employee.businessId },
  ]);
}

/** Every neighbouring pair of each leg's `placeIds`: the stretches a carrier actually drives in the given plans. */
export function planLegPairs(plans: readonly { legs: readonly { placeIds: readonly string[] }[] }[]): PlacePair[] {
  const pairs: PlacePair[] = [];
  for (const plan of plans) {
    for (const leg of plan.legs) {
      for (let i = 0; i + 1 < leg.placeIds.length; i++) {
        if (leg.placeIds[i] !== leg.placeIds[i + 1]) pairs.push({ from: leg.placeIds[i], to: leg.placeIds[i + 1] });
      }
    }
  }
  return pairs;
}

/**
 * The home ↔ work stretches of the carriers (MVP IV F2: a carrier is drawn along its whole commute): every
 * neighbouring pair of every plan leg's `placeIds` that touches a home, in the plans' order, then both baseline
 * commutes of every employee who carries a leg, in the employees' order. The other half of a carrier's day is
 * its baseline commute, so both are needed to draw it from home to work and back.
 * A home is a place some employee lives at. Every pair here is also in `planLegPairs(plans)` or in
 * `commutePairs(employees)`: this names a part of what the fetch already asks for, it adds no request.
 * Duplicates are kept, as in those two; `planPolylines` drops them.
 */
export function carrierCommutePairs(
  plans: readonly { legs: readonly { employeeId: string; placeIds: readonly string[] }[] }[],
  employees: readonly { id: string; businessId: string; homeId: string }[],
): PlacePair[] {
  const homeIds = new Set(employees.map((employee) => employee.homeId));
  const carrierIds = new Set(plans.flatMap((plan) => plan.legs.map((leg) => leg.employeeId)));
  return [
    ...planLegPairs(plans).filter(({ from, to }) => homeIds.has(from) || homeIds.has(to)),
    ...commutePairs(employees.filter((employee) => carrierIds.has(employee.id))),
  ];
}
