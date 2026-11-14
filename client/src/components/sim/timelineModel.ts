import type { Employee, Hub, Shipment, SimEvent } from '../../../../shared/types';
import { formatMin } from '../../ui/format';

export type TimelineRow = {
  id: string;
  timeLabel: string;
  text: string;
  state: 'done' | 'next' | 'upcoming';
};

function eventText(
  e: SimEvent,
  shipments: Map<string, Shipment>,
  employees: Map<string, Employee>,
  hubs: Map<string, Hub>,
): string {
  const who = employees.get(e.employeeId)?.name ?? 'A courier';
  const label = shipments.get(e.shipmentId)?.label;
  const pkg = label ? `“${label}”` : 'a package';
  const hub = (e.hubId && hubs.get(e.hubId)?.name) || 'a hub';
  switch (e.kind) {
    case 'pickup': return `${who} picked up ${pkg}`;
    case 'hub_drop': return `${who} dropped ${label ? 'it' : pkg} at ${hub}`;
    case 'hub_pickup': return `${who} collected ${label ? 'it' : pkg} from ${hub}`;
    case 'delivered': return `${who} delivered ${label ? 'it' : pkg}`;
  }
}

export function toTimelineRows(
  events: SimEvent[],
  timeMin: number,
  shipments: Shipment[],
  employees: Employee[],
  hubs: Hub[],
): TimelineRow[] {
  const s = new Map(shipments.map((x) => [x.id, x]));
  const em = new Map(employees.map((x) => [x.id, x]));
  const h = new Map(hubs.map((x) => [x.id, x]));
  let nextMin: number | undefined;
  for (const e of events) {
    if (e.timeMin > timeMin && (nextMin === undefined || e.timeMin < nextMin)) nextMin = e.timeMin;
  }
  return events.map((e) => ({
    id: e.id,
    timeLabel: formatMin(e.timeMin),
    text: eventText(e, s, em, h),
    state: e.timeMin <= timeMin ? 'done' : e.timeMin === nextMin ? 'next' : 'upcoming',
  }));
}

// ---------- Scrubber model ----------
export type ScrubWindow = { simStartMin: number; simEndMin: number };
/** Contract defaults (spec §7): Day 1 15:30 to Day 2 12:00. */
export const DEFAULT_SCRUB_WINDOW: ScrubWindow = { simStartMin: 930, simEndMin: 2160 };
export const SMALL_STEP_MIN = 5;
export const LARGE_STEP_MIN = 60;
const DAY_MIN = 1440;

/** Clamp to the window and round to an integer minute; non-finite falls back to the start. */
export function clampSeek(raw: number, w: ScrubWindow): number {
  if (!Number.isFinite(raw)) return w.simStartMin;
  return Math.min(w.simEndMin, Math.max(w.simStartMin, Math.round(raw)));
}

/**
 * Slider key -> target minute (Left/Right 5 min, PageUp/Down 60 min, Home/End edges).
 * null when the key is not a scrub key, has a modifier, or the target equals the current time.
 */
export function scrubKeyTarget(
  key: string, current: number, w: ScrubWindow,
  mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {},
): number | null {
  if (mods.ctrlKey || mods.metaKey || mods.altKey || mods.shiftKey) return null;
  let raw: number;
  switch (key) {
    case 'ArrowLeft': raw = current - SMALL_STEP_MIN; break;
    case 'ArrowRight': raw = current + SMALL_STEP_MIN; break;
    case 'PageDown': raw = current - LARGE_STEP_MIN; break;
    case 'PageUp': raw = current + LARGE_STEP_MIN; break;
    case 'Home': raw = w.simStartMin; break;
    case 'End': raw = w.simEndMin; break;
    default: return null;
  }
  const t = clampSeek(raw, w);
  return t === clampSeek(current, w) ? null : t;
}

const KIND_NAME: Record<SimEvent['kind'], string> = {
  pickup: 'Pickup', hub_drop: 'Hub drop-off', hub_pickup: 'Hub pickup', delivered: 'Delivered',
};

export type ScrubTick = { timeMin: number; pct: number; count: number; title: string };

/** Position of a minute inside the window, 0..100. */
export function scrubPct(min: number, w: ScrubWindow): number {
  const span = w.simEndMin - w.simStartMin;
  if (span <= 0) return 0;
  return ((clampSeek(min, w) - w.simStartMin) / span) * 100;
}

/** One tick per distinct minute; the title names every event type and package at that minute. */
export function toScrubTicks(events: SimEvent[], shipments: Shipment[], w: ScrubWindow): ScrubTick[] {
  const labels = new Map(shipments.map((s) => [s.id, s.label]));
  const byMin = new Map<number, SimEvent[]>();
  for (const e of events) {
    if (!Number.isFinite(e.timeMin) || e.timeMin < w.simStartMin || e.timeMin > w.simEndMin) continue;
    const m = Math.round(e.timeMin);
    byMin.set(m, [...(byMin.get(m) ?? []), e]);
  }
  return [...byMin.entries()].sort((a, b) => a[0] - b[0]).map(([m, list]) => ({
    timeMin: m,
    pct: scrubPct(m, w),
    count: list.length,
    title: `${formatMin(m)}: ${list
      .map((e) => `${KIND_NAME[e.kind]} – ${labels.get(e.shipmentId) ?? 'a package'}`).join('; ')}`,
  }));
}

export type ScrubLabel = { text: string; pct: number; kind: 'day' | 'gap' };

/** "Day 1" at the window start, "Day 2" at midnight, and an "Overnight" label between the last Day 1 and first Day 2 event. */
export function toScrubLabels(events: SimEvent[], w: ScrubWindow): ScrubLabel[] {
  const out: ScrubLabel[] = [];
  const inWin = events.map((e) => e.timeMin).filter((m) => Number.isFinite(m) && m >= w.simStartMin && m <= w.simEndMin);
  const day = (min: number) => Math.floor(min / DAY_MIN) + 1;
  out.push({ text: `Day ${day(w.simStartMin)}`, pct: 0, kind: 'day' });
  for (let d = day(w.simStartMin) + 1; (d - 1) * DAY_MIN <= w.simEndMin; d++) {
    const at = (d - 1) * DAY_MIN;
    if (at > w.simStartMin) out.push({ text: `Day ${d}`, pct: scrubPct(at, w), kind: 'day' });
  }
  const before = inWin.filter((m) => m < DAY_MIN);
  const after = inWin.filter((m) => m >= DAY_MIN);
  if (before.length > 0 && after.length > 0) {
    const a = Math.max(...before);
    const b = Math.min(...after);
    out.push({ text: 'Overnight', pct: (scrubPct(a, w) + scrubPct(b, w)) / 2, kind: 'gap' });
  }
  return out;
}

/** Coalesce seeks: at most one send per animation frame, always the latest value. */
export function createFrameSeeker(
  send: (timeMin: number) => void,
  raf: (cb: () => void) => number,
  cancel: (id: number) => void,
) {
  let pending: number | null = null;
  let handle: number | null = null;
  const flush = () => {
    handle = null;
    if (pending === null) return;
    const t = pending;
    pending = null;
    send(t);
  };
  return {
    push(t: number) { pending = t; if (handle === null) handle = raf(flush); },
    /** Send right away (key press / release), dropping anything queued. */
    now(t: number) {
      if (handle !== null) { cancel(handle); handle = null; }
      pending = null;
      send(t);
    },
    cancel() { if (handle !== null) cancel(handle); handle = null; pending = null; },
  };
}
