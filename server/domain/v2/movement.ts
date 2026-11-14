import type { LatLng, Leg, MarkerPosition, Run, Stop, TravelProvider } from '../../../shared/v2/types';
import { positionBetween } from './polyline';

type PlannedLeg = { leg: Leg; shipmentId: string };

function placeCoordinates(run: Run): Map<string, LatLng> {
  return new Map([
    ...run.scenario.businesses.map(({ id, lat, lng }) => [id, { lat, lng }] as const),
    ...run.scenario.homes.map(({ id, lat, lng }) => [id, { lat, lng }] as const),
  ]);
}

function stopsByPlace(leg: Leg): Map<string, Stop[]> {
  const byPlace = new Map<string, Stop[]>();
  for (const stop of leg.stops) {
    const stops = byPlace.get(stop.placeId) ?? [];
    stops.push(stop);
    byPlace.set(stop.placeId, stops);
  }
  return byPlace;
}

function markerForLeg(
  leg: Leg,
  shipmentId: string,
  departureMin: number,
  timeMin: number,
  coordinates: Map<string, LatLng>,
  travel: Pick<TravelProvider, 'polyline'>,
): MarkerPosition | undefined {
  if (timeMin < departureMin || timeMin > leg.finishMin || leg.placeIds.length === 0) return undefined;
  const pickupEndMin = leg.stops[0]?.serviceEndMin;
  const dropoffEndMin = leg.stops.at(-1)?.serviceEndMin;
  const carrying = pickupEndMin !== undefined && dropoffEndMin !== undefined
    && timeMin >= pickupEndMin && timeMin < dropoffEndMin;

  // A route without a known endpoint cannot be shown honestly. In particular,
  // never substitute a home or a nearby point for a missing place.
  if (leg.placeIds.some(placeId => !coordinates.has(placeId))) return undefined;

  const stops = stopsByPlace(leg);
  for (let index = 0; index < leg.placeIds.length; index += 1) {
    const placeId = leg.placeIds[index]!;
    const place = coordinates.get(placeId)!;
    const placeStops = stops.get(placeId) ?? [];
    const lastService = placeStops.at(-1);

    if (lastService !== undefined) {
      if (timeMin >= lastService.arrivalMin && timeMin < lastService.serviceStartMin) {
        return { employeeId: leg.employeeId, ...place, servicing: false };
      }
      if (timeMin >= lastService.serviceStartMin && timeMin < lastService.serviceEndMin) {
        return {
          employeeId: leg.employeeId,
          ...place,
          ...(carrying ? { carryingShipmentId: shipmentId } : {}),
          servicing: true,
        };
      }
    }

    if (index === leg.placeIds.length - 1) {
      return { employeeId: leg.employeeId, ...place, servicing: false };
    }

    const nextPlaceId = leg.placeIds[index + 1]!;
    const nextPlace = coordinates.get(nextPlaceId)!;
    const departMin = lastService?.serviceEndMin ?? departureMin;
    const nextStop = stops.get(nextPlaceId)?.[0];
    const arriveMin = nextStop?.arrivalMin ?? (index + 1 === leg.placeIds.length - 1 ? leg.finishMin : undefined);

    // The plan intentionally stores every timing value needed for simulation.
    // Do not invent an arrival time for a malformed intermediate place.
    if (arriveMin === undefined) return undefined;
    if (timeMin >= departMin && timeMin < arriveMin) {
      return {
        employeeId: leg.employeeId,
        ...positionBetween({
          encoded: travel.polyline(placeId, nextPlaceId), from: place, to: nextPlace,
          departMin, arriveMin, timeMin,
        }),
        ...(carrying ? { carryingShipmentId: shipmentId } : {}),
        servicing: false,
      };
    }
  }
  return undefined;
}

function plannedLegs(run: Run): PlannedLeg[] {
  return run.assignments.plans.flatMap(plan => plan.legs.map(leg => ({ leg, shipmentId: plan.shipmentId })));
}

/** Returns the visible vehicle markers at a simulated minute, in employee ID order. */
export function markersAt(
  run: Run,
  timeMin: number,
  travel: Pick<TravelProvider, 'polyline'>,
): MarkerPosition[] {
  const trips = new Map(run.trips.map(trip => [trip.id, trip]));
  const coordinates = placeCoordinates(run);
  const markers = new Map<string, MarkerPosition>();

  for (const { leg, shipmentId } of plannedLegs(run)) {
    const trip = trips.get(leg.tripId);
    if (trip === undefined || markers.has(leg.employeeId)) continue;
    const marker = markerForLeg(leg, shipmentId, trip.departureMin, timeMin, coordinates, travel);
    if (marker !== undefined) markers.set(marker.employeeId, marker);
  }
  return [...markers.values()].sort((left, right) => left.employeeId.localeCompare(right.employeeId));
}

/** Returns matched package locations; homes are never package locations. */
export function packagePositionsAt(
  run: Run,
  timeMin: number,
  markers: MarkerPosition[],
): Record<string, LatLng> {
  const businesses = new Map(run.scenario.businesses.map(({ id, lat, lng }) => [id, { lat, lng }] as const));
  const markersByEmployee = new Map(markers.map(marker => [marker.employeeId, marker]));
  const positions: Record<string, LatLng> = {};

  for (const plan of run.assignments.plans) {
    const shipment = run.scenario.shipments.find(candidate => candidate.id === plan.shipmentId);
    const firstLeg = plan.legs[0];
    const lastLeg = plan.legs.at(-1);
    const firstPickup = firstLeg?.stops[0];
    const finalDropoff = lastLeg?.stops.at(-1);
    if (shipment === undefined || firstPickup === undefined || finalDropoff === undefined) continue;

    if (timeMin < firstPickup.serviceEndMin) {
      const origin = businesses.get(shipment.originBusinessId);
      if (origin !== undefined) positions[shipment.id] = origin;
      continue;
    }
    if (timeMin >= finalDropoff.serviceEndMin) {
      const destination = businesses.get(shipment.destinationBusinessId);
      if (destination !== undefined) positions[shipment.id] = destination;
      continue;
    }

    const carryingLeg = plan.legs.find(leg => {
      const pickup = leg.stops[0];
      const dropoff = leg.stops.at(-1);
      return pickup !== undefined && dropoff !== undefined
        && timeMin >= pickup.serviceEndMin && timeMin < dropoff.serviceEndMin;
    });
    if (carryingLeg !== undefined) {
      const marker = markersByEmployee.get(carryingLeg.employeeId);
      if (marker !== undefined) positions[shipment.id] = { lat: marker.lat, lng: marker.lng };
      continue;
    }

    const relay = plan.relayBusinessId === undefined ? undefined : businesses.get(plan.relayBusinessId);
    if (relay !== undefined) positions[shipment.id] = relay;
  }
  return positions;
}
