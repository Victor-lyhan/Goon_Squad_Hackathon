// @vitest-environment jsdom
// The 30-second demo path of docs/mvp3.md, end to end in a real DOM (#704; DECISIONS pass 63):
// homepage -> "Watch a package" -> /simulator?package=<Navy Yard id>&play=1 -> the journey plays by itself
// at the fixed pace, shows "Overnight at <relay point>" for about 1 s in place of the night, runs the morning
// leg and ends Delivered. One Play/Pause button pauses it in place and resumes it.
//
// It runs the real app (`AppShell`: header, route table, homepage, simulator page with its data hook) on the
// REAL default NYC run built from the committed fixtures/nyc, with no key and no network: the app's `fetch`
// is the in-memory `DemoServer` of demo-path-mvp3-helper.ts, which answers with the server's own views,
// `snapshotAt` and `planControl`. Time is `vi.useFakeTimers()`; nothing sleeps.
//
// The only story value written here is the label "Navy Yard grinder burrs" (DECISIONS pass 54): the package
// ID, every business and carrier name, every minute and the number of steps are read from the run.
// The map runs in its no-key state: the Google loader is replaced by a recorder that must stay unused.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimulatorResponse } from '../../shared/v2/api';
import type { DeliveryPlan, Leg, Shipment, Stop } from '../../shared/v2/types';
import { nycSummaryFrom, watchPackageHref } from '../../client/src/pages/landingModel';
import {
  JOURNEY_COMMUTE_STEP_MIN, JOURNEY_STEP_MIN, JOURNEY_STEP_MS, OVERNIGHT_CARD_MS,
} from '../../client/src/components/sim/v2/motion/journeyPlayback';
import { formatClock } from '../../client/src/ui/format';
import { buttons, click, link, textOf } from './kitDom';
import { DemoServer, advance, demoRun, mountApp, settleUntil, type MountedApp } from './demo-path-mvp3-helper';

/** Per test and hook: one real run build, then renders. Locally well under 1 s; 30 s is far above 10x (pass 52). */
const T = 30_000;
vi.setConfig({ testTimeout: T, hookTimeout: T });

const google = vi.hoisted(() => ({ loads: 0 }));
vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: () => { google.loads += 1; },
  importLibrary: () => { google.loads += 1; return new Promise(() => {}); },
}));

/** The one story value in this file: the package the homepage's button opens is found by this label. */
const STORY_LABEL = 'Navy Yard grinder burrs';
const WATCH_LINK = 'Watch a package';
/** The whole demo, in real time (docs/mvp3.md: "a judge understands Relay in 30 seconds"). */
const DEMO_BUDGET_MS = 30_000;

// ---------- The story, read from the run ----------

type Story = {
  id: string;
  /** `/simulator?package=<id>&play=1`: what the homepage's button must link to. */
  href: string;
  /** The same without `play=1`: the URL once playback was started. */
  openedUrl: string;
  sender: string;
  relay: string;
  recipient: string;
  carrierA: string;
  carrierB: string;
  pickup: Stop;
  /** The seeks of each leg at the fixed pace, in order. */
  evening: number[];
  morning: number[];
  /** All of them: the evening, then (after the card) the morning. */
  seeks: number[];
  stepCount: number;
};

/**
 * One leg at the fixed pace, the carrier's whole commute (#761): from one minute before the trip departs
 * to the leg's finish. One minute to the departure, JOURNEY_COMMUTE_STEP_MIN while the carrier drives
 * without the package, JOURNEY_STEP_MIN from one minute before its first stop to its last stop's service end.
 */
function legSeeks(leg: Leg, departureMin: number): number[] {
  const carryStart = Math.min(...leg.stops.map((s) => s.arrivalMin)) - 1;
  const carryEnd = Math.max(...leg.stops.map((s) => s.serviceEndMin));
  const seeks = [departureMin - 1];
  const last = () => seeks[seeks.length - 1];
  if (last() < carryStart) seeks.push(departureMin);
  while (last() < carryStart) seeks.push(Math.min(last() + JOURNEY_COMMUTE_STEP_MIN, carryStart));
  while (last() < carryEnd) seeks.push(Math.min(last() + JOURNEY_STEP_MIN, carryEnd));
  while (last() < leg.finishMin) seeks.push(Math.min(last() + JOURNEY_COMMUTE_STEP_MIN, leg.finishMin));
  return seeks;
}

function storyOf(sim: SimulatorResponse): Story {
  const { run } = demoRun();
  const labeled: Shipment[] = sim.shipments.filter((s) => s.label === STORY_LABEL);
  expect(labeled.map((s) => s.label), 'the default run has the story package once').toEqual([STORY_LABEL]);
  const shipment = labeled[0];
  const plans: DeliveryPlan[] = sim.plans.filter((p) => p.shipmentId === shipment.id);
  expect(plans.map((p) => p.kind), 'the API plans the story package as one relay').toEqual(['relay']);
  const [eveningLeg, morningLeg] = plans[0].legs;
  const business = (id: string | undefined) => {
    const b = run.scenario.businesses.find((x) => x.id === id);
    if (!b) throw new Error(`no business ${String(id)} in the run`);
    return b.name;
  };
  const employee = (id: string) => {
    const e = run.scenario.employees.find((x) => x.id === id);
    if (!e) throw new Error(`no employee ${id} in the run`);
    return e.name;
  };
  const departure = (leg: Leg) => {
    const trip = run.trips.find((t) => t.id === leg.tripId);
    if (!trip) throw new Error(`no trip ${leg.tripId} in the run`);
    return trip.departureMin;
  };
  const evening = legSeeks(eveningLeg, departure(eveningLeg));
  const morning = legSeeks(morningLeg, departure(morningLeg));
  // The whole commutes (#761): carrier A from leaving work to home, carrier B from leaving home to work.
  expect(evening[0]).toBe(departure(eveningLeg) - 1);
  expect(evening[evening.length - 1]).toBe(eveningLeg.finishMin);
  expect(evening[evening.length - 1]).toBeGreaterThan(eveningLeg.stops[eveningLeg.stops.length - 1].serviceEndMin);
  expect(morning[0]).toBe(departure(morningLeg) - 1);
  expect(morning[0]).toBeLessThan(morningLeg.stops[0].arrivalMin - 1);
  expect(morning[morning.length - 1]).toBe(morningLeg.finishMin);
  const id = encodeURIComponent(shipment.id);
  return {
    id: shipment.id,
    href: `/simulator?package=${id}&play=1`,
    openedUrl: `/simulator?package=${id}`,
    sender: business(shipment.originBusinessId),
    relay: business(plans[0].relayBusinessId),
    recipient: business(shipment.destinationBusinessId),
    carrierA: employee(eveningLeg.employeeId),
    carrierB: employee(morningLeg.employeeId),
    pickup: eveningLeg.stops[0],
    evening,
    morning,
    seeks: [...evening, ...morning],
    stepCount: eveningLeg.stops.length + morningLeg.stops.length,
  };
}

// ---------- The page ----------

/** The one Play/Pause button, whatever it reads now. */
function playPause(c: ParentNode): HTMLButtonElement {
  const all = buttons(c, /^(Play|Pause)$/);
  if (all.length !== 1) throw new Error(`playPause(): ${all.length} Play/Pause buttons`);
  return all[0];
}
/** A click on the one button, which must read `expected` now. */
function clickPlayPause(c: ParentNode, expected: 'Play' | 'Pause') {
  expect(textOf(playPause(c))).toBe(expected);
  click(playPause(c));
}
/** The text of every live status line on the page (the step line, the overnight card, banners). */
const statusLines = (c: ParentNode) => [...c.querySelectorAll('[role="status"]')].map(textOf).filter((t) => t !== '');
/** The "Overnight at <relay point>" card's text, or null while it is not shown. */
const overnightCard = (c: ParentNode) => statusLines(c).find((t) => t.startsWith('Overnight')) ?? null;

const timeline = (c: ParentNode) => {
  const all = c.querySelectorAll('section[aria-label="Package journey"]');
  if (all.length !== 1) throw new Error(`timeline(): ${all.length} journey panels`);
  return all[0];
};
/** The package's status as the server's snapshot has it, in the journey panel's header. */
const journeyStatus = (c: ParentNode) => textOf(timeline(c).querySelector('.jt__status strong')!);
const steps = (c: ParentNode) => [...timeline(c).querySelectorAll('ol > li')];
/** Each step's state: "Done", "Next" or "Upcoming". */
const stepStates = (c: ParentNode) => steps(c).map((li) => textOf(li.querySelector('.jt-step__state')!));
/** Each step's symbol and the short label next to it, as on the map (#683). */
const stepSymbols = (c: ParentNode) => steps(c).map((li) => [
  li.querySelector('svg[data-symbol]')?.getAttribute('data-symbol') ?? null,
  textOf(li.querySelector('.jt-step__short')!),
]);
const carrierLines = (c: ParentNode) =>
  [...timeline(c).querySelectorAll('ul[aria-label="Carriers"] .jt-leg__name')].map(textOf);

// ---------- Opening the path ----------

type Demo = { server: DemoServer; app: MountedApp; c: HTMLElement; story: Story };

function startServer(): { server: DemoServer; story: Story } {
  const server = new DemoServer();
  vi.stubGlobal('fetch', server.fetch);
  return { server, story: storyOf(server.simulator()) };
}

const firstSeekSent = (server: DemoServer) => () => server.seeks().length > 0;

/** The judge's path: the homepage, then one click on "Watch a package". Returns once the first step was sent. */
async function watchFromHomepage(): Promise<Demo> {
  const { server, story } = startServer();
  const app = mountApp('/');
  const c = app.container;
  await settleUntil(() => link(c, WATCH_LINK).getAttribute('href') === story.href, 'the Watch link pointing at the story package');
  click(link(c, WATCH_LINK));
  await settleUntil(firstSeekSent(server), 'playback starting by itself');
  return { server, app, c, story };
}

/** The same URL opened directly (a shared link, a reload of the first page). */
async function openWatchUrl(): Promise<Demo> {
  const { server, story } = startServer();
  const app = mountApp(story.href);
  await settleUntil(firstSeekSent(server), 'playback starting by itself');
  return { server, app, c: app.container, story };
}

beforeAll(() => { demoRun(); });
beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
  google.loads = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  expect(google.loads).toBe(0);
});

describe('the 30-second demo path on the real default NYC run (docs/mvp3.md)', () => {
  it('the pace is fixed and the overnight card stays up for about 1 s', () => {
    expect(JOURNEY_STEP_MS).toBeGreaterThan(0);
    expect(JOURNEY_STEP_MIN).toBeGreaterThan(0);
    expect(OVERNIGHT_CARD_MS).toBeGreaterThanOrEqual(800);
    expect(OVERNIGHT_CARD_MS).toBeLessThanOrEqual(1500);
  });

  it('the homepage\'s "Watch a package" links to /simulator?package=<the Navy Yard package>&play=1, found by its label', async () => {
    const { server, story } = startServer();
    const { run } = demoRun();
    const sim = server.simulator();

    // The model, fed the real simulator answer.
    const summary = nycSummaryFrom({ businesses: run.scenario.businesses }, { employees: run.scenario.employees }, sim);
    expect(watchPackageHref(summary)).toBe(story.href);
    expect(story.href).toMatch(/^\/simulator\?package=[^&]+&play=1$/);

    // The page: the plain simulator until the run is loaded, then the story package.
    const app = mountApp('/');
    expect(link(app.container, WATCH_LINK).getAttribute('href')).toBe('/simulator');
    await settleUntil(() => link(app.container, WATCH_LINK).getAttribute('href') !== '/simulator', 'the homepage loading the run');
    expect(link(app.container, WATCH_LINK).getAttribute('href')).toBe(story.href);
    expect(server.unknown).toEqual([]);
  });

  it('a click on it opens the simulator on that journey and playback starts without a click on Play', async () => {
    const { server, story } = startServer();
    const app = mountApp('/');
    const c = app.container;
    await settleUntil(() => link(c, WATCH_LINK).getAttribute('href') === story.href, 'the Watch link pointing at the story package');
    expect(server.controls()).toEqual([]);

    click(link(c, WATCH_LINK));
    expect(app.url()).toBe(story.href);
    await settleUntil(firstSeekSent(server), 'playback starting by itself');

    // The journey of the story package is on screen and it is playing: the first step was sent, no click.
    expect(textOf(timeline(c).querySelector('h2')!)).toBe(STORY_LABEL);
    expect(textOf(playPause(c))).toBe('Pause');
    expect(server.controls()).toEqual([{ action: 'seek', timeMin: story.evening[0] }]);
    // `play=1` starts it once: the key leaves the URL, the package stays.
    expect(app.url()).toBe(story.openedUrl);

    // The timeline shows the map's four symbols with their short labels, and the two carriers as A and B (#683).
    expect(stepSymbols(c)).toEqual([
      ['sender', story.sender],
      ['relay', `Overnight · ${story.relay}`],
      ['swap', `Handed to ${story.carrierB}`],
      ['recipient', `To ${story.recipient}`],
    ]);
    expect(carrierLines(c)).toEqual([`A · ${story.carrierA}`, `B · ${story.carrierB}`]);
    expect(steps(c)).toHaveLength(story.stepCount);
    expect(server.unknown).toEqual([]);
  });

  it('it plays by itself: past the sender, "Overnight at <relay point>" for about 1 s, the morning leg, Delivered at the recipient', async () => {
    const { server, c, story } = await watchFromHomepage();
    const startedAt = Date.now();
    const { evening, morning } = story;

    /** The statuses the page showed, in order, read after every step. */
    const seen: string[] = [journeyStatus(c)];
    const play = async (ms: number) => {
      for (let left = ms; left > 0; left -= JOURNEY_STEP_MS) {
        await advance(Math.min(JOURNEY_STEP_MS, left));
        if (seen[seen.length - 1] !== journeyStatus(c)) seen.push(journeyStatus(c));
      }
    };

    // Before the pickup: waiting at the sender, nothing done yet.
    expect(server.seeks()).toEqual([evening[0]]);
    expect(stepStates(c)[0]).toBe('Next');
    expect(stepStates(c).slice(1).every((s) => s === 'Upcoming')).toBe(true);

    // The evening leg, one step every JOURNEY_STEP_MS: the package passes its sender.
    const pickedUp = evening.findIndex((m) => m >= story.pickup.serviceEndMin);
    expect(pickedUp).toBeGreaterThan(0);
    await play(pickedUp * JOURNEY_STEP_MS);
    expect(server.seeks()).toEqual(evening.slice(0, pickedUp + 1));
    expect(stepStates(c).slice(0, 2)).toEqual(['Done', 'Next']);
    expect(statusLines(c).some((t) => t.includes(`Drop at relay point at ${story.relay}`))).toBe(true);
    expect(overnightCard(c)).toBeNull();

    // To the relay point: the package is left there. The card is not up before the next step is due.
    await play((evening.length - 1 - pickedUp) * JOURNEY_STEP_MS);
    expect(server.seeks()).toEqual(evening);
    expect(journeyStatus(c)).toBe('At the relay point');
    expect(overnightCard(c)).toBeNull();

    // The night: the card with the relay point's name, and no step while it is up.
    await play(JOURNEY_STEP_MS);
    expect(overnightCard(c)).toBe(`Overnight at ${story.relay}`);
    expect(textOf(playPause(c))).toBe('Pause');
    await advance(OVERNIGHT_CARD_MS - 1);
    expect(overnightCard(c)).toBe(`Overnight at ${story.relay}`);
    expect(server.seeks()).toEqual(evening);
    expect(server.timeMin()).toBe(evening[evening.length - 1]);

    // Then one jump to the morning (the night itself is never played) and the card is gone.
    await advance(1);
    expect(overnightCard(c)).toBeNull();
    expect(server.seeks()).toEqual([...evening, morning[0]]);
    expect(morning[0]).toBeGreaterThan(evening[evening.length - 1] + JOURNEY_STEP_MIN);

    // The morning leg, to the recipient.
    await play((morning.length - 1) * JOURNEY_STEP_MS);
    expect(server.seeks()).toEqual(story.seeks);
    expect(journeyStatus(c)).toBe('Delivered');
    expect(stepStates(c)).toEqual(steps(c).map(() => 'Done'));
    // #780: the last step is the end of carrier B's commute, so the line does not say "Journey complete" yet.
    expect(statusLines(c).some((t) => t.startsWith(`Delivered to recipient at ${story.recipient}. `) && t.endsWith(' is at work.'))).toBe(true);
    expect(statusLines(c).some((t) => t.startsWith('Journey complete'))).toBe(false);
    const deliveredAt = server.simulator().snapshot.deliveredAtMin[story.id];
    expect(stepSymbols(c).map(([symbol]) => symbol)).toEqual(['sender', 'relay', 'swap', 'recipient']);
    expect(stepSymbols(c)[story.stepCount - 1]).toEqual(['recipient', `Delivered ${formatClock(deliveredAt)}`]);

    // The server's statuses the judge saw, each once and in this order.
    expect(seen).toEqual(['Waiting for pickup', 'Picked up, on the way', 'At the relay point', 'Out for delivery', 'Delivered']);

    // It ends by itself: the button reads Play again, inside the 30 seconds of the demo.
    await play(JOURNEY_STEP_MS);
    expect(textOf(playPause(c))).toBe('Play');
    expect(Date.now() - startedAt).toBeLessThanOrEqual(DEMO_BUDGET_MS);

    // Nothing more is sent: `play=1` started it once. Every request was a seek; the server clock never played.
    await advance(10_000);
    expect(server.seeks()).toEqual(story.seeks);
    expect(server.controls().every((r) => r.action === 'seek')).toBe(true);
    expect(server.simulator().clock.playing).toBe(false);
    expect(journeyStatus(c)).toBe('Delivered');
    expect(server.unknown).toEqual([]);
  });

  it('Pause stops the clock (no seek while paused) and Play resumes from there, every step once', async () => {
    const { server, c, story } = await openWatchUrl();
    const { evening } = story;
    expect(evening.length).toBeGreaterThan(3); // three steps before the pause, and one to resume with
    await advance(2 * JOURNEY_STEP_MS);
    expect(server.seeks()).toEqual(evening.slice(0, 3));

    clickPlayPause(c, 'Pause');
    expect(textOf(playPause(c))).toBe('Play');
    expect(statusLines(c)).toContain('Journey paused.');
    const requests = server.requests.length;
    await advance(20_000);
    // No seek, and no other control either: the clock is where the last step left it. The page kept polling.
    expect(server.controls()).toEqual(evening.slice(0, 3).map((timeMin) => ({ action: 'seek', timeMin })));
    expect(server.timeMin()).toBe(evening[2]);
    expect(server.requests.length).toBeGreaterThan(requests);
    expect(textOf(playPause(c))).toBe('Play');
    expect(steps(c)).toHaveLength(story.stepCount); // still on the journey

    clickPlayPause(c, 'Play');
    await settleUntil(() => server.seeks().length > 3, 'the next step after Play');
    expect(server.seeks()).toEqual(evening.slice(0, 4)); // the next step, not the start
    expect(textOf(playPause(c))).toBe('Pause');

    await advance(story.seeks.length * JOURNEY_STEP_MS + OVERNIGHT_CARD_MS);
    expect(server.seeks()).toEqual(story.seeks);
    expect(journeyStatus(c)).toBe('Delivered');
    expect(textOf(playPause(c))).toBe('Play');
    expect(server.unknown).toEqual([]);
  });

  it('Pause on the overnight card keeps the package at the relay point; Play shows the card again, then the morning', async () => {
    const { server, c, story } = await openWatchUrl();
    const { evening, morning } = story;
    await advance(evening.length * JOURNEY_STEP_MS);
    expect(overnightCard(c)).toBe(`Overnight at ${story.relay}`);

    clickPlayPause(c, 'Pause');
    expect(overnightCard(c)).toBeNull();
    await advance(20_000);
    expect(server.seeks()).toEqual(evening);
    expect(journeyStatus(c)).toBe('At the relay point');

    clickPlayPause(c, 'Play');
    expect(overnightCard(c)).toBe(`Overnight at ${story.relay}`);
    await advance(OVERNIGHT_CARD_MS);
    expect(overnightCard(c)).toBeNull();
    expect(server.seeks()).toEqual([...evening, morning[0]]);

    await advance(morning.length * JOURNEY_STEP_MS);
    expect(server.seeks()).toEqual(story.seeks);
    expect(journeyStatus(c)).toBe('Delivered');
    expect(textOf(playPause(c))).toBe('Play');
  });
});
