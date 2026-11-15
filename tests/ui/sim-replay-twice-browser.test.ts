// @vitest-environment jsdom
// #891: the simulator rehearsed twice. The browser half is a headless Chrome walk on a production build (its
// numbers are in the PR); this file pins the API half, sent by the real page.
//
// The simulator page (SimulatorV2: the real data hook with its 1 s poll, the real journey player and the real
// Play/Pause and "Back to start" buttons) runs in a DOM against a REAL server: `createV2Runtime` on a temp copy
// of fixtures/nyc, a temp state file and no key (demo-rehearse-twice-helper.ts). Only the page's timers are
// fake, so "one step" and "one poll" are exact; every request and its answer are real and logged.
//
// - A package journey, opened the way the homepage's "Watch a package" opens it (`?package=<id>&play=1`):
//   Play to the end, Back to start, Play to the end again. The seeks, every answer apart from `version`, the
//   timeline's steps, the step line, the overnight card, the carriers and the final state are the same both
//   times. A third round with Pause in the evening leg and Pause on the overnight card sends the same seeks
//   and gets the same answers: Play after Pause goes on from the minute the clock stands on.
// - Network Play (no package picked): the same, to the end of the run, twice, the second time with a Pause.
// - "Back to start" answers the fresh run apart from `version` (clock at the start, paused, planning) and
//   leaves no vehicle on the map: the map gets exactly the movers of a page that never played.
// - No request loop: while it plays the page sends one seek per step, one poll after each seek and the 1 s
//   poll; once it has ended, and while it is paused, only the 1 s poll.
// - The server clock's own `play` / `pause` (another tab, the API) and Back to start, twice: the same answers.
//
// The map is replaced by a probe that keeps the props the page hands it (jsdom draws no map), and the page
// runs with reduced motion, so the movers the probe gets are the polled ones, not a tween between two.
// No ID, name or minute is written here (DECISIONS pass 54): everything is read from the run.
import { act, createElement } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapResponse, SimulatorResponse } from '../../shared/v2/api';
import type { SimControlRequest } from '../../shared/v2/schemas';
import { getMap, getSimulator, simulatorControl } from '../../client/src/api/v2';
import type { GoogleBaseMapProps } from '../../client/src/components/map/GoogleBaseMap';
import type { MapMover } from '../../client/src/components/map/types';
import {
  NETWORK_FINISHED_TEXT, NETWORK_PAUSED_TEXT, NETWORK_PLAYING_TEXT, PAUSED_TEXT, networkWindows,
} from '../../client/src/components/sim/v2/compose/journeyPlay';
import { SIM_END_MIN, simPageView } from '../../client/src/components/sim/v2/compose/simPageView';
import {
  FINISHED_REASON, PAUSE_LABEL, PLAY_LABEL, RESET_LABEL, RESET_REQUEST,
} from '../../client/src/components/sim/v2/controls/controlsModel';
import { buildJourney, playPlan, type Journey } from '../../client/src/components/sim/v2/journey/journeyModel';
import { INITIAL_SIM_DATA } from '../../client/src/components/sim/v2/live/simDataModel';
import { SIM_POLL_MS } from '../../client/src/components/sim/v2/live/simPoller';
import {
  JOURNEY_COMMUTE_STEP_MIN, JOURNEY_STEP_MS, OVERNIGHT_CARD_MS, nextJourneyAction,
} from '../../client/src/components/sim/v2/motion/journeyPlayback';
import { DEFAULT_LAYERS } from '../../client/src/components/sim/v2/workspaceModel';
import { watchPackageId } from '../../client/src/pages/landingModel';
import SimulatorV2 from '../../client/src/pages/v2/SimulatorV2';
import { nycFilesState } from '../api/v2-e2e-nyc-helper';
import { settle, startRehearsalApi, useFakePollTimers, type Logged, type RehearsalApi } from './demo-rehearse-twice-helper';
import { button, click, mount, textOf } from './kitDom';
import { stubMatchMedia } from './sim-v2-dom-helpers';

/**
 * Per test and hook (DECISIONS pass 52). Each test plays the real run two or three times through the page,
 * one real request per step: about 3 s locally for the slowest, so this is far more than 10x.
 */
const T = 120_000;
vi.setConfig({ testTimeout: T, hookTimeout: T });

// ---------- The map probe ----------

/** What the page handed the map last, and every carrier it ever drew as a vehicle (`<id> <letter>`). */
const mapProbe = vi.hoisted(() => ({ last: null as unknown, vehicles: [] as string[] }));
vi.mock('../../client/src/components/map/GoogleBaseMap', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../client/src/components/map/GoogleBaseMap')>();
  return {
    ...real,
    GoogleBaseMap: (props: GoogleBaseMapProps) => {
      mapProbe.last = props;
      for (const m of props.movers) {
        const seen = `${m.id} ${m.badge ?? ''}`;
        if (m.kind === 'vehicle' && !mapProbe.vehicles.includes(seen)) mapProbe.vehicles.push(seen);
      }
      return null;
    },
  };
});
const mapProps = (): GoogleBaseMapProps => {
  if (!mapProbe.last) throw new Error('the page has not drawn its map yet');
  return mapProbe.last as GoogleBaseMapProps;
};
const copy = <X>(x: X): X => JSON.parse(JSON.stringify(x)) as X;

// ---------- The server ----------

let api: RehearsalApi;
let nycBefore: string[];
/** The run before anything was played. */
let fresh: SimulatorResponse;
let map: MapResponse;
/** The package the homepage's "Watch a package" opens. */
let watchId: string;

/** What the map shows on a page that never played: the page's own view of the fresh answers. */
function freshMovers(selection: { kind: 'package'; id: string } | null): MapMover[] {
  const view = simPageView({ data: { ...INITIAL_SIM_DATA, view: 'ready', sim: fresh, map }, selection, layers: DEFAULT_LAYERS });
  if (view.view !== 'ready') throw new Error('the fresh run has no ready view');
  return copy(view.map.movers);
}

beforeAll(async () => {
  nycBefore = nycFilesState();
  api = await startRehearsalApi();
  fresh = await getSimulator();
  map = await getMap();
  const id = watchPackageId(fresh);
  if (!id) throw new Error('the default run has no package for "Watch a package"');
  watchId = id;
});
afterAll(async () => {
  await api?.close();
  expect(nycFilesState()).toStrictEqual(nycBefore); // nothing was written to the committed fixtures/nyc
});
beforeEach(async () => {
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
  // Each test starts where a presenter does: the clock at the start, paused, planning.
  await simulatorControl(RESET_REQUEST);
  stubMatchMedia({ reduced: true });
  useFakePollTimers();
  mapProbe.last = null;
  mapProbe.vehicles.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  // Not vi.unstubAllGlobals(): the helper's `fetch` must stay until `api.close()`.
  Reflect.deleteProperty(globalThis, 'matchMedia');
  expect(api.googleCalls).toEqual([]);
  expect(api.outgoing).toEqual([]);
});

// ---------- The page ----------

const SIM_GET = '/api/v2/simulator';
const CONTROL = '/api/v2/simulator/control';
/**
 * The page's time moves in steps of this many ms. The player sends its next seek JOURNEY_STEP_MS after the
 * last answer, and the answers land while the page's time stands still, so each tick holds at most one seek.
 */
const TICK_MS = JOURNEY_STEP_MS;
/** Far longer than any Play here (network Play takes under 60 s of page time). */
const MAX_PLAY_MS = 120_000;

const search = { current: '' };
function SearchProbe() {
  search.current = useLocation().search;
  return null;
}

type Page = ReturnType<typeof openPage>;

function openPage(query: string) {
  const { container, unmount } = mount(createElement(MemoryRouter, { initialEntries: [`/simulator${query}`] },
    createElement(SimulatorV2), createElement(SearchProbe)));
  const q = <E extends Element = HTMLElement>(sel: string) => container.querySelector<E>(sel);
  const text = (sel: string) => { const el = q(sel); return el ? textOf(el) : ''; };
  const all = (sel: string) => [...container.querySelectorAll(sel)].map((el) => textOf(el));
  return {
    container,
    /** Leaves the page, as a click on Home does. */
    close: unmount,
    playButton: () => q<HTMLButtonElement>('.spc-playbar button.ctl-primary')!,
    resetButton: () => button(q('.spc-playbar')!, RESET_LABEL),
    label: () => text('.spc-playbar button.ctl-primary'),
    action: () => q('[data-play-action]')?.getAttribute('data-play-action') ?? '',
    line: () => text('.ctl-playback [role="status"]'),
    card: () => text('.spc-overnight'),
    /** The timeline's steps as the page marks them: done, current or upcoming. */
    steps: () => [...container.querySelectorAll('.jt-step')]
      .map((el) => /jt-step--(\w+)/.exec(el.className)?.[1] ?? '?').join(','),
    /** Everything a presenter can compare between two rehearsals. */
    state: () => ({
      button: text('.spc-playbar button.ctl-primary'),
      action: q('[data-play-action]')?.getAttribute('data-play-action') ?? '',
      disabledNote: text('.ctl-note'),
      line: text('.ctl-playback [role="status"]'),
      error: text('.ctl-error') + text('.spc-action-error'),
      card: text('.spc-overnight'),
      clock: mapProps().clockText ?? '',
      steps: [...container.querySelectorAll('.jt-step')].map((el) => `${/jt-step--(\w+)/.exec(el.className)?.[1]} ${textOf(el)}`),
      journey: [text('.jt__title'), text('.jt__kind'), text('.jt__status'), ...all('.jt__time')],
      carriers: all('.jl__name'),
      chips: all('.pk-chip'),
      rows: all('.pk-status'),
      summary: text('.sw-summary-list'),
      movers: copy(mapProps().movers),
      stops: copy(mapProps().stops ?? []),
    }),
  };
}

/** Moves the page's timers by `ms` and waits for the requests they started and for React. */
async function pass(ms: number): Promise<void> {
  for (let done = 0; done < ms; done += TICK_MS) {
    await act(async () => { vi.advanceTimersByTime(Math.min(TICK_MS, ms - done)); });
    await settle(api);
  }
}

// ---------- One rehearsal round, read from the request log and the page ----------

const controlsOf = (log: Logged[]) => log.filter((r) => r.method === 'POST' && r.path === CONTROL);
const seekMin = (r: Logged) => (r.sent as SimControlRequest & { timeMin?: number }).timeMin;
const isSeek = (r: Logged) => (r.sent as SimControlRequest).action === 'seek';
const pollsIn = (log: Logged[]) => log.filter((r) => r.method === 'GET' && r.path === SIM_GET).length;

/** An answer without its two version counters: the only thing a replay may change. */
function sansVersion(answer: unknown): unknown {
  const { version: _v, snapshot, ...rest } = answer as SimulatorResponse;
  const { version: _sv, ...snap } = snapshot;
  return { ...rest, snapshot: snap };
}

type Watch = { steps: string[]; lines: string[]; cards: string[] };
const newWatch = (): Watch => ({ steps: [], lines: [], cards: [] });
const once = (list: string[], value: string) => { if (value !== '' && list[list.length - 1] !== value) list.push(value); };
/** A list without its immediate repeats. */
const eachOnce = (list: string[]) => list.filter((x, i) => i === 0 || x !== list[i - 1]);
function observe(page: Page, w: Watch) {
  once(w.steps, page.steps());
  once(w.lines, page.line());
  // The card comes down between two showings, so a second showing is a second entry.
  if (page.card() === '') { if (w.cards[w.cards.length - 1] !== '') w.cards.push(''); } else once(w.cards, page.card());
}

/** Moves the page until `done()`; observes after every tick. Answers the page time it took. */
async function until(page: Page, w: Watch, done: () => boolean, what: string): Promise<number> {
  for (let ms = 0; ms <= MAX_PLAY_MS; ms += TICK_MS) {
    observe(page, w);
    if (done()) return ms;
    await pass(TICK_MS);
  }
  throw new Error(`the page did not reach "${what}" in ${MAX_PLAY_MS} ms of its own time`);
}

type Round = {
  /** The minutes the page sought, in order. */
  seeks: number[];
  /** Every control answer of the round, without `version`. */
  answers: unknown[];
  /** Controls other than a seek. */
  others: string[];
  refused: number;
  watch: Watch;
  /** Carriers drawn as vehicles, in the order they first appeared. */
  vehicles: string[];
  end: ReturnType<Page['state']>;
};

function roundOf(page: Page, from: number, watch: Watch): Round {
  const controls = controlsOf(api.log.slice(from));
  const seeks = controls.filter(isSeek);
  return {
    seeks: seeks.map((r) => seekMin(r)!),
    answers: seeks.map((r) => sansVersion(r.answer)),
    others: controls.filter((r) => !isSeek(r)).map((r) => (r.sent as SimControlRequest).action),
    refused: controls.filter((r) => r.status !== 200).length,
    watch: { ...watch, cards: watch.cards.filter(Boolean) },
    vehicles: [...mapProbe.vehicles],
    end: page.state(),
  };
}

/**
 * Plays to the end and reads the round: after a click on Play, or (`autoPlayedFrom`: the log's length before
 * the page opened) a journey that `play=1` has already started.
 */
async function playToEnd(page: Page, { autoPlayedFrom }: { autoPlayedFrom?: number } = {}): Promise<Round> {
  const from = autoPlayedFrom ?? api.log.length;
  const watch = newWatch();
  if (autoPlayedFrom === undefined) {
    mapProbe.vehicles.length = 0;
    click(page.playButton());
  }
  expect(page.label()).toBe(PAUSE_LABEL);
  await until(page, watch, () => page.label() === PLAY_LABEL, 'Play again at the end');
  return roundOf(page, from, watch);
}

/** Presses "Back to start" and answers the server's reply to it. */
async function backToStart(page: Page): Promise<Logged> {
  const from = api.log.length;
  click(page.resetButton());
  await settle(api);
  const resets = controlsOf(api.log.slice(from));
  expect(resets.map((r) => (r.sent as SimControlRequest).action)).toEqual(['reset_playback']);
  expect(resets[0].status).toBe(200);
  return resets[0];
}

/** After "Back to start": the fresh run again, and the map of a page that never played. */
function expectFreshStart(page: Page, reset: Logged, selection: { kind: 'package'; id: string } | null) {
  expect(sansVersion(reset.answer)).toEqual(sansVersion(fresh));
  const { clock } = reset.answer as SimulatorResponse;
  expect(clock).toEqual({ ...fresh.clock, playing: false });
  expect(clock.phase).toBe('planning');
  const movers = page.state().movers;
  expect(movers.filter((m) => m.kind === 'vehicle')).toEqual([]);
  expect(movers.filter((m) => m.carrierId || m.waiting)).toEqual([]);
  expect(movers).toEqual(freshMovers(selection));
  expect(page.card()).toBe('');
  expect(page.line()).toBe('');
  expect(page.label()).toBe(PLAY_LABEL);
}

/** The rule the page must keep while it plays: one seek per step, one poll per seek, the 1 s poll, nothing else. */
function expectNoLoop(log: Logged[], pageMs: number, seeks: number) {
  const controls = controlsOf(log);
  expect(controls.every(isSeek)).toBe(true);
  expect(controls).toHaveLength(seeks);
  expect(seeks).toBeLessThanOrEqual(pageMs / JOURNEY_STEP_MS + 1);
  // One poll after each applied seek (the data hook's refetch) and at most one per second of its own.
  expect(pollsIn(log)).toBeLessThanOrEqual(seeks + Math.ceil(pageMs / SIM_POLL_MS) + 1);
  const paths = new Set(log.map((r) => `${r.method} ${r.path}`));
  for (const p of paths) expect([`GET ${SIM_GET}`, `POST ${CONTROL}`, 'GET /api/v2/map']).toContain(p);
}

/** With nothing playing, `ms` of page time holds exactly one poll per SIM_POLL_MS and no control. */
async function expectQuiet(page: Page, ms: number) {
  const before = page.state();
  const from = api.log.length;
  await pass(ms);
  const log = api.log.slice(from);
  expect(controlsOf(log)).toEqual([]);
  expect(pollsIn(log)).toBe(ms / SIM_POLL_MS);
  expect(page.state()).toEqual(before);
}

const versionsRise = (log: Logged[]) => {
  const versions = controlsOf(log).map((r) => (r.answer as SimulatorResponse).version);
  for (let i = 1; i < versions.length; i += 1) expect(versions[i]).toBeGreaterThan(versions[i - 1]);
  return versions;
};

// ---------- A package journey ----------

describe('a package journey rehearsed twice on the real run (#891)', () => {
  it('Watch a package → end → Back to start → Play → end: the same seeks, answers, steps, carriers and final state', async () => {
    const selection = { kind: 'package' as const, id: watchId };
    const journey = buildJourney({ shipmentId: watchId, sim: fresh, map }) as Journey;
    expect(journey.kind).toBe('journey');
    expect(journey.planKind).toBe('relay'); // two carriers and a night: the homepage's story
    const windows = playPlan(journey).windows;
    const start = api.log.length;

    // The homepage's link: the journey opens and starts by itself, once, and the key leaves the URL.
    const page = openPage(`?package=${encodeURIComponent(watchId)}&play=1`);
    await settle(api);
    expect(search.current).toBe(`?package=${encodeURIComponent(watchId)}`);
    const first = await playToEnd(page, { autoPlayedFrom: start });

    // What one rehearsal shows.
    expect(first.refused).toBe(0);
    expect(first.others).toEqual([]);
    expect(first.seeks[0]).toBe(windows[0].startMin);
    expect(first.seeks[first.seeks.length - 1]).toBe(windows[windows.length - 1].endMin);
    for (let i = 1; i < first.seeks.length; i += 1) expect(first.seeks[i]).toBeGreaterThan(first.seeks[i - 1]);
    expect(first.watch.cards).toEqual([`Overnight at ${journey.steps.find((s) => s.kind === 'hub_drop')!.placeName}`]);
    expect(first.watch.steps[0].split(',')).toEqual(['current', ...journey.steps.slice(1).map(() => 'upcoming')]);
    expect(first.watch.steps[first.watch.steps.length - 1].split(',')).toEqual(journey.steps.map(() => 'done'));
    expect(first.watch.steps).toHaveLength(journey.steps.length + 1); // one step done at a time, never back
    expect(first.end.line.startsWith('Journey complete: ')).toBe(true);
    expect(first.end.action).toBe('play_journey');
    expect(first.end.error).toBe('');
    // Both carriers, each with its letter, and nobody else.
    const plan = fresh.plans.find((p) => p.shipmentId === watchId)!;
    expect(first.vehicles).toEqual([`${plan.legs[0].employeeId} A`, `${plan.legs[1].employeeId} B`]);
    expect(first.end.carriers).toEqual(journey.carriers.map((c) => `${c.legIndex === 0 ? 'A' : 'B'} · ${c.name}`));
    expect((controlsOf(api.log).at(-1)!.answer as SimulatorResponse).snapshot.shipmentStatus[watchId]).toBe('delivered');
    // No loop while it played: a seek per step, then the card's second.
    const playedMs = first.seeks.length * JOURNEY_STEP_MS + OVERNIGHT_CARD_MS;
    expectNoLoop(api.log.slice(start), playedMs + 2 * SIM_POLL_MS, first.seeks.length);
    await expectQuiet(page, 5 * SIM_POLL_MS);

    // Back to start: the fresh run, nothing left on the map.
    expectFreshStart(page, await backToStart(page), selection);
    const startState = page.state();
    await expectQuiet(page, 3 * SIM_POLL_MS);

    // The second rehearsal, by the button.
    const second = await playToEnd(page);
    expect(second).toEqual(first);
    await expectQuiet(page, 5 * SIM_POLL_MS);

    // And Back to start again lands on the same page as the first time.
    expectFreshStart(page, await backToStart(page), selection);
    expect(page.state()).toEqual(startState);
    // `version` is the one thing that moved: every control counted.
    versionsRise(api.log.slice(start));
  });

  it('Pause in the evening leg and on the overnight card: nothing moves while paused, and Play goes on from the same minute', async () => {
    const selection = { kind: 'package' as const, id: watchId };
    const windows = playPlan(buildJourney({ shipmentId: watchId, sim: fresh, map }) as Journey).windows;
    const page = openPage(`?package=${encodeURIComponent(watchId)}`);
    await settle(api);
    expect(page.label()).toBe(PLAY_LABEL); // no `play=1`: it waits for the button
    const plain = await playToEnd(page);
    expectFreshStart(page, await backToStart(page), selection);

    // The same journey with two pauses.
    const from = api.log.length;
    mapProbe.vehicles.length = 0;
    const watch = newWatch();
    const seeksNow = () => controlsOf(api.log.slice(from)).filter(isSeek).map((r) => seekMin(r)!);
    click(page.playButton());

    // 1. In the middle of the evening leg.
    const eveningSeeks = plain.seeks.filter((t) => t <= windows[0].endMin).length;
    const pauseAfter = Math.floor(eveningSeeks / 2);
    await until(page, watch, () => seeksNow().length >= pauseAfter, 'the middle of the evening leg');
    click(page.playButton());
    expect(page.label()).toBe(PLAY_LABEL);
    expect(page.action()).toBe('play_journey');
    expect(page.line()).toBe(PAUSED_TEXT);
    observe(page, watch);
    const pausedAt = seeksNow().at(-1)!;
    expect(pausedAt).toBeGreaterThan(windows[0].startMin);
    expect(pausedAt).toBeLessThan(windows[0].endMin);
    await expectQuiet(page, 3 * SIM_POLL_MS); // no seek, the same page, one poll per second
    expect((await getSimulator()).clock).toEqual({ ...fresh.clock, timeMin: pausedAt });
    expect(page.state().movers.some((m) => m.kind === 'vehicle')).toBe(true); // the carrier waits on the road
    click(page.playButton());
    expect(page.label()).toBe(PAUSE_LABEL);
    await until(page, watch, () => seeksNow().length > pauseAfter, 'the first seek after Play');
    // The next minute is the one a run without a pause seeks after `pausedAt`: not the start, not a skipped step.
    const next = nextJourneyAction(windows, pausedAt);
    expect(next.kind).toBe('seek');
    expect(seeksNow().at(-1)).toBe(next.kind === 'seek' ? next.toMin : NaN);
    expect(seeksNow().at(-1)).toBe(plain.seeks[pauseAfter]);

    // 2. While the overnight card is up.
    await until(page, watch, () => page.card() !== '', 'the overnight card');
    const beforeNight = seeksNow();
    expect(beforeNight.at(-1)).toBe(windows[0].endMin);
    click(page.playButton());
    expect(page.card()).toBe(''); // the card comes down with the pause
    expect(page.line()).toBe(PAUSED_TEXT);
    observe(page, watch);
    await expectQuiet(page, 3 * SIM_POLL_MS);
    expect(seeksNow()).toEqual(beforeNight);
    click(page.playButton());
    await until(page, watch, () => page.label() === PLAY_LABEL, 'Play again at the end');
    const paused = roundOf(page, from, watch);

    // The card showed twice (before and after the pause); everything else is the plain round.
    expect(paused.watch.cards).toEqual([plain.watch.cards[0], plain.watch.cards[0]]);
    expect(paused.watch.lines.filter((l) => l === PAUSED_TEXT)).toHaveLength(2);
    expect(eachOnce(paused.watch.lines.filter((l) => l !== PAUSED_TEXT))).toEqual(plain.watch.lines);
    expect({ ...paused, watch: { ...paused.watch, cards: plain.watch.cards, lines: plain.watch.lines } }).toEqual(plain);
    expectFreshStart(page, await backToStart(page), selection);
  });
});

describe('a journey played again without Back to start (#891)', () => {
  it('Play at the journey\'s end, and Watch a package a second time, both play the whole journey from its start', async () => {
    const page = openPage(`?package=${encodeURIComponent(watchId)}`);
    await settle(api);
    const plain = await playToEnd(page);

    // The clock stands on the journey's last minute; Play goes back to the first departure.
    expect((await getSimulator()).clock.timeMin).toBe(plain.seeks[plain.seeks.length - 1]);
    expect(plain.seeks[0]).toBeLessThan(plain.seeks[plain.seeks.length - 1]);
    const atEnd = await playToEnd(page);
    // Until the first seek answers, the page still shows the end it stands on (every step done, carrier B
    // at the end of the commute); the step line waits for it (#725). From that answer on it is the same rehearsal.
    expect(atEnd.watch.steps).toEqual([plain.watch.steps[plain.watch.steps.length - 1], ...plain.watch.steps]);
    expect([...atEnd.vehicles].sort()).toEqual([...plain.vehicles].sort());
    expect({ ...atEnd, watch: { ...atEnd.watch, steps: plain.watch.steps }, vehicles: plain.vehicles }).toEqual(plain);

    // Home, then "Watch a package" again: a new page on a clock that still stands at the journey's end.
    page.close();
    const from = api.log.length;
    mapProbe.vehicles.length = 0;
    mapProbe.last = null;
    const again = openPage(`?package=${encodeURIComponent(watchId)}&play=1`);
    await settle(api);
    const third = await playToEnd(again, { autoPlayedFrom: from });
    // Before its first seek answered, the new page drew the run as it stood (the old minute: carrier B at
    // the end of the commute, or the network's carriers while the map loads); from the first answer on it
    // is the same rehearsal, with the same two lettered carriers.
    expect(third.vehicles.filter((v) => / [AB]$/.test(v)).sort()).toEqual([...plain.vehicles].sort());
    expect({ ...third, vehicles: plain.vehicles }).toEqual(plain);
  });
});

// ---------- Network Play ----------

describe('network Play rehearsed twice on the real run (#891)', () => {
  it('Play → end → Back to start → Play with a Pause → end: the same seeks, answers, carriers and final state', async () => {
    const windows = networkWindows(fresh, SIM_END_MIN);
    const start = api.log.length;
    const page = openPage('');
    await settle(api);
    expect(page.action()).toBe('play_network');
    expect(page.state().movers).toEqual(freshMovers(null));
    const startState = page.state();

    const first = await playToEnd(page);
    expect(first.refused).toBe(0);
    expect(first.others).toEqual([]); // seeks only: no `play`, no `speed`, so the run is never locked
    expect(first.seeks[0]).toBe(windows[0].startMin);
    expect(first.seeks[first.seeks.length - 1]).toBe(SIM_END_MIN);
    for (let i = 1; i < first.seeks.length; i += 1) expect(first.seeks[i]).toBeGreaterThan(first.seeks[i - 1]);
    expect(first.watch.lines).toEqual([NETWORK_PLAYING_TEXT, NETWORK_FINISHED_TEXT]);
    expect(first.watch.cards).toHaveLength(1); // the one night
    // Every carrier of a plan leg was drawn, and nobody else.
    const carriers = new Set(fresh.plans.flatMap((p) => p.legs.map((l) => l.employeeId)));
    expect(new Set(first.vehicles.map((v) => v.split(' ')[0]))).toEqual(carriers);
    // The end of the run: everything delivered, the button off with its reason, no vehicle left.
    const last = controlsOf(api.log).at(-1)!.answer as SimulatorResponse;
    expect(last.clock).toEqual({ ...fresh.clock, timeMin: SIM_END_MIN });
    expect(Object.values(last.snapshot.shipmentStatus).every((s) => s === 'delivered')).toBe(true);
    expect(first.end.action).toBe('none');
    expect(first.end.disabledNote).toBe(FINISHED_REASON);
    expect(first.end.error).toBe('');
    expect(first.end.movers.filter((m) => m.kind === 'vehicle')).toEqual([]);
    expect(first.end.movers.every((m) => m.waiting === 'delivered')).toBe(true);
    const playedMs = first.seeks.length * JOURNEY_STEP_MS + OVERNIGHT_CARD_MS;
    expect(playedMs).toBeLessThanOrEqual(60_000);
    expectNoLoop(api.log.slice(start), playedMs + 2 * SIM_POLL_MS, first.seeks.length);
    await expectQuiet(page, 5 * SIM_POLL_MS);
    // A press on the finished button sends nothing.
    click(page.playButton());
    await expectQuiet(page, 2 * SIM_POLL_MS);

    expectFreshStart(page, await backToStart(page), null);
    expect(page.state()).toEqual(startState);
    expect(page.action()).toBe('play_network');

    // The second rehearsal, with a Pause while carriers are on the road.
    const from = api.log.length;
    mapProbe.vehicles.length = 0;
    const watch = newWatch();
    const seeksNow = () => controlsOf(api.log.slice(from)).filter(isSeek).map((r) => seekMin(r)!);
    click(page.playButton());
    const pauseAfter = Math.floor(first.seeks.filter((t) => t <= windows[0].endMin).length / 2);
    await until(page, watch, () => seeksNow().length >= pauseAfter, 'the middle of the evening commutes');
    click(page.playButton());
    expect(page.label()).toBe(PLAY_LABEL);
    expect(page.action()).toBe('play_network');
    expect(page.line()).toBe(NETWORK_PAUSED_TEXT);
    observe(page, watch);
    const pausedAt = seeksNow().at(-1)!;
    await expectQuiet(page, 3 * SIM_POLL_MS);
    expect((await getSimulator()).clock).toEqual({ ...fresh.clock, timeMin: pausedAt });
    expect(page.state().movers.some((m) => m.kind === 'vehicle')).toBe(true);
    click(page.playButton());
    await until(page, watch, () => seeksNow().length > pauseAfter, 'the first seek after Play');
    expect(seeksNow().at(-1)).toBe(first.seeks[pauseAfter]);
    expect(seeksNow().at(-1)! - pausedAt).toBeLessThanOrEqual(JOURNEY_COMMUTE_STEP_MIN);
    await until(page, watch, () => page.label() === PLAY_LABEL && page.action() === 'none', 'the end of the run');
    const second = roundOf(page, from, watch);
    expect(second.watch.lines).toEqual([NETWORK_PLAYING_TEXT, NETWORK_PAUSED_TEXT, NETWORK_PLAYING_TEXT, NETWORK_FINISHED_TEXT]);
    expect({ ...second, watch: { ...second.watch, lines: first.watch.lines } }).toEqual(first);

    expectFreshStart(page, await backToStart(page), null);
    expect(page.state()).toEqual(startState);
    versionsRise(api.log.slice(start));
  });
});

// ---------- Back to start while it plays ----------

describe('Back to start in the middle of Play (#891)', () => {
  /** Presses Play, lets `seeks` steps pass (or waits for the overnight card), presses Back to start. */
  async function playThenReset(page: Page, selection: { kind: 'package'; id: string } | null, stopAt: number | 'card') {
    const from = api.log.length;
    const watch = newWatch();
    click(page.playButton());
    const sent = () => controlsOf(api.log.slice(from)).filter(isSeek).length;
    await until(page, watch, () => (stopAt === 'card' ? page.card() !== '' : sent() >= stopAt), `Play at ${stopAt}`);
    expect(page.label()).toBe(PAUSE_LABEL);
    // `backToStart` checks that the reset is the only control from the press on: no seek follows it.
    expectFreshStart(page, await backToStart(page), selection);
    await expectQuiet(page, 3 * SIM_POLL_MS); // and none later: the step timer and the card's timer are gone
    return sent();
  }

  it('a journey: it stops at once, mid-leg and on the overnight card, and the next Play is the whole rehearsal', async () => {
    const selection = { kind: 'package' as const, id: watchId };
    const page = openPage(`?package=${encodeURIComponent(watchId)}`);
    await settle(api);
    const plain = await playToEnd(page);
    expectFreshStart(page, await backToStart(page), selection);
    const startState = page.state();

    expect(await playThenReset(page, selection, 5)).toBe(5);
    expect(page.state()).toEqual(startState);
    const night = await playThenReset(page, selection, 'card');
    expect(night).toBeLessThan(plain.seeks.length);
    expect(page.state()).toEqual(startState);

    expect(await playToEnd(page)).toEqual(plain);
  });

  it('network Play: it stops at once, and the next Play starts from the first commute again', async () => {
    const windows = networkWindows(fresh, SIM_END_MIN);
    const page = openPage('');
    await settle(api);
    const startState = page.state();

    expect(await playThenReset(page, null, 12)).toBe(12);
    expect(page.state()).toEqual(startState);
    expect(page.action()).toBe('play_network');

    // The next Play: the first commute's first minutes again, not the minute the last one stopped on.
    const from = api.log.length;
    click(page.playButton());
    const seeks = () => controlsOf(api.log.slice(from)).filter(isSeek).map((r) => seekMin(r)!);
    await until(page, newWatch(), () => seeks().length >= 3, 'three steps of the next Play');
    const expected = [windows[0].startMin];
    for (let i = 1; i < 3; i += 1) {
      const next = nextJourneyAction(windows, expected[i - 1]);
      expected.push(next.kind === 'seek' ? next.toMin : NaN);
    }
    expect(seeks()).toEqual(expected);
    expectFreshStart(page, await backToStart(page), null);
  });
});

// ---------- The server clock's own controls ----------

describe('seek, play, pause and Back to start sent twice (#891)', () => {
  it('give the same answers apart from version, and Back to start always answers the fresh run', async () => {
    const mid = Math.floor((fresh.clock.timeMin + SIM_END_MIN) / 2);
    const requests: SimControlRequest[] = [
      { action: 'seek', timeMin: mid },
      { action: 'play' },       // a clock started outside the page (another tab): it locks the run
      { action: 'pause' },
      { action: 'seek', timeMin: SIM_END_MIN },
      RESET_REQUEST,
    ];
    const round = async () => {
      const answers: SimulatorResponse[] = [];
      for (const req of requests) answers.push(await simulatorControl(req));
      return answers;
    };
    const first = await round();
    const second = await round();
    expect(second.map(sansVersion)).toEqual(first.map(sansVersion));
    expect(first.map((a) => a.clock.timeMin)).toEqual([mid, mid, mid, SIM_END_MIN, fresh.clock.timeMin]);
    expect(first.map((a) => a.clock.phase)).toEqual(['planning', 'locked', 'locked', 'locked', 'planning']);
    expect(first.map((a) => a.clock.playing)).toEqual([false, true, false, false, false]);
    expect(sansVersion(first[4])).toEqual(sansVersion(fresh));
    expect(sansVersion(second[4])).toEqual(sansVersion(fresh));
    const versions = [...first, ...second].map((a) => a.version);
    for (let i = 1; i < versions.length; i += 1) expect(versions[i]).toBeGreaterThan(versions[i - 1]);
    expect(sansVersion(await getSimulator())).toEqual(sansVersion(fresh));
  });
});
