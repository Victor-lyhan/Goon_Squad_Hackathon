// Unit definitions and output rounding for the study. These are definitions, not assumptions: nothing here
// can be argued about, so nothing here is in the `assumptions` table. Every other number the study's math uses
// comes from scripts/study/assumptions.ts (tests/study/assumptions.test.ts scans the math files for literals).

/** The international mile, in meters (exact by definition). Meters are converted to miles only for output. */
export const METERS_PER_MILE = 1609.344;

/** Minutes in a day: Day 2 00:00 is minute 1440 (AGENTS.md: time = integer minutes since Day 1 00:00). */
export const MINUTES_PER_DAY = 1440;

/** Decimals kept in the output file. */
export const MILES_DECIMALS = 3;
export const KG_DECIMALS = 3;
export const RATE_DECIMALS = 4;
export const MINUTES_DECIMALS = 1;

/** `value` rounded to `decimals` places. Never -0, so the file and `toBe(0)` both see a plain 0. */
export function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale + 0;
}

export const milesFromMeters = (meters: number): number => meters / METERS_PER_MILE;

/** part / whole as a rounded fraction, or null when there is nothing to divide by (never NaN). */
export function rate(part: number, whole: number): number | null {
  return whole === 0 ? null : roundTo(part / whole, RATE_DECIMALS);
}

/** total / count rounded to `decimals`, or null when count is 0. */
export function average(total: number, count: number, decimals: number): number | null {
  return count === 0 ? null : roundTo(total / count, decimals);
}

// ---------- text for the terminal summary ----------

/** 1489 -> "$14.89". */
export const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/** 0.6612 -> "66.1%". */
export const percent = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`;
