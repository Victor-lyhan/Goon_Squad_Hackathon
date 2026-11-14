import { pairKey, type TravelProvider } from '../../shared/v2/types';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { buildTrips } from '../../server/domain/v2/trips';
import type { MatchContext } from '../../server/domain/v2/matching';
import { business, employee, shipment, TableTravel } from './matching-v2-helpers';

/** Counts provider calls only; reset after setup to measure a single allocation. */
export function countingTravel(provider: TravelProvider) {
  const counts = { durationMin: 0, distanceM: 0 };
  const travel: TravelProvider = {
    durationMin(from, to) { counts.durationMin++; return provider.durationMin(from, to); },
    distanceM(from, to) { counts.distanceM++; return provider.distanceM(from, to); },
    polyline(from, to) { return provider.polyline(from, to); },
  };
  return { travel, counts, reset() { counts.durationMin = 0; counts.distanceM = 0; } };
}

/** Synthetic test geometry only: three business clusters and eight home clusters.
 * Build the matrix once, outside timed matching. Like the NYC cache it has every
 * ordered business/business and home/business pair, but no home/home pairs.
 */
export function nycShapedWorkload(size: { employees: number; packages: number }) {
  const positions = new Map<string, readonly [number, number]>();
  const businesses = Array.from({ length: 18 }, (_, i) => {
    const cluster = i < 8 ? 0 : i < 14 ? 1 : 2;
    const offset = i - [0, 8, 14][cluster];
    const b = { ...business(`biz-${String(i + 1).padStart(2, '0')}`),
      borough: (['Manhattan', 'Brooklyn', 'Queens'] as const)[cluster],
      neighborhood: `Business cluster ${cluster + 1}` };
    positions.set(b.id, [cluster * 15 + offset, offset % 2]);
    return b;
  });
  const homeCenters = [[5, 0], [10, 4], [15, 0], [18, 5], [22, 2], [25, 6], [35, 0], [40, 4]] as const;
  const employees = Array.from({ length: size.employees }, (_, i) => {
    const employer = i % businesses.length;
    // The featured A→B relay has homes between the two employers. Neither
    // carrier can drive directly via the other employer within eight minutes.
    const cluster = employer === 0 ? 2 : employer === 14 ? 0 : i % 8;
    const center = homeCenters[cluster];
    const e = employee(`emp-${i + 1}`, businesses[employer].id, {
      homeId: `home-${String(i + 1).padStart(3, '0')}`,
      eveningDepartureMin: 1020 + (i % 4) * 5,
      morningDepartureMin: 1935 + (i % 3) * 5,
      maxExtraMin: employer === 0 || employer === 14 ? 8 : 8 + i % 5,
    });
    positions.set(e.homeId, [center[0] + Math.floor(i / 18) % 2, center[1]]);
    return e;
  });
  const table = new TableTravel();
  for (const [from, a] of positions) {
    for (const [to, b] of positions) {
      if (from.startsWith('home-') && to.startsWith('home-')) continue;
      const durationMin = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
      table.pairs[pairKey(from, to)] = { durationMin, distanceM: durationMin * 350 };
    }
  }
  const counter = countingTravel(table);
  const ctx: MatchContext = { businesses, employees, travel: counter.travel,
    trips: employees.flatMap(e => buildTrips(e, table)), settings: { ...DEFAULT_SETTINGS } };
  const shipments = Array.from({ length: size.packages }, (_, i) => {
    const diagnosis = i >= size.packages - 5;
    const origin = i === 0 || diagnosis ? 0 : i === 1 ? 8 : (i * 7) % 18;
    const destination = i === 0 || diagnosis ? 14 : i === 1 ? 9 : (origin + 1 + i % 16) % 18;
    return shipment({ id: `shp-${i + 1}`, clientRequestId: `workload-${i + 1}`, createdSeq: i + 1,
      originBusinessId: businesses[origin].id, destinationBusinessId: businesses[destination].id,
      // Both readiness/added time and deadline must be relaxed: all four
      // diagnostic candidate generations run, rather than a structural exit.
      readyMin: diagnosis ? 1100 : 960, deadlineMin: diagnosis ? 1120 : 2040 });
  });
  return { ctx, shipments, counter, table };
}
