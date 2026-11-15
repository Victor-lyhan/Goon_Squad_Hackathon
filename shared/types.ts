// Relay shared contracts. HUMAN-OWNED. Agents: do not edit; write BLOCKED.md instead.
// Units: time = minutes since Day 1 00:00 (Day 2 = +1440), distance = meters, money = integer cents.

// ---------- ID conventions (deterministic, never random) ----------
// Business  biz-<slug>            Hub   hub-<slug>          Employee emp-<n>
// Trip      <employeeId>-eve | <employeeId>-morn
// Shipment  shp-<n> (n = creation order, 1-based)
// Plan      plan-<shipmentId>     Job   <planId>-L<legIndex>
// Notification  ntf-<planId>-biz-<businessId> | ntf-<jobId>
// SimEvent  evt-<planId>-<stopIndexAcrossLegs>
export const tripId = (employeeId: string, dir: 'eve' | 'morn') => `${employeeId}-${dir}`;
export const planIdFor = (shipmentId: string) => `plan-${shipmentId}`;
export const jobIdFor = (planId: string, legIndex: number) => `${planId}-L${legIndex}`;

// ---------- Graph ----------
export type Node = {
  id: string; x: number; y: number;
  label?: string;      // friendly name, e.g. "Maple St & 4th Ave"
  district?: string;   // e.g. "Downtown", "Northside"
};
export type Edge = { from: string; to: string; distanceM: number; durationMin: number };
export type Graph = { nodes: Node[]; edges: Edge[] };

// ---------- Entities ----------
export type Business = { id: string; name: string; nodeId: string; district: string };
export type Hub = { id: string; name: string; nodeId: string };

export type Employee = {
  id: string; name: string; businessId: string; homeNodeId: string;
  eveningDepartureMin: number; morningDepartureMin: number;
  maxExtraMin: number; availableEvening: boolean; availableMorning: boolean;
  eveningViaNodeIds: string[]; morningViaNodeIds: string[]; // max 3 each
};

// Derived from Employee + graph; never edited directly.
export type Trip = {
  id: string; employeeId: string; direction: 'evening' | 'morning';
  originNodeId: string; destinationNodeId: string; departureMin: number;
  baselineNodeIds: string[]; baselineDurationMin: number; baselineDistanceM: number;
};

export type PackageCategory = 'envelope' | 'small_box';
export type Shipment = {
  id: string; clientRequestId: string; label: string;
  originBusinessId: string; destinationBusinessId: string;
  readyMin: number; deadlineMin: number;
  category: PackageCategory; description: string; weightGrams: number;
  pickupInstructions: string; dropoffInstructions: string;
  createdSeq: number;
};

// ---------- Plans ----------
export type StopKind = 'pickup' | 'hub_drop' | 'hub_pickup' | 'delivery';
export type Stop = {
  nodeId: string; kind: StopKind;
  arrivalMin: number; serviceStartMin: number; serviceEndMin: number; // service = 2 min handling
};
export type Leg = {
  tripId: string; employeeId: string; routeNodeIds: string[];
  stops: Stop[]; finishMin: number; extraMin: number;
  extraDistanceM: number; rewardCents: number;
};
export type DeliveryPlan = {
  id: string; shipmentId: string; kind: 'direct' | 'relay';
  legs: Leg[]; hubId?: string; deliveryMin: number;
  customerPriceCents: number; platformContributionCents: number;
};
export type Job = {
  id: string; planId: string; shipmentId: string; employeeId: string;
  legIndex: number; tripId: string; pickup: Stop; dropoff: Stop; rewardCents: number;
};
export type Notification = {
  id: string; audience: 'business' | 'employee'; audienceId: string;
  kind: 'delivery_matched' | 'job_assigned'; shipmentId: string;
  planId: string; jobId?: string; message: string; createdSeq: number;
};

// ---------- Settings ----------
export type Settings = {
  handlingMin: number;                 // 2
  defaultMaxExtraMin: number;          // 8
  legRewardCents: number;              // 300  carrier pay per leg
  hubCostCents: number;                // 50   relay fee, relay plans only
  platformFeeCents: number;            // 400  per package
  flexDiscountCents: number;           // 100  off when deadlineMin - readyMin >= flexWindowMin
  flexWindowMin: number;               // 1080 (18 h)
  platformVariableCostCents: number;   // 50
  courierPriceCents: number;           // 1400
  simStartMin: number;                 // 930  (Day 1 15:30)
  simEndMin: number;                   // 2160 (Day 2 12:00)
  allowRelay: boolean;                 // true; false = direct-only
};

export type Scenario = {
  schemaVersion: 1;
  name: string; preset: 'demo' | 'random' | 'fixture' | 'custom';
  seed: number; graph: Graph;
  businesses: Business[]; hubs: Hub[]; employees: Employee[]; shipments: Shipment[];
  settings: Settings;
};

// ---------- Matching ----------
export type UnmatchedReason = { shipmentId: string; reason: string };
export type AssignmentResult = {
  plans: DeliveryPlan[];          // sorted by shipmentId
  unmatched: UnmatchedReason[];
  computeMs: number;              // measured, never hardcoded
};

// ---------- Simulation ----------
export type SimEventKind = 'pickup' | 'hub_drop' | 'hub_pickup' | 'delivered';
export type SimEvent = {
  id: string; timeMin: number; shipmentId: string; planId: string; jobId: string;
  kind: SimEventKind; employeeId: string; hubId?: string;
  seq: number; // stable tie order: at equal timeMin, hub_drop < hub_pickup, then planId
};

export type ShipmentProgress =
  | 'unmatched' | 'scheduled' | 'picked_up' | 'at_hub' | 'out_for_delivery' | 'delivered';
export type JobStatus = 'assigned' | 'in_progress' | 'completed';

export type Phase = 'planning' | 'locked'; // locked = playback has started; inputs read-only

export type Clock = {
  phase: Phase; playing: boolean;
  timeMin: number; speed: 30 | 120 | 600; // simulated minutes per real second
};

export type Run = {
  runId: string;           // changes on new planning cycle
  version: number;         // increments on every state mutation
  scenario: Scenario;      // frozen copy when phase = locked
  trips: Trip[];
  assignments: AssignmentResult;
  jobs: Job[];
  notifications: Notification[];
  events: SimEvent[];
  clock: Clock;
};

export type MarkerPosition = {
  employeeId: string; x: number; y: number;
  carryingShipmentId?: string; servicing: boolean;
};

export type Metrics = {
  requested: number; matched: number; delivered: number;
  direct: number; relay: number; unmatched: number;
  avgExtraMinPerTrip: number | null; maxExtraMin: number | null;
  earnedRewardsCents: number;
  projectedCustomerSavingsCents: number;
  projectedCustomerSpendCents: number;        // sum of matched plans' prices + unmatched*courier
  projectedPlatformContributionCents: number;
  earnedPlatformContributionCents: number;
  extraDistanceM: number;
};

// Output of the pure function snapshotAt(run, timeMin).
export type Snapshot = {
  runId: string; version: number; timeMin: number;
  shipmentStatus: Record<string, ShipmentProgress>;
  deliveredAtMin: Record<string, number>;
  jobStatus: Record<string, JobStatus>;
  earningsCents: Record<string, number>;  // by employeeId
  markers: MarkerPosition[];
  packagePositions: Record<string, { x: number; y: number }>;
  occurredEvents: SimEvent[];
  metrics: Metrics;
};
