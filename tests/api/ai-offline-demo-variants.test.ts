// #898: the demo must work with no Gemini key, and with Gemini paused after a failure (#884). This file sends
// the README's demo sentence and the close variants a presenter might type live to POST /api/v2/parse-request
// and POST /api/v2/advise of the real server on fixtures/nyc, with no key, and checks three things:
//   1. every variant either fills a field correctly or leaves it null (listed in `missing`, which the form
//      shows as "Check this: not in your request"); no address, time or weight is ever made up;
//   2. the options for the demo sentence are the engine's: each price is `customerPriceCents()` of its plan,
//      the request as typed costs the README's $9.50, and the answer says it is offline;
//   3. every text the two routes write for a problem is one plain sentence.
// The server is `createV2Runtime` with no Google key and no Gemini settings (v2-e2e-nyc-helper.ts), and
// `globalThis.fetch` is a recorder: a call that is not to the test server (to Gemini, say) fails the test.
// Both routes only read the run, so one server serves the whole file.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { adviceCard, ADVICE_COPY } from '../../client/src/components/business/v2/adviceModel';
import { draftFromParsed, NEEDS_INPUT_HINT } from '../../client/src/components/business/v2/newDeliveryModel';
import { adviseOffline, adviseUnlessPaused, offlineVariants, runVariant } from '../../server/ai/advisor';
import { createGeminiPause } from '../../server/ai/geminiPause';
import { parseWithGeminiUnlessPaused } from '../../server/ai/geminiParser';
import { parseOffline } from '../../server/ai/ruleParser';
import { advisorEngine, INVALID_ADVISE } from '../../server/api/v2/adviseRoutes';
import { INVALID_PARSE_REQUEST } from '../../server/api/v2/parseRequestRoutes';
import type { FetchLike } from '../../server/geo/googleClient';
import type { Store } from '../../server/store';
import type { AdviseResponse } from '../../shared/v2/api';
import type { ParseDraft, ParseRequestResponse } from '../../shared/v2/parseRequest';
import type { ApiError } from '../../shared/v2/schemas';
import type { NetworkBusiness, Run as RunV2, TravelProvider } from '../../shared/v2/types';
import { expectEnginePrices, type DraftTimes } from './v2-advise-pricing-helper';
import { copyNycFixtures, recordFetch, REPO_ROOT, startNycApi, T, type NycApi } from './v2-e2e-nyc-helper';

// ---------- the sentences ----------

/** The sentence the README's 2-minute demo types. */
const DEMO_SENTENCE = 'Send a 0.5 kg envelope of espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow, ready at 4 p.m.';
/** Its two halves, to write the variants from. */
const SEND = 'Send a 0.5 kg envelope of espresso blend samples';
const WHEN = 'by 10 a.m. tomorrow, ready at 4 p.m.';

/** The two demo businesses, by the README's names; `SENDER`/`RECIPIENT` stand for their ids in the table below. */
const SENDER = '<Brooklyn Roasting Company>';
const RECIPIENT = '<Blue Bottle Coffee>';

/** What the demo sentence gives. The run clock is at Day 1 3:30 PM (930); 960 is Day 1 4:00 PM, 2040 Day 2 10:00 AM. */
const DEMO_DRAFT: ParseDraft = {
  originBusinessId: null, destinationBusinessId: RECIPIENT, label: 'Envelope', category: 'envelope',
  description: 'Espresso blend samples', weightKg: 0.5, readyMin: 960, deadlineMin: 2040,
};
const CLOCK_MIN = 930;

type Variant = {
  what: string;
  text: string;
  /** The fields that differ from DEMO_DRAFT. */
  draft?: Partial<ParseDraft>;
  /** The stops the answer refuses, as typed. */
  refused?: string[];
};

/** The demo sentence and 20 variants of it. The table in PR #898 lists them with these answers. */
const VARIANTS: Variant[] = [
  { what: 'the README demo sentence', text: DEMO_SENTENCE },

  // Other times.
  { what: 'time: by 9am tomorrow', text: `${SEND} to Blue Bottle Coffee by 9am tomorrow, ready at 4 p.m.`, draft: { deadlineMin: 1980 } },
  { what: 'time: next morning (the decided morning, Day 2 10:00)', text: `${SEND} to Blue Bottle Coffee next morning, ready at 4 p.m.` },
  { what: 'time: by 10 the next morning, ready at 4 this afternoon', text: `${SEND} to Blue Bottle Coffee by 10 the next morning, ready at 4 this afternoon` },
  { what: 'time: tomorrow 10am, ready 4pm (no "by", no "at")', text: `${SEND} to Blue Bottle Coffee tomorrow 10am, ready 4pm` },
  {
    what: 'time: by 8 this evening (8 p.m. on Day 1)',
    text: `${SEND} to Blue Bottle Coffee by 8 this evening, ready at 4 p.m.`, draft: { deadlineMin: 1200 },
  },
  {
    what: 'time: this evening, with no hour: the deliver-by is the window end, assumed (#947), and ready is the clock',
    text: `${SEND} to Blue Bottle Coffee this evening`, draft: { readyMin: CLOCK_MIN, deadlineMin: 2160 },
  },

  // Weights.
  { what: 'weight: 2 lb', text: `Send a 2 lb envelope of espresso blend samples to Blue Bottle Coffee ${WHEN}`, draft: { weightKg: 0.907 } },
  {
    what: 'weight: a small box, with no weight',
    text: `Send a small box of espresso blend samples to Blue Bottle Coffee ${WHEN}`,
    draft: { label: 'Box', category: 'small_box', weightKg: null },
  },
  { what: 'weight: none', text: `Send an envelope of espresso blend samples to Blue Bottle Coffee ${WHEN}`, draft: { weightKg: null } },
  {
    what: 'weight: in words ("a light envelope") is not a number',
    text: `Send a light envelope of espresso blend samples to Blue Bottle Coffee ${WHEN}`, draft: { weightKg: null },
  },

  // The demo addresses, written differently.
  { what: 'address: the recipient by its street address, no borough', text: `${SEND} to 1 Wall Street ${WHEN}` },
  {
    what: 'address: both stops abbreviated',
    text: `${SEND} from 200 Flushing Ave to 1 Wall St ${WHEN}`, draft: { originBusinessId: SENDER },
  },
  {
    what: 'address: lower case, with the city',
    text: `send a 0.5 kg envelope of espresso blend samples from 200 flushing avenue, brooklyn to 1 wall st, new york ${WHEN}`,
    draft: { originBusinessId: SENDER },
  },
  {
    what: 'address: the names with their full addresses',
    text: `${SEND} from Brooklyn Roasting Company, 200 Flushing Avenue, Brooklyn, NY 11205 to Blue Bottle Coffee, 1 Wall Street, New York, NY 10005 ${WHEN}`,
    draft: { originBusinessId: SENDER },
  },
  {
    what: 'address: short names in lower case',
    text: `send a 0.5 kg envelope of espresso blend samples from brooklyn roasting co. to blue bottle ${WHEN}`,
    draft: { originBusinessId: SENDER },
  },
  { what: 'address: the name with its borough', text: `${SEND} to Blue Bottle Coffee, Manhattan ${WHEN}` },

  // Stops the parser must not guess.
  {
    what: 'address: another number on the same street is not the recipient',
    text: `${SEND} to 2 Wall Street ${WHEN}`, draft: { destinationBusinessId: null }, refused: ['2 Wall Street'],
  },
  {
    what: 'address: two stops outside the network',
    text: `${SEND} from my apartment to 350 Fifth Avenue ${WHEN}`,
    draft: { destinationBusinessId: null }, refused: ['my apartment', '350 Fifth Avenue'],
  },
  {
    // #947 reverses #898 here: a slip of one or two letters is read as the one business that close.
    what: 'address: a misspelt name is read as the one business that close (#947)',
    text: `${SEND} to Bluebottle Cafe ${WHEN}`,
  },
  { what: 'no destination', text: `${SEND} ${WHEN}`, draft: { destinationBusinessId: null } },
];

// ---------- plain sentences ----------

/** Words no sender should have to read. "Gemini" may stand only in the line that says an answer is offline. */
const JARGON = /\b(?:LLM|AI model|tool call|function call|schema|JSON|HTTP|429|Gemini|null|undefined|NaN|payload|stack)\b/i;
const MAX_WORDS = 14;

const wordCount = (text: string) => text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

/**
 * One plain sentence: one line, one sentence end at most (the last character), no jargon and at most
 * `maxWords` words. What the sender typed, which the refusal quotes, is not the server's wording: it is left out.
 */
function expectPlain(text: unknown, where: string, maxWords = MAX_WORDS): void {
  if (typeof text !== 'string') throw new Error(`${where}: no text`);
  const own = text.replace(/"[^"]*"/g, '"…"');
  expect(own.trim(), where).toBe(own);
  expect(own, where).not.toMatch(/[\r\n]/);
  expect(own.slice(0, -1), where).not.toMatch(/[.!?;]/);
  expect(own, where).not.toMatch(JARGON);
  expect(wordCount(own), `${where}: "${text}"`).toBeGreaterThan(0);
  expect(wordCount(own), `${where}: "${text}"`).toBeLessThanOrEqual(maxWords);
}

// ---------- the server ----------

const net = recordFetch();
let api: NycApi;
let fixturesDir: string;
let store: Store<RunV2>;
let travel: TravelProvider;
let sender: NetworkBusiness;
let recipient: NetworkBusiness;
/** Every console call while the file runs: no route may print a sentence. */
let printed: string[] = [];
const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
  vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { printed.push(args.map(String).join(' ')); }));

const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');

beforeAll(async () => {
  fixturesDir = copyNycFixtures();
  api = await startNycApi(net, { fixturesDir });
  const deps = api.runtime.deps;
  if (!deps.store || !deps.travel) throw new Error('/api/v2 did not load on fixtures/nyc');
  store = deps.store as Store<RunV2>;
  travel = deps.travel;
  const named = (name: string) => {
    const found = store.get().scenario.businesses.filter((b) => b.name === name);
    if (found.length !== 1) throw new Error(`the default run has ${found.length} businesses named "${name}"`);
    return found[0];
  };
  sender = named('Brooklyn Roasting Company');
  recipient = named('Blue Bottle Coffee');
}, T);

afterAll(async () => {
  api.expectRepoFilesUntouched();
  await api.close();
  fs.rmSync(fixturesDir, { recursive: true, force: true });
  net.expectNoOutgoing(); // no key: nothing was sent to Gemini (or anywhere else)
  net.restore();
  for (const spy of spies) spy.mockRestore();
}, T);

/** The draft a table row expects, with the two businesses' ids of this run. */
function expectedDraft(variant: Variant): ParseDraft {
  const id = (value: string | null) => (value === SENDER ? sender.id : value === RECIPIENT ? recipient.id : value);
  const draft = { ...DEMO_DRAFT, ...variant.draft };
  return { ...draft, originBusinessId: id(draft.originBusinessId), destinationBusinessId: id(draft.destinationBusinessId) };
}

/** POST /parse-request, which must answer 200 from the offline parser and leave the run as it is. */
async function parse(text: string): Promise<ParseRequestResponse> {
  const before = store.get();
  const res = await api.post<ParseRequestResponse>('/parse-request', { text });
  expect(res.status, text).toBe(200);
  expect(res.body.source, text).toBe('offline');
  expect(store.get(), text).toBe(before);
  return res.body;
}

/** The sentence's draft as the sender's Business page sends it to /advise: with the signed-in business as the sender. */
async function draftOnSenderPage(text: string): Promise<ParseDraft & DraftTimes> {
  const { draft } = await parse(text);
  expect(draft.readyMin, text).not.toBeNull();
  expect(draft.deadlineMin, text).not.toBeNull();
  return { ...draft, originBusinessId: sender.id } as ParseDraft & DraftTimes;
}

/** POST /advise, which must answer 200 offline and leave the run as it is. */
async function advise(draft: unknown): Promise<AdviseResponse> {
  const before = store.get();
  const res = await api.post<AdviseResponse>('/advise', { draft });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.source).toBe('offline');
  expect(store.get()).toBe(before);
  return res.body;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// ---------- parse-request ----------

describe('POST /api/v2/parse-request with no key: the demo sentence and what a presenter might type instead (#898)', () => {
  it('the table has the README sentence and at least 12 variants, of every kind the demo may meet', () => {
    expect(readme).toContain(`\n${DEMO_SENTENCE}\n`);
    expect(VARIANTS[0].text).toBe(DEMO_SENTENCE);
    expect(new Set(VARIANTS.map((v) => v.text)).size).toBe(VARIANTS.length);
    expect(VARIANTS.length - 1).toBeGreaterThanOrEqual(12);
    for (const kind of ['time:', 'weight:', 'address:', 'no destination']) {
      expect(VARIANTS.filter((v) => v.what.startsWith(kind)).length, kind).toBeGreaterThanOrEqual(kind === 'no destination' ? 1 : 3);
    }
    expect(store.get().clock.timeMin).toBe(CLOCK_MIN);
    // The addresses in the table are the two demo businesses' own.
    expect(sender.address).toBe('200 Flushing Avenue, Brooklyn, NY 11205');
    expect(recipient.address).toBe('1 Wall Street, New York, NY 10005');
  });

  it.each(VARIANTS)('$what: "$text"', async (variant) => {
    const { draft, missing, rejected } = await parse(variant.text);
    const expected = expectedDraft(variant);

    // The whole draft: a field is the sentence's own value or null, never a guess.
    expect(draft).toStrictEqual(expected);
    expect(missing).toStrictEqual((Object.keys(expected) as (keyof ParseDraft)[]).filter((key) => expected[key] === null));

    // A stop that is not a network business is refused in one plain sentence that quotes it as typed.
    if (variant.refused) {
      expectPlain(rejected, variant.what);
      for (const stop of variant.refused) expect(rejected).toContain(`"${stop}"`);
      expect(rejected).toMatch(/^Relay delivers only between network businesses, and /);
    } else {
      expect(rejected).toBeNull();
    }

    // Every field the sentence left empty gets the form's plain note, and no other field does. (The sender is
    // not a form field: the page sends as the signed-in business.)
    const { needsInput } = draftFromParsed(draft, { originId: sender.id, businesses: store.get().scenario.businesses });
    const noted: string[] = [];
    if (expected.destinationBusinessId === null) noted.push('recipientId');
    if (expected.weightKg === null) noted.push('weightKg');
    if (expected.deadlineMin === null) noted.push('deadlineDay', 'deadlineTime');
    expect([...needsInput].sort()).toStrictEqual(noted.sort());
    expectPlain(NEEDS_INPUT_HINT.replace(':', ','), 'the form\'s note');
  }, T);

  it('the route\'s answer is the offline parser\'s own, for every row', async () => {
    const { businesses } = store.get().scenario;
    for (const { text } of VARIANTS) {
      const { simStartMin: windowStartMin, simEndMin: windowEndMin } = store.get().scenario.settings;
      expect(await parse(text), text).toStrictEqual(parseOffline(text, { businesses, nowMin: CLOCK_MIN, windowStartMin, windowEndMin }));
    }
  }, T);

  it('with Gemini paused after a failure the draft is the same, and Gemini is not asked', async () => {
    const { businesses, settings } = store.get().scenario;
    const pause = createGeminiPause();
    pause.fail('timeout');
    let asked = 0;
    const fetchImpl: FetchLike = () => { asked += 1; return Promise.reject(new Error('Gemini is paused: nothing may be sent')); };
    const outcome = await parseWithGeminiUnlessPaused(
      DEMO_SENTENCE, { businesses, nowMin: CLOCK_MIN, windowStartMin: settings.simStartMin, windowEndMin: settings.simEndMin },
      { apiKey: 'AQ.FAKE_demo-variants-key', model: 'gemini-2.5-flash', fetchImpl }, pause,
    );
    expect(outcome).toMatchObject({ ok: false, reason: 'paused' });
    expect(asked).toBe(0);
    // The route then answers with the offline parser, as it does with no key.
    expect(parseOffline(DEMO_SENTENCE, { businesses, nowMin: CLOCK_MIN }).draft).toStrictEqual(expectedDraft(VARIANTS[0]));
  });
});

// ---------- advise ----------

describe('POST /api/v2/advise with no key: priced options for the demo sentence (#898)', () => {
  it('the demo sentence: the request as typed at the README\'s $9.50, every price the engine\'s, and it says it is offline', async () => {
    const draft = await draftOnSenderPage(DEMO_SENTENCE);
    const body = await advise(draft);

    expect(body.options.length).toBeGreaterThanOrEqual(1);
    expect(body.options.length).toBeLessThanOrEqual(3);
    expect(body.note).toBeUndefined();
    // Every option's price is customerPriceCents() of the plan the matcher picks for its two times.
    const priced = expectEnginePrices(store.get(), travel, draft, body);
    expect(priced).toHaveLength(body.options.length);
    const [asTyped] = body.options;
    expect(asTyped.changes).toStrictEqual({});
    expect(money(asTyped.customerPriceCents)).toBe('$9.50');
    expect(readme).toContain('price: $9.50');
    expect(asTyped.summary).toContain('$9.50.');

    // Offline, said once and plainly: the answer's `source`, which the Options card turns into its one line.
    expect(body.source).toBe('offline');
    const card = adviceCard(body, { draft, businesses: store.get().scenario.businesses });
    if (!card) throw new Error('the Options card shows nothing for the demo sentence');
    expect(card.sourceLine).toBe(ADVICE_COPY.offlineLine);
    expect(card.sourceLine).toMatch(/^Priced by Relay, with no AI model\.$/);
    expect(card.sourceLine.slice(0, -1)).not.toMatch(/[.!?;]/);
    expect(wordCount(card.sourceLine)).toBeLessThanOrEqual(MAX_WORDS);
    expect(card.rows.map((row) => row.priceText)).toStrictEqual(body.options.map((o) => money(o.customerPriceCents)));
  }, T);

  it('the demo sentence has one deal: every allowed earlier ready time and later deliver-by gets the same plan', async () => {
    // Why the card shows one option for this very sentence: its window is exactly the 18 hours of the
    // flexibility discount, and the same two commutes carry it whatever time is added. A second row would
    // repeat the first one's price and arrival, so the advisor leaves it out.
    const draft = await draftOnSenderPage(DEMO_SENTENCE);
    const run = store.get();
    const { settings } = run.scenario;
    expect(draft.deadlineMin - draft.readyMin).toBe(settings.flexWindowMin);
    const engine = advisorEngine(run, travel, draft);
    const outcomes = offlineVariants(engine).map((variant) => runVariant(variant, engine));
    const widest = runVariant({ readyMin: engine.clockMin, deadlineMin: settings.simEndMin, changes: {}, clamped: false }, engine);
    const deals = [...outcomes, widest].map((o) => (o.matched ? [o.option.customerPriceCents, o.option.deliveryMin, o.option.carrierNames] : o.reason));
    expect(new Set(deals.map((deal) => JSON.stringify(deal))).size).toBe(1);
    expect(deals[0]).toStrictEqual([950, expect.any(Number), ['Elena Rossi', 'Reese Green']]);

    const body = await advise(draft);
    expect(body.options.map((o) => [o.label, o.changes, o.customerPriceCents])).toStrictEqual([['As requested', {}, 950]]);
    expect(body).toStrictEqual(adviseOffline(engine));
  }, T);

  it('"by 9am tomorrow": two options, $10.50 as typed and $9.50 with the deliver-by an hour later, the cheapest marked', async () => {
    const draft = await draftOnSenderPage(VARIANTS[1].text);
    expect(draft.deadlineMin).toBe(1980);
    const body = await advise(draft);

    expect(body.note).toBeUndefined();
    expect(body.options.map((o) => [o.label, o.changes, money(o.customerPriceCents)])).toStrictEqual([
      ['As requested', {}, '$10.50'],
      ['Deliver by Day 2, 10:00 AM', { deadlineMin: 2040 }, '$9.50'],
    ]);
    const priced = expectEnginePrices(store.get(), travel, draft, body);
    expect(priced.map((p) => p.flexible)).toStrictEqual([false, true]);
    const card = adviceCard(body, { draft, businesses: store.get().scenario.businesses });
    expect(card?.rows.map((row) => [row.priceText, row.cheapest])).toStrictEqual([['$10.50', false], ['$9.50', true]]);
    expect(card?.sourceLine).toBe(ADVICE_COPY.offlineLine);
  }, T);

  it('"by 8 this evening": no commute arrives that day, so the one option is a later deliver-by and the note says why', async () => {
    const draft = await draftOnSenderPage(VARIANTS[5].text);
    expect(draft.deadlineMin).toBe(1200);
    const body = await advise(draft);

    expect(body.options.map((o) => [o.changes, money(o.customerPriceCents)])).toStrictEqual([[{ deadlineMin: 2040 }, '$9.50']]);
    expectEnginePrices(store.get(), travel, draft, body);
    expect(body.note).toBe('As typed, no commute can arrive before the deadline.');
    expectPlain(body.note, 'the note');
  }, T);

  it('with Gemini paused after a failure the options are the same, and Gemini is not asked', async () => {
    const draft = await draftOnSenderPage(DEMO_SENTENCE);
    const body = await advise(draft);
    const pause = createGeminiPause();
    pause.fail('timeout');
    let asked = 0;
    const fetchImpl: FetchLike = () => { asked += 1; return Promise.reject(new Error('Gemini is paused: nothing may be sent')); };

    const attempt = await adviseUnlessPaused(
      advisorEngine(store.get(), travel, draft), { apiKey: 'AQ.FAKE_demo-variants-key', model: 'gemini-2.5-flash', fetchImpl }, pause,
    );

    expect(attempt.response).toStrictEqual(body);
    expect(attempt.paused).toMatchObject({ cause: 'timeout' });
    expect(asked).toBe(0);
  }, T);
});

// ---------- the texts of a problem ----------

describe('every text the two routes write for a problem is one plain sentence (#898)', () => {
  it('the note of a request no carrier can take, for every reason the matcher gives', () => {
    // The matcher's reasons (server/domain/v2/matching.ts), and the route's own when the matcher gives none.
    const reasons = [
      'Every matching commute is already carrying a package',
      'No commute can arrive before the deadline',
      'No commute is available after the package is ready',
      'No sender evening commute or recipient morning commute is available',
      'The delivery window is too short for pickup and delivery handling',
      "Every route would exceed the employees' added-time limit",
      'No employees are available to carry packages',
      'No carrier can take it',
    ];
    const draft: DraftTimes = { originBusinessId: sender.id, destinationBusinessId: recipient.id, readyMin: 960, deadlineMin: 1980 };
    const real = advisorEngine(store.get(), travel, draft);
    for (const reason of reasons) {
      // No variant matches: no option, and the note says more time did not help.
      const none = adviseOffline({ ...real, match: () => ({ reason }) });
      expect(none.options).toStrictEqual([]);
      expect(none.note).toBe(`Even with more time, ${reason.charAt(0).toLowerCase()}${reason.slice(1)}.`);
      expectPlain(none.note, reason, MAX_WORDS + 1); // "about 14": the longest reason makes 15
      // Only the request as typed does not: the note says so, and the option below it is the way out.
      const some = adviseOffline({ ...real, match: (readyMin, deadlineMin) => (deadlineMin === draft.deadlineMin ? { reason } : real.match(readyMin, deadlineMin)) });
      expect(some.options.length).toBeGreaterThan(0);
      expect(some.note).toBe(`As typed, ${reason.charAt(0).toLowerCase()}${reason.slice(1)}.`);
      expectPlain(some.note, reason);
    }
  });

  it('parse-request: 400 with the same body as before for a missing, empty or too long text', async () => {
    const bodies: unknown[] = [{}, { text: '' }, { text: '   ' }, { text: 5 }, { text: 'x'.repeat(501) }, { sentence: DEMO_SENTENCE }];
    const seen = new Set<string>();
    for (const body of bodies) {
      const res = await api.post<ApiError>('/parse-request', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(Object.keys(res.body).sort()).toStrictEqual(['error', 'fieldErrors']);
      expect(res.body.error).toBe(INVALID_PARSE_REQUEST);
      expect(Object.keys(res.body.fieldErrors ?? {})).toStrictEqual(['text']);
      for (const text of [res.body.error, res.body.fieldErrors?.text]) {
        expectPlain(text, JSON.stringify(body).slice(0, 40));
        seen.add(text as string);
      }
    }
    expect([...seen].sort()).toStrictEqual(['Describe the delivery in one sentence', 'Invalid request text', 'Max 500 characters']);
  }, T);

  it('advise: 400 with the same body as before for a draft that cannot be priced', async () => {
    const ok = { originBusinessId: sender.id, destinationBusinessId: recipient.id, readyMin: 960, deadlineMin: 2040 };
    const bodies: [unknown, string[]][] = [
      [{}, ['draft']],
      [{ draft: null }, ['draft']],
      [{ draft: { ...ok, originBusinessId: 'biz-nowhere' } }, ['originBusinessId']],
      [{ draft: { ...ok, destinationBusinessId: sender.id } }, ['destinationBusinessId']],
      [{ draft: { ...ok, readyMin: 10 } }, ['readyMin']],
      [{ draft: { ...ok, readyMin: 960.5 } }, ['readyMin']],
      [{ draft: { ...ok, deadlineMin: 900 } }, ['deadlineMin']],
      [{ draft: { ...ok, deadlineMin: 99999 } }, ['deadlineMin']],
      [{ draft: { ...ok, deadlineMin: 'tomorrow' } }, ['deadlineMin']],
    ];
    const seen = new Set<string>();
    for (const [body, fields] of bodies) {
      const res = await api.post<ApiError>('/advise', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(Object.keys(res.body).sort()).toStrictEqual(['error', 'fieldErrors']);
      expect(res.body.error).toBe(INVALID_ADVISE);
      expect(Object.keys(res.body.fieldErrors ?? {}).sort(), JSON.stringify(body)).toStrictEqual(fields);
      for (const text of [res.body.error, ...Object.values(res.body.fieldErrors ?? {})]) {
        expectPlain(text, JSON.stringify(body).slice(0, 60));
        seen.add(text);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(8);
  }, T);

  it('advise: a draft with a field left out is a 200 with no options and one plain sentence naming it (#947)', async () => {
    const ok = { originBusinessId: sender.id, destinationBusinessId: recipient.id, readyMin: 960, deadlineMin: 2040 };
    const bodies: [unknown, string][] = [
      [{ draft: {} }, 'Choose a sender, a recipient and a ready time to see options.'],
      [{ draft: { ...ok, destinationBusinessId: null } }, 'Choose a recipient to see options.'],
      [{ draft: { ...ok, originBusinessId: undefined, readyMin: null } }, 'Choose a sender and a ready time to see options.'],
    ];
    for (const [body, note] of bodies) {
      const res = await api.post<AdviseResponse>('/advise', body);
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(res.body).toStrictEqual({ options: [], source: 'offline', note });
      expectPlain(note, JSON.stringify(body));
    }
  }, T);

  it('no route printed anything: not a sentence, not a draft', () => {
    expect(printed.filter((line) => /espresso|envelope|Blue Bottle|Wall St/i.test(line))).toStrictEqual([]);
  });
});
