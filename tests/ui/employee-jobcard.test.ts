import { describe, expect, it } from 'vitest';
import type { EmployeeJobView } from '../../shared/api';
import type { Business, DeliveryPlan, Hub, Job, Leg, Shipment, Stop, StopKind } from '../../shared/types';
import { toJobCardModel } from '../../client/src/components/employee/jobCardModel';

const businesses: Business[] = [
  { id: 'biz-a', name: 'Business A', nodeId: 'n-0-0', district: 'D' },
  { id: 'biz-b', name: 'Business B', nodeId: 'n-5-5', district: 'N' },
];
const hubs: Hub[] = [{ id: 'hub-h', name: 'Hub H', nodeId: 'n-3-3' }];
const shipment: Shipment = {
  id: 'shp-1', clientRequestId: 'c1', label: 'Contracts', originBusinessId: 'biz-a', destinationBusinessId: 'biz-b',
  readyMin: 1000, deadlineMin: 1900, category: 'envelope', description: '', weightGrams: 300,
  pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
};
const stop = (nodeId: string, kind: StopKind, t: number): Stop =>
  ({ nodeId, kind, arrivalMin: t - 1, serviceStartMin: t, serviceEndMin: t + 2 });
const leg = (emp: string, a: Stop, b: Stop, extra: number): Leg => ({
  tripId: `${emp}-eve`, employeeId: emp, routeNodeIds: [], stops: [a, b],
  finishMin: b.serviceEndMin, extraMin: extra, extraDistanceM: 0, rewardCents: 300,
});
const mkJob = (plan: DeliveryPlan, i: number): Job => ({
  id: `${plan.id}-L${i}`, planId: plan.id, shipmentId: plan.shipmentId, employeeId: plan.legs[i].employeeId,
  legIndex: i, tripId: plan.legs[i].tripId, pickup: plan.legs[i].stops[0], dropoff: plan.legs[i].stops[1], rewardCents: 300,
});
const view = (plan: DeliveryPlan, i: number, status: EmployeeJobView['status'] = 'assigned'): EmployeeJobView =>
  ({ job: mkJob(plan, i), status, shipment, plan });

const relay: DeliveryPlan = {
  id: 'plan-shp-1', shipmentId: 'shp-1', kind: 'relay', hubId: 'hub-h', deliveryMin: 1100,
  customerPriceCents: 1000, platformContributionCents: 0,
  legs: [
    leg('emp-1', stop('n-0-0', 'pickup', 1020), stop('n-3-3', 'hub_drop', 1040), 6),
    leg('emp-2', stop('n-3-3', 'hub_pickup', 1060), stop('n-5-5', 'delivery', 1090), 4),
  ],
};
const direct: DeliveryPlan = {
  id: 'plan-shp-2', shipmentId: 'shp-1', kind: 'direct', deliveryMin: 1100,
  customerPriceCents: 1000, platformContributionCents: 0,
  legs: [leg('emp-1', stop('n-0-0', 'pickup', 1020), stop('n-5-5', 'delivery', 1090), 5)],
};

describe('toJobCardModel', () => {
  it('relay leg 0 drops at the hub and shows the final destination', () => {
    const m = toJobCardModel(view(relay, 0), businesses, hubs);
    expect(m.tag).toBe('Relay leg 1 of 2');
    expect(m.pickupPlace).toBe('Business A');
    expect(m.dropoffPlace).toBe('Hub H');
    expect(m.finalDestination).toBe('Business B');
    expect(m.addedTime).toBe('+6 min');
    expect(m.reward).toBe('$3.00');
    expect(m.statusLabel).toBe('Assigned');
    expect(m.senderName).toBe('Business A');
    expect(m.weight).toBe('0.3 kg');
  });
  it('relay leg 1 picks up at the hub', () => {
    const m = toJobCardModel(view(relay, 1, 'in_progress'), businesses, hubs);
    expect(m.tag).toBe('Relay leg 2 of 2');
    expect(m.pickupPlace).toBe('Hub H');
    expect(m.dropoffPlace).toBe('Business B');
    expect(m.addedTime).toBe('+4 min');
    expect(m.statusLabel).toBe('In progress');
  });
  it('direct job is tagged Direct with no final-destination context', () => {
    const m = toJobCardModel(view(direct, 0, 'completed'), businesses, hubs);
    expect(m.tag).toBe('Direct');
    expect(m.finalDestination).toBeNull();
    expect(m.statusLabel).toBe('Completed');
    expect(m.addedTime).toBe('+5 min');
  });
  it('never exposes raw node ids', () => {
    const m = toJobCardModel(view(relay, 0), businesses, hubs);
    expect(JSON.stringify(m)).not.toMatch(/n-\d-\d/);
  });
});
