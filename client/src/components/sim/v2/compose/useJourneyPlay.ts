// Plugs the Play journey player (journeyPlay.ts) into the page body (#496). It stops on Stop, on
// Esc (through the page's key map), when the selection or the run changes, when the server clock
// starts playing (another tab, or Play here), when a step fails, and on unmount.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SimControlRequest } from '../../../../../../shared/v2/schemas';
import type { Journey } from '../journey/journeyModel';
import {
  PLAY_IDLE, createJourneyPlayer, currentPlay, journeyWindows, syncJourneyPlayer,
  type JourneyPlayer, type PlaySync, type PlayState,
} from './journeyPlay';

export type JourneyPlay = {
  /** The state for the package and run on screen. */
  state: PlayState;
  play: () => void;
  /** True when a running journey was stopped. */
  stop: () => boolean;
};

export type JourneyPlayInput = {
  control: (req: SimControlRequest) => Promise<unknown>;
  runId: string | null;
  clockPlaying: boolean;
  /** The ID of the package in journey mode, or null. */
  shipmentId: string | null;
  /** The matched package's journey, or null (unmatched, pending, network mode). */
  journey: Journey | null;
};

export function useJourneyPlay({ control, runId, clockPlaying, shipmentId, journey }: JourneyPlayInput): JourneyPlay {
  const [stored, setStored] = useState<PlayState>(PLAY_IDLE);
  const latest = useRef({ control, runId, clockPlaying, journey });
  latest.current = { control, runId, clockPlaying, journey };

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
  // Another package or a new run resets it; the clock starting to play stops it (syncJourneyPlayer).
  const seen = useRef<PlaySync | null>(null);
  useEffect(() => {
    const now = { shipmentId, runId, clockPlaying };
    syncJourneyPlayer(player, seen.current, now);
    seen.current = now;
  }, [player, shipmentId, runId, clockPlaying]);

  // Stable, so the page's Esc hook and the handlers keep the same functions across polls.
  const play = useCallback(() => {
    const { journey: j, runId: run, clockPlaying: playing } = latest.current;
    if (!j || !run) return;
    player.start({ shipmentId: j.shipmentId, runId: run, windows: journeyWindows(j), clockPlaying: playing });
  }, [player]);
  const stop = useCallback(() => player.stop(), [player]);

  return { state: currentPlay(stored, shipmentId, runId), play, stop };
}
