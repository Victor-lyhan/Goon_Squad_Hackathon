// Pure clock logic (spec §7). Owner: agent:victor-1.
// No timers, no Date.now(): the setInterval timer and the control route only call these.
import type { Clock, Settings, SimEvent } from '../shared/types';
import type { SimControlRequest } from '../shared/schemas';

const DAY2_START_MIN = 1440;
const MORNING_LEAD_MIN = 5;
const MORNING_FALLBACK_MIN = 1860;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function advanceClock(clock: Clock, elapsedMs: number, settings: Settings): Clock {
  if (!clock.playing) return clock;
  const next = clock.timeMin + Math.floor((clock.speed * elapsedMs) / 1000);
  if (next >= settings.simEndMin) {
    return { ...clock, timeMin: settings.simEndMin, playing: false };
  }
  return { ...clock, timeMin: next };
}

export function applyControl(
  clock: Clock,
  req: SimControlRequest,
  events: SimEvent[],
  settings: Settings,
): Clock {
  switch (req.action) {
    case 'play':
      // The only control that locks the run.
      return { ...clock, phase: 'locked', playing: true };
    case 'pause':
      return { ...clock, playing: false };
    case 'speed':
      return { ...clock, speed: req.speed };
    case 'seek':
      return { ...clock, timeMin: clamp(req.timeMin, settings.simStartMin, settings.simEndMin) };
    case 'next_event': {
      let next: number | undefined;
      for (const e of events) {
        if (e.timeMin > clock.timeMin && (next === undefined || e.timeMin < next)) next = e.timeMin;
      }
      if (next === undefined) return clock;
      return { ...clock, timeMin: clamp(next, settings.simStartMin, settings.simEndMin) };
    }
    case 'jump_to_morning': {
      let first: number | undefined;
      for (const e of events) {
        if (e.timeMin >= DAY2_START_MIN && (first === undefined || e.timeMin < first)) first = e.timeMin;
      }
      const target = first === undefined ? MORNING_FALLBACK_MIN : first - MORNING_LEAD_MIN;
      return {
        ...clock,
        timeMin: clamp(Math.max(target, clock.timeMin), settings.simStartMin, settings.simEndMin),
      };
    }
    case 'finish':
      return { ...clock, timeMin: settings.simEndMin, playing: false };
    case 'reset_playback':
      // "Back to start" is the way out of `locked` (#734): the app has no other control that unlocks.
      // Only the clock changes; the caller keeps plans, jobs and the runId as they are.
      return { ...clock, phase: 'planning', timeMin: settings.simStartMin, playing: false };
  }
}
