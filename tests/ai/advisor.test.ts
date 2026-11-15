// The AI advisor core (#862, reshaped by #959, server/ai/advisor.ts) on a FAKE engine and a FAKE Gemini behind
// the injected `fetch`: the engine's fastest and cheapest picks, the balanced fallback, Gemini's one structured
// call and the server's checks of its answer (a candidate id, no invented number), the time limit, and the rule
// that the options never wait on Gemini to exist. No network, no key, no run.
import { describe, expect, it } from 'vitest';
import {
  ADVICE_RESPONSE_SCHEMA, ADVISE_TIMEOUT_MS, MAX_GEMINI_CANDIDATES, MAX_LABEL_CHARS, MAX_SENTENCE_CHARS,
  adviceThinkingConfig, advise, adviseOffline, allowedNumbers, balancedPick, buildAdvicePrompt, candidateSet, cleanText,
  fastestAndCheapest, kindNote, numbersIn, optionLabel, shortlist, tagWords, timeText,
  type AdvisorEngine, type CandidateAnswer,
} from '../../server/ai/advisor';
import { GEMINI_MODELS_URL } from '../../server/ai/gemini';
import type { FetchInitLike, FetchLike } from '../../server/geo/googleClient';
import type { DeliveryPlan } from '../../shared/v2/types';

const KEY = 'AQ.FAKE_advisor-key-41c9';
const MODEL = 'gemini-2.5-flash';

const leg = (tripId: string, employeeId: string, extraMin: number) =>
  ({ tripId, employeeId, placeIds: [], stops: [], finishMin: 0, extraMin, extraDistanceM: 1609.344, rewardCents: 300 });

const plan = (kind: 'direct' | 'relay', deliveryMin: number, customerPriceCents: number, legs: ReturnType<typeof leg>[], relayBusinessId?: string) =>
  ({
    id: 'pln-x', shipmentId: 'shp-advice', kind, deliveryMin, customerPriceCents, platformContributionCents: 0, legs,
    ...(relayBusinessId ? { relayBusinessId } : {}),
  }) as DeliveryPlan;

/**
 * Four plans, in the engine's order (p1-p4):
 *   p1 direct, Theo Martin, arrives 1900 (Day 2, 7:40 AM), $7.00
 *   p2 relay via Etsy, Elena Rossi + Reese Green, arrives 1860 (Day 2, 7:00 AM), $10.50   <- fastest
 *   p3 relay via Kinship Coffee, Elena Rossi + Sam Lee, arrives 1880 (Day 2, 7:20 AM), $9.50
 *   p4 direct, Ada Park, arrives 1950 (Day 2, 8:30 AM), $6.50                               <- cheapest
 * Balanced: p1 (50/400 + 40/90 = 0.57) beats p3 (300/400 + 20/90 = 0.97).
 */
const FOUR: DeliveryPlan[] = [
  plan('direct', 1900, 700, [leg('t-1', 'emp-theo', 3)]),
  plan('relay', 1860, 1050, [leg('t-2', 'emp-elena', 4), leg('t-3', 'emp-reese', 3)], 'biz-etsy'),
  plan('relay', 1880, 950, [leg('t-2', 'emp-elena', 4), leg('t-4', 'emp-sam', 5)], 'biz-kinship'),
  plan('direct', 1950, 650, [leg('t-5', 'emp-ada', 5)]),
];

function fakeEngine(over: { plans?: DeliveryPlan[]; answer?: (r: number, d: number) => CandidateAnswer; text?: string } = {}) {
  const calls: [number, number][] = [];
  const log: string[] = [];
  const engine: AdvisorEngine = {
    draft: {
      originBusinessId: 'biz-titan', destinationBusinessId: 'biz-blue', readyMin: 960, deadlineMin: 2040,
      text: over.text ?? 'Fragile glass vase to Blue Bottle Coffee by 9 tomorrow', description: 'glass vase',
    },
    clockMin: 930, windowStartMin: 930, windowEndMin: 2160, flexWindowMin: 1080,
    candidates(readyMin, deadlineMin) {
      calls.push([readyMin, deadlineMin]);
      log.push('engine');
      return over.answer ? over.answer(readyMin, deadlineMin) : { plans: over.plans ?? FOUR, reasons: {} };
    },
    employeeName: (id) => ({ 'emp-theo': 'Theo Martin', 'emp-elena': 'Elena Rossi', 'emp-reese': 'Reese Green', 'emp-sam': 'Sam Lee', 'emp-ada': 'Ada Park' })[id] ?? 'A carrier',
    businessName: (id) => ({ 'biz-titan': 'Titan Foods', 'biz-blue': 'Blue Bottle Coffee', 'biz-etsy': 'Etsy', 'biz-kinship': 'Kinship Coffee' })[id] ?? null,
  };
  return { engine, calls, log };
}

// ---------- fake Gemini ----------
type Reply = unknown | { status: number } | 'hang' | { raw: string };

/** A fake `fetch` answering each call with a structured-output reply; it records every request. */
function fakeGemini(replies: Reply[], log: string[] = []) {
  const bodies: Record<string, any>[] = [];
  const inits: (FetchInitLike | undefined)[] = [];
  const urls: string[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    log.push('gemini');
    urls.push(url);
    inits.push(init);
    bodies.push(JSON.parse(String(init?.body)));
    if (!url.startsWith(GEMINI_MODELS_URL)) return Promise.reject(new Error('only the fake Gemini'));
    const reply = replies[bodies.length - 1] ?? { status: 500 };
    if (reply === 'hang') {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    if (typeof reply === 'object' && reply !== null && 'status' in reply) {
      return Promise.resolve({ status: (reply as { status: number }).status, text: async () => '{"error":{}}' });
    }
    const text = typeof reply === 'object' && reply !== null && 'raw' in reply ? (reply as { raw: string }).raw : JSON.stringify(reply);
    const body = { candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] };
    return Promise.resolve({ status: 200, text: async () => JSON.stringify(body) });
  };
  return { fetchImpl, bodies, inits, urls };
}

const settings = (fetchImpl: FetchLike, timeoutMs?: number, model = MODEL) => ({ apiKey: KEY, model, fetchImpl, timeoutMs });

const GOOD = {
  recommendedId: 'p3',
  reason: 'Kinship Coffee is on the way, so it arrives Day 2, 7:20 AM for $9.50.',
  sentences: [
    { id: 'p2', text: 'The quickest: there by 7:00 AM.' },
    { id: 'p4', text: 'The lowest price, $6.50, with Ada.' },
    { id: 'p3', text: 'A relay through Kinship Coffee, there by 7:20 AM.' },
  ],
};

const ids = (options: { id?: string; tags?: string[] }[]) => options.map((o) => [o.id, o.tags]);

describe('the engine: fastest, cheapest and balanced', () => {
  it('fastest = earliest arrival, cheapest = lowest price; each candidate keeps the engine\'s numbers and a stable id', () => {
    const { engine } = fakeEngine();
    const set = candidateSet(engine);
    expect(set.candidates.map((c) => c.id)).toStrictEqual(['p1', 'p2', 'p3', 'p4']);
    const ends = fastestAndCheapest(set.candidates)!;
    expect([ends.fastest.id, ends.cheapest.id]).toStrictEqual(['p2', 'p4']);
    expect(set.candidates[1].option).toStrictEqual({
      changes: {}, kind: 'relay', relayBusinessId: 'biz-etsy', carrierNames: ['Elena Rossi', 'Reese Green'],
      deliveryMin: 1860, extraMin: 7, extraMiles: 2, customerPriceCents: 1050,
    });
    expect(set.candidates.map((c) => c.handoffs)).toStrictEqual([0, 1, 1, 0]);
    // The same engine answer gives the same ids.
    expect(candidateSet(engine).candidates.map((c) => c.id)).toStrictEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('ties: the fastest of two equal arrivals is the cheaper, the cheapest of two equal prices the earlier; then engine order', () => {
    const tied = [
      plan('direct', 1900, 800, [leg('a', 'emp-theo', 1)]),
      plan('direct', 1900, 700, [leg('b', 'emp-ada', 1)]),
      plan('direct', 1950, 700, [leg('c', 'emp-sam', 1)]),
      plan('direct', 1900, 700, [leg('d', 'emp-reese', 1)]),
    ];
    const ends = fastestAndCheapest(candidateSet(fakeEngine({ plans: tied }).engine).candidates)!;
    expect([ends.fastest.id, ends.cheapest.id]).toStrictEqual(['p2', 'p2']);
  });

  it('one plan that is both fastest and cheapest is one option with both tags', () => {
    const answer = adviseOffline(fakeEngine({ plans: [FOUR[0], plan('direct', 1990, 900, [leg('x', 'emp-ada', 1)])] }).engine);
    expect(ids(answer.options)).toStrictEqual([['p1', ['fastest', 'cheapest']], ['p2', ['balanced']]]);
    expect(answer.options[0].label).toBe('Fastest and cheapest: Direct with Theo Martin, $7.00');
    expect(adviseOffline(fakeEngine({ plans: [FOUR[0]] }).engine).options).toHaveLength(1);
  });

  it('balanced: the remaining plan with the smallest normalised price + arrival', () => {
    const { engine } = fakeEngine();
    expect(balancedPick(candidateSet(engine).candidates)?.id).toBe('p1');
    // p3 at $7.50 arriving 1862: 100/400 + 2/90 = 0.27 now beats p1's 0.57.
    const cheaperRelay = [...FOUR.slice(0, 2), plan('relay', 1862, 750, FOUR[2].legs, 'biz-kinship'), FOUR[3]];
    expect(balancedPick(candidateSet(fakeEngine({ plans: cheaperRelay }).engine).candidates)?.id).toBe('p3');
    // A plan with the same kind, price and arrival as the fastest or the cheapest is no third option.
    const sameDeal = [FOUR[1], FOUR[3], plan('direct', 1950, 650, [leg('t-9', 'emp-sam', 2)])];
    expect(balancedPick(candidateSet(fakeEngine({ plans: sameDeal }).engine).candidates)).toBeNull();
  });

  it('offline: fastest, cheapest, balanced in that order, with the server\'s labels and summaries, source offline', () => {
    const answer = adviseOffline(fakeEngine().engine);
    expect(answer.source).toBe('offline');
    expect(answer.note).toBeUndefined();
    expect(answer.options.map((o) => [o.id, o.tags, o.label, o.summary, o.customerPriceCents, o.deliveryMin])).toStrictEqual([
      ['p2', ['fastest'], 'Fastest: Relay via Etsy, $10.50', 'Via Etsy with Elena Rossi and Reese Green, arrives Day 2, 7:00 AM, $10.50.', 1050, 1860],
      ['p4', ['cheapest'], 'Cheapest: Direct with Ada Park, $6.50', 'Direct with Ada Park, arrives Day 2, 8:30 AM, $6.50.', 650, 1950],
      ['p1', ['balanced'], 'Balanced: Direct with Theo Martin, $7.00', 'Direct with Theo Martin, arrives Day 2, 7:40 AM, $7.00.', 700, 1900],
    ]);
    expect(answer.options.every((o) => o.reason === undefined)).toBe(true);
  });

  it('labels keep their price within 60 characters', () => {
    const { engine } = fakeEngine();
    const long = { ...candidateSet(engine).candidates[1], option: { ...candidateSet(engine).candidates[1].option, relayBusinessId: 'biz-long' } };
    const named = { ...engine, businessName: () => 'The Extraordinarily Long Name Roasting Company of Brooklyn' };
    const label = optionLabel(['fastest', 'cheapest', 'recommended'], long, named);
    expect(label.length).toBeLessThanOrEqual(MAX_LABEL_CHARS);
    expect(label.endsWith(', $10.50')).toBe(true);
    expect(tagWords(['fastest', 'cheapest', 'recommended'])).toBe('Fastest, cheapest and recommended');
  });

  it('a kind with no plan gets its note (#954); no plan as typed tries the what-ifs, with changes and a note', () => {
    const relayOnly = fakeEngine({ answer: () => ({ plans: FOUR.slice(1, 3), reasons: { direct: 'A direct trip would add more than 12 minutes to a commute' } }) });
    expect(adviseOffline(relayOnly.engine).note).toBe('No direct: a direct trip would add more than 12 minutes to a commute.');
    expect(kindNote('relay', 'Every evening commute from Titan Foods is already carrying a package.'))
      .toBe('No relay: every evening commute from Titan Foods is already carrying a package.');

    const late = fakeEngine({
      answer: (_r, d) => (d >= 2040 + 1 ? { plans: [FOUR[0]], reasons: {} } : { plans: [], reasons: {}, reason: 'No commute can arrive before the deadline' }),
    });
    const answer = adviseOffline(late.engine);
    // Ready 2 h earlier (clamped to the clock, 930) finds nothing; ready + 18 h (2040) is the draft's own deliver-by,
    // so that what-if changes nothing and is not tried.
    expect(late.calls).toStrictEqual([[960, 2040], [930, 2040]]);
    expect(answer.options).toStrictEqual([]);
    expect(answer.note).toBe('Even with more time, no commute can arrive before the deadline.');
  });

  it('the first what-if with plans gives the options, each with its changes', () => {
    const { engine, calls } = fakeEngine({
      answer: (r) => (r < 960 ? { plans: FOUR.slice(0, 2), reasons: {} } : { plans: [], reasons: {}, reason: 'No commute leaves after the package is ready' }),
    });
    const answer = adviseOffline({ ...engine, draft: { ...engine.draft, deadlineMin: 2000 } });
    expect(calls).toStrictEqual([[960, 2000], [930, 2000]]);
    expect(answer.options.map((o) => [o.id, o.tags, o.changes])).toStrictEqual([
      ['p2', ['fastest'], { readyMin: 930 }], ['p1', ['cheapest'], { readyMin: 930 }],
    ]);
    expect(answer.note).toBe('As typed, no commute leaves after the package is ready.');
  });
});

describe('Gemini picks the recommended option', () => {
  it('one structured call: the key only in the header, no tools, the schema, thinking off; the sentence, draft and candidates as facts', async () => {
    const { engine } = fakeEngine();
    const gemini = fakeGemini([GOOD]);
    await advise(engine, settings(gemini.fetchImpl));
    expect(gemini.bodies).toHaveLength(1);
    expect(gemini.urls[0]).toBe(`${GEMINI_MODELS_URL}/${MODEL}:generateContent`);
    expect(gemini.urls[0]).not.toContain(KEY);
    expect((gemini.inits[0]?.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
    const body = gemini.bodies[0];
    expect(String(gemini.inits[0]?.body)).not.toContain(KEY);
    expect(body.tools).toBeUndefined();
    expect(body.toolConfig).toBeUndefined();
    expect(body.generationConfig).toStrictEqual({
      responseMimeType: 'application/json', responseSchema: ADVICE_RESPONSE_SCHEMA, thinkingConfig: { thinkingBudget: 0 },
    });
    expect(body.systemInstruction.parts[0].text).toBe(buildAdvicePrompt());
    const user: string = body.contents[0].parts[0].text;
    expect(user).toContain('"Fragile glass vase to Blue Bottle Coffee by 9 tomorrow"');
    expect(user).toContain('"contents":"glass vase"');
    expect(user).toContain('Fastest plan: p2. Cheapest plan: p4.');
    expect(user).toContain(JSON.stringify({
      id: 'p3', kind: 'relay', relayPoint: 'Kinship Coffee', carriers: ['Elena', 'Sam'], arrives: 'Day 2, 7:20 AM',
      price: '$9.50', extraMinutes: 9, handoffs: 1,
    }));
    expect(user).not.toContain('emp-');
  });

  it('a valid pick is the third option, tagged recommended with its reason; Gemini\'s sentences are the summaries', async () => {
    const { engine } = fakeEngine();
    const outcome = await advise(engine, settings(fakeGemini([GOOD]).fetchImpl));
    expect(outcome.by).toBe('gemini');
    expect(outcome.response.source).toBe('gemini');
    expect(outcome.response.options.map((o) => [o.id, o.tags, o.label, o.summary, o.reason])).toStrictEqual([
      ['p2', ['fastest'], 'Fastest: Relay via Etsy, $10.50', 'The quickest: there by 7:00 AM.', undefined],
      ['p4', ['cheapest'], 'Cheapest: Direct with Ada Park, $6.50', 'The lowest price, $6.50, with Ada.', undefined],
      ['p3', ['recommended'], 'Recommended: Relay via Kinship Coffee, $9.50', 'A relay through Kinship Coffee, there by 7:20 AM.', GOOD.reason],
    ]);
    // The numbers are the engine's.
    expect(outcome.response.options[2]).toMatchObject({ customerPriceCents: 950, deliveryMin: 1880, carrierNames: ['Elena Rossi', 'Sam Lee'] });
  });

  it.each([
    ['an id that is no candidate', { ...GOOD, recommendedId: 'p9' }, 'invalid answer: unknown id'],
    ['the fastest, while other plans exist', { ...GOOD, recommendedId: 'p2' }, 'invalid answer: same as fastest or cheapest'],
    ['the cheapest, while other plans exist', { ...GOOD, recommendedId: 'p4' }, 'invalid answer: same as fastest or cheapest'],
    ['a reason with an invented price', { ...GOOD, reason: 'It saves you $1.75 over the fastest.' }, 'invalid answer: invented number in reason'],
    ['a reason with an invented time', { ...GOOD, reason: 'It arrives by 6:15 AM.' }, 'invalid answer: invented number in reason'],
    ['an empty reason', { ...GOOD, reason: '  ' }, 'invalid answer: no reason'],
    ['no recommendedId', { reason: GOOD.reason, sentences: [] }, 'invalid answer: invalid shape'],
    ['not an object', ['p3'], 'invalid answer: invalid shape'],
  ])('%s: the balanced plan with the server\'s words', async (_name, reply, by) => {
    const { engine } = fakeEngine();
    const outcome = await advise(engine, settings(fakeGemini([reply]).fetchImpl));
    expect(outcome.by).toBe(by);
    expect(outcome.response).toStrictEqual(adviseOffline(engine));
    expect(ids(outcome.response.options)).toStrictEqual([['p2', ['fastest']], ['p4', ['cheapest']], ['p1', ['balanced']]]);
  });

  it('a sentence with an invented number, or for a plan not shown, is dropped alone: the server\'s summary takes its place', async () => {
    const { engine } = fakeEngine();
    const reply = {
      ...GOOD,
      sentences: [
        { id: 'p2', text: 'There 20 minutes before the others.' },    // 20 is in no fact
        { id: 'p4', text: 'x'.repeat(200) },                            // cut to 120 characters
        { id: 'p1', text: 'Not shown, so not used.' },
        { id: 'p3', text: 'Arrives Day 2 at 7:20 AM with 1 handoff.' },
      ],
    };
    const outcome = await advise(engine, settings(fakeGemini([reply]).fetchImpl));
    expect(outcome.by).toBe('gemini');
    const [fastest, cheapest, recommended] = outcome.response.options;
    expect(fastest.summary).toBe('Via Etsy with Elena Rossi and Reese Green, arrives Day 2, 7:00 AM, $10.50.');
    expect(cheapest.summary).toHaveLength(MAX_SENTENCE_CHARS);
    expect(recommended.summary).toBe('Arrives Day 2 at 7:20 AM with 1 handoff.');
    expect(outcome.response.options).toHaveLength(3);
  });

  it('with only two plans, Gemini may recommend one of them: it gains the tag and the reason', async () => {
    const { engine } = fakeEngine({ plans: [FOUR[1], FOUR[3]] });
    const reply = { recommendedId: 'p1', reason: 'Fragile, but the quickest at Day 2, 7:00 AM.', sentences: [] };
    const outcome = await advise(engine, settings(fakeGemini([reply]).fetchImpl));
    expect(outcome.by).toBe('gemini');
    expect(outcome.response.options.map((o) => [o.id, o.tags, o.reason])).toStrictEqual([
      ['p1', ['fastest', 'recommended'], reply.reason], ['p2', ['cheapest'], undefined],
    ]);
    expect(outcome.response.options[0].label).toBe('Fastest and recommended: Relay via Etsy, $10.50');
  });

  it('numbers: times on the hour may be written without minutes, prices with or without cents; nothing else', () => {
    expect(numbersIn('$9.50 at 7:05 AM on Day 2, 1,200 m')).toStrictEqual(['9.5', '7:5', '2', '1200']);
    const allowed = allowedNumbers([{ price: '$10.00', arrives: 'Day 2, 9:00 AM' }]);
    for (const ok of ['10', '10.00', '9', '9:00', '2']) expect(numbersIn(ok).every((n) => allowed.has(n)), ok).toBe(true);
    for (const bad of ['11', '9:30', '3']) expect(numbersIn(bad).every((n) => allowed.has(n)), bad).toBe(false);
  });

  it('a long candidate list is cut for the prompt, keeping the fastest, the cheapest and the balanced plan', () => {
    const many = Array.from({ length: 30 }, (_, i) => plan('relay', 1800 + i, 2000 - i * 10, [leg(`e${i}`, 'emp-elena', 3), leg(`m${i}`, 'emp-sam', i)], 'biz-etsy'));
    const set = candidateSet(fakeEngine({ plans: many }).engine);
    const listed = shortlist(set.candidates);
    expect(listed).toHaveLength(MAX_GEMINI_CANDIDATES);
    const ends = fastestAndCheapest(set.candidates)!;
    expect(listed.slice(0, 3).map((c) => c.id)).toStrictEqual([ends.fastest.id, ends.cheapest.id, balancedPick(set.candidates)!.id]);
  });

  it('thinking: minimal for gemini-3.x Flash, off for 2.5 Flash, the model\'s default otherwise', async () => {
    expect(adviceThinkingConfig('gemini-3-flash-preview')).toStrictEqual({ thinkingLevel: 'minimal' });
    expect(adviceThinkingConfig('models/gemini-3.1-flash')).toStrictEqual({ thinkingLevel: 'minimal' });
    expect(adviceThinkingConfig('gemini-2.5-flash-lite')).toStrictEqual({ thinkingBudget: 0 });
    expect(adviceThinkingConfig('gemini-2.5-pro')).toBeNull();
    expect(adviceThinkingConfig('gemini-3-pro-preview')).toBeNull();
    const gemini = fakeGemini([GOOD, GOOD]);
    await advise(fakeEngine().engine, settings(gemini.fetchImpl, undefined, 'gemini-3-flash-preview'));
    await advise(fakeEngine().engine, settings(gemini.fetchImpl, undefined, 'gemini-2.5-pro'));
    expect(gemini.bodies[0].generationConfig.thinkingConfig).toStrictEqual({ thinkingLevel: 'minimal' });
    expect(gemini.bodies[1].generationConfig.thinkingConfig).toBeUndefined();
  });
});

describe('fallbacks: the options never wait on Gemini', () => {
  it('the limit is 6 s', () => {
    expect(ADVISE_TIMEOUT_MS).toBe(6000);
  });

  it('a Gemini that does not answer in time: the balanced plan, the request aborted, by "timeout"', async () => {
    const { engine } = fakeEngine();
    const gemini = fakeGemini(['hang']);
    const started = Date.now();
    const outcome = await advise(engine, settings(gemini.fetchImpl, 80));
    expect(Date.now() - started).toBeLessThan(3000);
    expect(outcome.by).toBe('timeout');
    expect(outcome.response).toStrictEqual(adviseOffline(engine));
    expect(outcome.response.options.at(-1)?.tags).toStrictEqual(['balanced']);
    expect(gemini.inits[0]?.signal?.aborted).toBe(true);
  });

  it('the engine builds every candidate before Gemini is asked, and asks it nothing more after', async () => {
    const { engine, log } = fakeEngine();
    const gemini = fakeGemini([GOOD], log);
    await advise(engine, settings(gemini.fetchImpl));
    expect(log).toStrictEqual(['engine', 'gemini']);
  });

  it('a fetch that throws at once, an HTTP error or text that is no JSON: the balanced plan, by the reason', async () => {
    const { engine } = fakeEngine();
    const throwing: FetchLike = () => { throw new Error(`boom ${KEY}`); };
    const cases: [FetchLike, string][] = [
      [throwing, 'network error'],
      [fakeGemini([{ status: 429 }]).fetchImpl, 'HTTP 429'],
      [fakeGemini([{ raw: 'not json' }]).fetchImpl, 'bad JSON'],
    ];
    for (const [fetchImpl, by] of cases) {
      const outcome = await advise(engine, settings(fetchImpl));
      expect(outcome.by).toBe(by);
      expect(outcome.response).toStrictEqual(adviseOffline(engine));
      expect(JSON.stringify(outcome)).not.toContain(KEY);
    }
  });

  it('no key: nothing is sent, by "no key"; no plan: Gemini is not asked, by "no plan"', async () => {
    const { engine } = fakeEngine();
    const gemini = fakeGemini([GOOD]);
    for (const apiKey of [null, undefined, '', '   ']) {
      expect(await advise(engine, { apiKey, model: MODEL, fetchImpl: gemini.fetchImpl }))
        .toStrictEqual({ response: adviseOffline(engine), by: 'no key' });
    }
    expect(await advise(engine)).toStrictEqual({ response: adviseOffline(engine), by: 'no key' });
    const none = fakeEngine({ answer: () => ({ plans: [], reasons: {}, reason: 'Every matching commute is already carrying a package' }) });
    const outcome = await advise(none.engine, settings(gemini.fetchImpl));
    expect(outcome.by).toBe('no plan');
    expect(outcome.response.options).toStrictEqual([]);
    expect(outcome.response.note).toBe('Even with more time, every matching commute is already carrying a package.');
    expect(gemini.bodies).toHaveLength(0);
  });

  it('an engine error is not swallowed (the route turns a travel error into its 503)', async () => {
    const boom = new Error('travel data missing');
    const { engine } = fakeEngine({ answer: () => { throw boom; } });
    await expect(advise(engine, settings(fakeGemini([GOOD]).fetchImpl))).rejects.toBe(boom);
  });
});

describe('text helpers', () => {
  it('timeText', () => {
    expect(timeText(930)).toBe('Day 1, 3:30 PM');
    expect(timeText(1950)).toBe('Day 2, 8:30 AM');
    expect(timeText(2160)).toBe('Day 2, 12:00 PM');
    expect(timeText(1440)).toBe('Day 2, 12:00 AM');
  });
  it('cleanText', () => {
    expect(cleanText('  a\n\tb  ', 10)).toBe('a b');
    expect(cleanText('abcdefghijk', 5)).toBe('abcd…');
    expect(cleanText(7, 5)).toBe('');
  });
});
