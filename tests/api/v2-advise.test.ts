// POST /api/v2/advise (#862) on the real server: createV2Runtime, the sample travel cache, the committed NYC
// businesses and story, and a FAKE Gemini behind the injected `fetch`. Checks: the contract's shape, every
// number copied from the engine (a Gemini that invents a price is ignored), trips already reserved stay
// reserved, a slow Gemini falls back to the offline options, a bad draft is a 400, and the run is never changed.
// #867: the flexibility window is the run's `settings.flexWindowMin`; the variants, the prompt and the prices follow it.
// No network, no real key.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { adviseOffline, buildAdvisorPrompt, offlineVariants, PRESENT_OPTIONS, timeText, TRY_VARIANT } from '../../server/ai/advisor';
import { GEMINI_MODELS_URL } from '../../server/ai/gemini';
import { advisorEngine, flexWindowOf, INVALID_ADVISE } from '../../server/api/v2/adviseRoutes';
import {
  DEADLINE_BEFORE_READY, DEADLINE_OUTSIDE_WINDOW, READY_OUTSIDE_WINDOW, SAME_BUSINESS, UNKNOWN_BUSINESS,
} from '../../server/api/v2/shipmentOps';
import type { FetchLike } from '../../server/geo/googleClient';
import type { Store } from '../../server/store';
import type { AdviseResponse } from '../../shared/v2/api';
import type { Run as RunV2, Shipment, TravelProvider } from '../../shared/v2/types';
import { expectEnginePrices, withFlexWindow } from './v2-advise-pricing-helper';
import { T, startBootstrapApi, type BootstrapApi } from './v2-bootstrap-helper';

const KEY = 'AQ.FAKE_advise-route-77e2';
const MODEL = 'gemini-2.5-flash';

// A strict copy of the contract (shared/v2 has types, not response schemas): an extra key fails.
const OptionSchema = z.strictObject({
  label: z.string().min(1).max(60),
  summary: z.string().min(1).max(140),
  changes: z.strictObject({ readyMin: z.number().int().optional(), deadlineMin: z.number().int().optional() }),
  kind: z.enum(['direct', 'relay']),
  relayBusinessId: z.string().optional(),
  carrierNames: z.array(z.string().min(1)).min(1).max(2),
  deliveryMin: z.number().int(),
  extraMin: z.number(),
  extraMiles: z.number().min(0),
  customerPriceCents: z.number().int().min(0),
});
const ResponseSchema = z.strictObject({
  options: z.array(OptionSchema).max(3),
  source: z.enum(['gemini', 'offline']),
  note: z.string().optional(),
});

let api: BootstrapApi | null = null;
let printed: unknown[][];

beforeEach(() => {
  printed = [];
  for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args) => void printed.push(args));
  }
});
afterEach(async () => {
  // The route logs nothing: no key, no draft, no Gemini text.
  expect(printed).toStrictEqual([]);
  await api?.close();
  api = null;
  vi.restoreAllMocks();
}, T);

type Part = Record<string, unknown>;
type Turn = Part[] | 'hang';
const call = (name: string, args: unknown): Part => ({ functionCall: { name, args } });

/** A fake Gemini answering each model turn from `turns` in order (an HTTP 500 after the last). */
function fakeGemini(turns: Turn[]) {
  const sent: string[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    if (!url.startsWith(GEMINI_MODELS_URL)) return Promise.reject(new Error('these tests only know the fake Gemini'));
    sent.push(String(init?.body));
    const turn = turns[sent.length - 1];
    if (turn === 'hang') {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    if (turn === undefined) return Promise.resolve({ status: 500, text: async () => '{}' });
    const body = { candidates: [{ content: { role: 'model', parts: turn }, finishReason: 'STOP' }] };
    return Promise.resolve({ status: 200, text: async () => JSON.stringify(body) });
  };
  return { fetchImpl, sent };
}

async function start(gemini?: { turns: Turn[]; adviseTimeoutMs?: number }) {
  const fake = fakeGemini(gemini?.turns ?? []);
  api = await startBootstrapApi({
    cache: 'sample',
    fetch: fake.fetchImpl,
    ...(gemini ? { gemini: { apiKey: KEY, model: MODEL, adviseTimeoutMs: gemini.adviseTimeoutMs } } : {}),
  });
  if (!api.store || !api.runtime.deps.travel) throw new Error('/api/v2 did not load on the sample cache');
  return { store: api.store as Store<RunV2>, travel: api.runtime.deps.travel as TravelProvider, sent: fake.sent };
}

/** The four draft fields of one of the run's own shipments (a full ParseDraft: the rest may be anything). */
function draftOf(run: RunV2, shipmentId: string) {
  const s = run.scenario.shipments.find((x) => x.id === shipmentId) as Shipment;
  return {
    originBusinessId: s.originBusinessId, destinationBusinessId: s.destinationBusinessId,
    label: s.label, category: s.category, description: s.description, weightKg: s.weightGrams / 1000,
    readyMin: s.readyMin, deadlineMin: s.deadlineMin,
  };
}

async function advise(draft: unknown) {
  const answer = await (api as BootstrapApi).v2.post('/advise', { draft });
  expect(JSON.stringify(answer.body)).not.toContain(KEY);
  return answer;
}

async function adviseOk(draft: unknown): Promise<AdviseResponse> {
  const answer = await advise(draft);
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  expect(answer.headers.get('content-type')).toMatch(/^application\/json\b/);
  return ResponseSchema.parse(answer.body) as AdviseResponse;
}

const remember = (store: Store<RunV2>) => ({ run: store.get(), copy: structuredClone(store.get()) });
function expectUntouched(store: Store<RunV2>, before: ReturnType<typeof remember>) {
  expect(store.get()).toBe(before.run);       // no mutation was committed
  expect(store.get()).toEqual(before.copy);   // and nothing was changed in place
}

/** Every option's numbers are the engine's plan for its variant, read straight from the matcher. */
function expectEngineNumbers(run: RunV2, travel: TravelProvider, draft: ReturnType<typeof draftOf>, body: AdviseResponse) {
  const engine = advisorEngine(run, travel, draft);
  const names = new Map(run.scenario.employees.map((e) => [e.id, e.name]));
  for (const option of body.options) {
    const answer = engine.match(option.changes.readyMin ?? draft.readyMin, option.changes.deadlineMin ?? draft.deadlineMin);
    if (!('plan' in answer)) throw new Error(`the engine has no plan for ${JSON.stringify(option.changes)}`);
    const { plan } = answer;
    expect(option).toMatchObject({
      kind: plan.kind,
      deliveryMin: plan.deliveryMin,
      customerPriceCents: plan.customerPriceCents,
      extraMin: plan.legs.reduce((sum, leg) => sum + leg.extraMin, 0),
      carrierNames: plan.legs.map((leg) => names.get(leg.employeeId)),
    });
    expect(option.relayBusinessId).toBe(plan.kind === 'relay' ? plan.relayBusinessId : undefined);
    expect(option.extraMiles).toBeCloseTo(plan.legs.reduce((sum, leg) => sum + leg.extraDistanceM, 0) / 1609.344, 1);
  }
}

describe('POST /api/v2/advise without a Gemini key', () => {
  it('answers offline options in the contract\'s shape, every number from the engine, and changes nothing', async () => {
    const { store, travel, sent } = await start();
    const before = remember(store);
    const run = store.get();
    // shp-7 of the sample run: as typed it arrives next morning; ready 2 h earlier, the same evening.
    const draft = draftOf(run, 'shp-7');

    const body = await adviseOk(draft);

    expect(body.source).toBe('offline');
    expect(body.options.length).toBeGreaterThanOrEqual(2);
    expect(body.options[0].changes).toStrictEqual({});
    expect(body.options[1].changes).toStrictEqual({ readyMin: draft.readyMin - 120 });
    expect(body.options[1].deliveryMin).toBeLessThan(body.options[0].deliveryMin);
    expectEngineNumbers(run, travel, draft, body);
    expect(body).toStrictEqual(adviseOffline(advisorEngine(run, travel, draft)));
    expect(sent).toStrictEqual([]);
    expectUntouched(store, before);
    expect(await api!.savedRun()).toBeNull();   // the state file was never written
  }, T);

  it('trips already reserved stay reserved: no option uses a trip of a plan of the run', async () => {
    const { store, travel } = await start();
    const run = store.get();
    const reserved = new Set(run.assignments.plans.flatMap((p) => p.legs.map((l) => l.tripId)));
    for (const shipment of run.scenario.shipments) {
      const draft = draftOf(run, shipment.id);
      const engine = advisorEngine(run, travel, draft);
      const answer = engine.match(draft.readyMin, draft.deadlineMin);
      if ('plan' in answer) for (const leg of answer.plan.legs) expect(reserved.has(leg.tripId)).toBe(false);
    }
    // shp-5's own plan holds the only commutes that fit it as typed, so the request as typed finds none.
    const body = await adviseOk(draftOf(run, 'shp-5'));
    expect(body.note).toBe('As typed, every matching commute is already carrying a package.');
    expect(body.options.every((o) => Object.keys(o.changes).length > 0)).toBe(true);
  }, T);

  it('a draft no variant can match: 200 with no options and a note', async () => {
    const { store } = await start();
    const body = await adviseOk(draftOf(store.get(), 'shp-8'));
    expect(body).toStrictEqual({
      options: [], source: 'offline',
      note: 'Even with more time, every matching commute is already carrying a package.',
    });
  }, T);

  it('answers while the run is locked too, and still changes nothing', async () => {
    const { store } = await start();
    await store.mutate((run) => ({ ...run, clock: { ...run.clock, phase: 'locked' } }));
    const before = remember(store);
    const body = await adviseOk(draftOf(store.get(), 'shp-7'));
    expect(body.options.length).toBeGreaterThan(0);
    expectUntouched(store, before);
  }, T);

  it.each<[string, (d: ReturnType<typeof draftOf>) => unknown, Record<string, string>]>([
    ['no draft', () => undefined, { draft: 'Send the parsed draft' }],
    ['a draft that is a list', (d) => [d], { draft: 'Send the parsed draft' }],
    ['no sender', (d) => ({ ...d, originBusinessId: null }), { originBusinessId: 'Choose a sender' }],
    ['no recipient', (d) => ({ ...d, destinationBusinessId: undefined }), { destinationBusinessId: 'Choose a recipient' }],
    ['no ready time', (d) => ({ ...d, readyMin: null }), { readyMin: 'Choose a ready time' }],
    ['a deliver-by that is text', (d) => ({ ...d, deadlineMin: '2040' }), { deadlineMin: 'Choose a deliver-by time' }],
    ['a fraction of a minute', (d) => ({ ...d, readyMin: 990.5 }), { readyMin: 'Choose a ready time' }],
    ['an unknown sender', (d) => ({ ...d, originBusinessId: 'biz-nope' }), { originBusinessId: UNKNOWN_BUSINESS }],
    ['the same business twice', (d) => ({ ...d, destinationBusinessId: d.originBusinessId }), { destinationBusinessId: SAME_BUSINESS }],
    ['a ready time before the window', (d) => ({ ...d, readyMin: 100 }), { readyMin: READY_OUTSIDE_WINDOW }],
    ['a deliver-by after the window', (d) => ({ ...d, deadlineMin: 9999 }), { deadlineMin: DEADLINE_OUTSIDE_WINDOW }],
    ['a deliver-by before the ready time', (d) => ({ ...d, deadlineMin: d.readyMin }), { deadlineMin: DEADLINE_BEFORE_READY }],
  ])('%s is a 400 with the field\'s message', async (_name, build, fieldErrors) => {
    const { store } = await start();
    const before = remember(store);
    const answer = await advise(build(draftOf(store.get(), 'shp-7')));
    expect(answer.status).toBe(400);
    expect(answer.body).toStrictEqual({ error: INVALID_ADVISE, fieldErrors });
    expectUntouched(store, before);
  }, T);
});

// #867: the advisor's flexibility window is the run's `settings.flexWindowMin` (#861), the number the engine
// prices with. The sample run's settings say 1080 (18 h); the tests change it in the store, like an imported run.
describe('POST /api/v2/advise reads the run\'s flexWindowMin (#867)', () => {
  /** shp-2 of the sample run is delivered the evening it is ready. Here its deliver-by is 8 h after ready. */
  function shortWindowDraft(run: RunV2) {
    const draft = draftOf(run, 'shp-2');
    return { ...draft, deadlineMin: draft.readyMin + 480 };
  }
  /** The options that move the deliver-by: the "later deliver-by / flexible" variant. */
  const laterDeliverBy = (body: AdviseResponse) => body.options.filter((o) => o.changes.deadlineMin !== undefined);

  it('offline, the "later deliver-by" option is ready + 18 h on the sample run and ready + 10 h once the run says 600', async () => {
    const { store, travel } = await start();
    const draft = shortWindowDraft(store.get());
    expect(store.get().scenario.settings.flexWindowMin).toBe(1080);
    expect(flexWindowOf(store.get().scenario.settings)).toBe(1080);

    const at18 = await adviseOk(draft);
    expect(at18.options[0]).toMatchObject({ changes: {}, customerPriceCents: 700 });
    expect(laterDeliverBy(at18).map((o) => [o.changes, o.customerPriceCents]))
      .toStrictEqual([[{ deadlineMin: draft.readyMin + 1080 }, 600]]);
    expectEnginePrices(store.get(), travel, draft, at18);

    const run = await store.mutate((r) => withFlexWindow(r, 600));
    const before = remember(store);
    const engine = advisorEngine(run, travel, draft);
    expect(engine.flexWindowMin).toBe(600);
    expect(offlineVariants(engine).map((v) => v.changes)).toStrictEqual([
      {}, { readyMin: run.clock.timeMin }, { deadlineMin: draft.readyMin + 600 },
    ]);

    const at10 = await adviseOk(draft);
    expect(at10.source).toBe('offline');
    expect(at10.options[0]).toMatchObject({ changes: {}, customerPriceCents: 700 });
    expect(laterDeliverBy(at10).map((o) => [o.label, o.changes, o.customerPriceCents]))
      .toStrictEqual([[`Deliver by ${timeText(draft.readyMin + 600)}`, { deadlineMin: draft.readyMin + 600 }, 600]]);
    const priced = expectEnginePrices(run, travel, draft, at10);
    expect(priced.map((p) => p.flexible)).toContain(true);
    // The variant sits exactly on the engine's own limit: one minute less and the matcher gives no discount.
    const short = engine.match(draft.readyMin, draft.readyMin + 599);
    expect('plan' in short && short.plan.customerPriceCents).toBe(700);
    expectUntouched(store, before);
  }, T);

  it('a window the request already leaves is not offered again: at 600 the shp-7 request has the discount as typed', async () => {
    const { store, travel } = await start();
    const run = await store.mutate((r) => withFlexWindow(r, 600));
    const draft = draftOf(run, 'shp-7');   // 1090 -> 2100: under 18 h, over 10 h
    expect(draft.deadlineMin - draft.readyMin).toBeLessThan(1080);
    const body = await adviseOk(draft);
    expect(laterDeliverBy(body)).toStrictEqual([]);
    const priced = expectEnginePrices(run, travel, draft, body);
    expect(priced.length).toBeGreaterThan(0);
    expect(priced.every((p) => p.flexible)).toBe(true);
  }, T);

  it('with a key, Gemini\'s prompt says "at least 10 hours" for 600, and its later deliver-by gets the engine\'s discount', async () => {
    const turns: Turn[] = [];
    const { store, travel, sent } = await start({ turns });
    const run = await store.mutate((r) => withFlexWindow(r, 600));
    const before = remember(store);
    const draft = shortWindowDraft(run);
    turns.push(
      [call(TRY_VARIANT, {}), call(TRY_VARIANT, { deadlineMin: draft.readyMin + 600 }), call(TRY_VARIANT, { deadlineMin: draft.readyMin + 599 })],
      [call(PRESENT_OPTIONS, { options: [
        { resultId: 'r2', label: 'Flexible', summary: 'A later deliver-by, a lower price.' },
        { resultId: 'r3', label: 'One minute short', summary: 'Not flexible yet.' },
      ] })],
    );

    const body = await adviseOk(draft);

    expect(body.source).toBe('gemini');
    expect(body.options.map((o) => [o.label, o.changes, o.customerPriceCents])).toStrictEqual([
      ['Flexible', { deadlineMin: draft.readyMin + 600 }, 600],
      ['One minute short', { deadlineMin: draft.readyMin + 599 }, 700],
    ]);
    expect(expectEnginePrices(run, travel, draft, body).map((p) => p.flexible)).toStrictEqual([true, false]);
    expect(sent).toHaveLength(2);
    for (const text of sent) {
      const prompt: string = JSON.parse(text).systemInstruction.parts[0].text;
      expect(prompt).toBe(buildAdvisorPrompt(advisorEngine(run, travel, draft)));
      expect(prompt).toContain('A deliver-by at least 10 hours after the ready time gets a flexibility discount.');
      expect(prompt).not.toContain('18 hours');
    }
    expectUntouched(store, before);
  }, T);
});

describe('POST /api/v2/advise with a Gemini key', () => {
  it('Gemini picks and phrases; a price, a time and carriers it invents are ignored', async () => {
    const turns: Turn[] = [
      [call(TRY_VARIANT, {}), call(TRY_VARIANT, { readyMin: 0 })],   // 0 is clamped to the run clock
      [call(PRESENT_OPTIONS, {
        options: [
          { resultId: 'r1', label: 'As you asked', summary: 'Free, arrives tonight.', customerPriceCents: 1, deliveryMin: 1000, carrierNames: ['Nobody'] },
          { resultId: 'r2', label: 'Hand it over earlier', summary: 'Ready earlier, delivered the same evening.' },
          { resultId: 'r7', label: 'Teleport', summary: 'Invented' },
        ],
      })],
    ];
    const { store, travel, sent } = await start({ turns });
    const before = remember(store);
    const run = store.get();
    const draft = draftOf(run, 'shp-7');

    const body = await adviseOk(draft);

    expect(body.source).toBe('gemini');
    expect(body.options.map((o) => [o.label, o.summary, o.changes])).toStrictEqual([
      ['As you asked', 'Free, arrives tonight.', {}],
      ['Hand it over earlier', 'Ready earlier, delivered the same evening.', { readyMin: run.clock.timeMin }],
    ]);
    expectEngineNumbers(run, travel, draft, body);
    expect(body.options[0].customerPriceCents).not.toBe(1);
    expect(body.options[0].carrierNames).not.toContain('Nobody');
    expect(sent).toHaveLength(2);
    for (const text of sent) expect(text).not.toContain(KEY);   // the key travels only in the header
    expectUntouched(store, before);
    expect(await api!.savedRun()).toBeNull();
  }, T);

  it('a Gemini that does not answer within the budget: the offline options, quickly', async () => {
    const { store, travel } = await start({ turns: ['hang'], adviseTimeoutMs: 150 });
    const before = remember(store);
    const run = store.get();
    const draft = draftOf(run, 'shp-7');
    const started = Date.now();
    const body = await adviseOk(draft);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(body).toStrictEqual(adviseOffline(advisorEngine(run, travel, draft)));
    expectUntouched(store, before);
  }, T);

  it('a Gemini error: the offline options, never a 5xx', async () => {
    const { store, travel } = await start({ turns: [] });   // HTTP 500 on the first turn
    const run = store.get();
    const draft = draftOf(run, 'shp-7');
    expect(await adviseOk(draft)).toStrictEqual(adviseOffline(advisorEngine(run, travel, draft)));
  }, T);
});
