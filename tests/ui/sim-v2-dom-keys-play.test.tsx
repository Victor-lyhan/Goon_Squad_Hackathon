// @vitest-environment jsdom
// Keys while a journey plays on the simulator page, in a real DOM with fake timers (#607, #648).
// Space is the one Play/Pause button from wherever the focus is (except a text field and a control
// with its own Space), so it pauses the running journey and never starts the server clock under it;
// "." is no longer a key of the page, so it leaves the journey running.
// The map runs in its no-key state: the Google loader is replaced by a recorder that must stay unused.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byLabel, click, press, textOf } from './kitDom';
import {
  FakeSimServer, T, advance, currentSearch, journeySteps, leftBody, mountPage, playPause, playStatus, readyState,
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
const TWO_SEEKS = [{ action: 'seek', timeMin: 1039 }, { action: 'seek', timeMin: 1041 }];

/** The page on the relay package with its journey playing: two seeks sent, the focus on the button (it reads Pause). */
async function playing() {
  const server = new FakeSimServer(readyState(1000));
  const { container: c } = mountPage(server, '?package=shp-2');
  click(playPause(c));
  await advance(STEP_MS);
  expect(server.seeks()).toEqual([1039, 1041]);
  expect(textOf(playPause(c))).toBe('Pause');
  expect(document.activeElement).toBe(playPause(c));
  return { server, c };
}

/** Lets the journey's timers run on; a journey that was not paused would send a seek per step. */
const wait = () => advance(20 * STEP_MS);

describe('Space pauses a playing journey from wherever the focus is', () => {
  it('from the page body: "Journey paused.", no seek follows, and no play or pause request is sent', async () => {
    const { server, c } = await playing();
    (document.activeElement as HTMLElement).blur();
    press(' ', document.body);
    expect(textOf(playStatus(c)!)).toBe('Journey paused.');
    expect(textOf(playPause(c))).toBe('Play');

    await wait();
    expect(server.controls()).toEqual(TWO_SEEKS); // the server clock was never started under the journey
    expect(currentSearch(server)).toBe('?package=shp-2'); // still in the journey
    expect(journeySteps(c)).toHaveLength(4);
  }, T);

  it('from the focus dropdown (a click leaves the focus there)', async () => {
    const { server, c } = await playing();
    const dropdown = byLabel(leftBody(c), 'Focus on employee');
    dropdown.focus();
    press(' ', dropdown);
    expect(textOf(playStatus(c)!)).toBe('Journey paused.');
    await wait();
    expect(server.controls()).toEqual(TWO_SEEKS);
  }, T);
});

describe('a key that is not the page\'s leaves the journey running', () => {
  it('Space on the focused Pause button is the button\'s own click, not a second toggle', async () => {
    const { server, c } = await playing();
    press(' ', document.activeElement!); // keydown only reaches the page's map; the map leaves it to the button
    expect(textOf(playPause(c))).toBe('Pause');
    await advance(2 * STEP_MS);
    expect(server.seeks()).toEqual([1039, 1041, 1043, 1045]);
  }, T);

  it('Space in the package search is text', async () => {
    const { server, c } = await playing();
    const search = byLabel(leftBody(c), 'Search packages');
    search.focus();
    press(' ', search);
    expect(textOf(playPause(c))).toBe('Pause');
    await advance(2 * STEP_MS);
    expect(server.seeks()).toEqual([1039, 1041, 1043, 1045]);
  }, T);

  it('"." does nothing any more (#648): from the button, the body or the search, the journey plays on', async () => {
    const { server, c } = await playing();
    press('.', document.activeElement!);
    (document.activeElement as HTMLElement).blur();
    press('.', document.body);
    const search = byLabel(leftBody(c), 'Search packages');
    search.focus();
    press('.', search);
    expect(textOf(playPause(c))).toBe('Pause');
    expect(server.controls()).toEqual(TWO_SEEKS);

    await advance(2 * STEP_MS);
    expect(server.seeks()).toEqual([1039, 1041, 1043, 1045]);
    expect(server.controls().every((r) => r.action === 'seek')).toBe(true);
  }, T);
});
