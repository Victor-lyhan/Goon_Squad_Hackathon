// Plugs the journey player (journeyPlay.ts) into the page body (#496, #648). It pauses on the
// Pause button, on Esc and Space (through the page's key map), when a timeline step is clicked and
// when the server clock starts playing (another tab); it resets when the selection or the run
// changes and on Back to start; it ends when a step fails, and stops on unmount.
// #790: with no package picked the same player plays every carrier's commute (network Play), from
// the clock's minute, over `networkWindows` of the polled response.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SimulatorResponse } from '../../../../../../shared/v2/api';
import type { SimControlRequest } from '../../../../../../shared/v2/schemas';
import type { Journey } from '../journey/journeyModel';
import {
  PLAY_IDLE, createJourneyPlayer, currentPlay, journeyWindows, networkWindows, playFromMin, syncJourneyPlayer,
  type JourneyPlayer, type PlaySync, type PlayState,
} from './journeyPlay';

export type JourneyPlay = {
  /** The state for the package and run on screen. */
  state: PlayState;
  /**
   * A package picked: its journey from the start, or after a pause from where the clock is. No package:
   * every carrier's commute from where the clock is (#790).
   */
  play: () => void;
  /** True when a running journey or network Play was paused. */
  pause: () => boolean;
  /** Back to idle (Back to start). */
  reset: () => void;
  /**
   * #725: Play from the start was pressed and its first step has not landed yet, so the timeline still
   * shows the moment before (a delivered package reads "Journey complete"). The step line waits for it.
   */
  settling: boolean;
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
  /** The polled response's plans and trips, for network Play's windows; null before the first poll. */
  network?: Pick<SimulatorResponse, 'plans' | 'trips'> | null;
  /** The minute the run ends: network Play's last jump lands there. */
  endMin?: number;
};

export function useJourneyPlay({
  control, runId, clockPlaying, clockMin, shipmentId, journey, network = null, endMin = Infinity,
}: JourneyPlayInput): JourneyPlay {
  const [stored, setStored] = useState<PlayState>(PLAY_IDLE);
  // The clock's time when Play started from the start; null once the clock moved (the first step landed)
  // or when Play went on after a pause. Adjusted during render, so no frame announces the old moment.
  const [startedAtMin, setStartedAtMin] = useState<number | null>(null);
  if (startedAtMin !== null && clockMin !== startedAtMin) setStartedAtMin(null);
  const latest = useRef({ control, runId, clockPlaying, clockMin, journey, shipmentId, network, endMin });
  latest.current = { control, runId, clockPlaying, clockMin, journey, shipmentId, network, endMin };

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
    const { journey: j, runId: run, clockPlaying: playing, clockMin: now, shipmentId: picked, network: net, endMin: end } = latest.current;
    if (!run) return;
    if (picked === null) {
      if (!net) return;
      setStartedAtMin(null);
      player.start({ shipmentId: null, runId: run, windows: networkWindows(net, end), fromMin: now, clockPlaying: playing });
      return;
    }
    if (!j) return;
    const windows = journeyWindows(j);
    const state = currentPlay(player.state(), j.shipmentId, run);
    const fromMin = playFromMin(state, windows, now);
    setStartedAtMin(fromMin === -Infinity ? now : null);
    player.start({ shipmentId: j.shipmentId, runId: run, windows, fromMin, clockPlaying: playing });
  }, [player]);
  const pause = useCallback(() => player.pause(), [player]);
  const reset = useCallback(() => player.reset(), [player]);

  const state = currentPlay(stored, shipmentId, runId);
  return { state, play, pause, reset, settling: state.status === 'running' && startedAtMin === clockMin };
}
