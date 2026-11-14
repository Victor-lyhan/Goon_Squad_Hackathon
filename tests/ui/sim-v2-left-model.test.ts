import { describe, expect, it } from 'vitest';
import {
  BUSY_REASON, FINISHED_REASON, LOCKED_RECOMPUTE_REASON, NO_NEXT_EVENT_REASON, PAST_MORNING_REASON, SCENARIO_FIELDS,
  SCENARIO_FIELD_INFO, SCRUB_IDLE, SPEED_OPTIONS, initScenarioState, minToScrub, playbackRequest, scrubDrag,
  scrubRelease, scrubShown, scrubToMin, speedRequest, syncScenarioState, toPlanningView, toPlaybackView,
  toScenarioForm, validateScenario, type ScenarioForm,
} from '../../client/src/components/sim/v2/controls/controlsModel';
import { GenerateScenarioRequest, SimControlRequest } from '../../shared/v2/schemas';
import type { Clock } from '../../shared/v2/types';

const W = { simStartMin: 930, simEndMin: 2160 };
const clock = (over: Partial<Clock> = {}): Clock => ({ phase: 'planning', playing: false, timeMin: 930, speed: 120, ...over });

describe('playback requests', () => {
  it('each control maps to one valid SimControlRequest', () => {
    const cases: [ReturnType<typeof playbackRequest>, SimControlRequest][] = [
      [playbackRequest('playPause', clock({ playing: false })), { action: 'play' }],
      [playbackRequest('playPause', clock({ playing: true, phase: 'locked' })), { action: 'pause' }],
      [playbackRequest('nextEvent', clock()), { action: 'next_event' }],
      [playbackRequest('jumpToMorning', clock()), { action: 'jump_to_morning' }],
      [playbackRequest('finish', clock()), { action: 'finish' }],
      [playbackRequest('reset', clock()), { action: 'reset_playback' }],
      [speedRequest(30), { action: 'speed', speed: 30 }],
      [speedRequest(120), { action: 'speed', speed: 120 }],
      [speedRequest(600), { action: 'speed', speed: 600 }],
    ];
    for (const [got, want] of cases) {
      expect(got).toEqual(want);
      expect(SimControlRequest.parse(got)).toEqual(want);
    }
  });

  it('offers exactly the three schema speeds with labels and a real-meaning title', () => {
    expect(SPEED_OPTIONS.map((o) => o.speed)).toEqual([30, 120, 600]);
    expect(SPEED_OPTIONS.map((o) => o.label)).toEqual(['1x', '4x', '20x']);
    for (const o of SPEED_OPTIONS) expect(o.title).toBe(`${o.speed} simulated minutes per second`);
  });
});

describe('scrubber conversion', () => {
  it('is exact at simStartMin, simEndMin and Day 2 08:30 (1950)', () => {
    for (const m of [W.simStartMin, W.simEndMin, 1950]) {
      expect(minToScrub(m, W)).toBe(m);
      expect(scrubToMin(String(minToScrub(m, W)), W)).toBe(m);
      expect(scrubToMin(minToScrub(m, W), W)).toBe(m);
    }
  });

  it('clamps, rounds and never returns NaN', () => {
    expect(scrubToMin('9999', W)).toBe(2160);
    expect(scrubToMin('-4', W)).toBe(930);
    expect(scrubToMin('1950.4', W)).toBe(1950);
    expect(scrubToMin('', W)).toBe(930);
    expect(scrubToMin('abc', W)).toBe(930);
    expect(minToScrub(Number.NaN, W)).toBe(930);
  });
});

describe('scrubber drag vs poll (DECISIONS pass 43)', () => {
  it('a poll during a drag keeps the drag value; after release the next poll wins', () => {
    const c1 = clock({ phase: 'locked', playing: true, timeMin: 1000 });
    let s = scrubDrag('1950', W);
    expect(scrubShown(s, c1, W)).toBe(1950);

    // Poll arrives mid-drag with a new time: thumb stays put.
    const c2 = { ...c1, timeMin: 1010 };
    expect(scrubShown(s, c2, W)).toBe(1950);

    // Release sends exactly one seek and keeps the value until a new clock arrives.
    const r = scrubRelease(s, c2, W);
    expect(r.request).toEqual({ action: 'seek', timeMin: 1950 });
    expect(SimControlRequest.parse(r.request)).toEqual(r.request);
    s = r.state;
    expect(scrubShown(s, c2, W)).toBe(1950);

    // Next poll: its time wins.
    const c3 = { ...c2, timeMin: 1952 };
    expect(scrubShown(s, c3, W)).toBe(1952);
    const c4 = { ...c2, timeMin: 1011 };
    expect(scrubShown(s, c4, W)).toBe(1011);
  });

  it('idle follows the clock; release without a drag or at the same minute sends nothing', () => {
    const c = clock({ timeMin: 1200 });
    expect(scrubShown(SCRUB_IDLE, c, W)).toBe(1200);
    expect(scrubRelease(SCRUB_IDLE, c, W)).toEqual({ state: SCRUB_IDLE, request: null });
    const same = scrubRelease(scrubDrag('1200', W), c, W);
    expect(same.request).toBeNull();
    expect(same.state).toEqual(SCRUB_IDLE);
    // A second release (blur after pointer up) does not send again.
    const first = scrubRelease(scrubDrag('1300', W), c, W);
    expect(scrubRelease(first.state, c, W).request).toBeNull();
  });
});

describe('playback view', () => {
  it('planning: Play, title says it locks, only Next event needs an event', () => {
    const v = toPlaybackView(clock(), W, null);
    expect(v.playLabel).toBe('Play');
    expect(v.playTitle).toMatch(/locks the run/);
    expect(v.disabled).toEqual({ nextEvent: NO_NEXT_EVENT_REASON });
    expect(v.reasons).toEqual([NO_NEXT_EVENT_REASON]);
    expect(v.timeLabel).toBe('Day 1, 3:30 PM');
  });

  it('finished: Play, Finish, Next event and Jump to morning disabled with the finished reason; Reset enabled', () => {
    const v = toPlaybackView(clock({ phase: 'locked', timeMin: 2160 }), W, null);
    expect(v.finished).toBe(true);
    expect(v.disabled).toEqual({ play: FINISHED_REASON, nextEvent: FINISHED_REASON, jumpToMorning: FINISHED_REASON, finish: FINISHED_REASON });
    expect(v.reasons).toEqual([FINISHED_REASON]);
  });

  it('past the morning: Jump to morning gives its reason', () => {
    const v = toPlaybackView(clock({ phase: 'locked', playing: true, timeMin: 1950 }), W, 1980);
    expect(v.playLabel).toBe('Pause');
    expect(v.disabled).toEqual({ jumpToMorning: PAST_MORNING_REASON });
  });

  it('busy disables everything with one shared reason', () => {
    const v = toPlaybackView(clock({ timeMin: 1000 }), W, 1100, true);
    expect(Object.keys(v.disabled).sort()).toEqual(['finish', 'jumpToMorning', 'nextEvent', 'play', 'reset', 'scrub', 'speed']);
    expect(v.reasons).toEqual([BUSY_REASON]);
  });
});

describe('scenario form', () => {
  const value = GenerateScenarioRequest.parse({ preset: 'random', seed: 7 });
  const form = (over: Partial<ScenarioForm>): ScenarioForm => ({ ...toScenarioForm(value), ...over });

  it('field ranges mirror the shared schema', () => {
    const shape = GenerateScenarioRequest.shape;
    for (const f of SCENARIO_FIELDS) {
      const { min, max } = SCENARIO_FIELD_INFO[f];
      if (min === undefined || max === undefined) continue;
      expect(shape[f].safeParse(min).success).toBe(true);
      expect(shape[f].safeParse(max).success).toBe(true);
      expect(shape[f].safeParse(min - 1).success).toBe(false);
      expect(shape[f].safeParse(max + 1).success).toBe(false);
    }
    expect(SCENARIO_FIELDS).not.toContain('hubs');
  });

  it('valid input parses to the request', () => {
    const r = validateScenario(form({ employees: ' 120 ', packages: '5', maxExtraMin: '0' }));
    expect(r).toEqual({ ok: true, request: { preset: 'random', seed: 7, employees: 120, packages: 5, maxExtraMin: 0 }, errors: {} });
  });

  it('invalid values give the schema messages', () => {
    const bad = { seed: '1.5', employees: '121', packages: '4', maxExtraMin: 'abc' };
    const r = validateScenario(form(bad));
    expect(r.ok).toBe(false);
    const raw = { preset: 'random', seed: 1.5, employees: 121, packages: 4, maxExtraMin: Number.NaN };
    const issues = GenerateScenarioRequest.safeParse(raw).error!.issues;
    for (const f of SCENARIO_FIELDS) {
      const want = issues.find((i) => i.path[0] === f)!.message;
      expect(r.errors[f]).toBe(want);
      expect(r.errors[f]).toBeTruthy();
    }
    expect(validateScenario(form({ employees: '' })).errors.employees).toBeTruthy();
  });

  it('a poll with an equal value keeps typed text; a new server value resets it', () => {
    let s = initScenarioState(value);
    s = { ...s, form: { ...s.form, employees: '9' } };
    const polled = syncScenarioState(s, { ...value });
    expect(polled).toBe(s);
    expect(polled.form.employees).toBe('9');
    const changed = syncScenarioState(s, { ...value, seed: 8 });
    expect(changed.form).toEqual(toScenarioForm({ ...value, seed: 8 }));
  });
});

describe('planning view', () => {
  it('Recompute is disabled with a reason only while locked (or busy)', () => {
    expect(toPlanningView('planning')).toEqual({ phaseLabel: 'Planning', recomputeDisabled: null });
    expect(toPlanningView('locked').recomputeDisabled).toBe(LOCKED_RECOMPUTE_REASON);
    expect(toPlanningView('planning', true).recomputeDisabled).toBe(BUSY_REASON);
  });
});
