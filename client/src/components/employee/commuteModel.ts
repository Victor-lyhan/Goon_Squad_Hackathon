import { PutCommuteRequest } from '../../../../shared/schemas';
import type { Employee } from '../../../../shared/types';

export const DEFAULT_MAX_EXTRA_MIN = 8;
const DAY = 1440;

export type CommuteForm = {
  businessId: string;
  homeNodeId: string;
  eveningTime: string; // HH:MM on Day 1
  morningTime: string; // HH:MM on Day 2
  availableEvening: boolean;
  availableMorning: boolean;
  maxExtraMin: number;
  eveningViaNodeIds: string[];
  morningViaNodeIds: string[];
};

/** Minutes -> "HH:MM" (day-of-minute; Day 2 values wrap into 00:00-23:59). */
export function minToTimeInput(min: number): string {
  const m = ((Math.round(min) % DAY) + DAY) % DAY;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** "HH:MM" -> minutes within a day (0..1439); NaN when malformed. */
export function timeInputToMin(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return NaN;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return NaN;
  return h * 60 + m;
}

export function emptyForm(businessId = ''): CommuteForm {
  return {
    businessId,
    homeNodeId: '',
    eveningTime: '17:30',
    morningTime: '07:45',
    availableEvening: true,
    availableMorning: true,
    maxExtraMin: DEFAULT_MAX_EXTRA_MIN,
    eveningViaNodeIds: [],
    morningViaNodeIds: [],
  };
}

export function toForm(e: Employee): CommuteForm {
  return {
    businessId: e.businessId,
    homeNodeId: e.homeNodeId,
    eveningTime: minToTimeInput(e.eveningDepartureMin),
    morningTime: minToTimeInput(e.morningDepartureMin),
    availableEvening: e.availableEvening,
    availableMorning: e.availableMorning,
    maxExtraMin: e.maxExtraMin,
    eveningViaNodeIds: [...e.eveningViaNodeIds],
    morningViaNodeIds: [...e.morningViaNodeIds],
  };
}

export function toRequest(f: CommuteForm): PutCommuteRequest {
  return {
    businessId: f.businessId,
    homeNodeId: f.homeNodeId,
    eveningDepartureMin: timeInputToMin(f.eveningTime),
    morningDepartureMin: timeInputToMin(f.morningTime) + DAY,
    availableEvening: f.availableEvening,
    availableMorning: f.availableMorning,
    maxExtraMin: f.maxExtraMin,
    eveningViaNodeIds: [...f.eveningViaNodeIds],
    morningViaNodeIds: [...f.morningViaNodeIds],
  };
}

const FIELD_MAP: Record<string, string> = {
  eveningDepartureMin: 'eveningDepartureMin',
  morningDepartureMin: 'morningDepartureMin',
};

/** Field errors keyed by request field name (empty object when valid). */
export function validate(f: CommuteForm): Record<string, string> {
  const result = PutCommuteRequest.safeParse(toRequest(f));
  if (result.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const head = String(issue.path[0] ?? 'form');
    const key = FIELD_MAP[head] ?? head;
    if (!(key in errors)) errors[key] = issue.message;
  }
  return errors;
}

export const MAX_WAYPOINTS = 3;
export type WaypointDirection = 'evening' | 'morning';
export const WAYPOINT_LIMIT_MESSAGE = 'Up to 3 waypoints';

const viaKey = (d: WaypointDirection) => (d === 'evening' ? 'eveningViaNodeIds' : 'morningViaNodeIds') as
  'eveningViaNodeIds' | 'morningViaNodeIds';

/** Appends a waypoint; returns the same form plus `error` when the cap is hit. Duplicates of the last stop are ignored. */
export function addWaypoint(
  f: CommuteForm, dir: WaypointDirection, nodeId: string,
): { form: CommuteForm; error?: string } {
  const k = viaKey(dir);
  const list = f[k];
  if (list.length >= MAX_WAYPOINTS) return { form: f, error: WAYPOINT_LIMIT_MESSAGE };
  if (list[list.length - 1] === nodeId) return { form: f };
  return { form: { ...f, [k]: [...list, nodeId] } };
}

export function removeWaypoint(f: CommuteForm, dir: WaypointDirection, index: number): CommuteForm {
  const k = viaKey(dir);
  return { ...f, [k]: f[k].filter((_, i) => i !== index) };
}

export function clearWaypoints(f: CommuteForm, dir: WaypointDirection): CommuteForm {
  return { ...f, [viaKey(dir)]: [] };
}

export const SAVED_TEXT = 'Saved. Available for matching.';
export const LOCKED_TEXT = 'Planning is locked. To change your commute, press "Start new planning cycle" in the simulator Setup drawer.';

/** "3 waiting packages were matched to your route." or '' when none. */
export function rematchedText(n: number): string {
  if (n <= 0) return '';
  return `${n} waiting ${n === 1 ? 'package was' : 'packages were'} matched to your route.`;
}
