// POST /api/v2/advise (#862, #959) on the real server: createV2Runtime, the sample travel cache, the committed NYC
// businesses and story, and a FAKE Gemini behind the injected `fetch`. Checks: the contract's shape, the engine's
// fastest and cheapest candidates, every number copied from the engine, Gemini's recommendation used only when it
// passes the checks, the balanced plan otherwise (a slow or failing Gemini), trips already reserved stay reserved,
// a bad draft is a 400, the run is never changed, and one log line per request without the key or the sentence.
// #867: the flexibility window is the run's `settings.flexWindowMin`. No network, no real key.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { adviseOffline, balancedPick, candidateSet, fastestAndCheapest, money, shortlist, timeText, whatIfVariants } from '../../server/ai/advisor';
import { GEMINI_MODELS_URL } from '../../server/ai/gemini';
import { adviseLogLine, advisorEngine, flexWindowOf, INVALID_ADVISE } from '../../server/api/v2/adviseRoutes';
import {
  DEADLINE_BEFORE_READY, DEADLINE_OUTSIDE_WINDOW, READY_OUTSIDE_WINDOW, SAME_BUSINESS, UNKNOWN_BUSINESS,
} from '../../server/api/v2/shipmentOps';
import type { FetchLike } from '../../server/geo/googleClient';
import type { Store } from '../../server/store';
import type { AdviseResponse } from '../../shared/v2/api';
import type { Run as RunV2, Shipment, TravelProvider } from '../../shared/v2/types';
import { candidatePlanOf, expectEnginePrices, withFlexWindow } from './v2-advise-pricing-helper';
import { T, startBootstrapApi, useStoryOnlyRun, type BootstrapApi } from './v2-bootstrap-helper';

const KEY = 'AQ.FAKE_advise-route-77e2';
const MODEL = 'gemini-2.5-flash';

// A strict copy of the contract (shared/v2 has types, not response schemas): an extra key fails.
const OptionSchema = z.strictObject({
  id: z.string().regex(/^p\d+$/),
  tags: z.array(z.enum(['fastest', 'cheapest', 'recommended', 'balanced'])).min(1),
  label: z.string().min(1).max(60),
  summary: z.string().min(1).max(140),
  reason: z.string().min(1).max(120).optional(),
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

/** One Gemini reply: the structured answer (sent back as the candidate's text), or a call that never answers. */
type Turn = Record<string, unknown> | 'hang';

/** A fake Gemini answering each call from `turns` in order (an HTTP 500 after the last). */
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
    const body = { candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(turn) }] }, finishReason: 'STOP' }] };
    return Promise.resolve({ status: 200, text: async () => JSON.stringify(body) });
  };
  return { fetchImpl, sent };
}

async function start(gemini?: { turns: Turn[]; adviseTimeoutMs?: number }) {
  const fake = fakeGemini(gemini?.turns ?? []);
  /** The route's lines: [to log, to info]. */
  const lines: ['log' | 'info', string][] = [];
  api = await startBootstrapApi({
    cache: 'sample',
    fetch: fake.fetchImpl,
    ...(gemini ? { gemini: {
      apiKey: KEY, model: MODEL, adviseTimeoutMs: gemini.adviseTimeoutMs,
      log: (line: string) => void lines.push(['log', line]), info: (line: string) => void lines.push(['info', line]),
    } } : {}),
  });
  if (!api.store || !api.runtime.deps.travel) throw new Error('/api/v2 did not load on the sample cache');
  return { store: api.store as Store<RunV2>, travel: api.runtime.deps.travel as TravelProvider, sent: fake.sent, lines };
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

async function advise(draft: unknown, text?: string) {
  const answer = await (api as BootstrapApi).v2.post('/advise', text === undefined ? { draft } : { draft, text });
  expect(JSON.stringify(answer.body)).not.toContain(KEY);
  return answer;
}

async function adviseOk(draft: unknown, text?: string): Promise<AdviseResponse> {
  const answer = await advise(draft, text);
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  expect(answer.headers.get('content-type')).toMatch(/^application\/json\b/);
  return ResponseSchema.parse(answer.body) as AdviseResponse;
}

const remember = (store: Store<RunV2>) => ({ run: store.get(), copy: structuredClone(store.get()) });
function expectUntouched(store: Store<RunV2>, before: ReturnType<typeof remember>) {
  expect(store.get()).toBe(before.run);       // no mutation was committed
  expect(store.get()).toEqual(before.copy);   // and nothing was changed in place
}

/** Every option's numbers are those of the engine's candidate it names by id, for the option's two times. */
function expectEngineNumbers(run: RunV2, travel: TravelProvider, draft: ReturnType<typeof draftOf>, body: AdviseResponse) {
  const names = new Map(run.scenario.employees.map((e) => [e.id, e.name]));
  for (const option of body.options) {
    const plan = candidatePlanOf(run, travel, draft, option);
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
  it('the fastest, the cheapest and the balanced candidate, in the contract\'s shape, every number from the engine; nothing changes', async () => {
    const { store, travel, sent } = await start();
    const before = remember(store);
    const run = store.get();
    // shp-1 of the sample run: 14 free candidates as typed, in the matcher's order: p1 and p2 direct at $7.00
    // (arriving 1988 and 1898), p3-p14 relay at $10.50 (p10 arrives first of all, at 1896).
    const draft = draftOf(run, 'shp-1');

    const body = await adviseOk(draft);

    expect(body.source).toBe('offline');
    expect(body.note).toBeUndefined();
    // Fastest: p10 (1896). Cheapest: p2, the earlier of the two $7.00 plans. Balanced: p1, 0 + 92/97 = 0.95,
    // under every remaining relay (1 + something).
    expect(body.options.map((o) => [o.id, o.tags, o.kind])).toStrictEqual([
      ['p10', ['fastest'], 'relay'], ['p2', ['cheapest'], 'direct'], ['p1', ['balanced'], 'direct'],
    ]);
    expect(body.options.map((o) => [o.deliveryMin, o.customerPriceCents])).toStrictEqual([[1896, 1050], [1898, 700], [1988, 700]]);
    // The fastest arrives first of every candidate, the cheapest costs least of every candidate.
    const { candidates } = candidateSet(advisorEngine(run, travel, draft));
    expect(candidates).toHaveLength(14);
    expect(body.options[0].deliveryMin).toBe(Math.min(...candidates.map((c) => c.option.deliveryMin)));
    expect(body.options[1].customerPriceCents).toBe(Math.min(...candidates.map((c) => c.option.customerPriceCents)));
    expect(body.options.every((o) => Object.keys(o.changes).length === 0 && o.reason === undefined)).toBe(true);
    expectEngineNumbers(run, travel, draft, body);
    expectEnginePrices(run, travel, draft, body);
    expect(body).toStrictEqual(adviseOffline(advisorEngine(run, travel, draft)));
    expect(sent).toStrictEqual([]);
    expectUntouched(store, before);
    expect(await api!.savedRun()).toBeNull();   // the state file was never written
  }, T);

  it('one plan that is both fastest and cheapest is one option; a kind with no plan has its note (#954)', async () => {
    const { store, travel } = await start();
    const run = store.get();
    const draft = draftOf(run, 'shp-7');
    const body = await adviseOk(draft);
    expect(body.options.map((o) => [o.id, o.tags, o.kind, o.label])).toStrictEqual([
      ['p1', ['fastest', 'cheapest'], 'direct', `Fastest and cheapest: Direct with ${body.options[0].carrierNames[0]}, $7.00`],
    ]);
    expect(body.note).toBe('No relay: no evening commute from McGraw Hill leaves after the package is ready.');
    expectEngineNumbers(run, travel, draft, body);
  }, T);

  it('trips already reserved stay reserved: no candidate uses a trip of a plan of the run', async () => {
    const { store, travel } = await start();
    const run = store.get();
    const reserved = new Set(run.assignments.plans.flatMap((p) => p.legs.map((l) => l.tripId)));
    expect(reserved.size).toBeGreaterThan(0);
    for (const shipment of run.scenario.shipments) {
      const draft = draftOf(run, shipment.id);
      for (const plan of advisorEngine(run, travel, draft).candidates(draft.readyMin, draft.deadlineMin).plans) {
        for (const leg of plan.legs) expect(reserved.has(leg.tripId)).toBe(false);
      }
    }
    // On the story's 60 employees alone, shp-5's own plan holds the only commutes that fit it as typed: the
    // first what-if with a plan is offered. (On the default run an added employee has a free one, #966.)
    const storyOnly = await useStoryOnlyRun(api as BootstrapApi);
    const draft = draftOf(storyOnly, 'shp-5');
    const body = await adviseOk(draft);
    expect(body.note).toBe('As typed, every matching commute is already carrying a package.');
    expect(body.options.map((o) => o.changes)).toStrictEqual([{ readyMin: draft.readyMin - 120 }]);
    expectEngineNumbers(storyOnly, travel, draft, body);
  }, T);

  it('a draft no what-if can match either: 200 with no options and a note', async () => {
    await start();
    const body = await adviseOk(draftOf(await useStoryOnlyRun(api as BootstrapApi), 'shp-8'));
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
    ['a sender that is a number', (d) => ({ ...d, originBusinessId: 7 }), { originBusinessId: 'Choose a sender' }],
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

  it('package fields of the wrong type and a sentence that is no text are dropped, not a 400', async () => {
    const { store } = await start();
    const draft = draftOf(store.get(), 'shp-7');
    const plain = await adviseOk(draft);
    expect(await adviseOk({ ...draft, label: 7, category: ['x'], description: {}, weightKg: 'heavy' })).toStrictEqual(plain);
    const answer = await (api as BootstrapApi).v2.post('/advise', { draft, text: 42 });
    expect(answer.status).toBe(200);
    expect(answer.body).toStrictEqual(plain);
  }, T);

  it.each<[string, (d: ReturnType<typeof draftOf>) => unknown, string]>([
    ['no sender', (d) => ({ ...d, originBusinessId: null }), 'Choose a sender to see options.'],
    ['no recipient', (d) => ({ ...d, destinationBusinessId: undefined }), 'Choose a recipient to see options.'],
    ['no ready time', (d) => ({ ...d, readyMin: null }), 'Choose a ready time to see options.'],
    ['no sender and no recipient', (d) => ({ ...d, originBusinessId: null, destinationBusinessId: null }), 'Choose a sender and a recipient to see options.'],
  ])('%s is a 200 with no options and a note naming it (#947)', async (_name, build, note) => {
    const { store } = await start();
    const before = remember(store);
    const body = await adviseOk(build(draftOf(store.get(), 'shp-7')));
    expect(body).toStrictEqual({ options: [], source: 'offline', note });
    expectUntouched(store, before);
  }, T);

  it('no deliver-by is the window end, and one after the window end is moved to it with a note (#947)', async () => {
    const { store, travel } = await start();
    const run = store.get();
    const { simEndMin } = run.scenario.settings;
    const draft = draftOf(run, 'shp-7');
    const atEnd = await adviseOk({ ...draft, deadlineMin: simEndMin });
    expect(atEnd.options.length).toBeGreaterThan(0);

    const none = await adviseOk({ ...draft, deadlineMin: null });
    expect(none.options).toStrictEqual(atEnd.options);
    expect(none.note).toBe(['No deliver-by time given, so Relay delivers by 12:00 PM tomorrow.', atEnd.note].filter(Boolean).join(' '));

    const late = await adviseOk({ ...draft, deadlineMin: simEndMin + 300 });
    expect(late.options).toStrictEqual(atEnd.options);
    expect(late.note?.startsWith('Relay delivers by 12:00 PM tomorrow, ahead of your 5:00 PM deadline.')).toBe(true);
    expectEngineNumbers(run, travel, { ...draft, deadlineMin: simEndMin }, late);
  }, T);
});

// #867: the flexibility window is the run's `settings.flexWindowMin` (#861), the number the engine prices with.
// The sample run's settings say 1080 (18 h); the tests change it in the store, like an imported run.
describe('POST /api/v2/advise reads the run\'s flexWindowMin (#867)', () => {
  /** shp-2 of the sample run, with its deliver-by `hours` after ready. */
  function windowDraft(run: RunV2, hours: number) {
    const draft = draftOf(run, 'shp-2');
    return { ...draft, deadlineMin: draft.readyMin + hours * 60 };
  }

  it('a 10 h window has no discount on the sample run (18 h) and has it once the run says 600', async () => {
    const { store, travel } = await start();
    const draft = windowDraft(store.get(), 10);
    expect(flexWindowOf(store.get().scenario.settings)).toBe(1080);
    const at18 = await adviseOk(draft);
    expect(at18.options.length).toBeGreaterThan(0);
    expect(expectEnginePrices(store.get(), travel, draft, at18).every((p) => !p.flexible && p.option.customerPriceCents >= 700)).toBe(true);

    const run = await store.mutate((r) => withFlexWindow(r, 600));
    const before = remember(store);
    const at10 = await adviseOk(draft);
    const priced = expectEnginePrices(run, travel, draft, at10);
    expect(priced.length).toBeGreaterThan(0);
    expect(priced.every((p) => p.flexible)).toBe(true);
    expect(at10.options.map((o) => o.customerPriceCents)).toStrictEqual(at18.options.map((o) => o.customerPriceCents - 100));
    expectUntouched(store, before);
  }, T);

  it('the deliver-by what-if for a request with no plan as typed is ready + the run\'s window', async () => {
    const { store, travel } = await start();
    const run = await store.mutate((r) => withFlexWindow(r, 600));
    const draft = windowDraft(run, 8);
    expect(whatIfVariants(advisorEngine(run, travel, draft)).map((v) => v.changes)).toStrictEqual([
      { readyMin: run.clock.timeMin }, { deadlineMin: draft.readyMin + 600 },
    ]);
  }, T);
});

describe('POST /api/v2/advise with a Gemini key', () => {
  const SENTENCE = 'Fragile glass samples, one courier please, for the opening tomorrow morning';

  /** shp-1's candidates as the advisor sees them, and a plan Gemini may recommend: shown to it, neither end. */
  function shp1(run: RunV2, travel: TravelProvider) {
    const draft = draftOf(run, 'shp-1');
    const set = candidateSet(advisorEngine(run, travel, draft));
    const ends = fastestAndCheapest(set.candidates)!;
    const balanced = balancedPick(set.candidates)!;
    const pick = shortlist(set.candidates).find((c) => ![ends.fastest.id, ends.cheapest.id, balanced.id].includes(c.id))!;
    return { draft, set, ends, balanced, pick };
  }

  it('Gemini\'s valid pick is the third option, recommended with its reason; it got the sentence and the facts once', async () => {
    const turns: Turn[] = [];
    const { store, travel, sent, lines } = await start({ turns });
    const before = remember(store);
    const run = store.get();
    const { draft, ends, pick } = shp1(run, travel);
    const reason = `A calm choice for glass: it arrives ${timeText(pick.option.deliveryMin)}.`;
    turns.push({
      recommendedId: pick.id, reason,
      sentences: [
        { id: ends.fastest.id, text: `The quickest, there ${timeText(ends.fastest.option.deliveryMin)}.` },
        { id: pick.id, text: `${money(pick.option.customerPriceCents)}, with ${pick.handoffs} handoffs.` },
      ],
    });

    const body = await adviseOk(draft, SENTENCE);

    expect(body.source).toBe('gemini');
    expect(body.options.map((o) => [o.id, o.tags, o.reason])).toStrictEqual([
      [ends.fastest.id, ['fastest'], undefined], [ends.cheapest.id, ['cheapest'], undefined], [pick.id, ['recommended'], reason],
    ]);
    expect(body.options[0].summary).toBe(`The quickest, there ${timeText(ends.fastest.option.deliveryMin)}.`);
    expect(body.options[2].summary).toBe(`${money(pick.option.customerPriceCents)}, with ${pick.handoffs} handoffs.`);
    expectEngineNumbers(run, travel, draft, body);
    // One call, with the business's sentence and the candidates as facts; the key only in the header.
    expect(sent).toHaveLength(1);
    const request: string = JSON.parse(sent[0]).contents[0].parts[0].text;
    expect(request).toContain(JSON.stringify(SENTENCE));
    expect(request).toContain(`Fastest plan: ${ends.fastest.id}. Cheapest plan: ${ends.cheapest.id}.`);
    expect(request).toContain(`"id":"${pick.id}","kind":"${pick.option.kind}"`);
    expect(sent[0]).not.toContain(KEY);
    expect(lines).toStrictEqual([['info', adviseLogLine('gemini')]]);
    expect(lines[0][1]).toBe('[advise] gemini');
    expectUntouched(store, before);
    expect(await api!.savedRun()).toBeNull();
  }, T);

  it.each<[string, (p: ReturnType<typeof shp1>) => Turn, string]>([
    ['an id that is no candidate', () => ({ recommendedId: 'p999', reason: 'The best one.', sentences: [] }), 'invalid answer: unknown id'],
    ['the fastest again', (p) => ({ recommendedId: p.ends.fastest.id, reason: 'Quickest.', sentences: [] }), 'invalid answer: same as fastest or cheapest'],
    ['a reason with an invented price', (p) => ({ recommendedId: p.pick.id, reason: 'It saves you $0.37.', sentences: [] }), 'invalid answer: invented number in reason'],
  ])('%s: the balanced plan with the server\'s words, and the reason in the log line', async (_name, reply, by) => {
    const turns: Turn[] = [];
    const { store, travel, lines } = await start({ turns });
    const run = store.get();
    const p = shp1(run, travel);
    turns.push(reply(p));
    const body = await adviseOk(p.draft, SENTENCE);
    expect(body).toStrictEqual(adviseOffline(advisorEngine(run, travel, p.draft)));
    expect(body.options.at(-1)).toMatchObject({ id: p.balanced.id, tags: ['balanced'] });
    expect(lines).toStrictEqual([['log', `[advise] fallback: ${by}`]]);
  }, T);

  it('a Gemini that does not answer within its limit: the balanced plan, quickly, and "[advise] fallback: timeout"', async () => {
    const { store, travel, lines } = await start({ turns: ['hang'], adviseTimeoutMs: 150 });
    const before = remember(store);
    const run = store.get();
    const draft = draftOf(run, 'shp-1');
    const started = Date.now();
    const body = await adviseOk(draft, SENTENCE);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(body).toStrictEqual(adviseOffline(advisorEngine(run, travel, draft)));
    expect(body.options.map((o) => o.tags)).toStrictEqual([['fastest'], ['cheapest'], ['balanced']]);
    expect(lines).toStrictEqual([['log', '[advise] fallback: timeout']]);
    expectUntouched(store, before);
  }, T);

  it('a Gemini error: the balanced plan, never a 5xx; the next request asks Gemini again (no pause)', async () => {
    const { store, travel, sent, lines } = await start({ turns: [] });   // HTTP 500 every time
    const run = store.get();
    const draft = draftOf(run, 'shp-1');
    expect(await adviseOk(draft)).toStrictEqual(adviseOffline(advisorEngine(run, travel, draft)));
    expect(await adviseOk(draft)).toStrictEqual(adviseOffline(advisorEngine(run, travel, draft)));
    expect(sent).toHaveLength(2);
    expect(lines).toStrictEqual([['log', '[advise] fallback: HTTP 500'], ['log', '[advise] fallback: HTTP 500']]);
  }, T);

  it('no plan, a draft still missing a field, and a refused draft ask Gemini nothing; each has its one line', async () => {
    const { sent, lines } = await start({ turns: [] });
    const run = await useStoryOnlyRun(api as BootstrapApi); // shp-8 has no plan on the story's 60 employees
    await adviseOk(draftOf(run, 'shp-8'), SENTENCE);
    await adviseOk({ ...draftOf(run, 'shp-1'), destinationBusinessId: null });
    expect((await advise({ ...draftOf(run, 'shp-1'), readyMin: 100 })).status).toBe(400);
    expect(sent).toStrictEqual([]);
    expect(lines).toStrictEqual([
      ['info', '[advise] fallback: no plan'], ['info', '[advise] fallback: draft incomplete'], ['info', '[advise] fallback: invalid draft'],
    ]);
    for (const [, line] of lines) expect(line).not.toMatch(/Fragile|AQ\./);
  }, T);
});
