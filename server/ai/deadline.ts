// The deliver-by of a parsed request against the run's planning window (#947), shared by both parsers
// (server/ai/ruleParser.ts, server/ai/geminiParser.ts) and POST /advise (server/api/v2/adviseRoutes.ts).
//
// The run plans from `settings.simStartMin` to `settings.simEndMin` (Day 1 15:30 to Day 2 12:00 in the default
// run). What a deliver-by outside that window means:
// - after the window end (up to the end of Day 2): it cannot be missed in the run, so it becomes the window end,
//   and a note says so: "Relay delivers by 12:00 PM tomorrow, ahead of your 5:00 PM deadline."
// - none at all: the window end, marked assumed: "No deliver-by time given, so Relay delivers by 12:00 PM tomorrow."
// - before the window start, at or before the ready time, or after the end of Day 2: still an error (the
//   parsers leave it null, /advise answers 400).
// Pure: no clock, no store, no network.
import type { ParseDraft, ParseRequestResponse } from '../../shared/v2/parseRequest';

const DAY_MIN = 1440;
/** The end of Day 2: the latest minute a request can name ("by midnight tomorrow"). */
export const LAST_MIN = 2 * DAY_MIN;

/** The run's planning window: `settings.simStartMin` and `settings.simEndMin`. */
export type PlanningWindow = { windowStartMin: number; windowEndMin: number };

/**
 * A parse answer with what the server filled in or changed (#947). Both fields are left out when empty, so an
 * answer for a sentence that says everything is the contract's `ParseRequestResponse` unchanged.
 */
export type ParseAnswer = ParseRequestResponse & {
  /** Plain sentences about what the server chose: a near-miss business name, a deliver-by moved or assumed. */
  note?: string;
  /** Draft fields the sentence did not say and the server filled in (`deadlineMin`: the window end). */
  assumed?: (keyof ParseDraft)[];
};

const two = (n: number) => String(n).padStart(2, '0');

/** "today" for Day 1, "tomorrow" for Day 2 (DECISIONS pass 80). */
const dayWord = (day: number) => (day <= 1 ? 'today' : day === 2 ? 'tomorrow' : `on Day ${day}`);

/** The minute as words, "12:00 PM tomorrow" or "5:00 PM"; the end of a day is "midnight". */
function timeParts(min: number): { clock: string; day: number } {
  const whole = Math.max(0, Math.round(min));
  if (whole > 0 && whole % DAY_MIN === 0) return { clock: 'midnight', day: whole / DAY_MIN };
  const day = Math.floor(whole / DAY_MIN) + 1;
  const rest = whole % DAY_MIN;
  const hour = Math.floor(rest / 60);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return { clock: `${h12}:${two(rest % 60)} ${hour < 12 ? 'AM' : 'PM'}`, day };
}

/** "12:00 PM tomorrow" for 2160, "6:00 PM today" for 1080. */
export function timeWithDay(min: number): string {
  const { clock, day } = timeParts(min);
  return `${clock} ${dayWord(day)}`;
}

/** "Relay delivers by 12:00 PM tomorrow, ahead of your 5:00 PM deadline." The day is said again only when it differs. */
export function clampedNote(askedMin: number, windowEndMin: number): string {
  const asked = timeParts(askedMin);
  const end = timeParts(windowEndMin);
  const yours = asked.day === end.day ? `your ${asked.clock} deadline` : `your deadline of ${asked.clock} ${dayWord(asked.day)}`;
  return `Relay delivers by ${timeWithDay(windowEndMin)}, ahead of ${yours}.`;
}

/** "No deliver-by time given, so Relay delivers by 12:00 PM tomorrow." */
export const assumedNote = (windowEndMin: number) => `No deliver-by time given, so Relay delivers by ${timeWithDay(windowEndMin)}.`;

export type SettledDeadline = {
  /** The deliver-by to use, or null when the one given is an error. */
  deadlineMin: number | null;
  /** True when none was given and the window end is used. */
  assumed: boolean;
  /** The sentence that says what was changed or assumed, or null. */
  note: string | null;
};

/**
 * The deliver-by to use for a request, given the one it states (or null) and its ready time.
 * `readyMin` null: the ready time is unknown, so only the window decides.
 */
export function settleDeadline(given: number | null, readyMin: number | null, window: PlanningWindow): SettledDeadline {
  const { windowStartMin: start, windowEndMin: end } = window;
  const readyOk = readyMin === null || readyMin < end;
  if (given === null) {
    return readyOk ? { deadlineMin: end, assumed: true, note: assumedNote(end) } : { deadlineMin: null, assumed: false, note: null };
  }
  const error = { deadlineMin: null, assumed: false, note: null };
  if (!Number.isInteger(given) || given < start || given > LAST_MIN) return error;
  if (readyMin !== null && given <= readyMin) return error;
  if (given <= end) return { deadlineMin: given, assumed: false, note: null };
  return readyOk ? { deadlineMin: end, assumed: false, note: clampedNote(given, end) } : error;
}

/** The answer with `note` and `assumed` added when there is something to say; the order of `ParseDraft` is kept. */
export function withNotes(answer: ParseRequestResponse, notes: readonly string[], assumed: readonly (keyof ParseDraft)[]): ParseAnswer {
  return {
    ...answer,
    ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
    ...(assumed.length > 0 ? { assumed: [...assumed] } : {}),
  };
}
