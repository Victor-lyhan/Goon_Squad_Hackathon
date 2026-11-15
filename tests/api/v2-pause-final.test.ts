// #747: Pause is final. After `POST /simulator/control {action:'pause'}` has answered, no ticker step may
// change the run: not the clock, and not the `version` either.
// The fault: the ticker reads `store.get()`, and a control that stops the clock is only visible there once
// its state write has finished. A tick that is due during that write still saw `playing: true` and queued a
// step behind the control. The step then found the clock stopped and moved nothing, but `store.mutate`
// bumped the version and wrote the file once more, after the answer. On a busy machine the write is slow,
// so the window is wide (v2-e2e-nyc-flow "expected 5 to be 4").
// Here that order is forced, not waited for: the whole server on the real NYC run and the real file store
// (v2-e2e-nyc-helper.ts), the real ticker with a `now` only the test moves (so a step is due exactly when
// the test says), and a gate in front of the state write (so the control is still in flight when the tick
// comes). Nothing sleeps for a fixed time: every wait is for a condition.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import type { SimulatorResponse } from '../../shared/v2/api';
import type { Clock } from '../../shared/v2/types';
import { recordFetch, startNycApi, T, type NycApi } from './v2-e2e-nyc-helper';

const TICK_MS = 20;
/** One real second for the ticker is `clock.speed` simulated minutes: one whole step, nothing carried. */
const SECOND_MS = 1000;

const net = recordFetch();
let api: NycApi;
/** The ticker's clock. Real time never moves it, so a step is due only after the test adds to it. */
let nowMs = 1_000_000;
const now = vi.fn(() => nowMs);
/** How many times the ticker's timer has fired. */
const ticks = () => now.mock.calls.length;

// ---------- the gate in front of the state write ----------

const realRename = fs.promises.rename.bind(fs.promises);
let gate: { waiting: number; opened: Promise<void>; open(): void } | null = null;

/** From now on every state write stops just before the file is replaced, until `open()`. */
function holdWrites() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  const mine = { waiting: 0, opened, open: () => { gate = null; open(); } };
  gate = mine;
  return mine;
}

async function until(what: string, done: () => boolean): Promise<void> {
  const deadline = Date.now() + T / 2;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

const store = () => api.runtime.deps.store!;
let mutate: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
    const held = gate;
    if (held) {
      held.waiting += 1;
      await held.opened;
    }
    return realRename(from, to);
  });
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  api = await startNycApi(net);
  expect(api.runtime.status).toBe('ready');
  mutate = vi.spyOn(store(), 'mutate'); // the ticker and the control route both call it on this object
  api.runtime.startTicker({ intervalMs: TICK_MS, now });
}, T);
afterEach(() => {
  gate?.open();
  net.expectNoOutgoing();
});
afterAll(async () => {
  await api?.close();
  net.restore();
  vi.restoreAllMocks();
}, T);

/** Back to start, Play, and one ticker step applied and saved: a run that is playing, with nothing in flight. */
async function playing(): Promise<SimulatorResponse> {
  await api.control({ action: 'reset_playback' });
  const play = await api.control({ action: 'play' });
  expect(play.clock).toMatchObject({ phase: 'locked', playing: true });
  nowMs += SECOND_MS;
  await until('the first ticker step', () => store().get().clock.timeMin > play.clock.timeMin);
  const moved = await api.simulator();
  expect(moved.clock.timeMin).toBe(play.clock.timeMin + play.clock.speed);
  expect(moved.version).toBe(play.version + 1);
  return moved;
}

/**
 * For more than two ticker intervals after `answer`, with a simulated second due at every tick, `GET
 * /simulator` reads the answered version and clock, and the state file holds that version.
 */
async function expectFinal(answer: SimulatorResponse): Promise<void> {
  const from = ticks();
  let reads = 0;
  // `from + 3`: the first tick after the answer may be a part interval, so three ticks span two whole ones.
  while (ticks() < from + 3 || reads < 3) {
    nowMs += SECOND_MS;
    const read = await api.simulator();
    expect({ version: read.version, clock: read.clock }).toStrictEqual({ version: answer.version, clock: answer.clock });
    reads += 1;
    await new Promise((resolve) => setTimeout(resolve, TICK_MS / 4));
  }
  expect(ticks()).toBeGreaterThanOrEqual(from + 3);
  expect((await api.savedRun())?.version).toBe(answer.version);
  expect((await api.simulator()).version).toBe(answer.version);
}

describe('a control that stops the clock is final once it has answered (#747)', () => {
  const stops: [string, (before: Clock, end: number, start: number) => Clock][] = [
    ['pause', (before) => ({ ...before, playing: false })],
    ['finish', (before, end) => ({ ...before, timeMin: end, playing: false })],
    ['reset_playback', (before, _end, start) => ({ ...before, phase: 'planning', timeMin: start, playing: false })],
  ];

  it.each(stops)('%s, with a tick due while its state write is in flight: no step moves the version after the answer', async (action, expected) => {
    const { simStartMin, simEndMin } = store().get().scenario.settings;
    const before = await playing();
    const mutations = mutate.mock.calls.length;

    // The control is in flight: applied to a draft, its state write not finished, so `store.get()` still plays.
    const held = holdWrites();
    const pending = api.control({ action });
    await until(`${action} to reach its state write`, () => held.waiting === 1);
    expect(store().get().clock.playing).toBe(true);

    // A tick is due right now. It sees `playing: true` and queues a step of one second behind the control.
    nowMs += SECOND_MS;
    await until('the ticker to queue its step', () => mutate.mock.calls.length === mutations + 2);
    expect(store().get().version).toBe(before.version);

    held.open();
    const answer = await pending;
    expect(answer.version).toBe(before.version + 1);
    expect(answer.clock).toStrictEqual(expected(before.clock, simEndMin, simStartMin));

    await expectFinal(answer);
    expect(mutate.mock.calls.length).toBe(mutations + 2); // the ticker queued nothing more
    expect(warn).not.toHaveBeenCalled(); // a step that is dropped is not a failed write
  }, T);

  it('a step already in flight when Pause arrives is applied first: the answer includes it, and it is final too', async () => {
    const before = await playing();
    const mutations = mutate.mock.calls.length;

    const held = holdWrites();
    nowMs += SECOND_MS;
    await until('the step to reach its state write', () => held.waiting === 1);
    const pending = api.control({ action: 'pause' });
    await until('the pause to be queued behind it', () => mutate.mock.calls.length === mutations + 2);

    held.open();
    const answer = await pending;
    expect(answer.version).toBe(before.version + 2);
    expect(answer.clock).toStrictEqual({ ...before.clock, timeMin: before.clock.timeMin + before.clock.speed, playing: false });

    await expectFinal(answer);
    expect(warn).not.toHaveBeenCalled();
  }, T);

  it('Play after such a pause starts from the answered minute: the dropped step is not played back', async () => {
    const before = await playing();
    const mutations = mutate.mock.calls.length;

    const held = holdWrites();
    const pending = api.control({ action: 'pause' });
    await until('the pause to reach its state write', () => held.waiting === 1);
    nowMs += SECOND_MS;
    await until('the ticker to queue its step', () => mutate.mock.calls.length === mutations + 2);
    held.open();
    const paused = await pending;
    await expectFinal(paused);

    const play = await api.control({ action: 'play' });
    expect(play.clock).toStrictEqual({ ...paused.clock, playing: true });
    nowMs += SECOND_MS;
    await until('the next ticker step', () => store().get().clock.timeMin > paused.clock.timeMin);
    const moved = await api.simulator();
    expect(moved.clock.timeMin).toBe(before.clock.timeMin + before.clock.speed); // one second, not the seconds spent paused
    expect(moved.version).toBe(play.version + 1);
    await api.control({ action: 'pause' });
  }, T);
});
