// Small /api/v2 sample responses for the NYC homepage tests. Only the fields the homepage reads are real.
import type { BusinessesResponse, EmployeesResponse, SimulatorResponse } from '../../shared/v2/api';
import type { DeliveryPlan, Employee, NetworkBusiness, Shipment } from '../../shared/v2/types';

const biz = (slug: string, name: string): NetworkBusiness => ({
  id: `biz-${slug}`, name, address: `1 ${name} St`, neighborhood: 'Chelsea', borough: 'Manhattan',
  kind: 'cafe', lat: 40.74, lng: -73.99,
} as NetworkBusiness);
const emp = (n: number): Employee => ({
  id: `emp-${n}`, name: `Employee ${n}`, businessId: 'biz-a', homeId: `home-00${n}`,
  eveningDepartureMin: 1080, morningDepartureMin: 1890, maxExtraMin: 12,
  availableEvening: true, availableMorning: true,
});

export const businesses: BusinessesResponse = {
  businesses: [biz('a', 'Alpha'), biz('b', 'Bravo'), biz('c', 'Charlie'), biz('d', 'Delta'), biz('e', 'Echo')],
};
export const employees: EmployeesResponse = { employees: [emp(7), emp(1), emp(2)] };
/** Metrics deliberately differ from anything countable in the sample (no shipments, no plans). */
export const simulator = {
  runId: 'run-nyc', version: 3, clock: { timeMin: 1950, speed: 1, playing: false },
  snapshot: { metrics: { requested: 24, matched: 19 } },
  plans: [], jobs: [], shipments: [], unmatched: [], computeMs: 4, nextEventMin: null,
} as unknown as SimulatorResponse;

export const travelMissingBody = { error: 'Travel data is not loaded', code: 'travel_data_missing' };

/** A shipment and a plan with only the fields the homepage reads (label, createdSeq; shipmentId, kind). */
export const shipment = (id: string, label: string, createdSeq: number): Shipment =>
  ({ id, label, createdSeq, originBusinessId: 'biz-a', destinationBusinessId: 'biz-b' } as Shipment);
export const plan = (shipmentId: string, kind: DeliveryPlan['kind']): DeliveryPlan =>
  ({ id: `plan-${shipmentId}`, shipmentId, kind, legs: [] } as unknown as DeliveryPlan);
/** The sample answer with these shipments and plans (the metrics stay as they are: nothing is counted). */
export const simulatorWith = (shipments: Shipment[], plans: DeliveryPlan[]): SimulatorResponse =>
  ({ ...simulator, shipments, plans });

/** The story run: the Navy Yard package is a relay, listed after an earlier relay and a direct. */
export const storySimulator = simulatorWith(
  [shipment('shp-1', 'Coffee samples', 1), shipment('shp-2', 'Bakery boxes', 2), shipment('shp-3', 'Navy Yard grinder burrs', 3)],
  [plan('shp-1', 'relay'), plan('shp-2', 'direct'), plan('shp-3', 'relay')],
);
/** A run without the story package (Random city, an import): the first relay by createdSeq is shp-12. */
export const randomSimulator = simulatorWith(
  [shipment('shp-14', 'Parts', 14), shipment('shp-12', 'Paper', 12), shipment('shp-11', 'Tea', 11), shipment('shp-13', 'Unmatched', 13)],
  [plan('shp-14', 'relay'), plan('shp-11', 'direct'), plan('shp-12', 'relay')],
);
