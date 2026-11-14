// Small /api/v2 sample responses for the NYC homepage tests. Only the fields the homepage reads are real.
import type { BusinessesResponse, EmployeesResponse, SimulatorResponse } from '../../shared/v2/api';
import type { Employee, NetworkBusiness } from '../../shared/v2/types';

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
