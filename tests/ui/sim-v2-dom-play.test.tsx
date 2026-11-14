// @vitest-environment jsdom
// "Play journey" on the MVP II simulator page in a real DOM with fake timers (#519, on top of #496):
// one click starts it, the seeks arrive in the planned order (2 simulated minutes every 500 ms inside
// a leg, one jump over each gap), the step line in the live region follows the server's events, Stop
// and Esc end it with no further call, an unmount leaves no timer and no call behind, and with reduced
// motion the steps snap (no animation frame is asked for).
// The map runs in its no-key state: the Google loader is replaced by a recorder that must stay unused.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimulatorResponse } from '../../shared/v2/api';
import type { SimControlRequest } from '../../shared/v2/schemas';
import { BUSY_REASON } from '../../client/src/components/sim/v2/controls/controlsModel';
import { simDataReducer, type SimDataState } from '../../client/src/components/sim/v2/live/simDataModel';
import { createSimActions } from '../../client/src/components/sim/v2/live/useSimulatorV2';
import { button, buttons, click, press, textOf } from './kitDom';
import {
  FakeSimServer, T, advance, currentSearch, journeySteps, leftBody, mountBody, mountPage, playStatus, readyState,
  runAt, settle, stubMatchMedia,
} from './sim-v2-dom-helpers';

const google = vi.hoisted(() => ({ loads: 0 }));
vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: () => { google.loads += 1; },
  importLibrary: () => { google.loads += 1; return new Promise(() => {}); },
}));

/** Spies on animation frames (the mover tween); installed after the fake timers so it wraps theirs. */
let rafCalls = 0;

beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
  google.loads = 0;
  vi.useFakeTimers();
  rafCalls = 0;
  const raf = window.requestAnimationFrame.bind(window);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafCalls += 1; return raf(cb); });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  expect(google.loads).toBe(0);
});

const SHP2 = { kind: 'package', id: 'shp-2' } as const;
const STEP_MS = 500;

/**
 * The planned seeks for the relay sample, written out: leg 1 from one minute before the first
 * arrival (1039) to the drop's service end (1062), then one jump over the night to 1949 and leg 2 to
 * the delivery's service end (1977). 2 minutes per step, never past a window's end.
 */
const PLANNED = [
  1039, 1041, 1043, 1045, 1047, 1049, 1051, 1053, 1055, 1057, 1059, 1061, 1062,
  1949, 1951, 1953, 1955, 1957, 1959, 1961, 1963, 1965, 1967, 1969, 1971, 1973, 1975, 1977,
];

const playButton = (c: ParentNode) => button(c, 'Play journey');
const stopButton = (c: ParentNode) => button(c, 'Stop');

describe('Play journey', () => {
  it('one click plays the whole journey: seeks in the planned order, the step line updated, then back to Play', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, SHP2);
    const status = playStatus(c)!;
    expect(status.getAttribute('role')).toBe('status');
    expect(textOf(status)).toBe('');
    expect(textOf(c)).toContain('about 14 s');

    click(playButton(c));
    await settle();
    expect(server.seeks()).toEqual([1039]);
    expect(buttons(c, 'Play journey')).toHaveLength(0);
    expect(stopButton(c)).toBeTruthy();
    expect(textOf(status)).toBe('Step 1 of 4 next: Pickup at sender at DUMBO Studio.');

    await advance(2 * STEP_MS); // 1041, 1043: the pickup (1042) has happened
    expect(server.seeks()).toEqual([1039, 1041, 1043]);
    expect(textOf(playStatus(c)!)).toBe('Step 2 of 4 next: Drop at relay point at Brooklyn Roasting.');
    expect(playStatus(c)).toBe(status); // the same live region, its text replaced

    await advance(11 * STEP_MS); // to 1062 (dropped at the relay point), then the jump to 1949
    expect(server.seeks().slice(-2)).toEqual([1062, 1949]);
    expect(textOf(status)).toBe('Step 3 of 4 next: Pickup at relay point at Brooklyn Roasting.');

    await advance(20 * STEP_MS);
    expect(server.seeks()).toEqual(PLANNED);
    expect(server.controls().every((r) => r.action === 'seek')).toBe(true);
    expect(textOf(status)).toBe('Journey complete: Delivered to recipient at Etsy.');
    expect(playButton(c)).toBeTruthy();
    expect(server.selections).toEqual([]); // the journey stays on screen

    await advance(10 * STEP_MS);
    expect(server.seeks()).toHaveLength(PLANNED.length);
  }, T);

  it('pauses a playing clock first, then seeks', async () => {
    const start = readyState(1000);
    const server = new FakeSimServer({ ...start, sim: { ...start.sim!, clock: { ...start.sim!.clock, playing: true } } });
    const { container: c } = mountBody(server, SHP2);
    click(playButton(c));
    await settle();
    await advance(STEP_MS);
    expect(server.controls()).toEqual([
      { action: 'pause' }, { action: 'seek', timeMin: 1039 }, { action: 'seek', timeMin: 1041 },
    ]);
    expect(stopButton(c)).toBeTruthy();
  }, T);

  it('Stop ends it: "Journey stopped." and no further call', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, SHP2);
    click(playButton(c));
    await advance(3 * STEP_MS);
    expect(server.seeks()).toEqual(PLANNED.slice(0, 4));

    click(stopButton(c));
    expect(textOf(playStatus(c)!)).toBe('Journey stopped.');
    expect(playButton(c)).toBeTruthy();
    await advance(20 * STEP_MS);
    expect(server.seeks()).toEqual(PLANNED.slice(0, 4));
    expect(server.calls).toHaveLength(4);
    expect(journeySteps(c)).toHaveLength(4); // still in the journey
  }, T);

  it('on the page, the first Esc stops the journey and the next one goes back to the network', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountPage(server, '?package=shp-2');
    click(playButton(c));
    await advance(STEP_MS);
    expect(server.seeks()).toEqual([1039, 1041]);

    press('Escape', document.activeElement!); // focus is on the Stop button the click left it on
    expect(textOf(playStatus(c)!)).toBe('Journey stopped.');
    expect(currentSearch(server)).toBe('?package=shp-2');
    await advance(10 * STEP_MS);
    expect(server.seeks()).toEqual([1039, 1041]);

    (document.activeElement as HTMLElement).blur(); // Esc from the page body; the next test keeps the focus
    press('Escape', document.body);
    expect(currentSearch(server)).toBe('');
    expect(journeySteps(c)).toHaveLength(0);
  }, T);

  // After the first Esc stops the journey, the focus is still on the Play journey button. The page's
  // key map used to claim Esc from a focused button, so this second Esc did nothing; #511 (PR #537)
  // fixed it in page/keyMap.ts (isTextTarget) and page/simPageState.ts.
  it('the second Esc, with the focus still on the Play journey button, goes back to the network', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountPage(server, '?package=shp-2');
    click(playButton(c));
    await advance(STEP_MS);
    press('Escape', document.activeElement!);
    expect(textOf(playStatus(c)!)).toBe('Journey stopped.');
    expect(document.activeElement).toBe(playButton(c));
    press('Escape', document.activeElement!);
    expect(currentSearch(server)).toBe('');
  }, T);

  it('an unmount while it plays leaves no timer and no call behind', async () => {
    const server = new FakeSimServer(readyState(1000));
    const m = mountBody(server, SHP2);
    click(playButton(m.container));
    await advance(2 * STEP_MS);
    const sent = server.calls.length;
    expect(sent).toBe(3);

    m.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await advance(30 * STEP_MS);
    expect(server.calls).toHaveLength(sent);
    expect(vi.getTimerCount()).toBe(0);
  }, T);

  it('a refused step stops it with the error as an alert and no further call', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, SHP2);
    click(playButton(c));
    await advance(STEP_MS);
    server.refuse = true;
    await advance(STEP_MS);
    expect(server.seeks()).toEqual([1039, 1041, 1043]);
    expect(textOf(c.querySelector('.spc-play [role="alert"]')!)).toBe('Play journey stopped: the simulator did not accept a step.');
    await advance(10 * STEP_MS);
    expect(server.seeks()).toHaveLength(3);
  }, T);
});

describe('Play journey and motion', () => {
  it('without reduced motion each step is tweened (animation frames are asked for)', async () => {
    stubMatchMedia({ reduced: false });
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, SHP2);
    click(playButton(c));
    await advance(4 * STEP_MS);
    expect(rafCalls).toBeGreaterThan(0);
  }, T);

  it('with reduced motion it steps the same seeks without a tween', async () => {
    const media = stubMatchMedia({ reduced: true });
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, SHP2);
    click(playButton(c));
    await advance(40 * STEP_MS);
    expect(media.queries).toContain('(prefers-reduced-motion: reduce)');
    expect(server.seeks()).toEqual(PLANNED);
    expect(rafCalls).toBe(0);
    expect(textOf(playStatus(c)!)).toBe('Journey complete: Delivered to recipient at Etsy.');
  }, T);
});

/** Control answers arrive this long after the request, like a slow connection. */
const DELAY_MS = 300;

/**
 * A fake server whose controls go through the real `createSimActions` (#594), so `busy` is set the way
 * the page's hook sets it, and whose control answers arrive DELAY_MS late. Each answer carries a higher
 * version and keeps a next event ahead, so "Next event" has no reason of its own to be disabled.
 */
class SlowControlServer extends FakeSimServer {
  private version = 100;
  private readonly actions = createSimActions({
    simulatorControl: (req) => {
      const answer = this.answer(req);
      return new Promise<SimulatorResponse>((res) => { setTimeout(() => res(answer), DELAY_MS); });
    },
    generateScenario: () => Promise.reject(new Error('unused')),
    resetPlanning: () => Promise.reject(new Error('unused')),
    recomputeMatches: () => Promise.reject(new Error('unused')),
    compareMatches: () => Promise.reject(new Error('unused')),
  }, (a) => this.set(simDataReducer(this.state, a)), () => {});

  constructor(state: SimDataState) { super(state); }

  private answer(req: SimControlRequest): SimulatorResponse {
    const cur = this.state.sim!;
    const base = req.action === 'seek' ? runAt(req.timeMin, { runId: cur.runId }) : cur;
    const playing = req.action === 'play' ? true : req.action === 'pause' ? false : base.clock.playing;
    this.version += 1;
    return { ...base, version: this.version, nextEventMin: 2100, clock: { ...base.clock, playing } };
  }

  override control(req: SimControlRequest): Promise<SimulatorResponse | null> {
    this.calls.push({ name: 'control', req });
    return this.actions.control(req);
  }
}

describe('Play journey keeps the left panel still (#594)', () => {
  const nextEvent = (c: ParentNode) => button(leftBody(c), 'Next event');

  it('with slow answers, no busy text and no disabled Next event while it plays; Play and Pause still show busy', async () => {
    const server = new SlowControlServer(readyState(1000));
    const { container: c } = mountPage(server, '?package=shp-2');
    expect(textOf(leftBody(c))).not.toContain(BUSY_REASON);

    click(playButton(c));
    let checks = 0;
    // 100 ms at a time through the whole journey (each step waits for its slow answer).
    for (let t = 0; t < 60 * STEP_MS && buttons(c, 'Play journey').length === 0; t += 100) {
      await advance(100);
      expect(server.state.busy).toBe(false);
      expect(textOf(leftBody(c))).not.toContain(BUSY_REASON);
      expect(leftBody(c).querySelector(`[title="${BUSY_REASON}"]`)).toBeNull();
      expect(nextEvent(c).disabled).toBe(false);
      checks += 1;
    }
    expect(checks).toBeGreaterThan(30);
    expect(server.seeks()).toEqual(PLANNED);
    expect(textOf(playStatus(c)!)).toBe('Journey complete: Delivered to recipient at Etsy.');
    expect(server.state.sim?.clock.timeMin).toBe(1977); // the last seek's answer is what is shown

    // Every other control is busy as before: Play, then Pause.
    click(button(leftBody(c), 'Play'));
    await settle();
    expect(textOf(leftBody(c))).toContain(BUSY_REASON);
    expect(nextEvent(c).disabled).toBe(true);
    await advance(DELAY_MS);
    expect(textOf(leftBody(c))).not.toContain(BUSY_REASON);

    click(button(leftBody(c), 'Pause'));
    await settle();
    expect(textOf(leftBody(c))).toContain(BUSY_REASON);
    expect(nextEvent(c).disabled).toBe(true);
    await advance(DELAY_MS);
    expect(textOf(leftBody(c))).not.toContain(BUSY_REASON);
    expect(nextEvent(c).disabled).toBe(false);
  }, T);
});
