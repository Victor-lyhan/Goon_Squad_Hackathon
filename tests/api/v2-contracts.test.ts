import { describe, expect, it } from 'vitest';
import {
  jobIdFor, pairKey, planIdFor, tripId, TravelDataMissingError,
  type Employee, type Home, type NetworkBusiness, type NycBusinessesFile, type NycDemoStoryFile,
  type NycNeighborhoodsFile, type PolylinesFile, type Run, type Scenario, type Snapshot,
  type TravelMatrixFile, type TravelProvider,
} from '../../shared/v2/types';
import type { CommuteResponse, EmployeeDashboard, MapResponse, TravelUnavailable } from '../../shared/v2/api';
import {
  ApiError, CompareRequest, CreateShipmentRequest, GenerateScenarioRequest, GeocodeQuery,
  PatchShipmentRequest, PutCommuteRequest, SimControlRequest,
} from '../../shared/v2/schemas';
import * as v1 from '../../shared/types';
import * as v1Schemas from '../../shared/schemas';

// ---------- A small typed city: A (Brooklyn) -> B (Midtown), relayed through R (DUMBO) ----------
const businesses = [
  { id: 'biz-studio', name: 'Studio', address: '1 Bedford Ave, Brooklyn, NY', neighborhood: 'Williamsburg', borough: 'Brooklyn', kind: 'office', lat: 40.7195, lng: -73.9565 },
  { id: 'biz-agency', name: 'Agency', address: '1 W 42nd St, New York, NY', neighborhood: 'Midtown', borough: 'Manhattan', kind: 'office', lat: 40.7536, lng: -73.9822 },
  { id: 'biz-cafe', name: 'Cafe', address: '1 Water St, Brooklyn, NY', neighborhood: 'DUMBO', borough: 'Brooklyn', kind: 'cafe', lat: 40.7033, lng: -73.9903 },
] satisfies NetworkBusiness[];

const homes = [
  { id: 'home-001', neighborhood: 'Park Slope', lat: 40.6722, lng: -73.9772 },
  { id: 'home-story-ana', neighborhood: 'Astoria', lat: 40.7642, lng: -73.9235 },
] satisfies Home[];

const employees = [
  { id: 'emp-1', name: 'Sam', businessId: 'biz-studio', homeId: 'home-001', eveningDepartureMin: 1050, morningDepartureMin: 1920, maxExtraMin: 8, availableEvening: true, availableMorning: true },
  { id: 'emp-2', name: 'Ana', businessId: 'biz-agency', homeId: 'home-story-ana', eveningDepartureMin: 1080, morningDepartureMin: 1900, maxExtraMin: 8, availableEvening: true, availableMorning: true },
] satisfies Employee[];

const scenario = {
  schemaVersion: 2, name: 'Contract test city', preset: 'custom', seed: 42,
  businesses, homes, employees,
  shipments: [{
    id: 'shp-1', clientRequestId: 'req-1', label: 'Proofs', originBusinessId: 'biz-studio', destinationBusinessId: 'biz-agency',
    readyMin: 960, deadlineMin: 1980, category: 'envelope', description: 'Printed proofs', weightGrams: 300,
    pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
  }],
  settings: {
    handlingMin: 2, defaultMaxExtraMin: 8, priceCents: 1000, legRewardCents: 300, hubCostCents: 50,
    platformVariableCostCents: 50, courierPriceCents: 1400, simStartMin: 930, simEndMin: 2160, allowRelay: true,
  },
} satisfies Scenario;

const planId = planIdFor('shp-1');
const eveTrip = tripId('emp-1', 'eve');
const mornTrip = tripId('emp-2', 'morn');
const dropAtRelay = { placeId: 'biz-cafe', kind: 'hub_drop', arrivalMin: 1072, serviceStartMin: 1072, serviceEndMin: 1074 } as const;
const pickAtOrigin = { placeId: 'biz-studio', kind: 'pickup', arrivalMin: 1050, serviceStartMin: 1050, serviceEndMin: 1052 } as const;
const pickAtRelay = { placeId: 'biz-cafe', kind: 'hub_pickup', arrivalMin: 1925, serviceStartMin: 1925, serviceEndMin: 1927 } as const;
const deliver = { placeId: 'biz-agency', kind: 'delivery', arrivalMin: 1950, serviceStartMin: 1950, serviceEndMin: 1952 } as const;

const run = {
  runId: 'run-1', version: 1, scenario,
  trips: [
    { id: eveTrip, employeeId: 'emp-1', direction: 'evening', originPlaceId: 'biz-studio', destinationPlaceId: 'home-001', departureMin: 1050, baselineDurationMin: 25, baselineDistanceM: 7400 },
    { id: mornTrip, employeeId: 'emp-2', direction: 'morning', originPlaceId: 'home-story-ana', destinationPlaceId: 'biz-agency', departureMin: 1900, baselineDurationMin: 30, baselineDistanceM: 9100 },
  ],
  assignments: {
    plans: [{
      id: planId, shipmentId: 'shp-1', kind: 'relay', relayBusinessId: 'biz-cafe', deliveryMin: 1952,
      customerPriceCents: 1000, platformContributionCents: 300,
      legs: [
        { tripId: eveTrip, employeeId: 'emp-1', placeIds: ['biz-studio', 'biz-cafe', 'home-001'], stops: [pickAtOrigin, dropAtRelay], finishMin: 1085, extraMin: 10, extraDistanceM: 1200, rewardCents: 300 },
        { tripId: mornTrip, employeeId: 'emp-2', placeIds: ['home-story-ana', 'biz-cafe', 'biz-agency'], stops: [pickAtRelay, deliver], finishMin: 1952, extraMin: 22, extraDistanceM: 3000, rewardCents: 300 },
      ],
    }],
    unmatched: [], computeMs: 1,
  },
  jobs: [
    { id: jobIdFor(planId, 0), planId, shipmentId: 'shp-1', employeeId: 'emp-1', legIndex: 0, tripId: eveTrip, pickup: pickAtOrigin, dropoff: dropAtRelay, rewardCents: 300 },
    { id: jobIdFor(planId, 1), planId, shipmentId: 'shp-1', employeeId: 'emp-2', legIndex: 1, tripId: mornTrip, pickup: pickAtRelay, dropoff: deliver, rewardCents: 300 },
  ],
  notifications: [
    { id: `ntf-${jobIdFor(planId, 0)}`, audience: 'employee', audienceId: 'emp-1', kind: 'job_assigned', shipmentId: 'shp-1', planId, jobId: jobIdFor(planId, 0), message: 'New job', createdSeq: 1 },
  ],
  events: [
    { id: `evt-${planId}-1`, timeMin: 1074, shipmentId: 'shp-1', planId, jobId: jobIdFor(planId, 0), kind: 'hub_drop', employeeId: 'emp-1', relayBusinessId: 'biz-cafe', seq: 1 },
  ],
  clock: { phase: 'planning', playing: false, timeMin: 930, speed: 120 },
} satisfies Run;

describe('MVP II contracts: data model', () => {
  it('builds a typed Scenario and Run with place IDs and a relay business instead of a hub', () => {
    expect(run.scenario.schemaVersion).toBe(2);
    expect(run.assignments.plans[0].relayBusinessId).toBe('biz-cafe');
    const placeIds = new Set([...scenario.businesses, ...scenario.homes].map((p) => p.id));
    for (const leg of run.assignments.plans[0].legs) {
      for (const id of leg.placeIds) expect(placeIds.has(id)).toBe(true);
      leg.placeIds.slice(1).forEach((id, i) => expect(id).not.toBe(leg.placeIds[i])); // neighbours are distinct
    }
    // a run survives the JSON round trip the store and export/import use
    expect(JSON.parse(JSON.stringify(run))).toEqual(run);
  });

  it('re-exports the MVP 1 ID helpers unchanged', () => {
    expect(tripId).toBe(v1.tripId);
    expect(planIdFor).toBe(v1.planIdFor);
    expect(jobIdFor).toBe(v1.jobIdFor);
    expect(run.jobs.map((j) => j.id)).toEqual(['plan-shp-1-L0', 'plan-shp-1-L1']);
  });

  it('types snapshots, the map and the commute responses in lat/lng', () => {
    const snapshot = {
      runId: run.runId, version: run.version, timeMin: 1060,
      shipmentStatus: { 'shp-1': 'picked_up' }, deliveredAtMin: {}, jobStatus: { [jobIdFor(planId, 0)]: 'in_progress' },
      earningsCents: { 'emp-1': 0 },
      markers: [{ employeeId: 'emp-1', lat: 40.71, lng: -73.97, carryingShipmentId: 'shp-1', servicing: false }],
      packagePositions: { 'shp-1': { lat: 40.71, lng: -73.97 } },
      occurredEvents: [],
      metrics: {
        requested: 1, matched: 1, delivered: 0, direct: 0, relay: 1, unmatched: 0, avgExtraMinPerTrip: 16, maxExtraMin: 22,
        earnedRewardsCents: 0, projectedCustomerSavingsCents: 400, projectedCustomerSpendCents: 1000,
        projectedPlatformContributionCents: 300, earnedPlatformContributionCents: 0, extraDistanceM: 4200,
      },
    } satisfies Snapshot;
    const map = {
      runId: run.runId, businesses, homes,
      employees: employees.map(({ id, name, businessId, homeId }) => ({ id, name, businessId, homeId })),
      polylines: [{ from: 'biz-studio', to: 'biz-cafe', encoded: '_p~iF~ps|U_ulLnnqC' }, { from: 'biz-cafe', to: 'home-001', encoded: null }],
    } satisfies MapResponse;
    const commute = { employee: employees[0], home: homes[0], trips: [run.trips[0]], rematchedShipmentIds: [] } satisfies CommuteResponse;
    const dashboard = {
      ...commute, assigned: [], completed: [], earnedCents: 0, projectedCents: 300, notifications: [], phase: 'planning', version: 1,
    } satisfies Omit<EmployeeDashboard, 'rematchedShipmentIds'>;
    const unavailable = { error: 'Google Maps server key is missing', code: 'google_key_missing' } satisfies TravelUnavailable;

    expect(snapshot.packagePositions['shp-1']).toEqual({ lat: 40.71, lng: -73.97 });
    expect(map.polylines.map((p) => pairKey(p.from, p.to))).toEqual(['biz-studio|biz-cafe', 'biz-cafe|home-001']);
    expect(dashboard.home.neighborhood).toBe('Park Slope');
    expect(unavailable.code).toBe('google_key_missing');
  });
});

describe('MVP II contracts: travel', () => {
  it('pairKey is ordered from|to', () => {
    expect(pairKey('a', 'b')).toBe('a|b');
    expect(pairKey('a', 'b')).not.toBe(pairKey('b', 'a'));
  });

  it('TravelDataMissingError is an Error carrying from/to/what', () => {
    const err = new TravelDataMissingError('biz-studio', 'home-001');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TravelDataMissingError);
    expect(err.name).toBe('TravelDataMissingError');
    expect(err.from).toBe('biz-studio');
    expect(err.to).toBe('home-001');
    expect(err.what).toBe('matrix');
    expect(err.message).toContain('biz-studio|home-001');
    expect(new TravelDataMissingError('a', 'b', 'polyline').what).toBe('polyline');
  });

  it('a TravelProvider can be built from the fixture file formats', () => {
    const matrix = {
      schemaVersion: 1,
      places: { 'biz-studio': { lat: 40.7195, lng: -73.9565, formattedAddress: '1 Bedford Ave, Brooklyn, NY 11222, USA' }, 'biz-cafe': { lat: 40.7033, lng: -73.9903 } },
      pairs: { [pairKey('biz-studio', 'biz-cafe')]: { durationS: 601, distanceM: 4200 } },
    } satisfies TravelMatrixFile;
    const lines = { schemaVersion: 1, polylines: { [pairKey('biz-studio', 'biz-cafe')]: '_p~iF~ps|U_ulLnnqC' } } satisfies PolylinesFile;
    const pair = (from: string, to: string) => {
      const hit = (matrix.pairs as TravelMatrixFile['pairs'])[pairKey(from, to)];
      if (!hit) throw new TravelDataMissingError(from, to);
      return hit;
    };
    const provider: TravelProvider = {
      durationMin: (from, to) => (from === to ? 0 : Math.ceil(pair(from, to).durationS / 60)),
      distanceM: (from, to) => (from === to ? 0 : pair(from, to).distanceM),
      polyline: (from, to) => (lines.polylines as PolylinesFile['polylines'])[pairKey(from, to)] ?? null,
    };

    expect(provider.durationMin('biz-studio', 'biz-cafe')).toBe(11); // 601 s rounds UP
    expect(provider.distanceM('biz-studio', 'biz-cafe')).toBe(4200);
    expect(provider.durationMin('biz-cafe', 'biz-cafe')).toBe(0);
    expect(provider.polyline('biz-cafe', 'biz-studio')).toBeNull();
    expect(() => provider.durationMin('biz-cafe', 'biz-studio')).toThrow(TravelDataMissingError);
  });

  it('types the hand-written NYC fixture files', () => {
    const file = { businesses: businesses.map(({ lat: _lat, lng: _lng, ...rest }) => rest) } satisfies NycBusinessesFile;
    const hoods = {
      neighborhoods: [{ id: 'nbh-astoria', name: 'Astoria', borough: 'Queens', bbox: { south: 40.755, west: -73.94, north: 40.78, east: -73.9 } }],
    } satisfies NycNeighborhoodsFile;
    const { homeId: _homeId, ...ana } = employees[1];
    const { id: _id, clientRequestId: _req, createdSeq: _seq, ...proofs } = scenario.shipments[0];
    const story = {
      featuredEmployees: [{ ...ana, home: homes[1], note: 'Drives past DUMBO every morning' }],
      shipments: [{ ...proofs, expect: 'relay' }, { ...proofs, label: 'Samples', expect: 'any', note: 'filler' }],
    } satisfies NycDemoStoryFile;

    expect(file.businesses[0]).not.toHaveProperty('lat');
    expect(hoods.neighborhoods[0].id).toMatch(/^nbh-/);
    expect(story.featuredEmployees[0].home.id).toBe('home-story-ana');
  });
});

describe('MVP II contracts: request schemas', () => {
  const commute = {
    businessId: 'biz-studio', eveningDepartureMin: 1050, morningDepartureMin: 1920,
    availableEvening: true, availableMorning: true, maxExtraMin: 8,
  };

  it('PutCommuteRequest accepts both home forms', () => {
    expect(PutCommuteRequest.parse({ ...commute, home: { homeId: 'home-001' } }).home).toEqual({ homeId: 'home-001' });
    const point = { lat: 40.7642, lng: -73.9235, neighborhood: 'Astoria' };
    expect(PutCommuteRequest.parse({ ...commute, home: point }).home).toEqual(point);
  });

  it('PutCommuteRequest rejects a body with neither home form, and out-of-range values', () => {
    const bad = (body: unknown) => expect(PutCommuteRequest.safeParse(body).success).toBe(false);
    bad(commute);
    bad({ ...commute, home: {} });
    bad({ ...commute, home: { homeId: '' } });
    bad({ ...commute, home: { lat: 40.7, lng: -73.9 } });
    bad({ ...commute, home: { lat: 40.7, lng: -73.9, neighborhood: '  ' } });
    bad({ ...commute, home: { lat: 90.1, lng: -73.9, neighborhood: 'Astoria' } });
    bad({ ...commute, home: { lat: 40.7, lng: -180.1, neighborhood: 'Astoria' } });
    bad({ ...commute, home: { homeId: 'home-001' }, maxExtraMin: 31 });
    bad({ ...commute, home: { homeId: 'home-001' }, eveningDepartureMin: 1440 });
    bad({ ...commute, home: { homeId: 'home-001' }, morningDepartureMin: 1439 });

    const issue = PutCommuteRequest.safeParse({ ...commute, home: {} }).error?.issues[0];
    expect(issue?.path).toEqual(['home']);
    expect(issue?.message).toMatch(/home/i);
  });

  it('PutCommuteRequest has no waypoint fields', () => {
    const parsed = PutCommuteRequest.parse({ ...commute, home: { homeId: 'home-001' }, eveningViaNodeIds: ['n-1-1'] });
    expect(parsed).not.toHaveProperty('eveningViaNodeIds');
    expect(parsed).not.toHaveProperty('morningViaNodeIds');
  });

  it('GenerateScenarioRequest applies defaults, has no hubs and caps employees at 120', () => {
    expect(GenerateScenarioRequest.parse({ preset: 'demo' })).toEqual({ preset: 'demo', seed: 42, employees: 60, packages: 24, maxExtraMin: 12 });
    expect(GenerateScenarioRequest.parse({ preset: 'random', hubs: 6 })).not.toHaveProperty('hubs');
    expect(GenerateScenarioRequest.safeParse({ preset: 'random', employees: 120 }).success).toBe(true);
    expect(GenerateScenarioRequest.safeParse({ preset: 'random', employees: 121 }).success).toBe(false);
    expect(GenerateScenarioRequest.safeParse({ preset: 'random', employees: 9 }).success).toBe(false);
    expect(GenerateScenarioRequest.safeParse({ preset: 'random', packages: 61 }).success).toBe(false);
    expect(GenerateScenarioRequest.safeParse({ preset: 'random', maxExtraMin: 31 }).success).toBe(false);
    expect(GenerateScenarioRequest.safeParse({ preset: 'fixture' }).success).toBe(false);
  });

  it('GeocodeQuery trims and needs 3..200 characters', () => {
    expect(GeocodeQuery.parse({ q: '  31-01 Ditmars Blvd  ' })).toEqual({ q: '31-01 Ditmars Blvd' });
    expect(GeocodeQuery.safeParse({ q: 'ab' }).success).toBe(false);
    expect(GeocodeQuery.safeParse({ q: ' ab  ' }).success).toBe(false);
    expect(GeocodeQuery.safeParse({ q: 'abc' }).success).toBe(true);
    expect(GeocodeQuery.safeParse({ q: 'a'.repeat(200) }).success).toBe(true);
    expect(GeocodeQuery.safeParse({ q: 'a'.repeat(201) }).success).toBe(false);
    expect(GeocodeQuery.safeParse({}).success).toBe(false);
  });

  it('re-exports the unchanged MVP 1 schemas', () => {
    expect(CreateShipmentRequest).toBe(v1Schemas.CreateShipmentRequest);
    expect(PatchShipmentRequest).toBe(v1Schemas.PatchShipmentRequest);
    expect(SimControlRequest).toBe(v1Schemas.SimControlRequest);
    expect(CompareRequest).toBe(v1Schemas.CompareRequest);
    expect(ApiError).toBe(v1Schemas.ApiError);
  });
});
