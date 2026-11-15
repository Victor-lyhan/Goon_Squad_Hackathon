// Every number the Relay vs courier comparison uses that is not travel data or engine output.
// The math (baseline.ts, runner.ts) reads its constants only through `assumptionValues`, and the whole list is
// written to the results file, so nothing is hidden. The values are deliberately simple; each `reason` says
// why the value is plausible and, where it matters, which side it favours.
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import type { Assumption, AssumptionKey } from './types';

export const ASSUMPTION_KEYS: readonly AssumptionKey[] = [
  'legRewardCents',
  'hubCostCents',
  'platformFeeCents',
  'flexDiscountCents',
  'flexWindowMin',
  'courierEnvelopeCents',
  'courierSmallBoxCents',
  'courierPromisedByMin',
  'courierTripSharePerPackage',
  'courierEmptyMilesPerLoadedMile',
  'relayCommuteMilesShare',
  'relayMinAddedMPerLeg',
  'commuterCo2KgPerMile',
  'courierCo2KgPerMile',
];

/** The study's default assumptions, in the order the page shows them. */
export const ASSUMPTIONS: readonly Assumption[] = [
  {
    key: 'legRewardCents',
    label: 'Relay price: pay to the carrier, per commute',
    value: DEFAULT_SETTINGS.legRewardCents,
    unit: 'cents per commute that carries the package',
    reason: 'The app pays this to the employee for each commute that carries the package, one for a direct delivery and two for a relay: a few dollars for a stop of a few minutes on a drive they make anyway.',
  },
  {
    key: 'hubCostCents',
    label: 'Relay price: relay fee',
    value: DEFAULT_SETTINGS.hubCostCents,
    unit: 'cents per package held overnight at a relay point',
    reason: 'Only a package carried on two commutes pays it, for the business that keeps the package overnight between the evening carrier and the morning carrier.',
  },
  {
    key: 'platformFeeCents',
    label: 'Relay price: platform fee',
    value: DEFAULT_SETTINGS.platformFeeCents,
    unit: 'cents per package',
    reason: "Relay's own charge for matching, tracking and support, the same for a direct and a relay delivery and for an envelope and a small box.",
  },
  {
    key: 'flexDiscountCents',
    label: 'Relay price: flexibility discount',
    value: DEFAULT_SETTINGS.flexDiscountCents,
    unit: 'cents off per package with a flexible delivery window',
    reason: 'A long delivery window is easier to match, so it costs less; every simulated package is ready at 4:00 p.m. and due by 10:00 a.m. the next day, so every simulated price includes this discount, and a tighter request would cost this much more.',
  },
  {
    key: 'flexWindowMin',
    label: 'Relay price: shortest flexible delivery window',
    value: DEFAULT_SETTINGS.flexWindowMin,
    unit: `minutes from the ready time to the deadline (${DEFAULT_SETTINGS.flexWindowMin / 60} hours)`,
    reason: 'A request counts as flexible when its deadline is at least this long after its ready time, such as ready in the afternoon and due the next morning, which leaves both the evening and the morning commutes open to it.',
  },
  {
    key: 'courierEnvelopeCents',
    label: 'Courier price, envelope',
    value: 1400,
    unit: 'cents per package',
    reason: 'The courier price the Relay app already shows senders; it is at the low end for a booked next-day local courier in New York, and a guaranteed morning overnight service usually costs more, so it favours the courier.',
  },
  {
    key: 'courierSmallBoxCents',
    label: 'Courier price, small box',
    value: 1800,
    unit: 'cents per package',
    reason: 'Couriers charge more for a parcel than for a flat envelope; $4 more for a box of up to 2 kg is a modest step.',
  },
  {
    key: 'courierPromisedByMin',
    label: 'Courier promise: next business day by 10:30 a.m.',
    value: 630,
    unit: 'minutes after midnight on the next business day',
    reason: 'By 10:30 a.m. on the next business day is a common commitment of priority overnight services, and the courier is assumed to always meet it.',
  },
  {
    key: 'courierTripSharePerPackage',
    label: "Share of the courier's trip counted for one package",
    value: 1,
    unit: 'share of the trip (1 = a dedicated trip)',
    reason: 'The baseline is a dedicated trip for one package, the way a local courier is booked for a single urgent item; a van route shared with other parcels would split these miles and is not modelled, which favours Relay.',
  },
  {
    key: 'courierEmptyMilesPerLoadedMile',
    label: 'Courier empty miles per loaded mile (depot legs)',
    value: 0,
    unit: 'empty miles per loaded mile',
    reason: "Only the loaded drive from sender to recipient is counted; the courier's drive to the pickup and away from the drop-off is left out, which favours the courier.",
  },
  {
    key: 'relayCommuteMilesShare',
    label: "Share of the employee's normal commute counted for Relay",
    value: 0,
    unit: 'share of the commute',
    reason: 'The employee drives the commute with or without a package, so only the detour to the pickup and drop-off is added traffic.',
  },
  {
    key: 'relayMinAddedMPerLeg',
    label: 'Least added distance counted per Relay commute',
    value: 0,
    unit: 'meters',
    reason: "When the route through the stops is shorter in meters than the usual commute it counts as 0 added meters, never as a saving, the same rule as Relay's own summary numbers.",
  },
  {
    key: 'commuterCo2KgPerMile',
    label: "CO2 per mile, employee's car",
    value: 0.4,
    unit: 'kg CO2 per vehicle mile',
    reason: "About 400 g of CO2 per mile is the U.S. EPA's figure for the average gasoline passenger vehicle.",
  },
  {
    key: 'courierCo2KgPerMile',
    label: 'CO2 per mile, courier vehicle',
    value: 0.4,
    unit: 'kg CO2 per vehicle mile',
    reason: "The courier is assumed to drive, with the same per-mile figure as the commuter's car so the CO2 gap comes only from miles; a delivery van would emit more per mile.",
  },
];

export type AssumptionValues = Readonly<Record<AssumptionKey, number>>;

/**
 * The assumptions as `key -> value` for the math. Throws if a key is missing, listed twice, unknown or not a
 * finite number, so the math can never fall back to a number that is not in the list.
 */
export function assumptionValues(assumptions: readonly Assumption[]): AssumptionValues {
  const values = new Map<string, number>();
  for (const { key, value } of assumptions) {
    if (!ASSUMPTION_KEYS.includes(key)) throw new Error(`Unknown study assumption "${key}"`);
    if (values.has(key)) throw new Error(`Study assumption "${key}" is listed twice`);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Study assumption "${key}" must be a finite number, got ${String(value)}`);
    }
    values.set(key, value);
  }
  const missing = ASSUMPTION_KEYS.filter(key => !values.has(key));
  if (missing.length > 0) throw new Error(`Study assumptions are missing: ${missing.join(', ')}`);
  return Object.fromEntries(values) as AssumptionValues;
}
