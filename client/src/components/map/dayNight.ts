// Day and night on the simulator map (docs/mvp3.md P1, DECISIONS pass 63, #649). Pure: no React, no
// DOM, no Google. It is presentation of the clock only; no status or time is computed from it.
import { formatClock } from '../../ui/format';
import type { LayerSpec, PathDatum, RGBA } from './layers';

export type DayNight = 'day' | 'night';

/** Night starts at Day 1 4:30 PM, about NYC sunset in mid-November. */
export const NIGHT_START_MIN = 990;
/** Night ends at Day 2 6:45 AM, about NYC sunrise in mid-November (this minute is day again). */
export const NIGHT_END_MIN = 1845;

/** `'night'` from Day 1 4:30 PM up to (not including) Day 2 6:45 AM, `'day'` otherwise. */
export function dayNightAt(timeMin: number): DayNight {
  return timeMin >= NIGHT_START_MIN && timeMin < NIGHT_END_MIN ? 'night' : 'day';
}

/** The badge's time: "Day 1 · 6:12 PM" for minutes since Day 1 00:00. */
export function dayNightClockText(timeMin: number): string {
  const safe = Number.isFinite(timeMin) ? Math.max(0, Math.round(timeMin)) : 0;
  return `Day ${Math.floor(safe / 1440) + 1} · ${formatClock(safe)}`;
}

/** The badge icon's text alternative. */
export const DAY_NIGHT_ALT: Record<DayNight, string> = { day: 'Day', night: 'Night' };

/** A light line under a route on the dark map, so a dark blue leg stays as readable as by day. */
export const NIGHT_CASING: RGBA = [255, 255, 255, 220];
/** Pixels the casing is wider than its route (half on each side). */
export const NIGHT_CASING_EXTRA_PX = 3;
/** Only solid routes get a casing; faint commutes and dimmed routes (lower alpha) stay quiet. */
export const NIGHT_CASING_MIN_ALPHA = 200;

/**
 * The night map's layers: the same layers in the same order, each path layer preceded by a casing
 * layer for its solid routes. Nothing is recolored or dimmed, and casings are never pickable, so
 * hover and click behave as by day.
 */
export function withNightCasing(specs: LayerSpec[]): LayerSpec[] {
  const out: LayerSpec[] = [];
  for (const spec of specs) {
    if (spec.type === 'path') {
      const data: PathDatum[] = spec.data
        .filter((d) => d.color[3] >= NIGHT_CASING_MIN_ALPHA)
        .map((d) => ({ ...d, color: NIGHT_CASING, width: d.width + NIGHT_CASING_EXTRA_PX }));
      if (data.length > 0) {
        out.push({ type: 'path', id: `${spec.id}-night-casing`, data, props: { ...spec.props, pickable: false } });
      }
    }
    out.push(spec);
  }
  return out;
}
