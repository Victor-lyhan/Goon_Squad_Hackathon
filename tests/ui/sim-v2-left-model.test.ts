// The simulator's one Play/Pause button, as pure data (#648, DECISIONS pass 63): the requests the
// server clock gets, and what the button shows and does for each page state.
import { describe, expect, it } from 'vitest';
import {
  BUSY_REASON, FINISHED_REASON, PAUSE_REQUEST, PLAY_SPEED, RESET_LABEL, RESET_REQUEST, isRunFinished,
  playClockRequests, resetDisabledReason,
} from '../../client/src/components/sim/v2/controls/controlsModel';
import * as controlsModel from '../../client/src/components/sim/v2/controls/controlsModel';
import {
  NO_JOURNEY_TEXT, PLAY_IDLE, playButtonView, type PlayButtonInput, type PlayState,
} from '../../client/src/components/sim/v2/compose/journeyPlay';
import type { Journey, UnmatchedJourney } from '../../client/src/components/sim/v2/journey/journeyModel';
import { SimControlRequest } from '../../shared/v2/schemas';
import type { Clock } from '../../shared/v2/types';

const SIM_END = 2160;
const clock = (over: Partial<Clock> = {}): Clock => ({ phase: 'planning', playing: false, timeMin: 930, speed: 120, ...over });

describe('server clock requests', () => {
  it('Play at the fixed speed is one request', () => {
    expect(PLAY_SPEED).toBe(120);
    expect(playClockRequests(clock({ speed: 120 }))).toEqual([{ action: 'play' }]);
  });

  it('a clock left at another speed gets `speed` 120 once, then play', () => {
    for (const speed of [30, 600] as const) {
      expect(playClockRequests(clock({ speed }))).toEqual([{ action: 'speed', speed: 120 }, { action: 'play' }]);
    }
  });

  it('every request is a valid SimControlRequest', () => {
    const all = [...playClockRequests(clock({ speed: 30 })), PAUSE_REQUEST, RESET_REQUEST];
    expect(all.map((r) => r.action)).toEqual(['speed', 'play', 'pause', 'reset_playback']);
    for (const req of all) expect(SimControlRequest.parse(req)).toEqual(req);
  });

  it('the run is finished at simEndMin, not before', () => {
    expect(isRunFinished(clock({ timeMin: 2159 }), SIM_END)).toBe(false);
    expect(isRunFinished(clock({ timeMin: 2160 }), SIM_END)).toBe(true);
  });

  it('Back to start is disabled only while another control is open', () => {
    expect(RESET_LABEL).toBe('Back to start');
    expect(resetDisabledReason(false)).toBeNull();
    expect(resetDisabledReason(true)).toBe(BUSY_REASON);
  });

  it('the speed, scrubber, step, scenario and planning helpers are gone', () => {
    const gone = [
      'SPEED_OPTIONS', 'speedRequest', 'playbackRequest', 'toPlaybackView', 'scrubDrag', 'scrubRelease', 'scrubShown',
      'minToScrub', 'scrubToMin', 'validateScenario', 'toScenarioForm', 'toPlanningView', 'NO_NEXT_EVENT_REASON',
      'PAST_MORNING_REASON', 'LOCKED_RECOMPUTE_REASON',
    ];
    for (const name of gone) expect(controlsModel, name).not.toHaveProperty(name);
  });
});

describe('the one Play/Pause button', () => {
  const journey = { kind: 'journey', shipmentId: 'shp-1' } as Journey;
  const unmatched: UnmatchedJourney = { kind: 'unmatched', shipmentId: 'shp-2', title: 'Box', reason: 'No commute fits.' };
  const target = { shipmentId: 'shp-1', runId: 'run-1' };
  const view = (over: Partial<PlayButtonInput> = {}) =>
    playButtonView({ packagePicked: false, journey: null, play: PLAY_IDLE, clock: clock(), busy: false, simEndMin: SIM_END, ...over });
  const picked = (over: Partial<PlayButtonInput> = {}) => view({ packagePicked: true, journey, ...over });

  it('no package: Play plays the server clock, Pause pauses it', () => {
    expect(view()).toEqual({ label: 'Play', action: 'play_clock', note: null });
    expect(view({ clock: clock({ playing: true, phase: 'locked' }) })).toEqual({ label: 'Pause', action: 'pause_clock', note: null });
  });

  it('no package, run finished: disabled, and the note names Back to start', () => {
    expect(view({ clock: clock({ timeMin: 2160, phase: 'locked' }) })).toEqual({ label: 'Play', action: null, note: FINISHED_REASON });
    expect(FINISHED_REASON).toContain('Back to start');
  });

  it('no package, another control open: disabled with the busy reason, playing or not', () => {
    expect(view({ busy: true })).toEqual({ label: 'Play', action: null, note: BUSY_REASON });
    expect(view({ busy: true, clock: clock({ playing: true }) })).toEqual({ label: 'Pause', action: null, note: BUSY_REASON });
  });

  it('package picked: Play plays its journey; a running journey reads Pause', () => {
    expect(picked()).toEqual({ label: 'Play', action: 'play_journey', note: null });
    for (const overnight of [false, true]) {
      const play: PlayState = { status: 'running', overnight, ...target };
      expect(picked({ play })).toEqual({ label: 'Pause', action: 'pause_journey', note: null });
    }
  });

  it('package picked: paused, finished and failed all read Play again', () => {
    for (const status of ['paused', 'finished', 'failed'] as const) {
      expect(picked({ play: { status, ...target } })).toEqual({ label: 'Play', action: 'play_journey', note: null });
    }
  });

  it('package picked: the journey plays at the end of the run and while another control is open (seeks are quiet)', () => {
    expect(picked({ clock: clock({ timeMin: 2160 }) }).action).toBe('play_journey');
    expect(picked({ busy: true }).action).toBe('play_journey');
  });

  it('package picked while the server clock plays: Pause pauses the clock', () => {
    expect(picked({ clock: clock({ playing: true }) })).toEqual({ label: 'Pause', action: 'pause_clock', note: null });
  });

  it('an unmatched package has nothing to play and says so; a pending or unknown one is just disabled', () => {
    expect(view({ packagePicked: true, journey: unmatched })).toEqual({ label: 'Play', action: null, note: NO_JOURNEY_TEXT });
    expect(view({ packagePicked: true, journey: null })).toEqual({ label: 'Play', action: null, note: null });
  });
});
