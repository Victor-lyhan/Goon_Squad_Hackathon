import { tripId, type Employee, type TravelProvider, type Trip } from '../../../shared/v2/types';

/** Build only enabled commutes. Missing travel data propagates to the caller. */
export function buildTrips(employee: Employee, travel: TravelProvider): Trip[] {
  const trips: Trip[] = [];
  for (const direction of ['evening', 'morning'] as const) {
    const evening = direction === 'evening';
    if (!(evening ? employee.availableEvening : employee.availableMorning)) continue;
    const originPlaceId = evening ? employee.businessId : employee.homeId;
    const destinationPlaceId = evening ? employee.homeId : employee.businessId;
    trips.push({
      id: tripId(employee.id, evening ? 'eve' : 'morn'), employeeId: employee.id, direction,
      originPlaceId, destinationPlaceId,
      departureMin: evening ? employee.eveningDepartureMin : employee.morningDepartureMin,
      baselineDurationMin: travel.durationMin(originPlaceId, destinationPlaceId),
      baselineDistanceM: travel.distanceM(originPlaceId, destinationPlaceId),
    });
  }
  return trips;
}
