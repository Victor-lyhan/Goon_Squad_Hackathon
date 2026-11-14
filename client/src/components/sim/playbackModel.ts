import type { Clock, Settings } from '../../../../shared/types';
import { formatMin } from './simFormat';

export type Speed = Clock['speed'];
export const SPEEDS: readonly Speed[] = [30, 120, 600];

export type PlaybackModel = {
  timeLabel: string;
  playLabel: 'Play' | 'Pause';
  speed: Speed;
  disabled: {
    play: boolean;
    speed: boolean;
    nextEvent: boolean;
    jumpToMorning: boolean;
    finish: boolean;
    reset: boolean;
  };
};

export function toPlaybackModel(
  clock: Clock,
  nextEventMin: number | null,
  settings: Pick<Settings, 'simStartMin' | 'simEndMin'>,
  busy = false,
): PlaybackModel {
  const atEnd = clock.timeMin >= settings.simEndMin;
  return {
    timeLabel: formatMin(clock.timeMin),
    playLabel: clock.playing ? 'Pause' : 'Play',
    speed: clock.speed,
    disabled: {
      // Pausing stays possible while running; Play is pointless at the end.
      play: busy || (!clock.playing && atEnd),
      speed: busy,
      nextEvent: busy || nextEventMin === null,
      jumpToMorning: busy,
      finish: busy || atEnd,
      reset: busy,
    },
  };
}
