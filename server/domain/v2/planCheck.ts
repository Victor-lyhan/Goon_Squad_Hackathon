import { planIdFor, type AssignmentResult, type DeliveryPlan, type Employee,
  type NetworkBusiness, type Settings, type Shipment, type TravelProvider, type Trip,
} from '../../../shared/v2/types';

export type PlanIssueCode = 'plan_id' | 'duplicate_shipment' | 'duplicate_trip' | 'missing_reference'
  | 'leg_count' | 'stop_business' | 'relay_business' | 'route_shape' | 'stop_shape'
  | 'trip_employee' | 'relay_employees' | 'relay_direction' | 'availability'
  | 'stop_time' | 'finish_time' | 'delivery_time' | 'extra_time' | 'extra_limit'
  | 'pickup_ready' | 'delivery_deadline' | 'relay_order';
export type PlanIssue = { planId: string; shipmentId: string; code: PlanIssueCode; message: string };
export type PlanCheckInput = {
  plans: readonly DeliveryPlan[]; shipments: readonly Shipment[]; employees: readonly Employee[];
  trips: readonly Trip[]; businesses: readonly NetworkBusiness[]; settings: Settings; travel: TravelProvider;
};

/** Independent of the matcher. Missing travel pairs deliberately propagate to the caller.
 * Issues are emitted once per rule per plan, in input order, including malformed references.
 */
export function checkPlans(input: PlanCheckInput): PlanIssue[] {
  const { plans, settings, travel } = input;
  const shipments = new Map(input.shipments.map(s => [s.id, s]));
  const employees = new Map(input.employees.map(e => [e.id, e]));
  const trips = new Map(input.trips.map(t => [t.id, t]));
  const businesses = new Set(input.businesses.map(b => b.id));
  const homes = new Set(input.employees.map(e => e.homeId));
  const usedShipments = new Set<string>();
  const usedTrips = new Set<string>();
  const issues: PlanIssue[] = [];
  for (const plan of plans) {
    const reported = new Set<PlanIssueCode>();
    const fail = (code: PlanIssueCode, message: string) => {
      if (!reported.has(code)) issues.push({ planId: plan.id, shipmentId: plan.shipmentId, code, message });
      reported.add(code);
    };
    if (plan.id !== planIdFor(plan.shipmentId)) fail('plan_id', 'Plan ID must be planIdFor(shipmentId).');
    if (usedShipments.has(plan.shipmentId)) fail('duplicate_shipment', 'Shipment has more than one plan.');
    usedShipments.add(plan.shipmentId);
    const shipment = shipments.get(plan.shipmentId);
    if (!shipment) fail('missing_reference', 'Shipment is missing.');
    const relay = plan.kind === 'relay';
    if (plan.legs.length !== (relay ? 2 : 1)) fail('leg_count', 'Incorrect number of legs.');
    const a = shipment?.originBusinessId;
    const b = shipment?.destinationBusinessId;
    const r = plan.relayBusinessId;
    if (relay && (!r || !businesses.has(r) || homes.has(r) || r === a || r === b)) {
      fail('relay_business', 'Relay point must be a network business other than sender and recipient.');
    }
    if (relay && plan.legs[0]?.employeeId === plan.legs[1]?.employeeId) {
      fail('relay_employees', 'Relay legs must use different employees.');
    }
    let relayReady: number | undefined;
    let derivedDelivery: number | undefined;
    for (const [index, leg] of plan.legs.entries()) {
      if (usedTrips.has(leg.tripId)) fail('duplicate_trip', `Trip ${leg.tripId} is used more than once.`);
      usedTrips.add(leg.tripId);
      for (const stop of leg.stops) {
        if (!businesses.has(stop.placeId) || homes.has(stop.placeId)) fail('stop_business', 'Every stop must be a network business, never a home.');
      }
      const trip = trips.get(leg.tripId);
      const employee = employees.get(leg.employeeId);
      if (!trip || !employee) {
        fail('missing_reference', `Leg ${index} has a missing trip or employee.`);
        continue;
      }
      if (trip.employeeId !== employee.id) fail('trip_employee', 'Leg carrier does not own its trip.');
      const evening = trip.direction === 'evening';
      if (!(evening ? employee.availableEvening : employee.availableMorning)) fail('availability', 'Carrier is unavailable for the trip direction.');
      if (relay && trip.direction !== (index === 0 ? 'evening' : 'morning')) fail('relay_direction', 'Relay must use an evening trip followed by a morning trip.');
      if (!shipment) continue;
      const pickup = relay && index === 1 ? r : a;
      const drop = relay && index === 0 ? r : b;
      const expectedPlaces = evening ? [pickup, drop, employee.homeId] : [employee.homeId, pickup, drop];
      if (employee.businessId !== (evening ? a : b)
        || leg.placeIds.length !== 3 || leg.placeIds.some((p, i) => p !== expectedPlaces[i])
        || leg.placeIds[0] !== trip.originPlaceId || leg.placeIds.at(-1) !== trip.destinationPlaceId) {
        fail('route_shape', `Leg ${index} does not follow the required commute and stop order.`);
      }
      const kinds = relay ? (index === 0 ? ['pickup', 'hub_drop'] : ['hub_pickup', 'delivery']) : ['pickup', 'delivery'];
      if (leg.stops.length !== 2 || leg.stops.some((s, i) => s.placeId !== [pickup, drop][i] || s.kind !== kinds[i])) {
        fail('stop_shape', `Leg ${index} has incorrect stop places, kinds or count.`);
      }
      if (leg.stops[0] && leg.stops[0].serviceStartMin < shipment.readyMin) fail('pickup_ready', 'Pickup begins before the shipment is ready.');
      if (relay && index === 1 && leg.stops[0]
        && leg.stops[0].serviceStartMin < (plan.legs[0]?.stops[1]?.serviceEndMin ?? Infinity)) {
        fail('relay_order', 'Relay pickup begins before deposit completes.');
      }
      // Walk the supplied route, without trusting any stored timing as a clock input.
      let time = trip.departureMin;
      let stopIndex = 0;
      for (const [i, place] of leg.placeIds.entries()) {
        if (i > 0) time += travel.durationMin(leg.placeIds[i - 1], place);
        while (leg.stops[stopIndex]?.placeId === place) {
          const stop = leg.stops[stopIndex];
          const arrival = time;
          const ready = stopIndex === 0 ? Math.max(shipment.readyMin, relay && index === 1 ? relayReady ?? shipment.readyMin : shipment.readyMin) : -Infinity;
          const start = Math.max(arrival, ready);
          time = start + settings.handlingMin;
          if (stop.arrivalMin !== arrival || stop.serviceStartMin !== start || stop.serviceEndMin !== time) fail('stop_time', `Leg ${index} stop ${stopIndex} timing differs from travel, waiting and handling.`);
          if (index === 0 && relay && stopIndex === 1) relayReady = time;
          if (index === (relay ? 1 : 0) && stopIndex === 1) derivedDelivery = time;
          stopIndex++;
        }
      }
      if (stopIndex !== leg.stops.length) fail('stop_shape', `Leg ${index} has stops outside its route order.`);
      if (leg.finishMin !== time) fail('finish_time', `Leg ${index} finish differs from the re-derived finish.`);
      const extra = time - trip.departureMin - trip.baselineDurationMin;
      if (leg.extraMin !== extra) fail('extra_time', `Leg ${index} extra minutes differ from finish minus departure minus baseline.`);
      if (extra > employee.maxExtraMin || leg.extraMin > employee.maxExtraMin) fail('extra_limit', `Leg ${index} exceeds the carrier's extra-minute limit.`);
    }
    if (shipment) {
      if (derivedDelivery === undefined || plan.deliveryMin !== derivedDelivery) fail('delivery_time', 'Delivery time differs from re-derived delivery completion.');
      const storedDelivery = plan.legs.at(-1)?.stops[1]?.serviceEndMin;
      if (plan.deliveryMin > shipment.deadlineMin || (derivedDelivery ?? -Infinity) > shipment.deadlineMin
        || (storedDelivery ?? -Infinity) > shipment.deadlineMin) fail('delivery_deadline', 'Delivery completes after the deadline.');
    }
  }
  return issues;
}

export type StoryExpectation = { shipmentId: string; label: string; expect: 'direct' | 'relay' | 'any' };
export type StoryRow = StoryExpectation & { actual: 'direct' | 'relay' | 'unmatched'; ok: boolean; reason?: string };
export function checkStory(expectations: readonly StoryExpectation[], result: Pick<AssignmentResult, 'plans' | 'unmatched'>): StoryRow[] {
  return expectations.map(expectation => {
    const plan = result.plans.find(p => p.shipmentId === expectation.shipmentId);
    const actual = plan?.kind ?? 'unmatched';
    const reason = !plan ? result.unmatched.find(u => u.shipmentId === expectation.shipmentId)?.reason : undefined;
    return { ...expectation, actual, ok: !!plan && (expectation.expect === 'any' || expectation.expect === actual),
      ...(reason === undefined ? {} : { reason }) };
  });
}

/** Pass plans.length to include the checked count: successful plans cannot be counted from issues. */
export function formatCheckReport(issues: readonly PlanIssue[], storyRows: readonly StoryRow[], plansChecked?: number): string[] {
  return [
    `${plansChecked === undefined ? '' : `${plansChecked} plans checked, `}${issues.length} problems`,
    ...storyRows.map(row => `${row.ok ? 'OK' : 'FAIL'} ${row.shipmentId} ${row.label}: expected ${row.expect}, got ${row.actual}${row.reason ? ` — ${row.reason}` : ''}`),
    ...issues.map(issue => `${issue.planId} (${issue.shipmentId}) [${issue.code}] ${issue.message}`),
  ];
}
