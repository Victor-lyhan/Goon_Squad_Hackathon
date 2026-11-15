// @vitest-environment jsdom
// Issue 923 (the server restarted in the middle of a journey), the one fault the browser walk found on the
// simulator page: the step that failed while the server was away left the red box "Can't reach the Relay
// server." in the left panel, and it stayed there after the server was back, after Play was pressed again
// and to the end of the journey ("Delivered" next to a red error). Only Dismiss took it away, because Play
// sends seeks only and a seek is quiet (it never clears the last action's message).
//
// Now a press on Play takes the old message away, as every other control already does. This file mounts
// the real page (`SimulatorV2`: the real data hook, poller and journey player) over a fake `fetch` that can
// be taken away and brought back, and checks:
//   - while the server is away: Play stops, and the page says why (the box, the chip over Play, the line
//     over the map), with the journey still on screen;
//   - once it is back: the line over the map goes by itself; the reason Play stopped stays until the person acts;
//   - Play again: the box and the chip are gone at once and stay away to the end of the journey;
//   - Play while the server is still away: the message is shown again (nothing is swallowed).
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimulatorResponse } from '../../shared/v2/api';
import type { SimControlRequest } from '../../shared/v2/schemas';
import { PAUSE_LABEL, PLAY_LABEL } from '../../client/src/components/sim/v2/compose/journeyPlay';
import { CONNECTION_LOST_MESSAGE, SERVER_UNREACHABLE_MESSAGE } from '../../client/src/components/sim/v2/live/simDataModel';
import { SIM_POLL_MS } from '../../client/src/components/sim/v2/live/simPoller';
import { JOURNEY_STEP_MS } from '../../client/src/components/sim/v2/motion/journeyPlayback';
import SimulatorV2 from '../../client/src/pages/v2/SimulatorV2';
import { click, mount, textOf } from './kitDom';
import { T, advance, journeySteps, playPause, runAt, sampleMapResponse, settle, stubMatchMedia } from './sim-v2-dom-helpers';

vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: () => {},
  importLibrary: () => new Promise(() => {}),
}));

// ---------- The fake server behind `fetch` ----------

const SIM_URL = '/api/v2/simulator';
const MAP_URL = '/api/v2/map';
const CONTROL_URL = '/api/v2/simulator/control';

const server = {
  /** True while the server is stopped: every request fails as in a browser ("Failed to fetch"). */
  down: false,
  timeMin: 1000,
  version: 1,
  /** Every minute the page sought, and whether the server was there to take it. */
  seeks: [] as { timeMin: number; answered: boolean }[],
  /** The sample run at the server's minute. Each write gets a higher version, as on the real server. */
  answer(): SimulatorResponse {
    const run = runAt(server.timeMin);
    return { ...run, version: server.version, snapshot: { ...run.snapshot, version: server.version } };
  },
};

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

function fakeFetch(input: unknown, init?: { method?: string; body?: string }): Promise<Response> {
  const url = String(input);
  const req = init?.body ? (JSON.parse(init.body) as SimControlRequest) : null;
  if (url === CONTROL_URL && req?.action === 'seek') server.seeks.push({ timeMin: req.timeMin, answered: !server.down });
  if (server.down) return Promise.reject(new TypeError('Failed to fetch'));
  if (url === SIM_URL) return Promise.resolve(json(200, server.answer()));
  if (url === MAP_URL) return Promise.resolve(json(200, sampleMapResponse));
  if (url === CONTROL_URL && req) {
    if (req.action === 'seek') server.timeMin = req.timeMin;
    server.version += 1;
    return Promise.resolve(json(200, server.answer()));
  }
  return Promise.resolve(json(404, { error: 'Not found' }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
  stubMatchMedia({ reduced: true }); // a wide window; the polled positions are drawn as they are
  vi.stubGlobal('fetch', fakeFetch);
  Object.assign(server, { down: false, timeMin: 1000, version: 1, seeks: [] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ---------- The page ----------

/** The relay package of the sample run (sim-v2-journey-sample.ts), opened as a link opens it. */
const PACKAGE_URL = '/simulator?package=shp-2';

async function openJourney() {
  const { container: c, unmount } = mount(createElement(MemoryRouter, { initialEntries: [PACKAGE_URL] }, createElement(SimulatorV2)));
  await settle();
  await advance(SIM_POLL_MS);
  const texts = (sel: string) => [...c.querySelectorAll<HTMLElement>(sel)].map((el) => textOf(el));
  return {
    c, unmount,
    label: () => textOf(playPause(c)),
    /** The red box in the left panel: the message of the last failed action, with its Dismiss button. */
    box: () => texts('.spc-action-error p'),
    /** The chip over the Play button: why Play stopped. */
    chip: () => texts('.ctl-error'),
    /** The line over the map while the page cannot reach the server. */
    banner: () => texts('.spc-banner:not(.spc-banner--quiet)'),
    alerts: () => texts('[role="alert"]'),
    stepLine: () => texts('.ctl-playback [role="status"]').join(' '),
  };
}
type Page = Awaited<ReturnType<typeof openJourney>>;

/** Plays for `steps` steps of the journey player. */
const playFor = (steps: number) => advance(steps * JOURNEY_STEP_MS);

/** The server goes away in the middle of the journey: Play stops within two steps and the page says why. */
async function stopServerMidJourney(page: Page) {
  click(playPause(page.c));
  await playFor(6);
  expect(page.label()).toBe(PAUSE_LABEL);
  expect(server.seeks.length).toBeGreaterThanOrEqual(3);
  expect(server.seeks.every((s) => s.answered)).toBe(true);
  expect(page.alerts()).toEqual([]);

  server.down = true;
  await playFor(2);
}

describe('issue 923: the simulator after the server was away in the middle of a journey', () => {
  it('while it is away: Play stops and the page says why, with the journey still on screen', async () => {
    const page = await openJourney();
    const stepsBefore = journeySteps(page.c).length;
    expect(stepsBefore).toBeGreaterThan(0);
    await stopServerMidJourney(page);

    expect(page.label()).toBe(PLAY_LABEL);
    expect(page.box()).toEqual([SERVER_UNREACHABLE_MESSAGE]);
    expect(page.chip()).toEqual([`Play stopped: ${SERVER_UNREACHABLE_MESSAGE}`]);
    // Play has stopped for good: no step is sent into the void while the server is away.
    const sent = server.seeks.length;
    await advance(8 * SIM_POLL_MS);
    expect(server.seeks).toHaveLength(sent);
    expect(page.banner()).toEqual([CONNECTION_LOST_MESSAGE]);
    // Nothing went blank and nothing raw is shown: the timeline is there, in the same number of steps.
    expect(journeySteps(page.c)).toHaveLength(stepsBefore);
    expect(textOf(page.c)).not.toMatch(/Failed to fetch|TypeError|undefined|NaN|\[object/);
    page.unmount();
  }, T);

  it('once it is back: the line over the map goes by itself; Play again clears the box and the chip for good', async () => {
    const page = await openJourney();
    await stopServerMidJourney(page);
    await advance(8 * SIM_POLL_MS);
    expect(page.banner()).toEqual([CONNECTION_LOST_MESSAGE]);

    // The server is back. The poll backs off to at most 10 s while it is away, so 12 s is enough.
    server.down = false;
    await advance(12 * SIM_POLL_MS);
    expect(page.banner()).toEqual([]);
    // Why Play stopped stays until the person acts: it is the only thing that says why nothing moves.
    expect(page.label()).toBe(PLAY_LABEL);
    expect(page.chip()).toEqual([`Play stopped: ${SERVER_UNREACHABLE_MESSAGE}`]);
    expect(page.box()).toEqual([SERVER_UNREACHABLE_MESSAGE]);

    // Play again: both messages are gone with the press, before the first step has an answer.
    const sentBefore = server.seeks.length;
    click(playPause(page.c));
    expect(page.box()).toEqual([]);
    expect(page.chip()).toEqual([]);
    expect(page.label()).toBe(PAUSE_LABEL);

    // To the end of the journey: never a red message on the way, and never a Dismiss to press.
    let ended = false;
    for (let step = 0; step < 400 && !ended; step++) {
      await playFor(1);
      expect(page.alerts()).toEqual([]);
      expect(page.box()).toEqual([]);
      ended = page.label() === PLAY_LABEL;
    }
    expect(ended).toBe(true);
    expect(page.stepLine()).toMatch(/^Journey complete: /);
    expect(runAt(server.timeMin).snapshot.shipmentStatus['shp-2']).toBe('delivered');
    const after = server.seeks.slice(sentBefore);
    expect(after.length).toBeGreaterThan(3);
    expect(after.every((s) => s.answered)).toBe(true);
    expect(page.c.querySelector('.spc-action-error')).toBeNull();
    page.unmount();
  }, T);

  it('Play while the server is still away: the message is shown again, not swallowed', async () => {
    const page = await openJourney();
    await stopServerMidJourney(page);
    expect(page.box()).toEqual([SERVER_UNREACHABLE_MESSAGE]);

    const sentBefore = server.seeks.length;
    click(playPause(page.c));
    expect(page.box()).toEqual([]); // the old message goes with the press
    await playFor(2);
    // The new try failed too, and says so.
    expect(server.seeks.length).toBeGreaterThan(sentBefore);
    expect(server.seeks.at(-1)!.answered).toBe(false);
    expect(page.label()).toBe(PLAY_LABEL);
    expect(page.box()).toEqual([SERVER_UNREACHABLE_MESSAGE]);
    expect(page.chip()).toEqual([`Play stopped: ${SERVER_UNREACHABLE_MESSAGE}`]);
    page.unmount();
  }, T);
});
