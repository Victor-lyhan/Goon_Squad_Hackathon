// The AI advisor core (#862, server/ai/advisor.ts) on a FAKE engine and a FAKE Gemini behind the injected
// `fetch`: the variant rules (validation and clamping), the offline variants, the Gemini tool loop with its
// limits, and the rule that every number of an option comes from the engine, never from Gemini.
// No network, no key, no run.
import { describe, expect, it } from 'vitest';
import {
  ADVISOR_FUNCTIONS, MAX_LABEL_CHARS, MAX_SUMMARY_CHARS, MAX_TOOL_CALLS, PRESENT_OPTIONS, TRY_VARIANT,
  advise, adviseOffline, buildAdvisorPrompt, cleanText, offlineVariants, resolveVariant, timeText,
  type AdvisorEngine,
} from '../../server/ai/advisor';
import { GEMINI_MODELS_URL } from '../../server/ai/gemini';
import type { FetchInitLike, FetchLike } from '../../server/geo/googleClient';
import type { AdviseOption } from '../../shared/v2/api';
import type { DeliveryPlan } from '../../shared/v2/types';

const KEY = 'AQ.FAKE_advisor-key-41c9';
const MODEL = 'gemini-2.5-flash';

/**
 * A fake engine. Price: 700, or 600 when the deliver-by is at least 18 h after ready (the flexibility
 * discount of #861). Arrival: 2000, 1 minute earlier for each 3 minutes the package is ready earlier.
 * A deliver-by before 1990 finds no carrier.
 */
function fakeEngine(over: Partial<AdvisorEngine> = {}) {
  const calls: [number, number][] = [];
  const engine: AdvisorEngine = {
    draft: { originBusinessId: 'biz-a', destinationBusinessId: 'biz-b', readyMin: 960, deadlineMin: 2040 },
    clockMin: 930,
    windowStartMin: 930,
    windowEndMin: 2160,
    flexWindowMin: 1080,
    match(readyMin, deadlineMin) {
      calls.push([readyMin, deadlineMin]);
      if (deadlineMin < 1990) return { reason: 'No commute can arrive before the deadline' };
      const deliveryMin = 2000 - Math.round((960 - readyMin) / 3);
      const plan: DeliveryPlan = {
        id: 'pln-x', shipmentId: 'shp-advice', kind: 'relay', relayBusinessId: 'biz-r', deliveryMin,
        customerPriceCents: deadlineMin - readyMin >= 1080 ? 600 : 700, platformContributionCents: 0,
        legs: [
          { tripId: 't1', employeeId: 'emp-1', placeIds: [], stops: [], finishMin: 0, extraMin: 4, extraDistanceM: 1609.344, rewardCents: 300 },
          { tripId: 't2', employeeId: 'emp-2', placeIds: [], stops: [], finishMin: 0, extraMin: 3, extraDistanceM: 804.672, rewardCents: 300 },
        ],
      };
      return { plan };
    },
    employeeName: (id) => ({ 'emp-1': 'Elena Rossi', 'emp-2': 'Reese Green' })[id] ?? 'A carrier',
    businessName: (id) => ({ 'biz-a': 'Etsy', 'biz-b': 'Blue Bottle Coffee', 'biz-r': 'Brooklyn Roasting' })[id] ?? null,
    ...over,
  };
  return { engine, calls };
}

// ---------- fake Gemini ----------
type Part = Record<string, unknown>;
type Reply = Part[] | { status: number } | 'hang';
const call = (name: string, args: unknown): Part => ({ functionCall: { name, args } });

/** A fake `fetch` that answers each model turn from `turns` in order; it records every request body. */
function fakeGemini(turns: Reply[]) {
  const bodies: Record<string, any>[] = [];
  const inits: (FetchInitLike | undefined)[] = [];
  const urls: string[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    urls.push(url);
    inits.push(init);
    bodies.push(JSON.parse(String(init?.body)));
    if (!url.startsWith(GEMINI_MODELS_URL)) return Promise.reject(new Error('only the fake Gemini'));
    const reply = turns[bodies.length - 1] ?? { status: 500 };
    if (reply === 'hang') {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    if (!Array.isArray(reply)) return Promise.resolve({ status: reply.status, text: async () => '{"error":{}}' });
    const body = { candidates: [{ content: { role: 'model', parts: reply }, finishReason: 'STOP' }] };
    return Promise.resolve({ status: 200, text: async () => JSON.stringify(body) });
  };
  return { fetchImpl, bodies, inits, urls };
}

const settings = (fetchImpl: FetchLike, timeoutMs?: number) => ({ apiKey: KEY, model: MODEL, fetchImpl, timeoutMs });

/** The function responses the server sent back in a request body's last turn. */
const responsesIn = (body: Record<string, any>) =>
  (body.contents.at(-1).parts as { functionResponse: { name: string; response: Record<string, any> } }[])
    .map((p) => p.functionResponse);

describe('try_variant arguments: validation and clamping', () => {
  const { engine } = fakeEngine();

  it('no arguments, {} or null is the request as typed', () => {
    for (const args of [undefined, null, {}]) {
      expect(resolveVariant(args, engine)).toStrictEqual({ readyMin: 960, deadlineMin: 2040, changes: {}, clamped: false });
    }
  });

  it('an earlier ready time and a later deliver-by inside the bounds are taken as they are', () => {
    expect(resolveVariant({ readyMin: 940, deadlineMin: 2100 }, engine))
      .toStrictEqual({ readyMin: 940, deadlineMin: 2100, changes: { readyMin: 940, deadlineMin: 2100 }, clamped: false });
  });

  it('a ready time before the run clock is moved to the clock; a later one back to the draft\'s', () => {
    expect(resolveVariant({ readyMin: 0 }, engine)).toMatchObject({ readyMin: 930, changes: { readyMin: 930 }, clamped: true });
    expect(resolveVariant({ readyMin: 1500 }, engine)).toMatchObject({ readyMin: 960, changes: {}, clamped: true });
  });

  it('a deliver-by after the window end is moved to it; an earlier one back to the draft\'s', () => {
    expect(resolveVariant({ deadlineMin: 99999 }, engine)).toMatchObject({ deadlineMin: 2160, changes: { deadlineMin: 2160 }, clamped: true });
    expect(resolveVariant({ deadlineMin: 1000 }, engine)).toMatchObject({ deadlineMin: 2040, changes: {}, clamped: true });
  });

  it('the clock floor follows the clock, but never goes past the draft\'s own ready time', () => {
    const later = fakeEngine({ clockMin: 950 }).engine;
    expect(resolveVariant({ readyMin: 900 }, later)).toMatchObject({ readyMin: 950 });
    const pastReady = fakeEngine({ clockMin: 1200 }).engine;
    expect(resolveVariant({ readyMin: 900 }, pastReady)).toMatchObject({ readyMin: 960, changes: {} });
    // Before the window start (a clock still at the start of Day 1): the window start is the floor.
    const early = fakeEngine({ clockMin: 0 }).engine;
    expect(resolveVariant({ readyMin: 10 }, early)).toMatchObject({ readyMin: 930 });
  });

  it('fractions are rounded to whole minutes; a numeric text is read as a number', () => {
    expect(resolveVariant({ readyMin: 944.6 }, engine)).toMatchObject({ readyMin: 945 });
    expect(resolveVariant({ deadlineMin: '2100' }, engine)).toMatchObject({ deadlineMin: 2100 });
  });

  it.each([
    ['a text that is no number', { readyMin: 'noon' }],
    ['NaN', { readyMin: Number.NaN }],
    ['Infinity', { deadlineMin: Number.POSITIVE_INFINITY }],
    ['a list', { deadlineMin: [2100] }],
    ['an object', { readyMin: { min: 900 } }],
    ['a boolean', { deadlineMin: true }],
    ['an unknown argument (a price)', { customerPriceCents: 1 }],
    ['an unknown argument next to a good one', { readyMin: 940, originBusinessId: 'biz-x' }],
  ])('%s is an error', (_name, args) => {
    expect(resolveVariant(args, engine)).toHaveProperty('error');
  });

  it.each([['a list', [940]], ['a number', 940], ['a text', 'earlier']])('arguments that are %s are an error', (_name, args) => {
    expect(resolveVariant(args, engine)).toHaveProperty('error');
  });
});

describe('offline options', () => {
  it('the three fixed variants: as typed, ready 2 h earlier (clamped to the clock), deliver-by for the discount', () => {
    const { engine } = fakeEngine({ draft: { originBusinessId: 'biz-a', destinationBusinessId: 'biz-b', readyMin: 1000, deadlineMin: 2040 } });
    expect(offlineVariants(engine).map((v) => v.changes)).toStrictEqual([
      {}, { readyMin: 930 }, { deadlineMin: 2080 },   // 1000 - 120 = 880 is before the clock; 1000 + 1080 = 2080
    ]);
  });

  it('the discount deliver-by is clamped to the window end, and a variant equal to another is tried once', () => {
    const { engine } = fakeEngine({
      clockMin: 960, draft: { originBusinessId: 'biz-a', destinationBusinessId: 'biz-b', readyMin: 1200, deadlineMin: 2100 },
    });
    // ready 1200 - 120 = 1080; 1200 + 1080 = 2280, past the end -> 2160
    expect(offlineVariants(engine).map((v) => [v.readyMin, v.deadlineMin])).toStrictEqual([[1200, 2100], [1080, 2100], [1200, 2160]]);
    // Ready 960 is the clock, so "earlier" is the same variant; 960 + 1080 = 2040 is the draft's deliver-by: the same too.
    const atClock = fakeEngine({ clockMin: 960 }).engine;
    expect(offlineVariants(atClock).map((v) => v.changes)).toStrictEqual([{}]);
  });

  it('answers with engine numbers only, drops options with the same price and arrival, source offline', async () => {
    const { engine } = fakeEngine();
    const answer = adviseOffline(engine);
    expect(answer.source).toBe('offline');
    expect(answer.note).toBeUndefined();
    // As typed: 960 -> 2040 is exactly 18 h, so it already has the discount; the "discount" variant is the same
    // variant and is not tried. Ready 2 h earlier is clamped to the clock (930): arrives 10 min earlier.
    expect(answer.options).toStrictEqual<AdviseOption[]>([
      {
        label: 'As requested', summary: 'Via Brooklyn Roasting with Elena Rossi and Reese Green, arrives Day 2, 9:20 AM, $6.00.',
        changes: {}, kind: 'relay', relayBusinessId: 'biz-r', carrierNames: ['Elena Rossi', 'Reese Green'],
        deliveryMin: 2000, extraMin: 7, extraMiles: 1.5, customerPriceCents: 600,
      },
      {
        label: 'Ready 30 min earlier', summary: 'Via Brooklyn Roasting with Elena Rossi and Reese Green, arrives Day 2, 9:10 AM, $6.00.',
        changes: { readyMin: 930 }, kind: 'relay', relayBusinessId: 'biz-r', carrierNames: ['Elena Rossi', 'Reese Green'],
        deliveryMin: 1990, extraMin: 7, extraMiles: 1.5, customerPriceCents: 600,
      },
    ]);
  });

  it('a later deliver-by that earns the discount is its own option', () => {
    const { engine } = fakeEngine({ draft: { originBusinessId: 'biz-a', destinationBusinessId: 'biz-b', readyMin: 960, deadlineMin: 2000 } });
    const answer = adviseOffline(engine);
    expect(answer.options.map((o) => [o.label, o.customerPriceCents, o.changes])).toStrictEqual([
      ['As requested', 700, {}],
      ['Ready 30 min earlier', 700, { readyMin: 930 }],
      ['Deliver by Day 2, 10:00 AM', 600, { deadlineMin: 2040 }],
    ]);
  });

  it('a variant that is no cheaper and arrives no earlier than one already kept is dropped', () => {
    const base = fakeEngine().engine.match(960, 2000);
    if (!('plan' in base)) throw new Error('the fake engine should match');
    const { engine } = fakeEngine({
      draft: { originBusinessId: 'biz-a', destinationBusinessId: 'biz-b', readyMin: 1000, deadlineMin: 2000 },
      // $7.00 everywhere. As typed and ready earlier: arrives 2000. A later deliver-by: a later carrier, 2030.
      match: (_readyMin, deadlineMin) => ({ plan: { ...base.plan, deliveryMin: deadlineMin > 2000 ? 2030 : 2000 } }),
    });
    const answer = adviseOffline(engine);
    // Ready earlier: the same deal (dropped). Deliver-by 2080: the same price, later (dropped).
    expect(answer.options.map((o) => [o.changes, o.customerPriceCents, o.deliveryMin])).toStrictEqual([[{}, 700, 2000]]);
  });

  it('with no carrier for any variant: no options and a note with the matcher\'s reason', () => {
    const { engine } = fakeEngine({ match: () => ({ reason: 'Every matching commute is already carrying a package' }) });
    const answer = adviseOffline(engine);
    expect(answer.options).toStrictEqual([]);
    expect(answer.note).toContain('Every matching commute is already carrying a package');
  });

  it('when only a variant matches, the note says the request as typed cannot be', () => {
    const { engine } = fakeEngine({ draft: { originBusinessId: 'biz-a', destinationBusinessId: 'biz-b', readyMin: 960, deadlineMin: 1980 } });
    const answer = adviseOffline(engine);
    expect(answer.options.map((o) => o.changes)).toStrictEqual([{ deadlineMin: 2040 }]);
    expect(answer.note).toMatch(/^As typed, no carrier can take it: No commute can arrive before the deadline\.$/);
  });
});

describe('the Gemini agent loop', () => {
  it('runs try_variant on the engine, then builds the options from the tool results: Gemini\'s numbers are ignored', async () => {
    const { engine, calls } = fakeEngine({ draft: { originBusinessId: 'biz-a', destinationBusinessId: 'biz-b', readyMin: 960, deadlineMin: 2000 } });
    const gemini = fakeGemini([
      [call(TRY_VARIANT, {}), call(TRY_VARIANT, { deadlineMin: 2040 })],
      [call(PRESENT_OPTIONS, {
        options: [
          // Invented numbers everywhere: a price, an arrival, carriers and a relay point.
          { resultId: 'r2', label: 'Flexible and cheaper', summary: 'Only $1.00, arrives at 6 AM!', customerPriceCents: 100, deliveryMin: 1800, carrierNames: ['Nobody'], kind: 'direct' },
          { resultId: 'r1', label: 'As you asked', summary: 'Arrives by your deadline.', changes: { readyMin: 0 } },
          { resultId: 'r9', label: 'Invented result', summary: 'Free delivery' },   // no such tool result
          { resultId: 'r1', label: 'Again', summary: 'The same result twice' },     // shown once
        ],
      })],
    ]);

    const answer = await advise(engine, settings(gemini.fetchImpl));

    expect(answer.source).toBe('gemini');
    expect(calls).toStrictEqual([[960, 2000], [960, 2040]]);
    const common = { kind: 'relay', relayBusinessId: 'biz-r', carrierNames: ['Elena Rossi', 'Reese Green'], extraMin: 7, extraMiles: 1.5 };
    expect(answer.options).toStrictEqual([
      { label: 'Flexible and cheaper', summary: 'Only $1.00, arrives at 6 AM!', changes: { deadlineMin: 2040 }, ...common, deliveryMin: 2000, customerPriceCents: 600 },
      { label: 'As you asked', summary: 'Arrives by your deadline.', changes: {}, ...common, deliveryMin: 2000, customerPriceCents: 700 },
    ]);

    // The second turn answered both calls with the engine's facts, by resultId.
    const sent = responsesIn(gemini.bodies[1]);
    expect(sent.map((r) => [r.name, r.response.resultId, r.response.matched, r.response.price]))
      .toStrictEqual([[TRY_VARIANT, 'r1', true, '$7.00'], [TRY_VARIANT, 'r2', true, '$6.00']]);
    // The model's turn is sent back as it came, before the answers.
    expect(gemini.bodies[1].contents[1]).toStrictEqual({ role: 'model', parts: [call(TRY_VARIANT, {}), call(TRY_VARIANT, { deadlineMin: 2040 })] });
  });

  it('sends the key only in the x-goog-api-key header, the two functions, mode ANY and thinking off', async () => {
    const { engine } = fakeEngine();
    const gemini = fakeGemini([[call(TRY_VARIANT, {})], [call(PRESENT_OPTIONS, { options: [{ resultId: 'r1', label: 'A', summary: 'B' }] })]]);
    await advise(engine, settings(gemini.fetchImpl));
    expect(gemini.urls[0]).toBe(`${GEMINI_MODELS_URL}/${MODEL}:generateContent`);
    for (const [i, init] of gemini.inits.entries()) {
      expect(gemini.urls[i]).not.toContain(KEY);
      expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
      expect(String(init?.body)).not.toContain(KEY);
    }
    const body = gemini.bodies[0];
    expect(body.tools).toStrictEqual([{ functionDeclarations: ADVISOR_FUNCTIONS }]);
    expect(body.toolConfig).toStrictEqual({ functionCallingConfig: { mode: 'ANY' } });
    expect(body.generationConfig).toStrictEqual({ thinkingConfig: { thinkingBudget: 0 } });
    expect(body.systemInstruction.parts[0].text).toBe(buildAdvisorPrompt(engine));
    expect(body.systemInstruction.parts[0].text).toContain('readyMin from 930');
    expect(body.systemInstruction.parts[0].text).toContain('up to 2160');
  });

  it(`runs at most ${MAX_TOOL_CALLS} try_variant calls; later ones get an error answer and never reach the engine`, async () => {
    const { engine, calls } = fakeEngine();
    const six = [0, 1, 2, 3, 4, 5].map((i) => call(TRY_VARIANT, { deadlineMin: 2040 + i * 10 }));
    const gemini = fakeGemini([six, [call(TRY_VARIANT, {})], [call(PRESENT_OPTIONS, { options: [{ resultId: 'r4', label: 'L', summary: 'S' }] })]]);
    const answer = await advise(engine, settings(gemini.fetchImpl));
    expect(calls).toHaveLength(MAX_TOOL_CALLS);
    const first = responsesIn(gemini.bodies[1]);
    expect(first.slice(0, 4).every((r) => r.response.matched === true)).toBe(true);
    expect(first.slice(4).map((r) => r.response.error)).toStrictEqual([
      expect.stringContaining('limit'), expect.stringContaining('limit'),
    ]);
    expect(responsesIn(gemini.bodies[2])[0].response.error).toContain('limit');
    expect(answer.source).toBe('gemini');
    expect(answer.options[0].changes).toStrictEqual({ deadlineMin: 2070 });
  });

  it('a bad argument is answered with an error and the engine is not asked; an out-of-range one is clamped', async () => {
    const { engine, calls } = fakeEngine();
    const gemini = fakeGemini([
      [call(TRY_VARIANT, { readyMin: 'soon' }), call(TRY_VARIANT, { price: 1 }), call(TRY_VARIANT, { deadlineMin: 5000 }), call('reserve', {})],
      [call(PRESENT_OPTIONS, { options: [{ resultId: 'r1', label: 'Latest', summary: 'S' }] })],
    ]);
    const answer = await advise(engine, settings(gemini.fetchImpl));
    expect(calls).toStrictEqual([[960, 2160]]);
    const sent = responsesIn(gemini.bodies[1]);
    expect(sent[0].response).toHaveProperty('error');
    expect(sent[1].response).toHaveProperty('error');
    expect(sent[2].response).toMatchObject({ resultId: 'r1', deadlineMin: 2160, note: expect.stringContaining('nearest allowed') });
    expect(sent[3]).toMatchObject({ name: 'reserve', response: { error: expect.stringContaining('Unknown function') } });
    expect(answer.options[0].changes).toStrictEqual({ deadlineMin: 2160 });
  });

  it('labels and summaries are cut to 60 and 140 characters on one line; empty ones get the server\'s text', async () => {
    const { engine } = fakeEngine();
    const gemini = fakeGemini([
      [call(TRY_VARIANT, {}), call(TRY_VARIANT, { readyMin: 930 })],
      [call(PRESENT_OPTIONS, { options: [
        { resultId: 'r1', label: `Long\nlabel ${'x'.repeat(100)}`, summary: 's'.repeat(400) },
        { resultId: 'r2', label: '   ', summary: 42 },
      ] })],
    ]);
    const answer = await advise(engine, settings(gemini.fetchImpl));
    const [a, b] = answer.options;
    expect(a.label.length).toBeLessThanOrEqual(MAX_LABEL_CHARS);
    expect(a.label.startsWith('Long label x')).toBe(true);
    expect(a.summary.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
    expect(b.label).toBe('Ready 30 min earlier');
    expect(b.summary).toBe('Via Brooklyn Roasting with Elena Rossi and Reese Green, arrives Day 2, 9:10 AM, $6.00.');
  });

  it('one pick is topped up with another tried result that differs in price or arrival', async () => {
    const { engine } = fakeEngine();
    const gemini = fakeGemini([
      [call(TRY_VARIANT, {}), call(TRY_VARIANT, { deadlineMin: 2100 }), call(TRY_VARIANT, { readyMin: 930 })],
      [call(PRESENT_OPTIONS, { options: [{ resultId: 'r1', label: 'As typed', summary: 'S' }] })],
    ]);
    const answer = await advise(engine, settings(gemini.fetchImpl));
    // r2 (later deliver-by) is the same price and arrival as r1: skipped. r3 arrives 10 minutes earlier.
    expect(answer.options.map((o) => [o.label, o.changes])).toStrictEqual([['As typed', {}], ['Ready 30 min earlier', { readyMin: 930 }]]);
  });

  it.each<[string, Reply[]]>([
    ['an HTTP error', [{ status: 500 }]],
    ['a 403 after a tool turn', [[call(TRY_VARIANT, {})], { status: 403 }]],
    ['text instead of a function call', [[{ text: 'Here are your options: $1.00' }]]],
    ['present_options with only invented results', [[call(PRESENT_OPTIONS, { options: [{ resultId: 'r1', label: 'X', summary: 'Y' }] })]]],
    ['present_options with a broken shape', [[call(TRY_VARIANT, {})], [call(PRESENT_OPTIONS, { options: 'all of them' })]]],
    ['a model that never presents', Array.from({ length: 10 }, () => [call(TRY_VARIANT, {})])],
  ])('%s falls back to the offline options', async (_name, turns) => {
    const { engine } = fakeEngine();
    const gemini = fakeGemini(turns);
    expect(await advise(engine, settings(gemini.fetchImpl))).toStrictEqual(adviseOffline(engine));
  });

  it('a Gemini that does not answer within the budget: offline options, the request is aborted', async () => {
    const { engine } = fakeEngine();
    const gemini = fakeGemini(['hang']);
    const started = Date.now();
    const answer = await advise(engine, settings(gemini.fetchImpl, 80));
    expect(Date.now() - started).toBeLessThan(5000);
    expect(answer).toStrictEqual(adviseOffline(engine));
    expect(gemini.inits[0]?.signal?.aborted).toBe(true);
  });

  it('the budget covers every turn together: no new turn starts once it is used up', async () => {
    const { engine } = fakeEngine();
    let clock = 0;
    const turns: Reply[] = [[call(TRY_VARIANT, {})], [call(TRY_VARIANT, { readyMin: 930 })], [call(PRESENT_OPTIONS, { options: [{ resultId: 'r1', label: 'A', summary: 'B' }] })]];
    const gemini = fakeGemini(turns);
    const slow: FetchLike = (url, init) => {
      clock += 6000;   // every turn "takes" 6 s of the 10 s budget
      return gemini.fetchImpl(url, init);
    };
    const answer = await advise(engine, settings(slow), () => clock);
    expect(answer).toStrictEqual(adviseOffline(engine));   // the third turn would start after 12 s
    expect(gemini.bodies).toHaveLength(2);
  });

  it('no key: nothing is sent, offline options', async () => {
    const { engine } = fakeEngine();
    const gemini = fakeGemini([]);
    for (const apiKey of [null, undefined, '', '   ']) {
      expect(await advise(engine, { apiKey, model: MODEL, fetchImpl: gemini.fetchImpl })).toStrictEqual(adviseOffline(engine));
    }
    expect(await advise(engine)).toStrictEqual(adviseOffline(engine));
    expect(gemini.bodies).toHaveLength(0);
  });

  it('an engine error is not swallowed (the route turns a travel error into its 503)', async () => {
    const boom = new Error('travel data missing');
    const { engine } = fakeEngine({ match: () => { throw boom; } });
    const gemini = fakeGemini([[call(TRY_VARIANT, {})]]);
    await expect(advise(engine, settings(gemini.fetchImpl))).rejects.toBe(boom);
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
