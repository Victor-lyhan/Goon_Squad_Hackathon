// Relay MVP II shared contracts (real NYC, Google travel times). HUMAN-OWNED. Agents: do not edit; write BLOCKED.md instead.
// MVP II code imports shared/v2/*; MVP 1 code keeps importing shared/types.ts until the cutover.
// Units: time = minutes since Day 1 00:00 (Day 2 = +1440), distance = meters, money = integer cents.

// ---------- Unchanged from MVP 1 ----------
// The enum values hub_drop, hub_pickup, at_hub and Settings.hubCostCents keep their names;
// only UI copy says "relay point".
export { tripId, planIdFor, jobIdFor } from '../types';
export type {
  PackageCategory, Shipment, StopKind, Notification, Settings, UnmatchedReason,
  SimEventKind, ShipmentProgress, JobStatus, Phase, Clock, Metrics,
} from '../types';
import type {
  Shipment, StopKind, Notification, Settings, UnmatchedReason,
  SimEventKind, ShipmentProgress, JobStatus, Clock, Metrics,
} from '../types';

// ---------- ID conventions (deterministic, never random) ----------
// Employee, Trip, Shipment, Plan, Job, Notification, SimEvent: same as shared/types.ts.
// Place IDs (a place is a network business or a home; TravelProvider looks places up by these):
//   Business            biz-<slug>
//   Pool home           home-<3 digits>            seeded background commuters, e.g. home-007
//   Story home          home-story-<slug>          featured employees in fixtures/nyc/demoStory.json
//   Commute-editor home home-c-<lat>_<lng>         both with 5 decimals, e.g. home-c-40.76420_-73.92350;
//                                                  derived from the coordinates, so the travel cache key is stable
// Neighborhood          nbh-<slug>

// ---------- Places ----------
export type LatLng = { lat: number; lng: number };
export type Borough = 'Manhattan' | 'Brooklyn' | 'Queens' | 'Bronx' | 'Staten Island';
export type BusinessKind = 'office' | 'shop' | 'cafe';

// Every network business is also a relay point (can hold a package overnight). There is no Hub entity.
export type NetworkBusiness = {
  id: string; name: string; address: string; neighborhood: string; borough: Borough;
  kind: BusinessKind; lat: number; lng: number;
};

// Synthetic point in a real neighborhood; shown by neighborhood only. Only ever a commute endpoint.
export type Home = { id: string; neighborhood: string; lat: number; lng: number };

// ---------- Entities ----------
export type Employee = {
  id: string; name: string; businessId: string; homeId: string;
  eveningDepartureMin: number; morningDepartureMin: number; maxExtraMin: number;
  availableEvening: boolean; availableMorning: boolean;
}; // no waypoints

// Derived from Employee + TravelProvider; never edited directly.
export type Trip = {
  id: string; employeeId: string; direction: 'evening' | 'morning';
  originPlaceId: string; destinationPlaceId: string; departureMin: number;
  baselineDurationMin: number; baselineDistanceM: number;
};

// ---------- Plans ----------
export type Stop = {
  placeId: string; kind: StopKind;
  arrivalMin: number; serviceStartMin: number; serviceEndMin: number; // service = 2 min handling
};
export type Leg = {
  tripId: string; employeeId: string;
  placeIds: string[]; // travel order: trip origin, the stop places, trip destination; neighbours are distinct
  stops: Stop[]; finishMin: number; extraMin: number;
  extraDistanceM: number; rewardCents: number;
};
export type DeliveryPlan = {
  id: string; shipmentId: string; kind: 'direct' | 'relay';
  legs: Leg[]; relayBusinessId?: string; deliveryMin: number;
  customerPriceCents: number; platformContributionCents: number;
};
export type Job = {
  id: string; planId: string; shipmentId: string; employeeId: string;
  legIndex: number; tripId: string; pickup: Stop; dropoff: Stop; rewardCents: number;
};

// ---------- Matching ----------
export type AssignmentResult = {
  plans: DeliveryPlan[];
  unmatched: UnmatchedReason[];
  computeMs: number; // measured, never hardcoded
};

// ---------- Simulation ----------
export type SimEvent = {
  id: string; timeMin: number; shipmentId: string; planId: string; jobId: string;
  kind: SimEventKind; employeeId: string; relayBusinessId?: string;
  seq: number; // stable tie order: at equal timeMin, hub_drop < hub_pickup, then planId
};

export type Scenario = {
  schemaVersion: 2;
  name: string; preset: 'demo' | 'random' | 'custom';
  seed: number;
  businesses: NetworkBusiness[]; homes: Home[]; employees: Employee[]; shipments: Shipment[];
  settings: Settings;
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
  employeeId: string; lat: number; lng: number;
  carryingShipmentId?: string; servicing: boolean;
};

// Output of the pure function snapshotAt(run, timeMin).
export type Snapshot = {
  runId: string; version: number; timeMin: number;
  shipmentStatus: Record<string, ShipmentProgress>;
  deliveredAtMin: Record<string, number>;
  jobStatus: Record<string, JobStatus>;
  earningsCents: Record<string, number>; // by employeeId
  markers: MarkerPosition[];
  packagePositions: Record<string, LatLng>;
  occurredEvents: SimEvent[];
  metrics: Metrics;
};

// ---------- Travel ----------
// Key of an ordered place pair in the travel cache. A→B and B→A are different pairs.
export const pairKey = (fromPlaceId: string, toPlaceId: string) => `${fromPlaceId}|${toPlaceId}`;

// Thrown when a pair has no travel data. Travel times are never invented:
// the API turns this into a 503 TravelUnavailable (shared/v2/api.ts).
export class TravelDataMissingError extends Error {
  readonly from: string;
  readonly to: string;
  readonly what: 'matrix' | 'polyline';
  constructor(from: string, to: string, what: 'matrix' | 'polyline' = 'matrix') {
    super(`No travel ${what} data for ${pairKey(from, to)}`);
    this.name = 'TravelDataMissingError';
    this.from = from;
    this.to = to;
    this.what = what;
  }
}

// Synchronous lookups by place ID, so domain code stays pure.
export interface TravelProvider {
  /** Google seconds rounded UP to whole minutes; 0 if same place; throws TravelDataMissingError if the pair is unknown. */
  durationMin(fromPlaceId: string, toPlaceId: string): number;
  /** Meters; 0 if same place; throws TravelDataMissingError if the pair is unknown. */
  distanceM(fromPlaceId: string, toPlaceId: string): number;
  /** Google encoded polyline (precision 5); null if not cached. */
  polyline(fromPlaceId: string, toPlaceId: string): string | null;
}

// ---------- Fixture file formats (fixtures/nyc/) ----------
// businesses.json. No coordinates: they come from geocoding (matrix.json `places`).
export type NycBusinessesFile = { businesses: Omit<NetworkBusiness, 'lat' | 'lng'>[] };

// neighborhoods.json. id = nbh-<slug>.
export type Neighborhood = {
  id: string; name: string; borough: Borough;
  bbox: { south: number; west: number; north: number; east: number };
};
export type NycNeighborhoodsFile = { neighborhoods: Neighborhood[] };

// demoStory.json. The curated default scenario's featured employees and packages.
export type NycDemoStoryFile = {
  featuredEmployees: (Omit<Employee, 'homeId'> & { home: Home; note: string })[];
  shipments: (Omit<Shipment, 'id' | 'clientRequestId' | 'createdSeq'> & { expect: 'direct' | 'relay' | 'any'; note?: string })[];
};

// matrix.json. Written by `npm run fetch:routes` and by live commute saves.
export type TravelMatrixFile = {
  schemaVersion: 1;
  places: Record<string, LatLng & { formattedAddress?: string }>;   // geocoded businesses + every home that was fetched
  pairs: Record<string, { durationS: number; distanceM: number }>;  // key = pairKey(from, to); raw Google seconds
};

// polylines.json. key = pairKey(from, to); value = Google encoded polyline (precision 5).
export type PolylinesFile = { schemaVersion: 1; polylines: Record<string, string> };
