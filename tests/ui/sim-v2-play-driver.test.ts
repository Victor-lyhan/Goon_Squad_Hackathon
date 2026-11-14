// #496, #648: the journey player behind the one Play/Pause button, on the relay sample (shp-2,
// overnight at Brooklyn Roasting) and the direct one (shp-1), with fake timers and a fake `control`.
// The exact seek sequence, the overnight card, pause and resume, and every stop condition.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimControlRequest } from '../../shared/v2/schemas';
import { buildJourney, type Journey } from '../../client/src/components/sim/v2/journey/journeyModel';
import { JOURNEY_STEP_MS, OVERNIGHT_CARD_MS } from '../../client/src/components/sim/v2/motion/journeyPlayback';
import {
  PLAY_IDLE, createJourneyPlayer, currentPlay, journeyWindows, overnightText, playFromMin, relayPointName,
  syncJourneyPlayer,
  type JourneyPlayer, type PlayState, type PlaySync,
} from '../../client/src/components/sim/v2/compose/journeyPlay';
import { attachSimKeys, type SimKeyboardEvent, type SimKeyTarget } from '../../client/src/components/sim/v2/page/simPageState';
import { T, map, simAt } from './sim-v2-journey-sample';

const relay = buildJourney({ shipmentId: 'shp-2', sim: simAt(T.beforePickup), map }) as Journey;
const windows = journeyWindows(relay);
const direct = buildJourney({ shipmentId: 'shp-1', sim: simAt(T.beforePickup), map }) as Journey;
const directWindows = journeyWindows(direct);

const steps = (from: number, to: number) => {
  const out: number[] = [];
  for (let t = from + 2; t < to; t += 2) out.push(t);
  return [...out, to];
};
// Leg 1 from one minute before the pickup arrival (1040) to the drop's service end (1062); the
// overnight card, then one jump; leg 2 from 1949 to the delivery's service end (1977).
const LEG1 = [1039, ...steps(1039, 1062)];
const SEQUENCE = [...LEG1, 1949, ...steps(1949, 1977)];
/** When the last seek of leg 1 is sent, and when the card goes up (the step after it). */
const LEG1_END_MS = (LEG1.length - 1) * JOURNEY_STEP_MS;
const CARD_UP_MS = LEG1_END_MS + JOURNEY_STEP_MS;
/** The whole relay journey: one step per seek, plus the card. */
const TOTAL_MS = SEQUENCE.length * JOURNEY_STEP_MS + OVERNIGHT_CARD_MS;
const RUNNING = { status: 'running', overnight: false, shipmentId: 'shp-2', runId: 'run-1' } as const;

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

const start = (h: Harness, clockPlaying = false, fromMin = -Infinity) =>
  h.player.start({ shipmentId: 'shp-2', runId: 'run-1', windows, fromMin, clockPlaying });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('the journey on the relay sample', () => {
  it('the plan windows: leg 1 on Day 1 evening, leg 2 on Day 2 morning', () => {
    expect(windows).toEqual([{ startMin: 1039, endMin: 1062 }, { startMin: 1949, endMin: 1977 }]);
    expect(SEQUENCE).toHaveLength(28);
    expect(directWindows).toHaveLength(1);
  });

  it('sends the exact seek sequence: 2 minutes every 500 ms, one jump before pickup and one over the night', async () => {
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
    await vi.advanceTimersByTimeAsync(TOTAL_MS - 1);
    expect(h.player.state().status).toBe('running');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.player.state()).toEqual({ status: 'finished', shipmentId: 'shp-2', runId: 'run-1' });
    expect(TOTAL_MS).toBeLessThan(30_000);
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

describe('the overnight card (#648)', () => {
  it('names the relay business of the journey; a direct journey has none', () => {
    expect(relayPointName(relay)).toBe('Brooklyn Roasting');
    expect(relayPointName(direct)).toBeNull();
    expect(overnightText(relay, { ...RUNNING, overnight: true })).toBe('Overnight at Brooklyn Roasting');
    expect(overnightText(relay, RUNNING)).toBeNull();
    expect(overnightText(relay, { status: 'paused', shipmentId: 'shp-2', runId: 'run-1' })).toBeNull();
    expect(overnightText(null, { ...RUNNING, overnight: true })).toBeNull();
  });

  it('relay: shown after the evening leg for about 1 s, then gone, then the morning seek', async () => {
    const h = harness();
    start(h);
    await vi.advanceTimersByTimeAsync(LEG1_END_MS);
    expect(h.seeks()).toEqual(LEG1); // the evening leg ends at the relay point
    expect(h.player.state()).toEqual(RUNNING);

    await vi.advanceTimersByTimeAsync(JOURNEY_STEP_MS);
    expect(h.player.state()).toEqual({ ...RUNNING, overnight: true }); // shown
    expect(overnightText(relay, h.player.state())).toBe('Overnight at Brooklyn Roasting');
    expect(h.seeks()).toEqual(LEG1); // no seek into the night

    await vi.advanceTimersByTimeAsync(OVERNIGHT_CARD_MS - 1);
    expect(h.player.state()).toEqual({ ...RUNNING, overnight: true });
    expect(h.seeks()).toEqual(LEG1);

    await vi.advanceTimersByTimeAsync(1);
    expect(h.player.state()).toEqual(RUNNING); // gone
    expect(h.seeks()).toEqual([...LEG1, 1949]); // then the morning
    // The card came down before the morning seek was sent.
    const cardDown = h.states.findIndex((s, i) => i > 0 && s.status === 'running' && !s.overnight && h.states[i - 1].status === 'running');
    expect(cardDown).toBeGreaterThan(0);
    expect(h.states.filter((s) => s.status === 'running' && s.overnight)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(TOTAL_MS);
    expect(h.seeks()).toEqual(SEQUENCE);
    expect(h.seeks().every((t) => t <= 1062 || t >= 1949)).toBe(true); // never a minute of the night
  });

  it('a direct journey plays to the end without the card', async () => {
    const h = harness();
    h.player.start({ shipmentId: 'shp-1', runId: 'run-1', windows: directWindows, fromMin: -Infinity, clockPlaying: false });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.player.state()).toEqual({ status: 'finished', shipmentId: 'shp-1', runId: 'run-1' });
    expect(h.states.some((s) => s.status === 'running' && s.overnight)).toBe(false);
    const [w] = directWindows;
    expect(h.seeks()).toEqual([w.startMin, ...steps(w.startMin, w.endMin)]);
  });

  it('Pause while the card is up takes it down and sends no morning seek; Play shows it again', async () => {
    const h = harness();
    start(h);
    await vi.advanceTimersByTimeAsync(CARD_UP_MS + 300);
    expect(h.player.state()).toEqual({ ...RUNNING, overnight: true });
    expect(h.player.pause()).toBe(true);
    expect(overnightText(relay, h.player.state())).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.seeks()).toEqual(LEG1);

    start(h, false, playFromMin(h.player.state(), windows, 1062));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.player.state()).toEqual({ ...RUNNING, overnight: true });
    await vi.advanceTimersByTimeAsync(OVERNIGHT_CARD_MS);
    expect(h.seeks()).toEqual([...LEG1, 1949]);
  });
});

describe('pause and resume (#648)', () => {
  const paused: PlayState = { status: 'paused', shipmentId: 'shp-2', runId: 'run-1' };

  it('Pause stops stepping and sends nothing: the clock stays where it is', async () => {
    const h = harness();
    start(h);
    await vi.advanceTimersByTimeAsync(JOURNEY_STEP_MS * 3);
    expect(h.seeks()).toEqual(SEQUENCE.slice(0, 4));
    const calls = h.control.mock.calls.length;
    expect(h.player.pause()).toBe(true);
    expect(h.player.state()).toEqual(paused);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.control.mock.calls).toHaveLength(calls); // no seek, no reset, no pause request
    expect(vi.getTimerCount()).toBe(0);
    expect(h.player.pause()).toBe(false); // the next Esc is not for the journey
  });

  it('Play again resumes from the minute the clock is at, not from the start', async () => {
    const h = harness();
    start(h);
    await vi.advanceTimersByTimeAsync(JOURNEY_STEP_MS * 3);
    h.player.pause();
    const at = h.seeks()[3]; // the polled clock after the last answered seek
    expect(at).toBe(1045);
    expect(playFromMin(h.player.state(), windows, at)).toBe(at);

    start(h, false, playFromMin(h.player.state(), windows, at));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.seeks()).toEqual([...SEQUENCE.slice(0, 4), 1047]); // the next step, at once
    await vi.advanceTimersByTimeAsync(TOTAL_MS);
    expect(h.seeks()).toEqual(SEQUENCE); // each minute once: nothing replayed, nothing skipped
    expect(h.player.state().status).toBe('finished');
  });

  it('where Play starts: the start when idle, finished or failed; the clock after a pause; the start again at the end', () => {
    const target = { shipmentId: 'shp-2', runId: 'run-1' };
    expect(playFromMin(PLAY_IDLE, windows, 1050)).toBe(-Infinity);
    expect(playFromMin({ status: 'finished', ...target }, windows, 1977)).toBe(-Infinity);
    expect(playFromMin({ status: 'failed', ...target }, windows, 1050)).toBe(-Infinity);
    expect(playFromMin(paused, windows, 1050)).toBe(1050);
    expect(playFromMin(paused, windows, 930)).toBe(930); // Back to start, or a click on the first step
    expect(playFromMin(paused, windows, 1500)).toBe(1500); // in the night: the card, then the morning
    expect(playFromMin(paused, windows, 1976)).toBe(1976);
    expect(playFromMin(paused, windows, 1977)).toBe(-Infinity); // a click on the last step, then Play
    expect(playFromMin(paused, windows, 2160)).toBe(-Infinity);
  });

  it('once the journey has finished, Play starts from the start again', async () => {
    const h = harness();
    start(h);
    await vi.advanceTimersByTimeAsync(TOTAL_MS);
    expect(h.player.state().status).toBe('finished');
    start(h, false, playFromMin(h.player.state(), windows, 1977));
    await vi.advanceTimersByTimeAsync(TOTAL_MS);
    expect(h.seeks()).toEqual([...SEQUENCE, ...SEQUENCE]);
  });
});

describe('the journey stops', () => {

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

  it('a late answer from a paused journey changes nothing', async () => {
    let release: (v: unknown) => void = () => {};
    const h = harness(() => new Promise((r) => { release = r; }));
    start(h);
    await vi.advanceTimersByTimeAsync(0);
    h.player.pause();
    release(null); // the open seek fails after Pause
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.player.state().status).toBe('paused');
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

    it('the server clock starts playing (another tab): paused', async () => {
      const h = await running();
      syncJourneyPlayer(h.player, now(), now()); // a poll with nothing new
      expect(h.player.state().status).toBe('running');
      syncJourneyPlayer(h.player, now(), now({ clockPlaying: true }));
      expect(h.player.state().status).toBe('paused');
    });

    it('a journey started on a playing clock is not paused by that clock', async () => {
      const h = await running(true);
      syncJourneyPlayer(h.player, now({ clockPlaying: true }), now({ clockPlaying: true }));
      expect(h.player.state().status).toBe('running');
      syncJourneyPlayer(h.player, now({ clockPlaying: true }), now({ clockPlaying: false })); // the pause landed
      expect(h.player.state().status).toBe('running');
    });
  });

  it('a state left from another package or run reads idle (currentPlay)', () => {
    const s: PlayState = { status: 'running', overnight: false, shipmentId: 'shp-2', runId: 'run-1' };
    expect(currentPlay(s, 'shp-2', 'run-1')).toBe(s);
    expect(currentPlay(s, 'shp-1', 'run-1')).toBe(PLAY_IDLE);
    expect(currentPlay(s, 'shp-2', 'run-2')).toBe(PLAY_IDLE);
    expect(currentPlay(s, null, 'run-1')).toBe(PLAY_IDLE);
  });
});

describe('Esc: the first pauses the journey, the next goes back to the network', () => {
  function keys(escape: () => boolean) {
    let listener: ((e: SimKeyboardEvent) => void) | null = null;
    const target: SimKeyTarget = {
      addEventListener: (_t, l) => { listener = l; },
      removeEventListener: () => { listener = null; },
    };
    const select = vi.fn();
    const detach = attachSimKeys(target, {
      context: () => ({ selection: { kind: 'package', id: 'shp-2' }, data: { sim: simAt(T.onLeg1) } }),
      select,
      togglePlay: vi.fn(),
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
    const k = keys(() => h.player.pause());
    const first = k.press('BUTTON'); // focus is on the Pause button after a click
    expect(first.preventDefault).toHaveBeenCalled();
    expect(h.player.state().status).toBe('paused');
    expect(k.select).not.toHaveBeenCalled();
    k.press();
    expect(k.select).toHaveBeenCalledWith(null);
    k.detach();
  });

  it('Esc in a text field is left to the field', () => {
    const escape = vi.fn(() => true);
    const k = keys(escape);
    k.press('INPUT');
    k.press('TEXTAREA');
    expect(escape).not.toHaveBeenCalled();
    k.press('SELECT'); // #607: the focus dropdown is not a text field
    expect(escape).toHaveBeenCalledTimes(1);
  });
});
