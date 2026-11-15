// @vitest-environment jsdom
// The simulator's one Play/Pause button in a real DOM with fake timers (#519 and #496, one button in
// #648). With a package picked, one click plays its journey: the seeks arrive in the planned order
// (2 simulated minutes every 500 ms inside a leg), the card "Overnight at <relay point>" stands in
// for the night for about 1 s, the step line in the live region follows the server's events, Pause
// and Esc stop it with no further call and Play goes on from there, an unmount leaves no timer and
// no call behind, and with reduced motion the steps snap (no animation frame is asked for). With no
// package the same button steps every carrier's commute with seeks (#790). `?play=1` starts a journey once.
// The map runs in its no-key state: the Google loader is replaced by a recorder that must stay unused.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimulatorResponse } from '../../shared/v2/api';
import type { SimControlRequest } from '../../shared/v2/schemas';
import { BUSY_REASON } from '../../client/src/components/sim/v2/controls/controlsModel';
import { simDataReducer, type SimDataState } from '../../client/src/components/sim/v2/live/simDataModel';
import { createSimActions } from '../../client/src/components/sim/v2/live/useSimulatorV2';
import { button, buttons, click, press, textOf } from './kitDom';
import {
  FakeSimServer, T, advance, currentSearch, journeySteps, leftBody, mountBody, mountPage, overnightCard, packageRow, playPause,
  playStatus, readyState, rightBody, runAt, settle, stubMatchMedia,
} from './sim-v2-dom-helpers';

/** #725: Play/Pause and Back to start are `aria-disabled` (never `disabled`, which would drop focus to <body>). */
function isOff(b: HTMLButtonElement): boolean {
  expect(b.disabled).toBe(false);
  return b.getAttribute('aria-disabled') === 'true';
}

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

const SHP1 = { kind: 'package', id: 'shp-1' } as const;
const SHP2 = { kind: 'package', id: 'shp-2' } as const;
const STEP_MS = 500;
const CARD_MS = 1000;

/**
 * The planned seeks for the relay sample, written out: leg 1 from one minute before the first
 * arrival (1039) to the drop's service end (1062), then (after the overnight card) one jump to 1949
 * and leg 2 to the delivery's service end (1977). 2 minutes per step, never past a window's end.
 */
const LEG1 = [1039, 1041, 1043, 1045, 1047, 1049, 1051, 1053, 1055, 1057, 1059, 1061, 1062];
const LEG2 = [1949, 1951, 1953, 1955, 1957, 1959, 1961, 1963, 1965, 1967, 1969, 1971, 1973, 1975, 1977];
const PLANNED = [...LEG1, ...LEG2];
/** The direct sample (shp-1): one leg, 1049 to the delivery's service end. */
const DIRECT_FIRST = 1049;
/** The whole relay journey in real time: one step per seek, plus the card. */
const TOTAL_MS = PLANNED.length * STEP_MS + CARD_MS;

const label = (c: ParentNode) => textOf(playPause(c));
/** A click on the one button, which must read `expected` now. */
function clickPlayPause(c: ParentNode, expected: 'Play' | 'Pause') {
  expect(label(c)).toBe(expected);
  click(playPause(c));
}
const withClock = (state: SimDataState, clock: Partial<SimulatorResponse['clock']>): SimDataState =>
  ({ ...state, sim: { ...state.sim!, clock: { ...state.sim!.clock, ...clock } } });

describe('one Play/Pause button: a picked package plays its journey', () => {
  it('one click plays the whole journey: seeks in the planned order, the step line updated, then back to Play', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, SHP2);
    const status = playStatus(c)!;
    expect(status.getAttribute('role')).toBe('status');
    expect(textOf(status)).toBe('');

    clickPlayPause(c, 'Play');
    await settle();
    expect(server.seeks()).toEqual([1039]);
    expect(label(c)).toBe('Pause');
    expect(textOf(status)).toBe('Step 1 of 4 next: Pickup at sender at DUMBO Studio.');

    await advance(2 * STEP_MS); // 1041, 1043: the pickup (1042) has happened
    expect(server.seeks()).toEqual([1039, 1041, 1043]);
    expect(textOf(playStatus(c)!)).toBe('Step 2 of 4 next: Drop at relay point at Brooklyn Roasting.');
    expect(playStatus(c)).toBe(status); // the same live region, its text replaced

    await advance(10 * STEP_MS); // to 1062: dropped at the relay point
    expect(server.seeks()).toEqual(LEG1);
    expect(textOf(status)).toBe('Step 3 of 4 next: Pickup at relay point at Brooklyn Roasting.');

    await advance(TOTAL_MS);
    expect(server.seeks()).toEqual(PLANNED);
    expect(server.controls().every((r) => r.action === 'seek')).toBe(true);
    expect(textOf(status)).toBe('Journey complete: Delivered to recipient at Etsy.');
    expect(label(c)).toBe('Play');
    expect(server.selections).toEqual([]); // the journey stays on screen

    await advance(10 * STEP_MS);
    expect(server.seeks()).toHaveLength(PLANNED.length);
  }, T);

  it('the page has one Play/Pause button, in the left panel; the journey panel has none of its own', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, SHP2);
    const playLike = () => buttons(c, /^(Play|Pause|Stop|Resume)\b/);
    expect(playLike()).toEqual([playPause(c)]);
    expect(buttons(rightBody(c), /Play|Pause|Stop/)).toHaveLength(0);
    expect(textOf(c)).not.toMatch(/Play journey|about \d+ s/);
    clickPlayPause(c, 'Play');
    await advance(STEP_MS);
    expect(playLike()).toEqual([playPause(c)]);
    expect(buttons(rightBody(c), /Play|Pause|Stop/)).toHaveLength(0);
  }, T);

  it('once the journey has finished, Play starts it from the start again', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, SHP2);
    clickPlayPause(c, 'Play');
    await advance(TOTAL_MS);
    expect(server.seeks()).toEqual(PLANNED);
    clickPlayPause(c, 'Play');
    await advance(STEP_MS);
    expect(server.seeks()).toEqual([...PLANNED, 1039, 1041]);
  }, T);

  it('an unmount while it plays leaves no timer and no call behind', async () => {
    const server = new FakeSimServer(readyState(1000));
    const m = mountBody(server, SHP2);
    clickPlayPause(m.container, 'Play');
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
    clickPlayPause(c, 'Play');
    await advance(STEP_MS);
    server.refuse = true;
    await advance(STEP_MS);
    expect(server.seeks()).toEqual([1039, 1041, 1043]);
    expect(textOf(c.querySelector('.ctl-playback [role="alert"]')!)).toBe('Play stopped: the simulator did not accept a step.');
    expect(label(c)).toBe('Play');
    await advance(10 * STEP_MS);
    expect(server.seeks()).toHaveLength(3);
  }, T);

  it('an unmatched package has nothing to play: the button is disabled and says why', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, { kind: 'package', id: 'shp-3' });
    expect(label(c)).toBe('Play');
    expect(isOff(playPause(c))).toBe(true);
    const note = document.getElementById(playPause(c).getAttribute('aria-describedby')!)!;
    expect(textOf(note)).toBe('No journey to play: this package has no match yet.');
    await advance(5 * STEP_MS);
    expect(server.calls).toEqual([]);
  }, T);

  it('a package picked while the server clock plays: Pause pauses the clock, then Play plays the journey', async () => {
    const server = new FakeSimServer(withClock(readyState(1000), { playing: true }));
    const { container: c } = mountBody(server, SHP2);
    clickPlayPause(c, 'Pause');
    await settle();
    expect(server.controls()).toEqual([{ action: 'pause' }]);
    clickPlayPause(c, 'Play');
    await advance(STEP_MS);
    expect(server.controls().slice(1)).toEqual([{ action: 'seek', timeMin: 1039 }, { action: 'seek', timeMin: 1041 }]);
  }, T);
});

describe('pause and resume (#648)', () => {
  it('Pause stops stepping and keeps the clock where it is: "Journey paused." and no further call', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, SHP2);
    clickPlayPause(c, 'Play');
    await advance(3 * STEP_MS);
    expect(server.seeks()).toEqual(PLANNED.slice(0, 4));

    clickPlayPause(c, 'Pause');
    expect(textOf(playStatus(c)!)).toBe('Journey paused.');
    expect(label(c)).toBe('Play');
    await advance(20 * STEP_MS);
    expect(server.seeks()).toEqual(PLANNED.slice(0, 4));
    expect(server.calls).toHaveLength(4); // no pause, reset or seek request: the clock is where the last step left it
    expect(server.state.sim?.clock.timeMin).toBe(1045);
    expect(journeySteps(c)).toHaveLength(4); // still in the journey
  }, T);

  it('Play again resumes from there: the next step, not the start, and every minute once', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, SHP2);
    clickPlayPause(c, 'Play');
    await advance(3 * STEP_MS);
    clickPlayPause(c, 'Pause');
    await advance(5_000);

    clickPlayPause(c, 'Play');
    await settle();
    expect(server.seeks()).toEqual([1039, 1041, 1043, 1045, 1047]);
    expect(label(c)).toBe('Pause');
    await advance(TOTAL_MS);
    expect(server.seeks()).toEqual(PLANNED);
    expect(textOf(playStatus(c)!)).toBe('Journey complete: Delivered to recipient at Etsy.');
  }, T);

  it('pause, a click on a timeline step, Play: it goes on from the step that was clicked', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, SHP2);
    clickPlayPause(c, 'Play');
    await advance(2 * STEP_MS);
    click(journeySteps(c)[2]); // "Pickup at relay point": a click pauses the journey and seeks there
    await settle();
    expect(label(c)).toBe('Play');
    const at = server.state.sim!.clock.timeMin;
    expect(at).toBeGreaterThanOrEqual(1949);
    const before = server.seeks().length;

    clickPlayPause(c, 'Play');
    await settle();
    expect(server.seeks().slice(before)).toEqual([Math.min(at + 2, 1977)]);
  }, T);

  it('Back to start during a journey: one reset, the journey is idle, and Play starts from the start', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, SHP2);
    clickPlayPause(c, 'Play');
    await advance(3 * STEP_MS);
    click(button(leftBody(c), 'Back to start'));
    await advance(10 * STEP_MS);
    expect(server.controls().slice(4)).toEqual([{ action: 'reset_playback' }]);
    expect(label(c)).toBe('Play');
    expect(textOf(playStatus(c)!)).toBe('');
    expect(server.state.sim?.clock.timeMin).toBe(930);

    clickPlayPause(c, 'Play');
    await settle();
    expect(server.seeks().slice(4)).toEqual([1039]);
  }, T);

  it('on the page, the first Esc pauses the journey and the next one goes back to the network', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountPage(server, '?package=shp-2');
    clickPlayPause(c, 'Play');
    await advance(STEP_MS);
    expect(server.seeks()).toEqual([1039, 1041]);

    press('Escape', document.activeElement!); // focus is on the button the click left it on
    expect(textOf(playStatus(c)!)).toBe('Journey paused.');
    expect(currentSearch(server)).toBe('?package=shp-2');
    await advance(10 * STEP_MS);
    expect(server.seeks()).toEqual([1039, 1041]);

    (document.activeElement as HTMLElement).blur(); // Esc from the page body; the next test keeps the focus
    press('Escape', document.body);
    expect(currentSearch(server)).toBe('');
    expect(journeySteps(c)).toHaveLength(0);
  }, T);

  // After the first Esc pauses the journey, the focus is still on the Play/Pause button. The page's
  // key map used to claim Esc from a focused button, so this second Esc did nothing; #511 (PR #537)
  // fixed it in page/keyMap.ts (isTextTarget) and page/simPageState.ts.
  it('the second Esc, with the focus still on the Play/Pause button, goes back to the network', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountPage(server, '?package=shp-2');
    clickPlayPause(c, 'Play');
    await advance(STEP_MS);
    press('Escape', document.activeElement!);
    expect(textOf(playStatus(c)!)).toBe('Journey paused.');
    expect(document.activeElement).toBe(playPause(c));
    press('Escape', document.activeElement!);
    expect(currentSearch(server)).toBe('');
  }, T);

  it('on the page, Space is the button: it plays the journey, pauses it and resumes it', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountPage(server, '?package=shp-2');
    press(' ', document.body);
    await advance(STEP_MS);
    expect(server.seeks()).toEqual([1039, 1041]);
    expect(label(c)).toBe('Pause');

    press(' ', document.body);
    expect(label(c)).toBe('Play');
    expect(textOf(playStatus(c)!)).toBe('Journey paused.');
    await advance(10 * STEP_MS);
    expect(server.controls()).toEqual([{ action: 'seek', timeMin: 1039 }, { action: 'seek', timeMin: 1041 }]);

    press(' ', document.body);
    await settle();
    expect(server.seeks()).toEqual([1039, 1041, 1043]);
    expect(currentSearch(server)).toBe('?package=shp-2');
  }, T);
});

describe('the overnight card (#648)', () => {
  it('relay: after the evening leg the card is shown for about 1 s, then gone, then the morning seek', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, SHP2);
    expect(overnightCard(c)).toBeNull();
    clickPlayPause(c, 'Play');
    await advance((LEG1.length - 1) * STEP_MS);
    expect(server.seeks()).toEqual(LEG1);
    expect(overnightCard(c)).toBeNull(); // the evening leg is still on screen for one step

    await advance(STEP_MS);
    const card = overnightCard(c)!;
    expect(textOf(card)).toBe('Overnight at Brooklyn Roasting'); // the relay business by name, never an ID
    // #725: the card sits in the map's always-mounted live region, so it is announced when it appears.
    expect(card.getAttribute('role')).toBeNull();
    expect(card.parentElement!.getAttribute('role')).toBe('status');
    expect(card.parentElement!.classList.contains('spc-announce')).toBe(true);
    const moon = card.querySelector('svg')!;
    expect(moon.getAttribute('aria-hidden')).toBe('true');
    expect(card.closest('.spc-map')).not.toBeNull(); // over the map
    expect(label(c)).toBe('Pause');
    expect(server.seeks()).toEqual(LEG1); // no seek into the night

    await advance(CARD_MS - 1);
    expect(overnightCard(c)).not.toBeNull();
    expect(server.seeks()).toEqual(LEG1);

    await advance(1);
    expect(overnightCard(c)).toBeNull(); // gone
    expect(server.seeks()).toEqual([...LEG1, 1949]); // then the morning
    expect(server.state.sim?.clock.timeMin).toBe(1949);

    await advance(TOTAL_MS);
    expect(server.seeks()).toEqual(PLANNED);
    expect(overnightCard(c)).toBeNull();
    expect(server.seeks().some((t) => t > 1062 && t < 1949)).toBe(false); // the night is never played
  }, T);

  it('a direct journey plays to the end without the card', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, SHP1);
    clickPlayPause(c, 'Play');
    let shown = 0;
    for (let t = 0; t < 30 * STEP_MS && label(c) === 'Pause'; t += 100) {
      await advance(100);
      if (overnightCard(c)) shown += 1;
    }
    expect(shown).toBe(0);
    expect(label(c)).toBe('Play');
    expect(server.seeks()[0]).toBe(DIRECT_FIRST);
    expect(server.seeks().at(-1)).toBe(1072);
    expect(textOf(playStatus(c)!)).toBe('Journey complete: Delivered to recipient at Etsy.');
  }, T);

  it('Pause while the card is up takes it down and sends nothing; Play shows it again, then the morning', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, SHP2);
    clickPlayPause(c, 'Play');
    await advance(LEG1.length * STEP_MS + 400);
    expect(overnightCard(c)).not.toBeNull();

    clickPlayPause(c, 'Pause');
    expect(overnightCard(c)).toBeNull();
    await advance(5_000);
    expect(server.seeks()).toEqual(LEG1);

    clickPlayPause(c, 'Play');
    await settle();
    expect(textOf(overnightCard(c)!)).toBe('Overnight at Brooklyn Roasting');
    await advance(CARD_MS);
    expect(overnightCard(c)).toBeNull();
    expect(server.seeks()).toEqual([...LEG1, 1949]);
  }, T);

  it('picking another package while the card is up takes it down', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountPage(server, '?package=shp-2');
    clickPlayPause(c, 'Play');
    await advance(LEG1.length * STEP_MS + 400);
    expect(overnightCard(c)).not.toBeNull();
    press('Escape', document.body); // pauses the journey
    expect(overnightCard(c)).toBeNull();
    await advance(5_000);
    expect(server.seeks()).toEqual(LEG1);
  }, T);
});

/**
 * #790: network Play over the sample run (it has no `trips`, so each leg's window starts one minute before
 * its first stop): the evening legs merge into 1039 to 1110, the morning leg is 1949 to 1977, then one jump
 * to the end of the run (2160). The first step of a window is one minute, then 4 minutes per 500 ms.
 */
const NET_EVE = [1039, 1040, 1044, 1048, 1052, 1056, 1060, 1064, 1068, 1072, 1076, 1080, 1084, 1088, 1092, 1096, 1100, 1104, 1108, 1110];
const NET_MORN = [1949, 1950, 1954, 1958, 1962, 1966, 1970, 1974, 1977];
const NET_PLANNED = [...NET_EVE, ...NET_MORN, 2160];
const NET_TOTAL_MS = NET_PLANNED.length * STEP_MS + CARD_MS;
const NET_PLAYING = "Playing every carrier's commute.";
const NET_OVERNIGHT = 'Overnight: skipping to the morning commute';

describe('one Play/Pause button: no package picked steps every commute with seeks (#790)', () => {
  it('one click: the seeks in the planned order, the overnight card for the night, the end of the run; never play or speed', async () => {
    const server = new FakeSimServer(withClock(readyState(1000), { speed: 600, phase: 'planning' }));
    const { container: c } = mountBody(server, null);
    clickPlayPause(c, 'Play');
    await settle();
    expect(server.seeks()).toEqual([NET_EVE[0]]);
    expect(label(c)).toBe('Pause');
    expect(textOf(playStatus(c)!)).toBe(NET_PLAYING);

    await advance(NET_EVE.length * STEP_MS);
    expect(server.seeks()).toEqual(NET_EVE);
    expect(textOf(overnightCard(c)!)).toBe(NET_OVERNIGHT);
    expect(label(c)).toBe('Pause');
    await advance(CARD_MS);
    expect(overnightCard(c)).toBeNull();
    expect(server.seeks()).toEqual([...NET_EVE, NET_MORN[0]]);

    await advance(NET_TOTAL_MS);
    expect(server.seeks()).toEqual(NET_PLANNED);
    // Only seeks: the clock is never played, so its speed is never set and the run is never locked by Play.
    expect(server.controls().every((r) => r.action === 'seek')).toBe(true);
    expect(server.state.sim?.clock).toMatchObject({ playing: false, timeMin: 2160 });
    // Finished at the end of the run: Play is disabled and names Back to start; the step line says it is done.
    expect(label(c)).toBe('Play');
    expect(isOff(playPause(c))).toBe(true);
    expect(textOf(leftBody(c))).toContain('Run finished. Use Back to start to watch again.');
    expect(textOf(playStatus(c)!)).toBe('Every commute played.');
    await advance(5_000);
    expect(server.controls()).toHaveLength(NET_PLANNED.length);
  }, T);

  it('starts from the clock\'s minute: inside a window it goes on from there, not from the first departure', async () => {
    const server = new FakeSimServer(readyState(1060));
    const { container: c } = mountBody(server, null);
    clickPlayPause(c, 'Play');
    await settle();
    await advance(2 * STEP_MS);
    expect(server.seeks()).toEqual([1064, 1068, 1072]);
  }, T);

  it('Pause stops at the current minute with no further call; Play goes on from there', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, null);
    clickPlayPause(c, 'Play');
    await settle();
    await advance(3 * STEP_MS);
    clickPlayPause(c, 'Pause');
    await settle();
    const sent = server.seeks();
    expect(sent).toEqual(NET_EVE.slice(0, 4));
    expect(server.state.sim?.clock.timeMin).toBe(NET_EVE[3]);
    expect(label(c)).toBe('Play');
    expect(textOf(playStatus(c)!)).toBe('Paused.');
    await advance(5_000);
    expect(server.controls()).toHaveLength(sent.length);

    clickPlayPause(c, 'Play');
    await settle();
    await advance(STEP_MS);
    expect(server.seeks()).toEqual(NET_EVE.slice(0, 6));
  }, T);

  it('Pause while the card is up takes it down and sends nothing; Play shows it again, then the morning', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, null);
    clickPlayPause(c, 'Play');
    await settle();
    await advance(NET_EVE.length * STEP_MS);
    expect(overnightCard(c)).not.toBeNull();
    clickPlayPause(c, 'Pause');
    await settle();
    expect(overnightCard(c)).toBeNull();
    await advance(5_000);
    expect(server.seeks()).toEqual(NET_EVE);

    clickPlayPause(c, 'Play');
    await settle();
    expect(overnightCard(c)).not.toBeNull();
    await advance(CARD_MS);
    expect(server.seeks()).toEqual([...NET_EVE, NET_MORN[0]]);
  }, T);

  it('Back to start while it plays: one reset, no further seek, and Play starts again from the first departure', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, null);
    clickPlayPause(c, 'Play');
    await settle();
    await advance(2 * STEP_MS);
    click(button(leftBody(c), 'Back to start'));
    await settle();
    const before = server.controls();
    expect(before[before.length - 1]).toEqual({ action: 'reset_playback' });
    expect(label(c)).toBe('Play');
    expect(textOf(playStatus(c)!)).toBe('');
    await advance(5_000);
    expect(server.controls()).toEqual(before);

    clickPlayPause(c, 'Play');
    await settle();
    expect(server.seeks().slice(3)).toEqual([NET_EVE[0]]);
  }, T);

  it('a seek answer that lands after Pause sends nothing more and leaves the button at Play', async () => {
    const server = new FakeSimServer(readyState(1000));
    const answer = server.control.bind(server);
    let release: () => void = () => {};
    let n = 0;
    // The second seek hangs until `release`; the server records it when it answers.
    server.control = async (req) => {
      if (req.action === 'seek' && (n += 1) === 2) await new Promise<void>((r) => { release = r; });
      return answer(req);
    };
    const { container: c } = mountBody(server, null);
    clickPlayPause(c, 'Play');
    await settle();
    await advance(STEP_MS); // the second seek is out and has no answer yet
    expect(n).toBe(2);
    clickPlayPause(c, 'Pause');
    await settle();
    release();
    await settle();
    await advance(5_000);
    expect(server.seeks()).toEqual(NET_EVE.slice(0, 2));
    expect(n).toBe(2);
    expect(label(c)).toBe('Play');
    expect(textOf(playStatus(c)!)).toBe('Paused.');
  }, T);

  it('picking a package while it plays stops it: no further seek, the card is down, the journey is idle', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, null);
    clickPlayPause(c, 'Play');
    await settle();
    await advance(NET_EVE.length * STEP_MS);
    expect(overnightCard(c)).not.toBeNull();
    const sent = server.controls().length;
    click(packageRow(c, 'Coffee samples'));
    await settle();
    expect(server.selections[server.selections.length - 1]).toEqual(SHP2);
    expect(overnightCard(c)).toBeNull();
    await advance(5_000);
    expect(server.controls()).toHaveLength(sent);
    expect(label(c)).toBe('Play');
    expect(textOf(playStatus(c)!)).toBe('');
  }, T);

  it('a refused seek stops it with the error as an alert and no further call', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, null);
    clickPlayPause(c, 'Play');
    await settle();
    server.refuse = true;
    await advance(STEP_MS);
    expect(server.controls()).toHaveLength(2);
    expect(label(c)).toBe('Play');
    expect(textOf(leftBody(c).querySelector('.ctl-error')!)).toBe('Play stopped: the simulator did not accept a step.');
    await advance(5_000);
    expect(server.controls()).toHaveLength(2);
  }, T);

  it('a clock playing on its own (another tab) reads Pause and is paused with one request', async () => {
    const server = new FakeSimServer(withClock(readyState(1000), { playing: true }));
    const { container: c } = mountBody(server, null);
    clickPlayPause(c, 'Pause');
    await settle();
    expect(server.controls()).toEqual([{ action: 'pause' }]);
    expect(label(c)).toBe('Play');
  }, T);

  it('at the end of the run Play is disabled and names Back to start, which sends the reset', async () => {
    const server = new FakeSimServer(readyState(2160));
    const { container: c } = mountBody(server, null);
    expect(isOff(playPause(c))).toBe(true);
    expect(textOf(leftBody(c))).toContain('Run finished. Use Back to start to watch again.');
    click(button(leftBody(c), 'Back to start'));
    await settle();
    expect(server.controls()).toEqual([{ action: 'reset_playback' }]);
    expect(isOff(playPause(c))).toBe(false);
  }, T);

  it('on the page, Space plays and pauses network Play, Esc pauses it, and "." does nothing', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountPage(server);
    press('.', document.body);
    await settle();
    expect(server.calls).toEqual([]);

    press(' ', document.body);
    await settle();
    expect(server.seeks()).toEqual([NET_EVE[0]]);
    expect(label(c)).toBe('Pause');
    press(' ', document.body);
    await settle();
    expect(label(c)).toBe('Play');
    await advance(2_000);
    expect(server.controls()).toEqual([{ action: 'seek', timeMin: NET_EVE[0] }]);

    press(' ', document.body);
    await settle();
    expect(label(c)).toBe('Pause');
    press('Escape', document.body);
    await settle();
    expect(label(c)).toBe('Play');
    await advance(2_000);
    expect(server.seeks()).toEqual(NET_EVE.slice(0, 2));
    press('.', document.body);
    await settle();
    expect(server.controls()).toHaveLength(2);
    expect(server.controls().every((r) => r.action === 'seek')).toBe(true);
  }, T);
});

describe('/simulator?package=<id>&play=1 (#648)', () => {
  it('opens the journey, starts Play once, and takes the key out of the URL with a replace', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountPage(server, '?package=shp-2&play=1');
    await settle();
    expect(journeySteps(c)).toHaveLength(4);
    expect(label(c)).toBe('Pause');
    expect(server.seeks()).toEqual([1039]);
    expect(server.searches).toEqual(['?package=shp-2&play=1', '?package=shp-2']);
    expect(server.navigations).toEqual(['POP', 'REPLACE']); // no history entry: Back does not start it again

    await advance(2 * STEP_MS);
    expect(server.seeks()).toEqual([1039, 1041, 1043]); // one journey, not two started at once
    await advance(TOTAL_MS);
    expect(server.seeks()).toEqual(PLANNED);
    expect(label(c)).toBe('Play');

    // Once: later polls, and a pause, never start it again.
    server.poll(readyState(1977));
    await advance(10 * STEP_MS);
    expect(server.seeks()).toEqual(PLANNED);
    expect(server.searches).toHaveLength(2);
  }, T);

  it('waits for the journey to be loaded: nothing before the first poll and the map, then one start', async () => {
    const loading: SimDataState = { ...readyState(1000), view: 'loading', sim: null, map: null };
    const server = new FakeSimServer(loading);
    const { container: c } = mountPage(server, '?package=shp-2&play=1');
    await advance(3 * STEP_MS);
    expect(server.calls).toEqual([]);
    expect(currentSearch(server)).toBe('?package=shp-2&play=1');

    server.poll(readyState(1000, { map: null })); // the run, not yet the places of the journey
    await advance(3 * STEP_MS);
    expect(server.calls).toEqual([]);
    expect(currentSearch(server)).toBe('?package=shp-2&play=1');
    expect(isOff(playPause(c))).toBe(true);

    server.poll(readyState(1000));
    await settle();
    expect(server.seeks()).toEqual([1039]);
    expect(currentSearch(server)).toBe('?package=shp-2');
    expect(server.navigations.at(-1)).toBe('REPLACE');
    await advance(STEP_MS);
    expect(server.seeks()).toEqual([1039, 1041]);
  }, T);

  it('pauses a playing clock first, then seeks', async () => {
    const server = new FakeSimServer(withClock(readyState(1000), { playing: true }));
    const { container: c } = mountPage(server, '?package=shp-2&play=1');
    await settle();
    await advance(STEP_MS);
    expect(server.controls()).toEqual([
      { action: 'pause' }, { action: 'seek', timeMin: 1039 }, { action: 'seek', timeMin: 1041 },
    ]);
    expect(label(c)).toBe('Pause');
  }, T);

  it('an unmatched package opens as without the key and plays nothing', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountPage(server, '?package=shp-3&play=1');
    await advance(5 * STEP_MS);
    expect(server.calls).toEqual([]);
    expect(isOff(playPause(c))).toBe(true);
    expect(textOf(rightBody(c))).toContain('No commuter passes both businesses within their detour limit.');
    expect(currentSearch(server)).toBe('?package=shp-3');
  }, T);

  it('an unknown package opens as without the key and plays nothing, also when a known one is picked next', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountPage(server, '?package=shp-404&play=1');
    await advance(5 * STEP_MS);
    expect(server.calls).toEqual([]);
    expect(textOf(rightBody(c))).toContain('This package is not in the current scenario');
    expect(currentSearch(server)).toBe('?package=shp-404');

    click(button(rightBody(c), /Back to network/));
    await settle();
    click(c.querySelector<HTMLButtonElement>('ul.sw-pkgs button.sw-pkg')!);
    await advance(5 * STEP_MS);
    expect(journeySteps(c).length).toBeGreaterThan(0);
    expect(server.calls).toEqual([]); // the consumed key does not play the next package
  }, T);

  it('play=1 without a package plays nothing and is removed; the selection is untouched', async () => {
    const server = new FakeSimServer(readyState(1000));
    mountPage(server, '?employee=emp-1&play=1');
    await advance(5 * STEP_MS);
    expect(server.calls).toEqual([]);
    expect(currentSearch(server)).toBe('?employee=emp-1');
  }, T);

  it('without the key nothing starts by itself', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountPage(server, '?package=shp-2');
    await advance(5 * STEP_MS);
    expect(server.calls).toEqual([]);
    expect(label(c)).toBe('Play');
    expect(server.searches).toEqual(['?package=shp-2']);
  }, T);
});

describe('the journey and motion', () => {
  it('without reduced motion each step is tweened (animation frames are asked for)', async () => {
    stubMatchMedia({ reduced: false });
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, SHP2);
    clickPlayPause(c, 'Play');
    await advance(4 * STEP_MS);
    expect(rafCalls).toBeGreaterThan(0);
  }, T);

  it('with reduced motion it steps the same seeks without a tween', async () => {
    const media = stubMatchMedia({ reduced: true });
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, SHP2);
    clickPlayPause(c, 'Play');
    await advance(TOTAL_MS + STEP_MS);
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
 * version.
 */
class SlowControlServer extends FakeSimServer {
  private version = 100;
  private readonly actions = createSimActions({
    simulatorControl: (req) => {
      const answer = this.answer(req);
      return new Promise<SimulatorResponse>((res) => { setTimeout(() => res(answer), DELAY_MS); });
    },
    compareMatches: () => Promise.reject(new Error('unused')),
  }, (a) => this.set(simDataReducer(this.state, a)), () => {});

  constructor(state: SimDataState) { super(state); }

  private answer(req: SimControlRequest): SimulatorResponse {
    const cur = this.state.sim!;
    // Back to start puts the clock at the start of the run, like the server.
    const base = req.action === 'seek' ? runAt(req.timeMin, { runId: cur.runId })
      : req.action === 'reset_playback' ? runAt(930, { runId: cur.runId }) : cur;
    const playing = req.action === 'play' ? true : req.action === 'pause' ? false : base.clock.playing;
    this.version += 1;
    return { ...base, version: this.version, nextEventMin: 2100, clock: { ...base.clock, playing } };
  }

  override control(req: SimControlRequest): Promise<SimulatorResponse | null> {
    this.calls.push({ name: 'control', req });
    return this.actions.control(req);
  }
}

describe('a playing journey keeps the left panel still (#594)', () => {
  const backToStart = (c: ParentNode) => button(leftBody(c), 'Back to start');

  it('with slow answers, no busy text and no disabled button while a journey or network Play runs; Back to start still shows busy', async () => {
    const server = new SlowControlServer(readyState(1000));
    const { container: c } = mountPage(server, '?package=shp-2');
    expect(textOf(leftBody(c))).not.toContain(BUSY_REASON);

    clickPlayPause(c, 'Play');
    let checks = 0;
    // 100 ms at a time through the whole journey (each step waits for its slow answer).
    for (let t = 0; t < 80 * STEP_MS && (checks === 0 || label(c) === 'Pause'); t += 100) {
      await advance(100);
      expect(server.state.busy).toBe(false);
      expect(textOf(leftBody(c))).not.toContain(BUSY_REASON);
      expect(isOff(playPause(c))).toBe(false);
      expect(isOff(backToStart(c))).toBe(false);
      checks += 1;
    }
    expect(checks).toBeGreaterThan(30);
    expect(server.seeks()).toEqual(PLANNED);
    expect(textOf(playStatus(c)!)).toBe('Journey complete: Delivered to recipient at Etsy.');
    expect(server.state.sim?.clock.timeMin).toBe(1977); // the last seek's answer is what is shown

    // Back to start is not a seek: it is busy as before.
    press('Escape', document.body);
    expect(currentSearch(server)).toBe('');
    click(backToStart(c));
    await settle();
    expect(textOf(leftBody(c))).toContain(BUSY_REASON);
    expect(isOff(playPause(c))).toBe(true);
    await advance(DELAY_MS);
    expect(textOf(leftBody(c))).not.toContain(BUSY_REASON);
    expect(isOff(backToStart(c))).toBe(false);

    // #790: with no package the button plays every commute with the same quiet seeks: never busy either.
    clickPlayPause(c, 'Play');
    for (let t = 0; t < 10 * STEP_MS; t += 100) {
      await advance(100);
      expect(server.state.busy).toBe(false);
      expect(textOf(leftBody(c))).not.toContain(BUSY_REASON);
      expect(isOff(playPause(c))).toBe(false);
      expect(isOff(backToStart(c))).toBe(false);
    }
    expect(label(c)).toBe('Pause');
    clickPlayPause(c, 'Pause');
    await advance(DELAY_MS);
    expect(label(c)).toBe('Play');
    expect(server.controls().filter((r) => r.action !== 'seek')).toEqual([{ action: 'reset_playback' }]);
  }, T);
});
