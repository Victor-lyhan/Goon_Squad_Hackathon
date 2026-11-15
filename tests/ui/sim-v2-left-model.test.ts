// The simulator's one Play/Pause button, as pure data (#648, DECISIONS pass 63): the requests the
// server clock gets, and what the button shows and does for each page state. #790: with no package
// picked Play steps with seeks (network Play), so no `play` or `speed` request is left here.
import { describe, expect, it } from 'vitest';
import {
  BUSY_REASON, FINISHED_REASON, PAUSE_REQUEST, RESET_LABEL, RESET_REQUEST, isRunFinished, resetDisabledReason,
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
  it('every request is a valid SimControlRequest: pause and Back to start only (#790: no play, no speed)', () => {
    const all = [PAUSE_REQUEST, RESET_REQUEST];
    expect(all.map((r) => r.action)).toEqual(['pause', 'reset_playback']);
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
      // #790: network Play steps with seeks; the fixed clock speed and its requests are gone.
      'PLAY_SPEED', 'playClockRequests',
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

  it('no package: Play plays every commute (network Play, #790); a clock playing on its own reads Pause and is paused', () => {
    expect(view()).toEqual({ label: 'Play', action: 'play_network', note: null });
    expect(view({ clock: clock({ playing: true, phase: 'locked' }) })).toEqual({ label: 'Pause', action: 'pause_clock', note: null });
  });

  it('no package: running network Play reads Pause (also while the overnight card is up); paused, finished and failed read Play', () => {
    const network = { shipmentId: null, runId: 'run-1' };
    for (const overnight of [false, true]) {
      expect(view({ play: { status: 'running', overnight, ...network } })).toEqual({ label: 'Pause', action: 'pause_journey', note: null });
    }
    for (const status of ['paused', 'finished', 'failed'] as const) {
      expect(view({ play: { status, ...network } })).toEqual({ label: 'Play', action: 'play_network', note: null });
    }
    // Finished at the end of the run: the button is disabled and names Back to start.
    expect(view({ play: { status: 'finished', ...network }, clock: clock({ timeMin: 2160 }) })).toEqual({ label: 'Play', action: null, note: FINISHED_REASON });
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
