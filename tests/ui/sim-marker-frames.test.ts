import { describe, expect, it } from 'vitest';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { snapshotAt } from '../../server/domain/simulation';
import type { Snapshot } from '../../shared/types';
import {
  advanceFrames, framePositions, initialFrames, type FrameState,
} from '../../client/src/components/sim/markerTween';

// Real data: the Demo city, polled every STEP simulated minutes (1 s at speed 30 is 30 min).
const run = createInitialRun(loadDefaultScenario());
const STEP = 5;
const clock = { speed: 30 as const };

const moving = (a: Snapshot, b: Snapshot) => b.markers.some((m) => {
  const p = a.markers.find((x) => x.employeeId === m.employeeId);
  return p && (p.x !== m.x || p.y !== m.y);
});

// First minute where a carrier keeps moving across 3 consecutive polls.
function findMovingPolls(): Snapshot[] {
  const { simStartMin, simEndMin } = run.scenario.settings;
  for (let t = simStartMin; t + 2 * STEP <= simEndMin; t += STEP) {
    const snaps = [t, t + STEP, t + 2 * STEP].map((m) => snapshotAt(run, m));
    if (moving(snaps[0], snaps[1]) && moving(snaps[1], snaps[2])) return snaps;
  }
  throw new Error('no moving carrier in the demo city');
}
const polls = findMovingPolls();

const shown = (s: FrameState, reduced = false) => framePositions(s, reduced);
const positionsOf = (s: Snapshot) => ({ markers: s.markers, packagePositions: s.packagePositions });
// Compare only what is drawn: position per marker id / package id.
const xy = (p: ReturnType<typeof shown>) => ({
  markers: Object.fromEntries(p.markers.map((m) => [m.employeeId, [m.x, m.y]])),
  packages: Object.fromEntries(Object.entries(p.packagePositions).map(([id, q]) => [id, [q.x, q.y]])),
});
// What the old snapshot drew, restricted to ids that are still on the map in the new one.
const carriedOver = (prev: Snapshot, next: Snapshot) => {
  const p = xy(positionsOf(prev));
  const n = xy(positionsOf(next));
  const pick = (from: Record<string, number[]>, to: Record<string, number[]>) =>
    Object.fromEntries(Object.keys(to).map((id) => [id, from[id] ?? to[id]]));
  return { markers: pick(p.markers, n.markers), packages: pick(p.packages, n.packages) };
};

describe('advanceFrames on real polls', () => {
  it('the polls really move a carrier', () => {
    expect(xy(positionsOf(polls[1]))).not.toEqual(xy(positionsOf(polls[0])));
  });

  it('first frame after each new snapshot shows the previous positions; alpha 1 shows the new ones', () => {
    let state = initialFrames(polls[0]);
    expect(xy(shown(state))).toEqual(xy(positionsOf(polls[0])));
    for (let i = 1; i < polls.length; i++) {
      state = advanceFrames(state, polls[i], clock, false);
      expect(state.next).toBe(polls[i]);
      expect(state.alpha).toBe(0);
      expect(state.tween).toBe(true);
      expect(xy(shown(state))).toEqual(carriedOver(polls[i - 1], polls[i])); // no forward jump
      state = { ...state, alpha: 0.5 };
      expect(xy(shown(state))).not.toEqual(xy(positionsOf(polls[i])));
      state = { ...state, alpha: 1 };
      expect(xy(shown(state))).toEqual(xy(positionsOf(polls[i])));
    }
  });

  it('a poll that lands mid-tween starts from what is on screen, not from the old snapshot', () => {
    const mid = { ...advanceFrames(initialFrames(polls[0]), polls[1], clock, false), alpha: 0.4 };
    const onScreen = xy(shown(mid));
    const nextState = advanceFrames(mid, polls[2], clock, false);
    expect(nextState.alpha).toBe(0);
    const first = xy(shown(nextState));
    for (const [id, pos] of Object.entries(first.markers)) {
      if (onScreen.markers[id]) expect(pos).toEqual(onScreen.markers[id]);
    }
  });

  it('the same snapshot object again does not restart the tween', () => {
    const state = { ...advanceFrames(initialFrames(polls[0]), polls[1], clock, false), alpha: 0.7 };
    expect(advanceFrames(state, polls[1], clock, false)).toBe(state);
    const settled = initialFrames(polls[0]);
    expect(advanceFrames(settled, polls[0], clock, false)).toBe(settled);
  });

  describe('snap cases show the new positions at once', () => {
    const base = advanceFrames(initialFrames(polls[0]), polls[1], clock, false);
    const expectSnap = (next: Snapshot, reduced = false, speed = clock) => {
      const state = advanceFrames(base, next, speed, reduced);
      expect(state.next).toBe(next);
      expect(state.alpha).toBe(1);
      expect(state.tween).toBe(false);
      expect(xy(shown(state, reduced))).toEqual(xy(positionsOf(next)));
    };
    it('new runId', () => expectSnap({ ...polls[2], runId: `${polls[2].runId}-new` }));
    it('rewind', () => expectSnap(polls[0]));
    it('seek/jump', () => expectSnap(snapshotAt(run, polls[1].timeMin + clock.speed * 2 + 1)));
    it('reduced motion', () => expectSnap(polls[2], true));
  });
});
