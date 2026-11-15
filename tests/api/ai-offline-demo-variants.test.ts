// #898: the demo must work with no Gemini key, and with Gemini paused after a failure (#884). This file sends
// the README's demo sentence and the close variants a presenter might type live to POST /api/v2/parse-request
// and POST /api/v2/advise of the real server on fixtures/nyc, with no key, and checks three things:
//   1. every variant either fills a field correctly or leaves it null (listed in `missing`, which the form
//      shows as "Check this: not in your request"); no address, time or weight is ever made up;
//   2. the options for the demo sentence are the engine's candidates (#959: the fastest, the cheapest, the
//      balanced one): each price is `customerPriceCents()` of its plan, the request as typed costs the README's
//      $9.50, and the answer says it is offline;
//   3. every text the two routes write for a problem is one plain sentence.
// The server is `createV2Runtime` with no Google key and no Gemini settings (v2-e2e-nyc-helper.ts), and
// `globalThis.fetch` is a recorder: a call that is not to the test server (to Gemini, say) fails the test.
// Both routes only read the run, so one server serves the whole file.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { adviceCard } from '../../client/src/components/business/v2/adviceModel';
import { draftFromParsed, NEEDS_INPUT_HINT } from '../../client/src/components/business/v2/newDeliveryModel';
import { advise as adviseCore, adviseOffline, candidateSet } from '../../server/ai/advisor';
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

/**
 * #954: the demo sentence has no direct plan (every direct trip is over its carrier's added-time limit), so its
 * options say so next to the relay.
 */
const NO_DIRECT = 'No direct: a direct trip would be a longer detour than its carrier allows.';

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

describe('POST /api/v2/advise with no key: priced options for the demo sentence (#898, #959)', () => {
  it('the demo sentence: the fastest and cheapest plan as typed at the README\'s $9.50, every price the engine\'s, and it says it is offline', async () => {
    const draft = await draftOnSenderPage(DEMO_SENTENCE);
    const body = await advise(draft);

    expect(body.options.length).toBeGreaterThanOrEqual(1);
    expect(body.options.length).toBeLessThanOrEqual(3);
    expect(body.note).toBe(NO_DIRECT);
    expectPlain(body.note, 'the note');
    // Every option's price is customerPriceCents() of the engine's candidate it names.
    const priced = expectEnginePrices(store.get(), travel, draft, body);
    expect(priced).toHaveLength(body.options.length);
    const [first] = body.options;
    expect(first.changes).toStrictEqual({});
    expect(first.tags).toStrictEqual(['fastest', 'cheapest']);
    expect(first.label).toBe('Fastest and cheapest: Relay via Etsy, $9.50');
    expect(money(first.customerPriceCents)).toBe('$9.50');
    expect(readme).toContain('price: $9.50');
    expect(first.summary).toContain('$9.50.');

    // Offline: the answer's `source` says so. The Options card no longer turns it into a line (#960): it
    // shows the tags as badges and names each row without their words.
    expect(body.source).toBe('offline');
    const card = adviceCard(body, { draft, businesses: store.get().scenario.businesses });
    if (!card) throw new Error('the Options card shows nothing for the demo sentence');
    expect(Object.keys(card).sort()).toStrictEqual(['note', 'rows']);
    expect(card.rows[0]).toMatchObject({ tags: ['fastest', 'cheapest'], label: 'Relay via Etsy, $9.50' });
    expect(card.rows.map((row) => row.priceText)).toStrictEqual(body.options.map((o) => money(o.customerPriceCents)));
  }, T);

  it('the demo sentence has one price: every candidate is a relay at $9.50, so the fastest is also the cheapest', async () => {
    // Its window is exactly the 18 hours of the flexibility discount, and every plan is a relay (via Etsy or Titan Foods).
    const draft = await draftOnSenderPage(DEMO_SENTENCE);
    const run = store.get();
    expect(draft.deadlineMin - draft.readyMin).toBe(run.scenario.settings.flexWindowMin);
    const engine = advisorEngine(run, travel, draft);
    const { candidates, variant } = candidateSet(engine);
    expect(variant.changes).toStrictEqual({});
    expect(candidates.length).toBeGreaterThan(1);
    expect(new Set(candidates.map((c) => `${c.option.kind} ${c.option.customerPriceCents}`))).toStrictEqual(new Set(['relay 950']));

    const body = await advise(draft);
    expect(body.options.map((o) => [o.tags, o.changes, o.customerPriceCents])).toStrictEqual([
      [['fastest', 'cheapest'], {}, 950], [['balanced'], {}, 950],
    ]);
    expect(body).toStrictEqual(adviseOffline(engine));
  }, T);

  it('"by 9am tomorrow": no discount as typed, every option $10.50, and no what-if while the request as typed has a plan', async () => {
    const draft = await draftOnSenderPage(VARIANTS[1].text);
    expect(draft.deadlineMin).toBe(1980);
    const body = await advise(draft);

    expect(body.note).toBe(NO_DIRECT);
    expect(body.options.map((o) => [o.tags, o.changes, money(o.customerPriceCents)])).toStrictEqual([
      [['fastest', 'cheapest'], {}, '$10.50'], [['balanced'], {}, '$10.50'],
    ]);
    const priced = expectEnginePrices(store.get(), travel, draft, body);
    expect(priced.map((p) => p.flexible)).toStrictEqual([false, false]);
    const card = adviceCard(body, { draft, businesses: store.get().scenario.businesses });
    // The card shows the server's tags as badges (#960), also when both rows cost the same.
    expect(card?.rows.map((row) => [row.priceText, row.tags])).toStrictEqual([['$10.50', ['fastest', 'cheapest']], ['$10.50', ['balanced']]]);
  }, T);

  it('"by 8 this evening": no commute arrives that day, so the options are for a later deliver-by and the note says why', async () => {
    const draft = await draftOnSenderPage(VARIANTS[5].text);
    expect(draft.deadlineMin).toBe(1200);
    const body = await advise(draft);

    expect(body.options.length).toBeGreaterThan(0);
    expect(body.options.every((o) => o.changes.deadlineMin === 2040 && o.customerPriceCents === 950)).toBe(true);
    expect(body.options[0].tags).toStrictEqual(['fastest', 'cheapest']);
    expectEnginePrices(store.get(), travel, draft, body);
    expect(body.note).toBe('As typed, no commute can arrive before the deadline.');
    expectPlain(body.note, 'the note');
  }, T);

  it('with a key and a Gemini that fails, the options are the same offline ones', async () => {
    const draft = await draftOnSenderPage(DEMO_SENTENCE);
    const body = await advise(draft);
    let asked = 0;
    const fetchImpl: FetchLike = () => { asked += 1; return Promise.reject(new Error('no Gemini here')); };

    const outcome = await adviseCore(
      advisorEngine(store.get(), travel, draft), { apiKey: 'AQ.FAKE_demo-variants-key', model: 'gemini-2.5-flash', fetchImpl },
    );

    expect(outcome).toStrictEqual({ response: body, by: 'network error' });
    expect(asked).toBe(1);
  }, T);
});

// ---------- the #947 bug report ----------

describe('the sentence of the #947 bug report, typed on Titan Foods\' page: a misspelt recipient, a deliver-by after the window', () => {
  const HUMAN = 'deliver a box of cookies to Kinshop coffee by tomorrow 5pm';
  const NO_DEADLINE = 'deliver a box of cookies to Kinshop coffee';
  const READ_AS = 'Read "Kinshop coffee" as Kinship Coffee.';
  const CLAMPED = 'Relay delivers by 12:00 PM tomorrow, ahead of your 5:00 PM deadline.';
  const ASSUMED = 'No deliver-by time given, so Relay delivers by 12:00 PM tomorrow.';
  /** #954: why the options of Titan Foods -> Kinship Coffee have no relay next to the direct one. */
  const NO_RELAY = 'No relay: a relay would add more than 12 minutes to a commute.';

  const business = (id: string) => {
    const found = store.get().scenario.businesses.find((b) => b.id === id);
    if (!found) throw new Error(`the default run has no ${id}`);
    return found;
  };

  /** What a mocked Gemini answers to the sentence when it reads every word right (5pm tomorrow = 2460). */
  const geminiRead = (deadlineMin: number | null) => ({
    originBusinessId: null, destinationBusinessId: 'biz-kinship-coffee', label: 'Box', category: 'small_box',
    description: 'Cookies', weightKg: null, readyMin: null, deadlineMin, rejected: [],
  });

  async function parsedByGemini(text: string, answer: unknown) {
    const { businesses, settings } = store.get().scenario;
    const fetchImpl: FetchLike = async () => ({
      status: 200,
      text: async () => JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(answer) }] }, finishReason: 'STOP' }] }),
    });
    const outcome = await parseWithGeminiUnlessPaused(
      text, { businesses, nowMin: CLOCK_MIN, windowStartMin: settings.simStartMin, windowEndMin: settings.simEndMin },
      { apiKey: 'AQ.FAKE_demo-variants-key', model: 'gemini-2.5-flash', fetchImpl },
    );
    if (!outcome.ok) throw new Error(outcome.message);
    return outcome.response;
  }

  it('parses offline to Kinship Coffee with the deliver-by moved to the window end, and says both', async () => {
    expect(business('biz-titan-foods').name).toBe('Titan Foods');
    expect(business('biz-kinship-coffee').name).toBe('Kinship Coffee');
    const body = await parse(HUMAN);
    expect(body.draft).toMatchObject({ originBusinessId: null, destinationBusinessId: 'biz-kinship-coffee', readyMin: CLOCK_MIN, deadlineMin: 2160 });
    expect(body.rejected).toBeNull();
    expect(body).toMatchObject({ note: `${READ_AS} ${CLAMPED}` });
    expect(body).not.toHaveProperty('assumed');
    // On Titan Foods' page the sender is the signed-in business: only the weight is left to fill in.
    const { needsInput } = draftFromParsed(body.draft, { originId: 'biz-titan-foods', businesses: store.get().scenario.businesses });
    expect(needsInput).not.toContain('recipientId');
    expect(needsInput).not.toContain('deadlineTime');
  }, T);

  it('parses the same with a mocked Gemini', async () => {
    const offline = await parse(HUMAN);
    const gemini = await parsedByGemini(HUMAN, geminiRead(2460));
    expect(gemini.source).toBe('gemini');
    expect(gemini.draft).toMatchObject({ destinationBusinessId: 'biz-kinship-coffee', readyMin: CLOCK_MIN, deadlineMin: 2160 });
    expect(gemini.note).toBe(`${READ_AS} ${CLAMPED}`);
    expect(gemini.note).toBe((offline as typeof gemini).note);
    // Gemini left the misspelt stop open: the sentence still fills it.
    const open = await parsedByGemini(HUMAN, { ...geminiRead(2460), destinationBusinessId: null, rejected: ['Kinshop coffee'] });
    expect(open.draft.destinationBusinessId).toBe('biz-kinship-coffee');
    expect(open.rejected).toBeNull();
  }, T);

  it('with no deliver-by the window end is assumed, offline and with a mocked Gemini', async () => {
    const offline = await parse(NO_DEADLINE);
    const gemini = await parsedByGemini(NO_DEADLINE, geminiRead(null));
    for (const body of [offline, gemini]) {
      expect(body.draft, body.source).toMatchObject({ destinationBusinessId: 'biz-kinship-coffee', deadlineMin: 2160 });
      expect(body, body.source).toMatchObject({ note: `${READ_AS} ${ASSUMED}`, assumed: ['deadlineMin'] });
      expect(body.missing, body.source).not.toContain('deadlineMin');
    }
  }, T);

  // Before #947 /advise answered 400 for both (a deliver-by after the window, or none), and the card showed no
  // options. Ready at the clock (the window start) and the deliver-by at the window end is the widest window
  // the run has: no earlier ready time or later deliver-by exists to try, so the one option is the deal.
  // #954: it is the best direct plan, and the note says why there is no relay next to it.
  it.each([
    ['the sentence, its deliver-by sent as typed (5 PM tomorrow)', HUMAN, 2460, CLAMPED],
    ['the sentence, its deliver-by sent as parsed', HUMAN, 2160, undefined],
    ['the sentence with no deliver-by, sent without one', NO_DEADLINE, null, ASSUMED],
    ['the sentence with no deliver-by, sent as parsed', NO_DEADLINE, 2160, undefined],
  ])('/advise prices %s from Titan Foods: the direct option, as typed, with the notes', async (_name, text, deadlineMin, note) => {
    const { draft } = await parse(text);
    const sent = { ...draft, originBusinessId: 'biz-titan-foods', deadlineMin };
    const body = await advise(sent);
    expect(body.options.map((o) => [o.label, o.kind, o.changes, money(o.customerPriceCents)]))
      .toStrictEqual([['Fastest and cheapest: Direct with Theo Martin, $6.00', 'direct', {}, '$6.00']]);
    expect(body.note).toBe(note === undefined ? NO_RELAY : `${note} ${NO_RELAY}`);
    if (note !== undefined) expectPlain(note, 'the note');
    expectPlain(NO_RELAY, 'the relay note');
    expectEnginePrices(store.get(), travel, { ...sent, deadlineMin: 2160 } as ParseDraft & DraftTimes, body);
  }, T);

  it('/advise for the same two businesses, ready at 6 PM, by 10 AM tomorrow: the direct plan as typed, and no what-if', async () => {
    const text = 'deliver a box of cookies to Kinshop coffee by 10 a.m. tomorrow, ready at 6 p.m.';
    const { draft, note } = await parse(text) as ParseRequestResponse & { note?: string };
    expect(note).toBe(READ_AS);
    expect(draft).toMatchObject({ destinationBusinessId: 'biz-kinship-coffee', readyMin: 1080, deadlineMin: 2040 });
    const sent = { ...draft, originBusinessId: 'biz-titan-foods' } as ParseDraft & DraftTimes;
    const body = await advise(sent);
    expect(body.options.map((o) => [o.label, o.changes, money(o.customerPriceCents)])).toStrictEqual([
      ['Fastest and cheapest: Direct with Theo Martin, $7.00', {}, '$7.00'],
    ]);
    expect(body.note).toBe(NO_RELAY);
    expectEnginePrices(store.get(), travel, sent, body);
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
      // No what-if has a plan either: no option, and the note says more time did not help.
      const none = adviseOffline({ ...real, candidates: () => ({ plans: [], reasons: { direct: reason, relay: reason }, reason }) });
      expect(none.options).toStrictEqual([]);
      expect(none.note).toBe(`Even with more time, ${reason.charAt(0).toLowerCase()}${reason.slice(1)}.`);
      expectPlain(none.note, reason, MAX_WORDS + 1); // "about 14": the longest reason makes 15
      // Only the request as typed does not: the note says so, and the option below it is the way out.
      const some = adviseOffline({
        ...real,
        candidates: (readyMin, deadlineMin) => (deadlineMin === draft.deadlineMin
          ? { plans: [], reasons: {}, reason } : real.candidates(readyMin, deadlineMin)),
      });
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
