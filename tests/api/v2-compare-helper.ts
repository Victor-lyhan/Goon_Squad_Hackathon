// Travel table for the sample city in tests/api/v2-sample.ts, typed by hand so the matcher reproduces the
// sample's hand-built plans exactly:
//   shp-1 Studio -> Agency  only a relay works (Sam drops at the Cafe, Ana collects): every direct detour is too long
//   shp-2 Agency -> Studio  direct with Ana's evening commute
//   shp-3 Studio -> Agency  no commute fits its 40-minute window
// So "direct only" matches 1 package and "with relay" matches 2.
// The provider is the test-only fake over the real cached provider: a pair that is not listed throws
// TravelDataMissingError, exactly as in production.
import { pairKey, type TravelProvider } from '../../shared/v2/types';
import { createFakeProvider, type FakePair } from '../../server/geo/fakeProvider';
import { cachedPolylines } from './v2-sample';

const pair = (from: string, to: string, durationMin: number, distanceM: number): FakePair =>
  ({ from, to, durationMin, distanceM });

/** Every ordered pair between the 3 businesses, and between each business and the 3 homes in use (24 pairs). */
export const SAMPLE_PAIRS: FakePair[] = [
  // business <-> business
  pair('biz-studio', 'biz-agency', 26, 7000),
  pair('biz-agency', 'biz-studio', 24, 6400),       // shp-2 direct: pickup -> delivery
  pair('biz-studio', 'biz-cafe', 18, 5000),         // shp-1 relay leg 0: pickup -> relay point
  pair('biz-cafe', 'biz-studio', 19, 5100),
  pair('biz-cafe', 'biz-agency', 20, 5000),         // shp-1 relay leg 1: relay point -> delivery
  pair('biz-agency', 'biz-cafe', 21, 5200),
  // Sam (emp-1, Studio, home-001): baseline 30 evening, 32 morning
  pair('biz-studio', 'home-001', 30, 8200),
  pair('home-001', 'biz-studio', 32, 8400),
  pair('biz-agency', 'home-001', 35, 9500),         // direct shp-1 with Sam: 26 + 35 + 4 - 30 = 35 extra, too long
  pair('home-001', 'biz-agency', 36, 9700),
  pair('biz-cafe', 'home-001', 14, 4100),           // relay drop with Sam: 18 + 14 + 4 - 30 = 6 extra
  pair('home-001', 'biz-cafe', 15, 4200),
  // Ana (emp-2, Agency, home-story-ana): baseline 40 evening, 44 morning
  pair('biz-agency', 'home-story-ana', 40, 9800),
  pair('home-story-ana', 'biz-agency', 44, 10100),
  pair('biz-studio', 'home-story-ana', 20, 5500),   // shp-2 direct with Ana: 24 + 20 + 4 - 40 = 8 extra
  pair('home-story-ana', 'biz-studio', 30, 7600),   // direct shp-1 with Ana: 30 + 26 + 4 - 44 = 16 extra, too long
  pair('biz-cafe', 'home-story-ana', 27, 6500),
  pair('home-story-ana', 'biz-cafe', 28, 6600),     // relay collect with Ana: 28 + 20 + 4 - 44 = 8 extra
  // Lee (emp-3, Studio, home-002): baseline 16 evening, 18 morning; every detour is too long for Lee
  pair('biz-studio', 'home-002', 16, 4100),
  pair('home-002', 'biz-studio', 18, 4300),
  pair('biz-agency', 'home-002', 38, 9900),
  pair('home-002', 'biz-agency', 39, 10000),
  pair('biz-cafe', 'home-002', 25, 6000),
  pair('home-002', 'biz-cafe', 26, 6100),
];

/** The one pair the 503 tests take away: Sam's pickup -> relay point, which only the relay search asks for. */
export const MISSING_PAIR = { from: 'biz-studio', to: 'biz-cafe' } as const;

const polylines = Object.entries(cachedPolylines).map(([key, encoded]) => {
  const [from, to] = key.split('|');
  return { from, to, encoded };
});

/** Travel for the sample city: all 24 pairs, plus the sample's 10 cached route lines. */
export function sampleCityTravel(): TravelProvider {
  return createFakeProvider({ pairs: SAMPLE_PAIRS, polylines });
}

/** The same city with MISSING_PAIR not in the cache. */
export function sampleCityTravelMissingPair(): TravelProvider {
  const missing = pairKey(MISSING_PAIR.from, MISSING_PAIR.to);
  return createFakeProvider({ pairs: SAMPLE_PAIRS.filter((p) => pairKey(p.from, p.to) !== missing), polylines });
}

/** A result without the measured `computeMs`, for comparing two runs of the matcher. */
export function withoutComputeMs<T extends { directOnly: { result: object }; withRelay: { result: object } }>(response: T) {
  const strip = <S extends { result: object }>(side: S) => {
    const { computeMs: _computeMs, ...result } = side.result as { computeMs?: number };
    return { ...side, result };
  };
  return { ...response, directOnly: strip(response.directOnly), withRelay: strip(response.withRelay) };
}
