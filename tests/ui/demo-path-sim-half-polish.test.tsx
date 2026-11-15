// @vitest-environment jsdom
// #908: the simulator half of the 30-second path, homepage -> Watch a package -> the journey to its end.
// Walked in headless Chrome on a production build with no keys (the table is in the PR); this file pins
// what the walk changed and what it relies on:
//  1. the homepage: "Watch a package" is the first thing after the title and the page's first link; a
//     window too narrow for the simulator is told so under the button, before the press; a press that
//     comes before the run is loaded is held and lands on the journey (it used to open the simulator
//     with no package picked: two more presses);
//  2. while the simulator loads there is always one short plain line, and the Inspector is never empty;
//  3. the journey's steps read as plain sentences with their times, with no "hub", "leg", "trip" or id;
//  4. at the end the panel says the package arrived and names the next step in one line.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Landing, {
  STUDY_HREF, STUDY_LABEL, WATCH_LABEL, WATCH_NOTE_ID, WATCH_NOTE_NARROW, WATCH_WAIT_TEXT,
} from '../../client/src/pages/Landing';
import type { NycSummary } from '../../client/src/pages/landingModel';
import { RESET_LABEL } from '../../client/src/components/sim/v2/controls/controlsModel';
import { LOADING_TEXT, MAP_PENDING_TEXT } from '../../client/src/components/sim/v2/compose/simPageView';
import { JourneyLegend } from '../../client/src/components/sim/v2/journey/JourneyLegend';
import { ARRIVED_TEXT, JourneyTimeline } from '../../client/src/components/sim/v2/journey/JourneyTimeline';
import {
  NUMBERS_HREF, NUMBERS_LABEL, SOMEONE, buildJourney, stepSentence, type Journey,
} from '../../client/src/components/sim/v2/journey/journeyModel';
import { INITIAL_SIM_DATA } from '../../client/src/components/sim/v2/live/simDataModel';
import { NARROW_QUERY } from '../../client/src/components/sim/v2/page/simPageState';
import { formatMin } from '../../client/src/ui/format';
import { click, deferred, flush, link, mount, tabOrder, textOf } from './kitDom';
import { businesses, employees, storySimulator } from './landing-nyc-sample';
import { FakeSimServer, journeySteps, mountBody, playbar, readyState, rightBody, runAt } from './sim-v2-dom-helpers';
import { T, map, simAt } from './sim-v2-journey-sample';

const google = vi.hoisted(() => ({ loads: 0 }));
vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: () => { google.loads += 1; },
  importLibrary: () => { google.loads += 1; return new Promise(() => {}); },
}));
beforeEach(() => { vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', ''); google.loads = 0; });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); expect(google.loads).toBe(0); });

/** Words the path must not show (QUESTIONS 23:01, item 6) and raw ids. */
const JARGON = /\b(hubs?|legs?|trips?|trip ids?|ids?)\b|\b(shp|emp|biz|home|plan)-/i;

// ---------- 1. The homepage ----------

const READY: NycSummary = { status: 'ready', businessIds: ['biz-a'], employeeIds: ['emp-1'], watchPackageId: 'shp-3' };
const STORY_JOURNEY = '/simulator?package=shp-3&play=1';

describe('the homepage: Watch a package (#908)', () => {
  const css = readFileSync('client/src/styles/landing.css', 'utf8');

  it('is the first thing after the title and the first link of the page, with the line about a wider screen under it', () => {
    const { container: c } = mount(<MemoryRouter><Landing initialSummary={READY} /></MemoryRouter>);
    const copy = [...c.querySelector('.landing-hero-copy')!.children];
    expect(copy.map((el) => `${el.tagName.toLowerCase()}.${el.className || el.id}`)).toEqual([
      'h1.landing-title', 'a.watch-button', 'p.watch-note', 'ul.workspaces',
    ]);
    const watch = link(c, WATCH_LABEL);
    expect(watch.getAttribute('href')).toBe(STORY_JOURNEY);
    // The keyboard: the page's first stop (the header's links are the shell's, before the page).
    expect(tabOrder(c)[0]).toBe(watch);
    expect(c.innerHTML).not.toMatch(/tabindex/i);
    // What will happen, for a window the simulator does not fit: one sentence, read with the button.
    const note = c.querySelector('.watch-note')!;
    expect(note.id).toBe(WATCH_NOTE_ID);
    expect(watch.getAttribute('aria-describedby')).toBe(WATCH_NOTE_ID);
    expect(textOf(note)).toBe(WATCH_NOTE_NARROW);
    expect(WATCH_NOTE_NARROW).toBe('The simulator needs a wider screen. On this one, read How it works below.');
    expect(WATCH_NOTE_NARROW).not.toMatch(JARGON);
    expect(WATCH_NOTE_NARROW).not.toMatch(/\d|desktop-only|viewport|px/i);
    // It adds no link and no button: the tab order of the page is as it was.
    expect(note.querySelector('a, button')).toBeNull();
    expect(textOf(note.querySelector('[role="status"]')!)).toBe('');
  });

  it('the line shows only below the simulator\'s own breakpoint, so a wide hero is unchanged', () => {
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const at = flat.indexOf('@media (max-width: 899.98px)');
    expect(NARROW_QUERY).toBe('(max-width: 899.98px)'); // where the simulator shows only its notice
    expect(at).toBeGreaterThan(-1);
    const wide = flat.slice(0, at);
    const narrow = flat.slice(at, flat.indexOf('}\n}', at));
    expect(wide).toMatch(/\.watch-note-narrow \{ display: none; \}/);
    expect(narrow).toMatch(/\.watch-note-narrow \{ display: block; \}/);
    // Hidden, the paragraph takes no room: no margin of its own.
    expect(/\.watch-note \{([^}]*)\}/.exec(wide)![1]).toMatch(/margin: 0;/);
  });

  /** The page on a fetch the test answers, with the place the router is at. */
  function startOnHeldFetch() {
    const held = { businesses: deferred<Response>(), employees: deferred<Response>(), simulator: deferred<Response>() };
    vi.stubGlobal('fetch', vi.fn((url: string) => held[url.split('/').pop() as keyof typeof held].promise));
    const at = { path: '' };
    function Probe() { const l = useLocation(); at.path = l.pathname + l.search; return null; }
    const m = mount(<MemoryRouter><Landing /><Probe /></MemoryRouter>);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const answer = async () => {
      held.businesses.resolve(json(businesses)); held.employees.resolve(json(employees)); held.simulator.resolve(json(storySimulator));
      for (let i = 0; i < 5; i++) await flush();
    };
    const fail = async () => {
      for (const d of Object.values(held)) d.reject(new TypeError('Failed to fetch'));
      for (let i = 0; i < 5; i++) await flush();
    };
    const waitLine = () => textOf(m.container.querySelector('.watch-note [role="status"]')!);
    return { ...m, at, answer, fail, waitLine };
  }

  it('a press before the run is loaded is held, says so, and opens the journey once the run is loaded', async () => {
    const p = startOnHeldFetch();
    const watch = link(p.container, WATCH_LABEL);
    expect(watch.getAttribute('href')).toBe('/simulator'); // no package known yet
    click(watch);
    expect(p.at.path).toBe('/'); // not the simulator with nothing picked
    expect(p.waitLine()).toBe(WATCH_WAIT_TEXT);
    expect(WATCH_WAIT_TEXT).toBe('Opening the simulator…');
    expect(p.container.querySelector('.watch-note')!.className).toBe('watch-note is-waiting');

    await p.answer();
    expect(p.at.path).toBe(STORY_JOURNEY);
  });

  it('a held press still leaves the page when the load fails: the simulator has its own error state', async () => {
    const p = startOnHeldFetch();
    click(link(p.container, WATCH_LABEL));
    expect(p.at.path).toBe('/');
    await p.fail();
    expect(p.at.path).toBe('/simulator');
    p.unmount(); // drops the homepage's retry timer
  });

  it('a press after the run is loaded goes at once, as before', async () => {
    const p = startOnHeldFetch();
    await p.answer();
    expect(p.waitLine()).toBe('');
    click(link(p.container, WATCH_LABEL));
    expect(p.at.path).toBe(STORY_JOURNEY);
  });
});

// ---------- 2. While the simulator loads ----------

describe('after Watch a package, while the simulator loads (#908)', () => {
  const picked = { kind: 'package', id: 'shp-2' } as const;
  const line = (c: ParentNode) => [...c.querySelectorAll('[role="status"]')].map(textOf).filter(Boolean);

  it('first poll, then the places, then the journey: one short plain line at each wait, never an empty Inspector', () => {
    // 1. Before the first answer: the workspace frame, and the line in the map area. The Inspector holds
    //    placeholder rows (page/SimStateFrame, not this issue's files), so it is not blank.
    const server = new FakeSimServer(INITIAL_SIM_DATA);
    const { container: c } = mountBody(server, picked);
    expect(LOADING_TEXT).toBe('Loading the simulator…');
    expect(textOf(c.querySelector('.sps-map')!)).toContain(LOADING_TEXT);
    expect(rightBody(c).children.length).toBeGreaterThan(0);
    expect(rightBody(c).querySelectorAll('.sps-row').length).toBeGreaterThan(0);

    // 2. The run is here, its places are not: the Inspector itself says the short line.
    server.poll({ ...INITIAL_SIM_DATA, view: 'ready', sim: runAt(1000), map: null });
    expect(MAP_PENDING_TEXT).toBe('Loading places…');
    expect(line(rightBody(c))).toEqual([MAP_PENDING_TEXT]);
    expect(textOf(rightBody(c))).toMatch(/^Loading places…/);
    expect(journeySteps(c)).toHaveLength(0);

    // 3. The journey.
    server.poll(readyState(1000));
    expect(journeySteps(c)).toHaveLength(4);
    for (const text of [LOADING_TEXT, MAP_PENDING_TEXT]) {
      expect(text).not.toMatch(JARGON);
      expect(text.split(' ').length).toBeLessThanOrEqual(3);
    }
  });
});

// ---------- 3. The steps ----------

const journeyAt = (id: string, timeMin: number, status: Record<string, string> = {}) =>
  buildJourney({ shipmentId: id, sim: simAt(timeMin, status as never), map }) as Journey;

describe('the journey steps read as plain sentences with times (#908)', () => {
  it('a relay: who picks it up where, who leaves it for the night, who picks it up, who delivers it', () => {
    const relay = journeyAt('shp-2', T.beforePickup);
    expect(relay.steps.map((s) => s.sentence)).toEqual([
      'Cy picks up the package at DUMBO Studio.',
      'Cy leaves it at Brooklyn Roasting for the night.',
      'Ben picks it up at Brooklyn Roasting.',
      'Ben delivers it to Etsy.',
    ]);
    // The short names of the stops are unchanged: the map's tooltips and the Play bar's step line use them.
    expect(relay.steps.map((s) => s.label)).toEqual([
      'Pickup at sender', 'Drop at relay point', 'Pickup at relay point', 'Delivered to recipient',
    ]);
  });

  it('a direct delivery: two sentences', () => {
    expect(journeyAt('shp-1', T.beforePickup).steps.map((s) => s.sentence)).toEqual([
      'Ana picks up the package at DUMBO Studio.', 'Ana delivers it to Etsy.',
    ]);
  });

  it('without a name the sentence still reads: "A commuter", and the place by its role; never an id', () => {
    expect(SOMEONE).toBe('A commuter');
    expect(stepSentence('pickup', '', '')).toBe('A commuter picks up the package at the sender.');
    expect(stepSentence('hub_drop', ' ', '')).toBe('A commuter leaves it at the relay point for the night.');
    expect(stepSentence('hub_pickup', '', '')).toBe('A commuter picks it up at the relay point.');
    expect(stepSentence('delivery', '', '')).toBe('A commuter delivers it to the recipient.');
    // A run whose map names neither the carriers nor the businesses.
    const bare = buildJourney({ shipmentId: 'shp-2', sim: simAt(T.beforePickup), map: { ...map, businesses: [], employees: [] } }) as Journey;
    for (const s of bare.steps) {
      expect(s.sentence, s.sentence).toMatch(/^A commuter /);
      expect(s.sentence, s.sentence).not.toMatch(JARGON);
    }
  });

  it('the timeline shows each sentence with its time under it, and nothing on the panel is jargon', () => {
    const relay = journeyAt('shp-2', T.onLeg1, { 'shp-2': 'picked_up' });
    const { container: c } = mount(<><JourneyLegend carriers={relay.carriers} /><JourneyTimeline journey={relay} onSeek={() => {}} /></>);
    const steps = [...c.querySelectorAll('.jt__steps > .jt-step')];
    expect(steps.map((li) => textOf(li.querySelector('.jt-step__sentence')!))).toEqual(relay.steps.map((s) => s.sentence));
    expect(steps.map((li) => textOf(li.querySelector('.jt-step__time')!))).toEqual(relay.steps.map((s) => formatMin(s.timeMin)));
    expect(textOf(steps[0].querySelector('.jt-step__time')!)).toMatch(/^Day \d, \d{1,2}:\d{2} [AP]M$/);
    // The sentence is the line on screen; the stop's short name is for a screen reader only.
    for (const li of steps) {
      expect(li.querySelector('.jt-step__sentence')!.className).toBe('jt-step__sentence');
      expect(li.querySelector('.jt-step__label')!.className).toBe('jt-step__label jt-sr');
    }
    // A screen reader hears the stop's name, then the sentence, the state and the time.
    expect(textOf(steps[0].querySelector('button')!)).toBe(
      `1Step 1: Pickup at sender: Cy picks up the package at DUMBO Studio.Done${formatMin(relay.steps[0].timeMin)}DUMBO StudioDUMBO StudioCy Lam+5 min extra`,
    );
    // Every word on the panel, open or under Details.
    expect(textOf(c)).not.toMatch(JARGON);
    for (const el of c.querySelectorAll('[aria-label], [title]')) {
      expect(`${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`).not.toMatch(JARGON);
    }
    // The sentence has the row to itself and the time sits under it (journey.css).
    const sheet = readFileSync('client/src/components/sim/v2/journey/journey.css', 'utf8');
    expect(/\.jt-step__sentence \{([^}]*)\}/.exec(sheet)![1]).toMatch(/flex: 1 0 100%;/);
  });
});

// ---------- 4. The end ----------

describe('at the end of the journey the panel says the package arrived and what to do next (#908)', () => {
  const END_LINE = 'The package arrived. Back to start to watch it again, or See the numbers.';
  const delivered = journeyAt('shp-2', T.afterDelivery, { 'shp-2': 'delivered' });

  it('one line under the last step, with the name of the Play bar\'s button and the link to the study page', () => {
    const { container: c } = mount(<JourneyTimeline journey={delivered} onSeek={() => {}} />);
    const ends = [...c.querySelectorAll('.jt__end')];
    expect(ends).toHaveLength(1);
    expect(ends[0].tagName).toBe('P');
    expect(textOf(ends[0])).toBe(END_LINE);
    expect(END_LINE.startsWith(ARRIVED_TEXT)).toBe(true);
    expect(END_LINE).not.toMatch(JARGON);
    // Inside the last step, so the scroll that shows the Delivered step when the journey ends (#842) shows it too.
    expect(ends[0].parentElement).toBe(c.querySelector('.jt__steps > .jt-step:last-child'));
    // The two next steps by the names the rest of the app and the README use.
    expect(RESET_LABEL).toBe('Back to start');
    expect(textOf(ends[0].querySelector('.jt__end-name')!)).toBe(RESET_LABEL);
    const numbers = link(ends[0], NUMBERS_LABEL);
    expect(numbers.getAttribute('href')).toBe(NUMBERS_HREF);
    expect([NUMBERS_LABEL, NUMBERS_HREF]).toEqual([STUDY_LABEL, STUDY_HREF]); // the homepage's button
    expect(STUDY_LABEL).toBe('See the numbers');
    // Not a live region: the Play bar's hidden step line announces the delivery (#725).
    expect(ends[0].closest('[role="status"], [aria-live]')).toBeNull();
  });

  it('only once the snapshot says delivered: not on the way, not overnight, not for an unmatched package', () => {
    for (const [timeMin, status] of [[T.beforePickup, 'scheduled'], [T.overnight, 'at_hub'], [T.onLeg2, 'out_for_delivery']] as const) {
      const m = mount(<JourneyTimeline journey={journeyAt('shp-2', timeMin, { 'shp-2': status })} onSeek={() => {}} />);
      expect(m.container.querySelector('.jt__end'), status).toBeNull();
      m.unmount();
    }
    // Every step done but the snapshot's status is not "delivered" yet: the status decides, nothing is worked out here.
    const lagging = journeyAt('shp-2', T.afterDelivery, { 'shp-2': 'out_for_delivery' });
    expect(lagging.steps.every((s) => s.state === 'done')).toBe(true);
    const m = mount(<JourneyTimeline journey={lagging} onSeek={() => {}} />);
    expect(m.container.querySelector('.jt__end')).toBeNull();
    m.unmount();
    const unmatched = buildJourney({ shipmentId: 'shp-3', sim: simAt(T.afterDelivery), map })!;
    expect(mount(<JourneyTimeline journey={unmatched} onSeek={() => {}} />).container.querySelector('.jt__end')).toBeNull();
  });

  it('on the page, the line names a button that is on screen: the Play bar\'s "Back to start"', () => {
    const { container: c } = mountBody(new FakeSimServer(readyState(1977)), { kind: 'package', id: 'shp-2' });
    expect(textOf(rightBody(c).querySelector('.jt__end')!)).toBe(END_LINE);
    const named = textOf(rightBody(c).querySelector('.jt__end-name')!);
    expect([...playbar(c).querySelectorAll('button')].map(textOf)).toContain(named);
    // Before the delivery the same page has no end line.
    const early = mountBody(new FakeSimServer(readyState(1000)), { kind: 'package', id: 'shp-2' });
    act(() => {});
    expect(rightBody(early.container).querySelector('.jt__end')).toBeNull();
  });
});
