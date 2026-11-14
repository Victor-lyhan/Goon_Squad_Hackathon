// #496: the Play journey player on the relay sample (shp-2, overnight at Brooklyn Roasting), with
// fake timers and a fake `control`. The exact seek sequence, and every stop condition.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimControlRequest } from '../../shared/v2/schemas';
import { buildJourney, type Journey } from '../../client/src/components/sim/v2/journey/journeyModel';
import { JOURNEY_STEP_MS } from '../../client/src/components/sim/v2/motion/journeyPlayback';
import {
  PLAY_IDLE, createJourneyPlayer, currentPlay, durationHint, journeyWindows, syncJourneyPlayer,
  type JourneyPlayer, type PlayState, type PlaySync,
} from '../../client/src/components/sim/v2/compose/journeyPlay';
import { attachSimKeys, type SimKeyboardEvent, type SimKeyTarget } from '../../client/src/components/sim/v2/page/simPageState';
import { T, map, simAt } from './sim-v2-journey-sample';

const relay = buildJourney({ shipmentId: 'shp-2', sim: simAt(T.beforePickup), map }) as Journey;
const windows = journeyWindows(relay);

const steps = (from: number, to: number) => {
  const out: number[] = [];
  for (let t = from + 2; t < to; t += 2) out.push(t);
  return [...out, to];
};
// Leg 1 from one minute before the pickup arrival (1040) to the drop's service end (1062); one jump
// overnight; leg 2 from 1949 to the delivery's service end (1977).
const SEQUENCE = [1039, ...steps(1039, 1062), 1949, ...steps(1949, 1977)];

type Harness = {
  player: JourneyPlayer;
  control: ReturnType<typeof vi.fn<(req: SimControlRequest) => Promise<unknown>>>;
  states: PlayState[];
  seeks: () => number[];
};

function harness(answer: (req: SimControlRequest) => unknown = () => ({ ok: true })): Harness {
  const states: PlayState[] = [];
  const control = vi.fn(async (req: SimControlRequest) => answer(req));
  const player = createJourneyPlayer({
    control,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    onChange: (s) => states.push(s),
  });
  const seeks = () => control.mock.calls
    .map(([r]) => r)
    .filter((r): r is Extract<SimControlRequest, { action: 'seek' }> => r.action === 'seek')
    .map((r) => r.timeMin);
  return { player, control, states, seeks };
}

const start = (h: Harness, clockPlaying = false, runId = 'run-1') =>
  h.player.start({ shipmentId: 'shp-2', runId, windows, clockPlaying });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('Play journey on the relay sample', () => {
  it('the plan windows: leg 1 on Day 1 evening, leg 2 on Day 2 morning', () => {
    expect(windows).toEqual([{ startMin: 1039, endMin: 1062 }, { startMin: 1949, endMin: 1977 }]);
    expect(SEQUENCE).toHaveLength(28);
    expect(durationHint(windows)).toBe('about 14 s');
  });

  it('sends the exact seek sequence: 2 minutes every 500 ms, one jump before pickup and one overnight', async () => {
    const h = harness();
    start(h);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.seeks()).toEqual([1039]); // the jump to the first window, at once
    await vi.advanceTimersByTimeAsync(JOURNEY_STEP_MS - 1);
    expect(h.seeks()).toEqual([1039]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.seeks()).toEqual([1039, 1041]);
    await vi.advanceTimersByTimeAsync(JOURNEY_STEP_MS * 40);
    expect(h.seeks()).toEqual(SEQUENCE);
    expect(h.control.mock.calls.every(([r]) => r.action === 'seek')).toBe(true); // a paused clock is not paused again
  });

  it('stops by itself at the end, in under 30 s', async () => {
    const h = harness();
    start(h);
    await vi.advanceTimersByTimeAsync(SEQUENCE.length * JOURNEY_STEP_MS - 1);
    expect(h.player.state().status).toBe('running');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.player.state()).toEqual({ status: 'finished', shipmentId: 'shp-2', runId: 'run-1' });
    expect(SEQUENCE.length * JOURNEY_STEP_MS).toBeLessThan(30_000);
    const calls = h.control.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.control.mock.calls.length).toBe(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a playing server clock is paused first, then the seeks start', async () => {
    const h = harness();
    start(h, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.control.mock.calls.map(([r]) => r)).toEqual([{ action: 'pause' }, { action: 'seek', timeMin: 1039 }]);
  });

  it('a step waits for the previous answer, so a slow server never gets a queue of seeks', async () => {
    let release: (v: unknown) => void = () => {};
    const h = harness(() => new Promise((r) => { release = r; }));
    start(h);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.seeks()).toEqual([1039]);
    release({ ok: true });
    await vi.advanceTimersByTimeAsync(JOURNEY_STEP_MS);
    expect(h.seeks()).toEqual([1039, 1041]);
  });
});

describe('Play journey stops', () => {
  it('on Stop (or Esc): no more seeks, state "stopped", and stop() reports it was running', async () => {
    const h = harness();
    start(h);
    await vi.advanceTimersByTimeAsync(JOURNEY_STEP_MS * 3);
    const sent = h.seeks().length;
    expect(h.player.stop()).toBe(true);
    expect(h.player.state()).toEqual({ status: 'stopped', shipmentId: 'shp-2', runId: 'run-1' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.seeks()).toHaveLength(sent);
    expect(h.player.stop()).toBe(false); // the next Esc is not for the journey
  });

  it('when a seek fails: state "failed", no more seeks', async () => {
    let n = 0;
    const h = harness((r) => (r.action === 'seek' && ++n === 4 ? null : { ok: true }));
    start(h);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.seeks()).toEqual(SEQUENCE.slice(0, 4));
    expect(h.player.state().status).toBe('failed');
  });

  it('when the pause before the first step fails: no seek at all', async () => {
    const h = harness((r) => (r.action === 'pause' ? null : { ok: true }));
    start(h, true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.seeks()).toEqual([]);
    expect(h.player.state().status).toBe('failed');
  });

  it('on unmount (dispose): no more seeks, no state report', async () => {
    const h = harness();
    start(h);
    await vi.advanceTimersByTimeAsync(JOURNEY_STEP_MS * 2);
    const sent = h.seeks().length;
    const reports = h.states.length;
    h.player.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.seeks()).toHaveLength(sent);
    expect(h.states).toHaveLength(reports);
  });

  it('a late answer from a stopped journey changes nothing', async () => {
    let release: (v: unknown) => void = () => {};
    const h = harness(() => new Promise((r) => { release = r; }));
    start(h);
    await vi.advanceTimersByTimeAsync(0);
    h.player.stop();
    release(null); // the open seek fails after Stop
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.player.state().status).toBe('stopped');
    expect(h.seeks()).toEqual([1039]);
  });

  describe('syncJourneyPlayer (run after each page render)', () => {
    const now = (over: Partial<PlaySync> = {}): PlaySync => ({ shipmentId: 'shp-2', runId: 'run-1', clockPlaying: false, ...over });

    async function running(clockPlaying = false) {
      const h = harness();
      start(h, clockPlaying);
      await vi.advanceTimersByTimeAsync(JOURNEY_STEP_MS);
      return h;
    }

    it('another package or no package selected: reset to idle, no more seeks', async () => {
      for (const shipmentId of ['shp-1', null]) {
        const h = await running();
        syncJourneyPlayer(h.player, now(), now({ shipmentId }));
        expect(h.player.state()).toBe(PLAY_IDLE);
        const sent = h.seeks().length;
        await vi.advanceTimersByTimeAsync(10_000);
        expect(h.seeks()).toHaveLength(sent);
      }
    });

    it('a new run: reset to idle', async () => {
      const h = await running();
      syncJourneyPlayer(h.player, now(), now({ runId: 'run-2' }));
      expect(h.player.state()).toBe(PLAY_IDLE);
    });

    it('the server clock starts playing (another tab): stopped', async () => {
      const h = await running();
      syncJourneyPlayer(h.player, now(), now()); // a poll with nothing new
      expect(h.player.state().status).toBe('running');
      syncJourneyPlayer(h.player, now(), now({ clockPlaying: true }));
      expect(h.player.state().status).toBe('stopped');
    });

    it('a journey started on a playing clock is not stopped by that clock', async () => {
      const h = await running(true);
      syncJourneyPlayer(h.player, now({ clockPlaying: true }), now({ clockPlaying: true }));
      expect(h.player.state().status).toBe('running');
      syncJourneyPlayer(h.player, now({ clockPlaying: true }), now({ clockPlaying: false })); // the pause landed
      expect(h.player.state().status).toBe('running');
    });
  });

  it('a state left from another package or run reads idle (currentPlay)', () => {
    const s: PlayState = { status: 'running', shipmentId: 'shp-2', runId: 'run-1' };
    expect(currentPlay(s, 'shp-2', 'run-1')).toBe(s);
    expect(currentPlay(s, 'shp-1', 'run-1')).toBe(PLAY_IDLE);
    expect(currentPlay(s, 'shp-2', 'run-2')).toBe(PLAY_IDLE);
    expect(currentPlay(s, null, 'run-1')).toBe(PLAY_IDLE);
  });
});

describe('Esc: the first stops the journey, the next goes back to the network', () => {
  function keys(escape: () => boolean) {
    let listener: ((e: SimKeyboardEvent) => void) | null = null;
    const target: SimKeyTarget = {
      addEventListener: (_t, l) => { listener = l; },
      removeEventListener: () => { listener = null; },
    };
    const select = vi.fn();
    const detach = attachSimKeys(target, {
      context: () => ({ selection: { kind: 'package', id: 'shp-2' }, data: { sim: simAt(T.onLeg1), busy: false } }),
      select,
      control: vi.fn(),
      escape,
    });
    const press = (tagName = 'BODY') => {
      const e = { key: 'Escape', target: { tagName }, preventDefault: vi.fn() };
      listener?.(e);
      return e;
    };
    return { press, select, detach };
  }

  it('with a real player', async () => {
    const h = harness();
    start(h);
    await vi.advanceTimersByTimeAsync(JOURNEY_STEP_MS);
    const k = keys(() => h.player.stop());
    const first = k.press('BUTTON'); // focus is on the Stop button after a click
    expect(first.preventDefault).toHaveBeenCalled();
    expect(h.player.state().status).toBe('stopped');
    expect(k.select).not.toHaveBeenCalled();
    k.press();
    expect(k.select).toHaveBeenCalledWith(null);
    k.detach();
  });

  it('Esc in a text field is left to the field', () => {
    const escape = vi.fn(() => true);
    const k = keys(escape);
    k.press('INPUT');
    k.press('SELECT');
    expect(escape).not.toHaveBeenCalled();
  });
});
