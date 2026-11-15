// #966 over HTTP: the default NYC run has 120 employees and the story of 60.
// Two real servers with no key, each booted from its own temp copy of the committed fixtures/nyc
// (v2-e2e-nyc-helper.ts, DECISIONS pass 56), with `globalThis.fetch` as a recorder: a call that is not to a
// test server fails the test, so "no Google fetch" is checked on every step.
//   - `api`: the default run, as `npm start` gives it;
//   - `story`: the same server after POST /scenario/generate with the contract's default count, which is the
//     demo with the story's 60 employees only, the run the server started with before #966.
// What is held: the default run's 24 plans are the 60-employee run's, field for field, and stay so through
// Recompute, a new planning cycle, Play and Back to start, with and without requests sent in between; a
// request gets the plan the 60-employee run gives it while that run has one, and an added employee's commute
// after that; the Options card of the README's request and both sides of the comparison are the same on both.
// The only story names used are read from the README's ```demo-request block (DECISIONS pass 54, 59).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { emptyDraft, toRequest } from '../../client/src/components/business/v2/newDeliveryModel';
import type {
  AdviseResponse, CompareResponse, MapResponse, ShipmentResponse, SimulatorResponse,
} from '../../shared/v2/api';
import type { DeliveryPlan, Run as RunV2 } from '../../shared/v2/types';
import { DEFAULT_RUN_EMPLOYEES } from '../../server/api/v2/bootRun';
import { missingLinePairs } from '../../server/api/v2/mapLines';
import { STORY_EMPLOYEES } from '../../server/api/v2/storyFirst';
import { copyNycFixtures, recordFetch, REPO_ROOT, startNycApi, T, type NycApi } from './v2-e2e-nyc-helper';

const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
const block = /```demo-request\n([\s\S]*?)```/.exec(readme)?.[1] ?? '';
const demo = Object.fromEntries(block.trim().split('\n').map((line) => {
  const colon = line.indexOf(':');
  return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
})) as Record<'sender' | 'recipient' | 'package' | 'type' | 'weight_kg' | 'contents' | 'evening_carrier' | 'morning_carrier', string>;

const net = recordFetch();
const dirs: string[] = [];
let api: NycApi;
let story: NycApi;
/** The default run as it booted, and the 60-employee demo. */
let booted: RunV2;
let storyRun: RunV2;

const MATCH_REASON = 'Every matching commute is already carrying a package';
const plansOf = (run: RunV2) => run.assignments.plans;
/** The 24 story plans of a run: the plans of the packages the run booted with. */
const storyPlans = (run: RunV2) => {
  const ids = new Set(booted.scenario.shipments.map((shipment) => shipment.id));
  return plansOf(run).filter((plan) => ids.has(plan.shipmentId));
};
const isAdded = (employeeId: string) =>
  booted.scenario.employees.findIndex((employee) => employee.id === employeeId) >= STORY_EMPLOYEES;

/** The README's request as the New delivery form sends it (the times are the form's defaults). */
function readmeRequest(n: number) {
  const businessId = (name: string) => {
    const found = booted.scenario.businesses.filter((business) => business.name === name);
    if (found.length !== 1) throw new Error(`README names the business "${name}", and the default run has ${found.length} of them`);
    return found[0]!.id;
  };
  const draft = {
    ...emptyDraft(),
    recipientId: businessId(demo.recipient),
    label: demo.package,
    category: demo.type === 'Envelope' ? 'envelope' as const : 'small_box' as const,
    weightKg: demo.weight_kg,
    description: demo.contents,
  };
  return toRequest(draft, businessId(demo.sender), `story-first-${n}`);
}

beforeAll(async () => {
  for (const which of ['default', 'story'] as const) {
    const fixturesDir = copyNycFixtures();
    dirs.push(fixturesDir);
    const started = await startNycApi(net, { fixturesDir });
    if (which === 'default') api = started;
    else story = started;
  }
  booted = await api.exportRun();
  const generated = await story.post<SimulatorResponse>('/scenario/generate', { preset: 'demo' });
  expect(generated.status).toBe(200);
  storyRun = await story.exportRun();
}, T);
afterEach(() => net.expectNoOutgoing());
afterAll(async () => {
  await api?.close();
  await story?.close();
  net.restore();
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
}, T);

describe('the default NYC run: 120 employees, the story of 60 (#966)', () => {
  it('boots with the 60 story employees first and 60 more, and exactly the plans of the 60-employee run', () => {
    expect(api.runtime.status).toBe('ready');
    expect(booted.scenario.employees).toHaveLength(DEFAULT_RUN_EMPLOYEES);
    expect(storyRun.scenario.employees).toHaveLength(STORY_EMPLOYEES);
    expect(booted.scenario.employees.slice(0, STORY_EMPLOYEES)).toEqual(storyRun.scenario.employees);
    expect(booted.scenario.shipments).toEqual(storyRun.scenario.shipments);
    expect(booted.scenario.businesses).toEqual(storyRun.scenario.businesses);
    expect(booted.scenario.settings).toEqual(storyRun.scenario.settings);

    expect(plansOf(booted)).toHaveLength(booted.scenario.shipments.length);
    expect(plansOf(booted)).toEqual(plansOf(storyRun));
    expect(booted.assignments.unmatched).toEqual([]);
    expect(booted.jobs).toEqual(storyRun.jobs);
    expect(booted.events).toEqual(storyRun.events);
    expect(booted.jobs.some((job) => isAdded(job.employeeId))).toBe(false);
  }, T);

  it('the map has every route line it draws in the committed cache: nothing to fetch for the added employees', async () => {
    const map = await api.get<MapResponse>('/map');
    expect(map.status).toBe(200);
    expect(map.body.employees).toHaveLength(DEFAULT_RUN_EMPLOYEES);
    expect(map.body.homes).toHaveLength(DEFAULT_RUN_EMPLOYEES);
    // What a server with a Google key would ask for after this answer: the lines of the plans and of the
    // carriers' commutes that the cache lacks. None, as for the 60-employee run.
    expect(missingLinePairs(booted, map.body.polylines)).toEqual([]);
    const storyMap = await story.get<MapResponse>('/map');
    expect(missingLinePairs(storyRun, storyMap.body.polylines)).toEqual([]);
  }, T);

  it('the Options card of the README\'s request is the one of the 60-employee run', async () => {
    const { clientRequestId: _id, ...draft } = readmeRequest(0);
    const [onDefault, onStory] = await Promise.all([
      api.post<AdviseResponse>('/advise', { draft }), story.post<AdviseResponse>('/advise', { draft }),
    ]);
    expect(onDefault.status).toBe(200);
    expect(onDefault.body.options.length).toBeGreaterThan(0);
    expect(onDefault.body).toEqual(onStory.body);
    const addedNames = new Set(booted.scenario.employees.slice(STORY_EMPLOYEES).map((employee) => employee.name));
    for (const option of onDefault.body.options) {
      expect(option.carrierNames.filter((name) => addedNames.has(name)), option.label).toEqual([]);
    }
  }, T);

  it('the comparison is the 60-employee run\'s on both sides, its relay side is the run\'s own plans, and it changes nothing', async () => {
    const compared = await api.post<CompareResponse>('/matches/compare', {});
    expect(compared.status).toBe(200);
    expect(compared.body.withRelay.result.plans).toEqual(plansOf(booted));
    expect(compared.body.withRelay.result.unmatched).toEqual([]);
    const direct = compared.body.directOnly.result;
    expect(direct.plans.every((plan) => plan.kind === 'direct')).toBe(true);
    expect(direct.plans.length + direct.unmatched.length).toBe(booted.scenario.shipments.length);
    // Both sides are those of the 60-employee run: the same plans, reasons and numbers (the measured time aside).
    const onStory = await story.post<CompareResponse>('/matches/compare', {});
    for (const side of ['directOnly', 'withRelay'] as const) {
      expect(compared.body[side].result.plans, side).toEqual(onStory.body[side].result.plans);
      expect(compared.body[side].result.unmatched, side).toEqual(onStory.body[side].result.unmatched);
      expect(compared.body[side].metrics, side).toEqual(onStory.body[side].metrics);
    }
    expect((await api.exportRun()).assignments.plans).toEqual(plansOf(booted));
  }, T);

  it('Recompute keeps the 24 plans, the jobs and the timeline', async () => {
    const res = await api.post<SimulatorResponse>('/matches/recompute', {});
    expect(res.status).toBe(200);
    const run = await api.exportRun();
    expect(run.runId).toBe(booted.runId);
    expect(plansOf(run)).toEqual(plansOf(booted));
    expect(run.assignments.unmatched).toEqual([]);
    expect(run.jobs).toEqual(booted.jobs);
    expect(run.events).toEqual(booted.events);
    expect(run.notifications).toEqual(booted.notifications);
  }, T);

  it('Play and Back to start keep them: the run is locked, then open again, with every plan as it was', async () => {
    const played = await api.control({ action: 'play' });
    expect(played.clock.phase).toBe('locked');
    await api.control({ action: 'pause' });
    const back = await api.control({ action: 'reset_playback' });
    expect(back.clock).toMatchObject({ phase: 'planning', playing: false, timeMin: booted.clock.timeMin });
    const run = await api.exportRun();
    expect(plansOf(run)).toEqual(plansOf(booted));
    expect(run.jobs).toEqual(booted.jobs);
    expect(run.events).toEqual(booted.events);
  }, T);

  it('a new planning cycle keeps them, under a new run ID', async () => {
    const res = await api.post<SimulatorResponse>('/planning/reset', {});
    expect(res.status).toBe(200);
    const run = await api.exportRun();
    expect(run.runId).not.toBe(booted.runId);
    expect(plansOf(run)).toEqual(plansOf(booted));
    expect(run.assignments.unmatched).toEqual([]);
    expect(run.jobs).toEqual(booted.jobs);
    expect(run.events).toEqual(booted.events);
    expect(run.scenario).toEqual(booted.scenario);
  }, T);
});

describe('requests on the default run: the story\'s employees first, the added ones after them (#966)', () => {
  /** The README request, sent to both servers until the default run has no commute left for it. */
  const sends: { onDefault: ShipmentResponse; onStory: ShipmentResponse }[] = [];

  it('the README request gets the 60-employee run\'s plan while that run has one, then an added employee\'s commute, then the reason', async () => {
    for (let n = 1; n <= 12; n++) {
      const [onDefault, onStory] = await Promise.all([
        api.post<ShipmentResponse>('/shipments', readmeRequest(n)), story.post<ShipmentResponse>('/shipments', readmeRequest(n)),
      ]);
      expect([onDefault.status, onStory.status]).toEqual([201, 201]);
      sends.push({ onDefault: onDefault.body, onStory: onStory.body });
      if (!onDefault.body.matched) break;
    }
    const matchedOnStory = sends.filter((send) => send.onStory.matched).length;
    const matchedOnDefault = sends.filter((send) => send.onDefault.matched).length;

    // The first one is the request of the README's block, with the carriers the block names.
    const first = sends[0]!.onDefault.plan as DeliveryPlan;
    const names = new Map(booted.scenario.employees.map((employee) => [employee.id, employee.name]));
    expect(first.legs.map((leg) => names.get(leg.employeeId))).toEqual([demo.evening_carrier, demo.morning_carrier]);

    for (const [index, { onDefault, onStory }] of sends.entries()) {
      const nth = `send ${index + 1}`;
      if (onStory.matched) {
        // Exactly the 60-employee run's answer: same plan, same price, same carriers, same stop times.
        expect(onDefault.plan, nth).toEqual(onStory.plan);
        expect(onDefault.shipment, nth).toEqual(onStory.shipment);
        expect(onDefault.plan!.legs.some((leg) => isAdded(leg.employeeId)), nth).toBe(false);
      } else if (onDefault.matched) {
        // The 60-employee run says no; here an added employee carries it.
        expect(onStory.unmatchedReason, nth).toBe(MATCH_REASON);
        expect(onDefault.plan!.legs.some((leg) => isAdded(leg.employeeId)), nth).toBe(true);
      } else {
        expect(onDefault.unmatchedReason, nth).toBe(MATCH_REASON);
      }
    }
    // Once the 60-employee run has no commute left it stays that way, and the default run goes on for longer.
    expect(sends.map((send) => send.onStory.matched)).toEqual(sends.map((_, index) => index < matchedOnStory));
    expect(sends.map((send) => send.onDefault.matched)).toEqual(sends.map((_, index) => index < matchedOnDefault));
    expect(matchedOnStory).toBeGreaterThanOrEqual(1);
    expect(matchedOnDefault).toBeGreaterThan(matchedOnStory);
    expect(sends.at(-1)!.onDefault.matched).toBe(false);

    // The README says after how many sends the run has no commute left for the request.
    const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
    const said = /and the (\w+) time it is not matched \("([^"]+)"\)/.exec(readme);
    expect(said?.[1]).toBe(ORDINALS[matchedOnDefault]);
    expect(said?.[2]).toBe(MATCH_REASON);
  }, T);

  it('the 24 story plans did not move while the requests came in', async () => {
    expect(storyPlans(await api.exportRun())).toEqual(plansOf(booted));
  }, T);

  it.each([
    ['Recompute', '/matches/recompute'],
    ['a new planning cycle', '/planning/reset'],
  ])('%s with those requests in the run: the 24 story plans are identical, and every request that had a plan has one', async (_name, url) => {
    const before = await api.exportRun();
    const res = await api.post<SimulatorResponse>(url, {});
    expect(res.status).toBe(200);
    const run = await api.exportRun();
    expect(storyPlans(run)).toEqual(plansOf(booted));
    const planned = (from: RunV2) => new Set(plansOf(from).map((plan) => plan.shipmentId));
    expect([...planned(run)].sort()).toEqual([...planned(before)].sort());
    expect(run.assignments.unmatched.map((u) => u.reason)).toEqual(before.assignments.unmatched.map(() => MATCH_REASON));
    // A story package is never on an added employee's commute.
    for (const plan of storyPlans(run)) {
      expect(plan.legs.some((leg) => isAdded(leg.employeeId)), plan.shipmentId).toBe(false);
    }
  }, T);
});
