// Plugs the journey player (journeyPlay.ts) into the page body (#496, #648). It pauses on the
// Pause button, on Esc and Space (through the page's key map), when a timeline step is clicked and
// when the server clock starts playing (another tab); it resets when the selection or the run
// changes and on Back to start; it ends when a step fails, and stops on unmount.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SimControlRequest } from '../../../../../../shared/v2/schemas';
import type { Journey } from '../journey/journeyModel';
import {
  PLAY_IDLE, createJourneyPlayer, currentPlay, journeyWindows, playFromMin, syncJourneyPlayer,
  type JourneyPlayer, type PlaySync, type PlayState,
} from './journeyPlay';

export type JourneyPlay = {
  /** The state for the package and run on screen. */
  state: PlayState;
  /** From the start, or after a pause from where the clock is. */
  play: () => void;
  /** True when a running journey was paused. */
  pause: () => boolean;
  /** Back to idle (Back to start). */
  reset: () => void;
};

export type JourneyPlayInput = {
  control: (req: SimControlRequest) => Promise<unknown>;
  runId: string | null;
  clockPlaying: boolean;
  /** The polled clock's time: where Play goes on after a pause. */
  clockMin: number;
  /** The ID of the package in journey mode, or null. */
  shipmentId: string | null;
  /** The matched package's journey, or null (unmatched, pending, network mode). */
  journey: Journey | null;
};

export function useJourneyPlay({ control, runId, clockPlaying, clockMin, shipmentId, journey }: JourneyPlayInput): JourneyPlay {
  const [stored, setStored] = useState<PlayState>(PLAY_IDLE);
  const latest = useRef({ control, runId, clockPlaying, clockMin, journey });
  latest.current = { control, runId, clockPlaying, clockMin, journey };

  const ref = useRef<JourneyPlayer | null>(null);
  if (ref.current === null) {
    ref.current = createJourneyPlayer({
      control: (req) => latest.current.control(req),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      onChange: setStored,
    });
  }
  const player = ref.current;

  // Unmount.
  useEffect(() => () => player.dispose(), [player]);
  // Another package or a new run resets it; the clock starting to play pauses it (syncJourneyPlayer).
  const seen = useRef<PlaySync | null>(null);
  useEffect(() => {
    const now = { shipmentId, runId, clockPlaying };
    syncJourneyPlayer(player, seen.current, now);
    seen.current = now;
  }, [player, shipmentId, runId, clockPlaying]);

  // Stable, so the page's key hook and the handlers keep the same functions across polls.
  const play = useCallback(() => {
    const { journey: j, runId: run, clockPlaying: playing, clockMin: now } = latest.current;
    if (!j || !run) return;
    const windows = journeyWindows(j);
    const state = currentPlay(player.state(), j.shipmentId, run);
    player.start({
      shipmentId: j.shipmentId, runId: run, windows, fromMin: playFromMin(state, windows, now), clockPlaying: playing,
    });
  }, [player]);
  const pause = useCallback(() => player.pause(), [player]);
  const reset = useCallback(() => player.reset(), [player]);

  return { state: currentPlay(stored, shipmentId, runId), play, pause, reset };
}
