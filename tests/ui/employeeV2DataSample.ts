// Small hand-built v2 dashboards for the employee-v2-data tests (#388).
import type { EmployeeDashboard, EmployeeJobView, JobResponse } from '../../shared/v2/api';

export function jobView(id: string): EmployeeJobView {
  return {
    job: {
      id, planId: `plan-${id}`, shipmentId: `shp-${id}`, employeeId: 'emp-01', legIndex: 0, tripId: 'trip-1',
      pickup: { placeId: 'biz-a', kind: 'pickup', etaMin: 1000 },
      dropoff: { placeId: 'biz-b', kind: 'dropoff', etaMin: 1030 },
      rewardCents: 500,
    },
    status: 'assigned',
    shipment: { id: `shp-${id}`, label: `Box ${id}` },
    plan: { id: `plan-${id}` },
  } as unknown as EmployeeJobView;
}

export function dash(version: number, jobIds: string[], employeeId = 'emp-01'): EmployeeDashboard {
  return {
    employee: {
      id: employeeId, name: 'Ana', businessId: 'biz-a', homeId: 'home-001',
      eveningDepartureMin: 1050, morningDepartureMin: 1950, maxExtraMin: 8,
      availableEvening: true, availableMorning: true,
    },
    home: { id: 'home-001', neighborhood: 'Astoria', lat: 40.77, lng: -73.92 },
    trips: [],
    assigned: jobIds.map(jobView),
    completed: [],
    earnedCents: 0, projectedCents: 0, notifications: [], phase: 'planning', version,
  } as EmployeeDashboard;
}

export function jobResponse(id: string): JobResponse {
  return { ...jobView(id), trip: { id: 'trip-1' } } as unknown as JobResponse;
}
