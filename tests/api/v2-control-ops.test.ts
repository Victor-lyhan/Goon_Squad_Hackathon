// planControl: what each simulator control does to the v2 clock. Pure, so no server and no timers here.
import { describe, expect, it } from 'vitest';
import { controlError, planControl, type ControlPlan } from '../../server/api/v2/controlOps';
import type { Clock, Run } from '../../shared/v2/types';
import { deepFreeze, events, sampleRun } from './v2-sample';
import { eventAt, runWith } from './v2-control-helpers';

const ERROR = 'Invalid simulator control';

/** The new clock, or a failed expectation that shows the 400 instead. */
function applied(run: Run, body: unknown): Clock {
  const plan = planControl(run, body);
  expect(plan).toMatchObject({ kind: 'apply' });
  return (plan as Extract<ControlPlan, { kind: 'apply' }>).clock;
}

function refused(run: Run, body: unknown): Record<string, string> {
  const plan = planControl(run, body);
  expect(plan).toMatchObject({ kind: 'invalid', status: 400, error: ERROR });
  return (plan as Extract<ControlPlan, { kind: 'invalid' }>).fieldErrors;
}

describe('planControl: play, pause, speed', () => {
  it('play locks the run on the first press and starts the clock', () => {
    const run = runWith({ phase: 'planning', playing: false, timeMin: 930, speed: 30 });
    expect(applied(run, { action: 'play' })).toEqual({ phase: 'locked', playing: true, timeMin: 930, speed: 30 });
  });

  it('play on a locked, paused run keeps the minute and the speed', () => {
    const run = runWith({ phase: 'locked', playing: false, timeMin: 1500, speed: 600 });
    expect(applied(run, { action: 'play' })).toEqual({ phase: 'locked', playing: true, timeMin: 1500, speed: 600 });
  });

  it('pause stops the clock and stays locked', () => {
    const run = runWith({ phase: 'locked', playing: true, timeMin: 1200, speed: 120 });
    expect(applied(run, { action: 'pause' })).toEqual({ phase: 'locked', playing: false, timeMin: 1200, speed: 120 });
  });

  it.each([30, 120, 600] as const)('speed %i changes only the speed', (speed) => {
    const run = runWith({ phase: 'locked', playing: true, timeMin: 1200, speed: 120 });
    expect(applied(run, { action: 'speed', speed })).toEqual({ phase: 'locked', playing: true, timeMin: 1200, speed });
  });

  it('speed does not lock a run that is still in planning', () => {
    const run = runWith({ phase: 'planning', playing: false, timeMin: 930, speed: 30 });
    expect(applied(run, { action: 'speed', speed: 600 }).phase).toBe('planning');
  });
});

describe('planControl: seek', () => {
  const run = runWith({ phase: 'locked', playing: true, timeMin: 1110, speed: 120 });

  it.each([930, 931, 1500, 2159, 2160])('seek to %i lands exactly there and changes nothing else', (timeMin) => {
    expect(applied(run, { action: 'seek', timeMin })).toEqual({ phase: 'locked', playing: true, timeMin, speed: 120 });
  });

  it.each([929, 2161, 0, 2880])('seek to %i (outside 930..2160) is a 400 on timeMin, not a clamp', (timeMin) => {
    expect(refused(run, { action: 'seek', timeMin })).toEqual({ timeMin: 'Must be between 930 and 2160' });
  });

  it('the bounds are the run\'s own settings', () => {
    const short = runWith({ timeMin: 1000 });
    short.scenario.settings.simStartMin = 1000;
    short.scenario.settings.simEndMin = 1100;
    expect(applied(short, { action: 'seek', timeMin: 1100 }).timeMin).toBe(1100);
    expect(refused(short, { action: 'seek', timeMin: 1101 })).toEqual({ timeMin: 'Must be between 1000 and 1100' });
    expect(refused(short, { action: 'seek', timeMin: 999 })).toEqual({ timeMin: 'Must be between 1000 and 1100' });
  });

  it.each([1000.5, '1000', null, -1, 2881])('seek to %j is a 400 on timeMin', (timeMin) => {
    expect(Object.keys(refused(run, { action: 'seek', timeMin }))).toEqual(['timeMin']);
  });

  it('seek without timeMin is a 400 on timeMin', () => {
    expect(Object.keys(refused(run, { action: 'seek' }))).toEqual(['timeMin']);
  });
});

describe('planControl: next_event', () => {
  it('goes to the first event after the current minute', () => {
    // sample events: 1052, 1072, 1082, 1108, 1930, 1952
    expect(applied(runWith({ timeMin: 930 }), { action: 'next_event' }).timeMin).toBe(1052);
    expect(applied(runWith({ timeMin: 1052 }), { action: 'next_event' }).timeMin).toBe(1072);
    expect(applied(runWith({ timeMin: 1110 }), { action: 'next_event' }).timeMin).toBe(1930);
  });

  it('does not depend on the order of the events', () => {
    const run = runWith({ timeMin: 1060 }, [...events].reverse());
    expect(applied(run, { action: 'next_event' }).timeMin).toBe(1072);
  });

  it('two events in the same minute: lands on that minute once, then moves on', () => {
    const run = runWith({ timeMin: 1110 }, [...events, eventAt(1200, 6), eventAt(1200, 7)]);
    const first = applied(run, { action: 'next_event' });
    expect(first.timeMin).toBe(1200);
    const second = applied({ ...run, clock: first }, { action: 'next_event' });
    expect(second.timeMin).toBe(1930);
  });

  it('no event left: the clock is unchanged', () => {
    for (const timeMin of [1952, 2000, 2160]) {
      const run = runWith({ phase: 'locked', playing: true, timeMin, speed: 30 });
      expect(applied(run, { action: 'next_event' })).toEqual(run.clock);
    }
    const empty = runWith({ timeMin: 930 }, []);
    expect(applied(empty, { action: 'next_event' })).toEqual(empty.clock);
  });

  it('keeps playing, speed and phase', () => {
    const run = runWith({ phase: 'planning', playing: false, timeMin: 930, speed: 600 });
    expect(applied(run, { action: 'next_event' })).toEqual({ phase: 'planning', playing: false, timeMin: 1052, speed: 600 });
  });
});

describe('planControl: jump_to_morning', () => {
  it('goes to 5 minutes before the first Day 2 event', () => {
    expect(applied(runWith({ timeMin: 1110 }), { action: 'jump_to_morning' }).timeMin).toBe(1925); // first Day 2 event: 1930
  });

  it('no Day 2 event: goes to 1860', () => {
    const run = runWith({ timeMin: 1110 }, events.filter((e) => e.timeMin < 1440));
    expect(applied(run, { action: 'jump_to_morning' }).timeMin).toBe(1860);
    expect(applied(runWith({ timeMin: 930 }, []), { action: 'jump_to_morning' }).timeMin).toBe(1860);
  });

  it('an event at Day 2 00:00 counts as Day 2', () => {
    const run = runWith({ timeMin: 1110 }, [...events, eventAt(1440, 6)]);
    expect(applied(run, { action: 'jump_to_morning' }).timeMin).toBe(1435);
  });

  it('never goes backwards', () => {
    expect(applied(runWith({ timeMin: 1925 }), { action: 'jump_to_morning' }).timeMin).toBe(1925);
    expect(applied(runWith({ timeMin: 1940 }), { action: 'jump_to_morning' }).timeMin).toBe(1940);
    expect(applied(runWith({ timeMin: 2160 }), { action: 'jump_to_morning' }).timeMin).toBe(2160);
    const noMorning = runWith({ timeMin: 1900 }, events.filter((e) => e.timeMin < 1440));
    expect(applied(noMorning, { action: 'jump_to_morning' }).timeMin).toBe(1900);
  });

  it('keeps playing, speed and phase', () => {
    const run = runWith({ phase: 'locked', playing: true, timeMin: 1110, speed: 600 });
    expect(applied(run, { action: 'jump_to_morning' })).toEqual({ phase: 'locked', playing: true, timeMin: 1925, speed: 600 });
  });
});

describe('planControl: finish and reset_playback', () => {
  it('finish goes to simEndMin and pauses', () => {
    const run = runWith({ phase: 'locked', playing: true, timeMin: 1110, speed: 120 });
    expect(applied(run, { action: 'finish' })).toEqual({ phase: 'locked', playing: false, timeMin: 2160, speed: 120 });
  });

  it('reset_playback rewinds to simStartMin, pauses and unlocks: the run is in planning again (#734)', () => {
    const run = runWith({ phase: 'locked', playing: true, timeMin: 1700, speed: 600 });
    expect(applied(run, { action: 'reset_playback' })).toEqual({ phase: 'planning', playing: false, timeMin: 930, speed: 600 });
  });

  it('reset_playback changes only the clock: the plan carries no plans, jobs, shipments or runId', () => {
    const run = runWith({ phase: 'locked', playing: true, timeMin: 1700, speed: 600 });
    const plan = planControl(run, { action: 'reset_playback' });
    expect(Object.keys(plan).sort()).toEqual(['clock', 'kind']);
  });

  it('play, finish, reset, play, pause: locked by Play, unlocked only by the reset, locked again by Play', () => {
    let run = runWith({ phase: 'planning', playing: false, timeMin: 930, speed: 30 });
    const phases: string[] = [];
    for (const action of ['play', 'finish', 'reset_playback', 'play', 'pause'] as const) {
      run = { ...run, clock: applied(run, { action }) };
      phases.push(run.clock.phase);
    }
    expect(phases).toEqual(['locked', 'locked', 'planning', 'locked', 'locked']);
    expect(run.clock).toEqual({ phase: 'locked', playing: false, timeMin: 930, speed: 30 });
  });

  it('pause, seek, next event, jump to morning and finish never unlock a locked run', () => {
    let run = runWith({ phase: 'locked', playing: true, timeMin: 930, speed: 30 });
    const bodies = [
      { action: 'pause' }, { action: 'seek', timeMin: 930 }, { action: 'next_event' }, { action: 'jump_to_morning' },
      { action: 'seek', timeMin: 2160 }, { action: 'finish' }, { action: 'speed', speed: 600 },
    ];
    for (const body of bodies) {
      run = { ...run, clock: applied(run, body) };
      expect(run.clock.phase, body.action).toBe('locked');
    }
  });
});

describe('planControl: bad requests', () => {
  const run = runWith();

  it.each([
    ['an unknown action', { action: 'rewind' }, 'action'],
    ['no action', {}, 'action'],
    ['a speed that is not 30, 120 or 600', { action: 'speed', speed: 60 }, 'speed'],
    ['speed without a value', { action: 'speed' }, 'speed'],
    ['no body', undefined, 'body'],
    ['null', null, 'body'],
    ['a string', 'play', 'body'],
    ['an array', [{ action: 'play' }], 'body'],
  ])('%s -> 400 with fieldErrors.%s', (_name, body, field) => {
    const fieldErrors = refused(run, body);
    expect(Object.keys(fieldErrors)).toEqual([field]);
    expect(fieldErrors[field].length).toBeGreaterThan(0);
  });

  it('controlError is the ApiError body of the 400', () => {
    const plan = planControl(run, { action: 'seek', timeMin: 929 });
    if (plan.kind !== 'invalid') throw new Error('expected an invalid plan');
    expect(controlError(plan)).toEqual({ error: ERROR, fieldErrors: { timeMin: 'Must be between 930 and 2160' } });
  });
});

describe('planControl never mutates the run', () => {
  const bodies: unknown[] = [
    { action: 'play' }, { action: 'pause' }, { action: 'speed', speed: 600 }, { action: 'seek', timeMin: 1500 },
    { action: 'next_event' }, { action: 'jump_to_morning' }, { action: 'finish' }, { action: 'reset_playback' },
    { action: 'seek', timeMin: 100 }, { action: 'nope' }, undefined,
  ];

  it('a deep-frozen run does not throw for any action, valid or not', () => {
    const before = JSON.stringify(sampleRun); // sampleRun is deep-frozen
    for (const body of bodies) expect(() => planControl(sampleRun, body)).not.toThrow();
    const planning = deepFreeze(runWith({ phase: 'planning', playing: false, timeMin: 930 }));
    for (const body of bodies) expect(() => planControl(planning, body)).not.toThrow();
    expect(JSON.stringify(sampleRun)).toBe(before);
  });

  it('a changed clock is a new object', () => {
    const plan = planControl(sampleRun, { action: 'finish' });
    if (plan.kind !== 'apply') throw new Error('expected an apply plan');
    expect(plan.clock).not.toBe(sampleRun.clock);
    expect(sampleRun.clock.timeMin).toBe(1110);
  });
});
