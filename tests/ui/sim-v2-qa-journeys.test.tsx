// @vitest-environment jsdom
// #739: the journeys other than Navy Yard, and the network Play -> Pause -> Back to start -> journey path, in
// a real DOM on the REAL default NYC run. The same paths were played in headless Chrome at 1440 px (PR body).
// - a direct journey: plays to Delivered, never shows an Overnight card, and its legend has no ◆ or ⇄ row
//   (DECISIONS pass 68);
// - a relay other than Navy Yard: plays to Delivered with "Overnight at <its own relay point>";
// - an unmatched package: `play=1` plays nothing, the one button is disabled with its note, no control is sent;
// - `/simulator` with no package: Play (seeks only since #790), Pause, Back to start, then the Navy Yard
//   package and Play: it plays to Delivered, and Play/Pause and Back to start keep focus and the right enabled
//   state at every step.
//
// It runs the real app (`AppShell`) against `DemoServer` (demo-path-mvp3-helper.ts): the server's own views,
// `snapshotAt` and `planControl`, no key, no network, fake timers. Packages are picked from the simulator answer
// (kind, `createdSeq`, the Navy Yard label of pass 54), never by ID. The unmatched package is made by the
// server's own create steps (`planCreateShipment` -> `withShipment` -> `atPlanningStart` -> `matchPending`, as
// POST /api/v2/shipments does), because the default run has none.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimulatorResponse } from '../../shared/v2/api';
import type { DeliveryPlan, Run } from '../../shared/v2/types';
import { matchPending } from '../../server/api/v2/pipeline';
import { atPlanningStart, planCreateShipment, withShipment } from '../../server/api/v2/shipmentOps';
import { buildTimeline } from '../../server/domain/v2/timeline';
import { JOURNEY_STEP_MS, OVERNIGHT_CARD_MS } from '../../client/src/components/sim/v2/motion/journeyPlayback';
import { NO_JOURNEY_TEXT } from '../../client/src/components/sim/v2/compose/journeyPlay';
import { buttons, click, textOf } from './kitDom';
import { DemoServer, advance, demoRun, mountApp, settleUntil, type DemoRun, type MountedApp } from './demo-path-mvp3-helper';

const T = 30_000;
vi.setConfig({ testTimeout: T, hookTimeout: T });

const google = vi.hoisted(() => ({ loads: 0 }));
vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: () => { google.loads += 1; },
  importLibrary: () => { google.loads += 1; return new Promise(() => {}); },
}));

const NAVY_YARD = /navy yard/i;
/** Far more than the longest journey of the default run takes at the fixed pace (about 20 s). */
const JOURNEY_BUDGET_MS = 60_000;

// ---------- Picking packages from the API answer ----------

type Picked = { id: string; label: string; plan: DeliveryPlan };

function byCreatedSeq(sim: SimulatorResponse): Picked[] {
  const seq = new Map(sim.shipments.map((s) => [s.id, s]));
  return sim.plans
    .map((plan) => ({ id: plan.shipmentId, label: seq.get(plan.shipmentId)!.label, plan, n: seq.get(plan.shipmentId)!.createdSeq }))
    .sort((a, b) => a.n - b.n);
}
const firstDirect = (sim: SimulatorResponse) => byCreatedSeq(sim).find((p) => p.plan.kind === 'direct')!;
const firstOtherRelay = (sim: SimulatorResponse) =>
  byCreatedSeq(sim).find((p) => p.plan.kind === 'relay' && !NAVY_YARD.test(p.label))!;
const navyYard = (sim: SimulatorResponse) => byCreatedSeq(sim).find((p) => NAVY_YARD.test(p.label))!;

const businessName = (id: string | undefined) => demoRun().run.scenario.businesses.find((b) => b.id === id)!.name;

/**
 * The default run plus one delivery no commute can carry (ready at the first matched pickup's sender, due ten
 * minutes later), stored the way POST /api/v2/shipments stores it. Its ID is the one the server gave it.
 */
function runWithUnmatched(): { demo: DemoRun; id: string } {
  const { run, travel } = demoRun();
  const direct = run.assignments.plans.find((p) => p.kind === 'direct')!;
  const sent = run.scenario.shipments.find((s) => s.id === direct.shipmentId)!;
  const plan = planCreateShipment(run, {
    clientRequestId: 'qa-739-unmatched',
    originBusinessId: sent.originBusinessId,
    destinationBusinessId: sent.destinationBusinessId,
    label: 'QA rush proofs',
    category: 'envelope',
    description: 'Due too soon for any commute.',
    weightKg: 0.3,
    readyMin: sent.readyMin,
    deadlineMin: sent.readyMin + 10,
  });
  if (plan.kind !== 'create') throw new Error(`the create request was refused: ${JSON.stringify(plan)}`);
  const next: Run = structuredClone(atPlanningStart(withShipment(run, plan.shipment)));
  matchPending(next, [plan.shipment.id], { travel, buildEvents: buildTimeline });
  return { demo: { run: next, travel }, id: plan.shipment.id };
}

// ---------- The page ----------

function playPause(c: ParentNode): HTMLButtonElement {
  const all = buttons(c, /^(Play|Pause)$/);
  if (all.length !== 1) throw new Error(`playPause(): ${all.length} Play/Pause buttons`);
  return all[0];
}
function backToStart(c: ParentNode): HTMLButtonElement {
  const all = buttons(c, 'Back to start');
  if (all.length !== 1) throw new Error(`backToStart(): ${all.length} buttons`);
  return all[0];
}
const enabled = (b: HTMLButtonElement) => b.getAttribute('aria-disabled') !== 'true' && !b.disabled;
const statusLines = (c: ParentNode) => [...c.querySelectorAll('[role="status"]')].map(textOf).filter((t) => t !== '');
const overnightCard = (c: ParentNode) => statusLines(c).find((t) => t.startsWith('Overnight')) ?? null;
/** The journey legend's symbol keys (package, sender, relay, swap, recipient); empty without a journey legend. */
const legendSymbols = (c: ParentNode) =>
  [...c.querySelectorAll('ul[aria-label="Map symbols"] [data-symbol]')].map((li) => li.getAttribute('data-symbol'));
const journeyStatus = (c: ParentNode) =>
  textOf(c.querySelector('section[aria-label="Package journey"] .jt__status strong')!);

/** Statuses, overnight cards and button states seen while a journey plays to its end (the button reads Play again). */
async function playToEnd(c: HTMLElement) {
  const seen = { statuses: [journeyStatus(c)], overnight: new Set<string>(), focusLost: 0 };
  const focused = document.activeElement;
  let sawPause = textOf(playPause(c)) === 'Pause';
  for (let t = 0; t < JOURNEY_BUDGET_MS; t += JOURNEY_STEP_MS / 2) {
    await advance(JOURNEY_STEP_MS / 2);
    const card = overnightCard(c);
    if (card) seen.overnight.add(card);
    if (seen.statuses.at(-1) !== journeyStatus(c)) seen.statuses.push(journeyStatus(c));
    if (focused !== document.body && document.activeElement !== focused) seen.focusLost += 1;
    if (textOf(playPause(c)) === 'Pause') sawPause = true;
    else if (sawPause) return seen;
  }
  throw new Error('playToEnd(): the journey did not end');
}

type Open = { server: DemoServer; app: MountedApp; c: HTMLElement };

function open(path: string, demo?: DemoRun): Open {
  const server = new DemoServer(demo);
  vi.stubGlobal('fetch', server.fetch);
  const app = mountApp(path);
  return { server, app, c: app.container };
}

/** Nothing failed on the wire: no unknown path and no control the server refused. */
function expectCleanWire(server: DemoServer) {
  expect(server.unknown).toEqual([]);
  for (const req of server.controls()) expect(['seek', 'play', 'pause', 'speed', 'reset_playback']).toContain(req.action);
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

describe('journeys other than Navy Yard, opened with ?package=<id>&play=1 (#739)', () => {
  it('a direct journey plays to Delivered with no Overnight card and no ◆ or ⇄ legend row', async () => {
    const pick = firstDirect(new DemoServer().simulator());
    expect(pick.plan.legs).toHaveLength(1);
    const { server, app, c } = open(`/simulator?package=${encodeURIComponent(pick.id)}&play=1`);
    await settleUntil(() => server.seeks().length > 0, 'the direct journey starting by itself');
    expect(app.url()).toBe(`/simulator?package=${encodeURIComponent(pick.id)}`);
    expect(legendSymbols(c)).toEqual(['package', 'sender', 'recipient']);

    const seen = await playToEnd(c);
    expect(seen.overnight.size).toBe(0);
    expect(seen.statuses.at(-1)).toBe('Delivered');
    expect(seen.statuses).not.toContain('At the relay point');
    expect(statusLines(c)).toContain(`Journey complete: Delivered to recipient at ${businessName(pick.plan.legs[0].stops.at(-1)!.placeId)}.`);
    expect(legendSymbols(c)).toEqual(['package', 'sender', 'recipient']);
    expect(enabled(playPause(c)) && enabled(backToStart(c))).toBe(true);
    expect(server.controls().every((r) => r.action === 'seek')).toBe(true);
    expectCleanWire(server);
  });

  it('a relay other than Navy Yard plays to Delivered with "Overnight at <its relay point>" on the way', async () => {
    const pick = firstOtherRelay(new DemoServer().simulator());
    const relay = businessName(pick.plan.relayBusinessId);
    const { server, c } = open(`/simulator?package=${encodeURIComponent(pick.id)}&play=1`);
    await settleUntil(() => server.seeks().length > 0, 'the relay journey starting by itself');
    expect(legendSymbols(c)).toEqual(['package', 'sender', 'relay', 'swap', 'recipient']);

    const seen = await playToEnd(c);
    expect([...seen.overnight]).toEqual([`Overnight at ${relay}`]);
    expect(seen.statuses).toEqual(['Waiting for pickup', 'Picked up, on the way', 'At the relay point', 'Out for delivery', 'Delivered']);
    expect(overnightCard(c)).toBeNull();
    expect(enabled(playPause(c)) && enabled(backToStart(c))).toBe(true);
    expectCleanWire(server);
  }, T + OVERNIGHT_CARD_MS);

  it('an unmatched package plays nothing: Play is disabled with its note, no control is sent, play=1 leaves the URL', async () => {
    const { demo, id } = runWithUnmatched();
    const { server, app, c } = open(`/simulator?package=${encodeURIComponent(id)}&play=1`, demo);
    expect(server.simulator().unmatched.map((u) => u.shipmentId)).toEqual([id]);
    await settleUntil(() => app.url() === `/simulator?package=${encodeURIComponent(id)}`, 'the unmatched package settling');

    await advance(5_000);
    expect(textOf(playPause(c))).toBe('Play');
    expect(enabled(playPause(c))).toBe(false);
    expect(textOf(c)).toContain(NO_JOURNEY_TEXT);
    expect(enabled(backToStart(c))).toBe(true);
    expect(legendSymbols(c)).toEqual([]);
    expect(overnightCard(c)).toBeNull();
    expect(c.textContent).toContain('Unmatched');

    click(playPause(c));
    await advance(1_000);
    expect(server.controls()).toEqual([]);
    expectCleanWire(server);
  });
});

describe('/simulator with no package: Play, Pause, Back to start, then the Navy Yard journey (#739)', () => {
  it('plays to Delivered, and Play/Pause and Back to start keep focus and the right enabled state throughout', async () => {
    const { server, app, c } = open('/simulator');
    await settleUntil(() => buttons(c, /^(Play|Pause)$/).length === 1 && enabled(playPause(c)), 'the network page loading');
    const navy = navyYard(server.simulator());
    expect(server.simulator().clock.phase).toBe('planning');

    // Play (#790): network Play steps with seeks, so the clock is never played and the run stays in planning;
    // focus stays on the one button, which now reads Pause.
    const button = playPause(c);
    const start = server.simulator().clock.timeMin;
    click(button);
    await advance(100);
    expect(server.controls().at(-1)).toMatchObject({ action: 'seek' });
    expect(server.simulator().clock).toMatchObject({ playing: false, phase: 'planning' });
    expect(server.simulator().clock.timeMin).toBeGreaterThan(start);
    expect(document.activeElement).toBe(playPause(c));
    expect(textOf(playPause(c))).toBe('Pause');
    expect(enabled(playPause(c)) && enabled(backToStart(c))).toBe(true);

    // Pause: no further seek, the clock stays where it is; focus stays, the button reads Play and is enabled.
    await advance(1_000);
    click(playPause(c));
    await advance(100);
    const paused = { sent: server.controls().length, at: server.simulator().clock.timeMin };
    await advance(2_000);
    expect(server.controls()).toHaveLength(paused.sent);
    expect(server.simulator().clock.timeMin).toBe(paused.at);
    expect(server.controls().every((r) => r.action === 'seek')).toBe(true);
    expect(document.activeElement).toBe(playPause(c));
    expect(textOf(playPause(c))).toBe('Play');
    expect(enabled(playPause(c)) && enabled(backToStart(c))).toBe(true);

    // Back to start: focus stays on it, both buttons enabled, the run is in planning again (#734).
    click(backToStart(c));
    expect(document.activeElement).toBe(backToStart(c));
    await advance(100);
    expect(server.controls().at(-1)).toEqual({ action: 'reset_playback' });
    expect(server.simulator().clock).toMatchObject({ playing: false, phase: 'planning' });
    expect(document.activeElement).toBe(backToStart(c));
    expect(enabled(playPause(c)) && enabled(backToStart(c))).toBe(true);

    // The Navy Yard package from the list, then Play: its journey.
    const rows = buttons(c, new RegExp(`^${navy.label}`));
    expect(rows).toHaveLength(1);
    click(rows[0]);
    await settleUntil(() => c.querySelector('section[aria-label="Package journey"]') !== null, 'the journey opening');
    expect(app.url()).toBe(`/simulator?package=${encodeURIComponent(navy.id)}`);
    expect(enabled(playPause(c))).toBe(true);
    const seeksBefore = server.seeks().length;
    click(playPause(c));
    await advance(10);
    expect(server.seeks().length).toBeGreaterThan(seeksBefore);
    expect(document.activeElement).toBe(playPause(c));
    expect(textOf(playPause(c))).toBe('Pause');

    const seen = await playToEnd(c);
    expect(seen.focusLost).toBe(0);
    expect([...seen.overnight]).toEqual([`Overnight at ${businessName(navy.plan.relayBusinessId)}`]);
    expect(seen.statuses.at(-1)).toBe('Delivered');
    expect(document.activeElement).toBe(playPause(c));
    expect(textOf(playPause(c))).toBe('Play');
    expect(enabled(playPause(c)) && enabled(backToStart(c))).toBe(true);
    expectCleanWire(server);
  });
});
