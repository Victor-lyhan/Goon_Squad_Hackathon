// #790 (docs/mvp4.md F2): Play with no package picked steps through every carrier's commute with seeks, like a
// journey. Pure parts in Node with fake timers: the windows built from the response's `plans` and `trips`, the
// step rule over them (gaps skipped, the overnight card only for the night, a last jump to the end of the run),
// and the player's play / pause / reset / late-answer rules with `shipmentId: null`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimulatorResponse } from '../../shared/v2/api';
import type { SimControlRequest } from '../../shared/v2/schemas';
import type { DeliveryPlan, Leg, Trip } from '../../shared/v2/types';
import {
  NETWORK_FINISHED_TEXT, NETWORK_OVERNIGHT_TEXT, NETWORK_PAUSED_TEXT, NETWORK_PLAYING_TEXT, NETWORK_STEP_MIN,
  PLAY_IDLE, createJourneyPlayer, currentPlay, networkWindows, overnightText, playStatusText, syncJourneyPlayer,
  type PlayState,
} from '../../client/src/components/sim/v2/compose/journeyPlay';
import {
  JOURNEY_COMMUTE_STEP_MIN, JOURNEY_STEP_MS, OVERNIGHT_CARD_MS, nextJourneyAction, type JourneyWindow,
} from '../../client/src/components/sim/v2/motion/journeyPlayback';

const END = 2160;

const leg = (tripId: string, employeeId: string, firstArrival: number, finishMin: number): Leg => ({
  tripId, employeeId, placeIds: [],
  stops: [{ placeId: 'biz-a', kind: 'pickup', arrivalMin: firstArrival, serviceStartMin: firstArrival, serviceEndMin: firstArrival + 2 }],
  finishMin, extraMin: 0, extraDistanceM: 0, rewardCents: 0,
});
const plan = (id: string, legs: Leg[]): DeliveryPlan => ({
  id: `plan-${id}`, shipmentId: id, kind: legs.length > 1 ? 'relay' : 'direct', deliveryMin: legs[legs.length - 1].finishMin,
  customerPriceCents: 0, platformContributionCents: 0, legs,
});
const trip = (id: string, employeeId: string, direction: Trip['direction'], departureMin: number): Trip =>
  ({ id, employeeId, direction, departureMin } as Trip);

/**
 * Evening: emp-1 leaves at 1000 (to 1040), emp-2 at 1020 (to 1060): one window 999 to 1060. emp-3 at 1100
 * (to 1130): another window the same evening, after a quiet gap. Morning: emp-4 at 1900 (to 1940).
 */
const SIM: Pick<SimulatorResponse, 'plans' | 'trips'> = {
  plans: [
    plan('shp-1', [leg('emp-1-eve', 'emp-1', 1010, 1040)]),
    plan('shp-2', [leg('emp-2-eve', 'emp-2', 1030, 1060), leg('emp-4-morn', 'emp-4', 1910, 1940)]),
    plan('shp-3', [leg('emp-3-eve', 'emp-3', 1110, 1130)]),
  ],
  trips: [
    trip('emp-1-eve', 'emp-1', 'evening', 1000),
    trip('emp-2-eve', 'emp-2', 'evening', 1020),
    trip('emp-3-eve', 'emp-3', 'evening', 1100),
    trip('emp-4-morn', 'emp-4', 'morning', 1900),
  ],
};

/** Every seek from `fromMin` to `done`, with the jumps that show the overnight card. */
function steps(windows: JourneyWindow[], fromMin: number) {
  const seeks: number[] = [];
  const cards: number[] = [];
  let t = fromMin;
  for (let guard = 0; guard < 10_000; guard += 1) {
    const a = nextJourneyAction(windows, t);
    if (a.kind === 'done') break;
    if (a.overnight) cards.push(a.toMin);
    seeks.push(a.toMin);
    t = a.toMin;
  }
  return { seeks, cards };
}

describe('networkWindows: every plan leg, from its trip departure to its finish (#790)', () => {
  it('one window per stretch of overlapping legs, the night marked, and a last jump to the end of the run', () => {
    expect(networkWindows(SIM, END)).toEqual([
      { startMin: 999, endMin: 1060, carryStartMin: 1060, carryEndMin: 1060, nightBefore: false },
      { startMin: 1099, endMin: 1130, carryStartMin: 1130, carryEndMin: 1130, nightBefore: false },
      { startMin: 1899, endMin: 1940, carryStartMin: 1940, carryEndMin: 1940, nightBefore: true },
      { startMin: END, endMin: END, nightBefore: false },
    ]);
  });

  it('a leg whose trip is not in the response starts one minute before its first stop', () => {
    const w = networkWindows({ plans: SIM.plans, trips: undefined }, END);
    expect(w.map((x) => [x.startMin, x.endMin])).toEqual([[1009, 1060], [1109, 1130], [1909, 1940], [END, END]]);
  });

  it('no end jump when the run ends with the last window; no plans is just the jump to the end', () => {
    expect(networkWindows(SIM, 1940).map((x) => x.endMin)).toEqual([1060, 1130, 1940]);
    expect(networkWindows({ plans: [], trips: [] }, END)).toEqual([{ startMin: END, endMin: END, nightBefore: false }]);
  });

  it('the order of plans and trips does not matter', () => {
    const shuffled = { plans: [...SIM.plans].reverse(), trips: [...(SIM.trips ?? [])].reverse() };
    expect(networkWindows(shuffled, END)).toEqual(networkWindows(SIM, END));
  });
});

describe('the steps over the network windows (#790)', () => {
  const windows = networkWindows(SIM, END);

  it('jumps to the first departure, steps NETWORK_STEP_MIN, skips the quiet gap with no card, shows the card only for the night, ends at the end of the run', () => {
    expect(NETWORK_STEP_MIN).toBe(JOURNEY_COMMUTE_STEP_MIN);
    const { seeks, cards } = steps(windows, 930);
    expect(seeks).toEqual([
      999, 1000, 1004, 1008, 1012, 1016, 1020, 1024, 1028, 1032, 1036, 1040, 1044, 1048, 1052, 1056, 1060,
      1099, 1100, 1104, 1108, 1112, 1116, 1120, 1124, 1128, 1130,
      1899, 1900, 1904, 1908, 1912, 1916, 1920, 1924, 1928, 1932, 1936, 1940,
      END,
    ]);
    expect(cards).toEqual([1899]);
  });

  it('every carrier is seen in at least 3 steps between its departure and its finish', () => {
    const { seeks } = steps(windows, 930);
    for (const p of SIM.plans) {
      for (const l of p.legs) {
        const dep = SIM.trips!.find((t) => t.id === l.tripId)!.departureMin;
        expect(seeks.filter((t) => t >= dep && t <= l.finishMin).length, l.tripId).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('starts from the clock minute: inside a window it goes on from there; in the night it shows the card first', () => {
    expect(steps(windows, 1013).seeks.slice(0, 3)).toEqual([1017, 1021, 1025]);
    expect(steps(windows, 1500)).toMatchObject({ cards: [1899] });
    expect(steps(windows, 1500).seeks[0]).toBe(1899);
    expect(steps(windows, 1950).seeks).toEqual([END]);
    expect(steps(windows, END).seeks).toEqual([]);
  });

  it('a journey\'s windows (no nightBefore) still get the card between them', () => {
    const journey: JourneyWindow[] = [{ startMin: 1000, endMin: 1010 }, { startMin: 1100, endMin: 1110 }];
    expect(nextJourneyAction(journey, 1010)).toEqual({ kind: 'seek', toMin: 1100, overnight: true });
    expect(nextJourneyAction([journey[0], { ...journey[1], nightBefore: false }], 1010)).toEqual({ kind: 'seek', toMin: 1100 });
  });
});

describe('the player with no package picked (#790)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const windows = networkWindows(SIM, END);
  const target = { shipmentId: null, runId: 'run-1' };

  function setup() {
    const sent: SimControlRequest[] = [];
    const states: PlayState[] = [];
    let hold: { release: () => void } | null = null;
    let holdNext = false;
    const control = async (req: SimControlRequest) => {
      sent.push(req);
      if (holdNext) {
        holdNext = false;
        await new Promise<void>((r) => { hold = { release: r }; });
      }
      return {};
    };
    const player = createJourneyPlayer({
      control,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      onChange: (s) => states.push(s),
    });
    const seeks = () => sent.flatMap((r) => (r.action === 'seek' ? [r.timeMin] : []));
    return { player, sent, states, seeks, holdNextSeek: () => { holdNext = true; }, release: () => hold?.release() };
  }

  it('sends only seeks, one per JOURNEY_STEP_MS, the card for OVERNIGHT_CARD_MS, then finished', async () => {
    const { player, sent, states, seeks } = setup();
    player.start({ ...target, windows, fromMin: 930, clockPlaying: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(seeks()).toEqual([999]);
    expect(player.state()).toEqual({ status: 'running', overnight: false, ...target });
    await vi.advanceTimersByTimeAsync(JOURNEY_STEP_MS);
    expect(seeks()).toEqual([999, 1000]);
    await vi.advanceTimersByTimeAsync(60 * JOURNEY_STEP_MS + OVERNIGHT_CARD_MS);
    expect(player.state()).toEqual({ status: 'finished', ...target });
    expect(seeks()).toEqual(steps(windows, 930).seeks);
    expect(sent.every((r) => r.action === 'seek')).toBe(true);
    expect(states.filter((s) => s.status === 'running' && s.overnight)).toHaveLength(1);
  });

  it('on a playing clock it pauses the clock first (a pause does not lock the run), then seeks', async () => {
    const { player, sent } = setup();
    player.start({ ...target, windows, fromMin: 930, clockPlaying: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([{ action: 'pause' }, { action: 'seek', timeMin: 999 }]);
  });

  it('Pause stops at the current minute: no further seek, and a late answer changes nothing', async () => {
    const { player, seeks, holdNextSeek, release } = setup();
    player.start({ ...target, windows, fromMin: 930, clockPlaying: false });
    await vi.advanceTimersByTimeAsync(0);
    holdNextSeek();
    await vi.advanceTimersByTimeAsync(JOURNEY_STEP_MS); // the seek to 1000 is out, unanswered
    expect(player.pause()).toBe(true);
    expect(player.state()).toEqual({ status: 'paused', ...target });
    release();
    await vi.advanceTimersByTimeAsync(10 * JOURNEY_STEP_MS);
    expect(seeks()).toEqual([999, 1000]);
    expect(player.state()).toEqual({ status: 'paused', ...target });
    expect(player.pause()).toBe(false); // a second Esc is not used by the player
  });

  it('reset (Back to start, a package picked) and dispose leave no timer behind', async () => {
    for (const stop of ['reset', 'dispose'] as const) {
      const { player, seeks } = setup();
      player.start({ ...target, windows, fromMin: 930, clockPlaying: false });
      await vi.advanceTimersByTimeAsync(3 * JOURNEY_STEP_MS);
      player[stop]();
      const sent = seeks().length;
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(10 * JOURNEY_STEP_MS);
      expect(seeks()).toHaveLength(sent);
      expect(player.state()).toEqual(PLAY_IDLE);
    }
  });

  it('picking a package or a new run resets it; the clock starting to play elsewhere pauses it', async () => {
    const run = async () => {
      const s = setup();
      s.player.start({ ...target, windows, fromMin: 930, clockPlaying: false });
      await vi.advanceTimersByTimeAsync(0);
      return s.player;
    };
    const net = { shipmentId: null, runId: 'run-1', clockPlaying: false };
    const picked = await run();
    syncJourneyPlayer(picked, net, { ...net, shipmentId: 'shp-1' });
    expect(picked.state()).toEqual(PLAY_IDLE);
    const newRun = await run();
    syncJourneyPlayer(newRun, net, { ...net, runId: 'run-2' });
    expect(newRun.state()).toEqual(PLAY_IDLE);
    const otherTab = await run();
    syncJourneyPlayer(otherTab, net, { ...net, clockPlaying: true });
    expect(otherTab.state()).toEqual({ status: 'paused', ...target });
    const same = await run();
    syncJourneyPlayer(same, net, { ...net });
    expect(same.state().status).toBe('running');
  });

  it('a refused seek ends it as failed with no further call', async () => {
    const sent: SimControlRequest[] = [];
    const player = createJourneyPlayer({
      control: async (req) => { sent.push(req); return sent.length > 1 ? null : {}; },
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      onChange: () => {},
    });
    player.start({ ...target, windows, fromMin: 930, clockPlaying: false });
    await vi.advanceTimersByTimeAsync(10 * JOURNEY_STEP_MS);
    expect(sent).toHaveLength(2);
    expect(player.state()).toEqual({ status: 'failed', ...target });
  });
});

describe('what the page shows for network Play (#790)', () => {
  const target = { shipmentId: null, runId: 'run-1' };

  it('the network state is the one on screen only with no package picked, on its run', () => {
    const s: PlayState = { status: 'running', overnight: false, ...target };
    expect(currentPlay(s, null, 'run-1')).toBe(s);
    expect(currentPlay(s, 'shp-1', 'run-1')).toBe(PLAY_IDLE);
    expect(currentPlay(s, null, 'run-2')).toBe(PLAY_IDLE);
  });

  it('the status line: one fixed sentence per state (no journey needed)', () => {
    expect(playStatusText(null, { status: 'running', overnight: false, ...target })).toBe(NETWORK_PLAYING_TEXT);
    expect(playStatusText(null, { status: 'running', overnight: true, ...target })).toBe(NETWORK_PLAYING_TEXT);
    expect(playStatusText(null, { status: 'paused', ...target })).toBe(NETWORK_PAUSED_TEXT);
    expect(playStatusText(null, { status: 'finished', ...target })).toBe(NETWORK_FINISHED_TEXT);
    expect(playStatusText(null, { status: 'failed', ...target })).toBe('');
    expect(playStatusText(null, PLAY_IDLE)).toBe('');
  });

  it('the overnight card reads the network text while it is up, nothing otherwise', () => {
    expect(overnightText(null, { status: 'running', overnight: true, ...target })).toBe(NETWORK_OVERNIGHT_TEXT);
    expect(overnightText(null, { status: 'running', overnight: false, ...target })).toBeNull();
    expect(overnightText(null, { status: 'paused', ...target })).toBeNull();
  });
});
