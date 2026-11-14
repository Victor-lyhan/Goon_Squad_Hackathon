// @vitest-environment jsdom
// Keys during "Play journey" on the MVP II simulator page, in a real DOM with fake timers (#607):
// a key that sends a control (".", Space) stops the running journey first, exactly as the playback
// buttons do, so the player's next step never seeks back over the key's request. Before #607 the
// keyboard path called the data hook's `control` directly and the journey kept seeking.
// The map runs in its no-key state: the Google loader is replaced by a recorder that must stay unused.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, buttons, byLabel, click, press, textOf } from './kitDom';
import {
  FakeSimServer, T, advance, currentSearch, journeySteps, leftBody, mountPage, playStatus, readyState,
} from './sim-v2-dom-helpers';

const google = vi.hoisted(() => ({ loads: 0 }));
vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: () => { google.loads += 1; },
  importLibrary: () => { google.loads += 1; return new Promise(() => {}); },
}));

beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
  google.loads = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  expect(google.loads).toBe(0);
});

const STEP_MS = 500;
const playButton = (c: ParentNode) => button(c, 'Play journey');
const stopButton = (c: ParentNode) => button(c, 'Stop');

/** The page on the relay package with Play journey running: two seeks sent, the focus on Stop. */
async function playing() {
  const server = new FakeSimServer(readyState(1000));
  const { container: c } = mountPage(server, '?package=shp-2');
  click(playButton(c));
  await advance(STEP_MS);
  expect(server.seeks()).toEqual([1039, 1041]);
  expect(document.activeElement).toBe(stopButton(c));
  return { server, c };
}

/** Lets the journey's timers run on; a journey that was not stopped would send a seek per step. */
const wait = () => advance(20 * STEP_MS);

describe('a key that sends a control stops Play journey first', () => {
  it('"." with the focus on the Stop button: next event is sent, no seek follows, "Journey stopped." shows', async () => {
    const { server, c } = await playing();

    press('.', document.activeElement!); // where a click on Play journey leaves the focus
    expect(server.controls().slice(-1)).toEqual([{ action: 'next_event' }]);
    expect(textOf(playStatus(c)!)).toBe('Journey stopped.');
    expect(playButton(c)).toBeTruthy();
    expect(buttons(c, 'Stop')).toHaveLength(0);

    await wait();
    expect(server.seeks()).toEqual([1039, 1041]);
    expect(server.controls()).toEqual([
      { action: 'seek', timeMin: 1039 }, { action: 'seek', timeMin: 1041 }, { action: 'next_event' },
    ]);
    expect(textOf(playStatus(c)!)).toBe('Journey stopped.');
    expect(currentSearch(server)).toBe('?package=shp-2'); // still in the journey
    expect(journeySteps(c)).toHaveLength(4);
  }, T);

  it('"." from the page body does the same', async () => {
    const { server, c } = await playing();
    (document.activeElement as HTMLElement).blur();
    press('.', document.body);
    expect(textOf(playStatus(c)!)).toBe('Journey stopped.');
    await wait();
    expect(server.controls()).toEqual([
      { action: 'seek', timeMin: 1039 }, { action: 'seek', timeMin: 1041 }, { action: 'next_event' },
    ]);
  }, T);

  it('Space from the scrubber: play is sent and no seek follows', async () => {
    const { server, c } = await playing();
    const range = byLabel(leftBody(c), 'Simulation time');
    range.focus();
    press(' ', range);
    expect(server.controls().slice(-1)).toEqual([{ action: 'play' }]);
    expect(textOf(playStatus(c)!)).toBe('Journey stopped.');
    await wait();
    expect(server.seeks()).toEqual([1039, 1041]);
    expect(server.controls()).toHaveLength(3);
  }, T);

  it('the "Next event" button behaves the same (the keys now match it)', async () => {
    const { server, c } = await playing();
    click(button(leftBody(c), 'Next event'));
    expect(textOf(playStatus(c)!)).toBe('Journey stopped.');
    await wait();
    expect(server.controls()).toEqual([
      { action: 'seek', timeMin: 1039 }, { action: 'seek', timeMin: 1041 }, { action: 'next_event' },
    ]);
  }, T);
});

describe('a key that sends nothing leaves Play journey running', () => {
  it('Space on the focused Stop button is the button\'s own; "." in the package search is text', async () => {
    const { server, c } = await playing();
    press(' ', document.activeElement!); // keydown only reaches the page's map; the map leaves it to the button
    expect(buttons(c, 'Stop')).toHaveLength(1);

    const search = byLabel(leftBody(c), 'Search packages');
    search.focus();
    press('.', search);
    expect(buttons(c, 'Stop')).toHaveLength(1);
    expect(server.controls().every((r) => r.action === 'seek')).toBe(true);

    await advance(2 * STEP_MS);
    expect(server.seeks()).toEqual([1039, 1041, 1043, 1045]);
  }, T);

  it('"." with no next event left sends nothing and stops nothing, like the disabled button', async () => {
    const { server, c } = await playing();
    await advance(14 * STEP_MS); // over the night to 1953: the sample has no next event from 1950 on
    expect(server.state.sim?.nextEventMin).toBeNull();
    expect(button(leftBody(c), 'Next event').disabled).toBe(true);
    const sent = server.controls().length;

    (document.activeElement as HTMLElement).blur();
    press('.', document.body);
    expect(server.controls()).toHaveLength(sent);
    expect(buttons(c, 'Stop')).toHaveLength(1);
    await advance(STEP_MS);
    expect(server.seeks().length).toBe(sent + 1);
  }, T);
});
