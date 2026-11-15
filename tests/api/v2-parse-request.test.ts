// POST /api/v2/parse-request on the real server (createV2Runtime, the sample travel cache, the committed NYC
// businesses): one sentence in, a draft out (docs/mvp4.md F1, shared/v2/parseRequest.ts).
// The route only reads: no request here may change the run, its version or the state file, also while the
// run is locked. No key, no network (the helper's `fetch` throws), nothing outside the temp folder.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { z } from 'zod';
import { parseOffline } from '../../server/ai/ruleParser';
import { INVALID_PARSE_REQUEST, PARSE_TEXT_REQUIRED } from '../../server/api/v2/parseRequestRoutes';
import { ParseRequestBody, PARSE_TEXT_MAX, type ParseRequestResponse } from '../../shared/v2/parseRequest';
import { ApiError } from '../../shared/v2/schemas';
import type { Run as RunV2 } from '../../shared/v2/types';
import type { Store } from '../../server/store';
import { T, noNetwork, startBootstrapApi, type Answer, type BootstrapApi } from './v2-bootstrap-helper';

const EXAMPLE = 'Deliver an envelope from Etsy to Brooklyn Roasting by 10 a.m. tomorrow.';

// shared/v2 has no response schema (responses are types), so the tests check every 200 against this strict
// copy of `ParseRequestResponse`: a key the contract does not have fails the parse.
const minute = z.number().int().min(0).max(2880);
const DRAFT_KEYS = [
  'originBusinessId', 'destinationBusinessId', 'label', 'category', 'description', 'weightKg', 'readyMin', 'deadlineMin',
] as const;
const ResponseSchema = z.strictObject({
  draft: z.strictObject({
    originBusinessId: z.string().nullable(),
    destinationBusinessId: z.string().nullable(),
    label: z.string().nullable(),
    category: z.enum(['envelope', 'small_box']).nullable(),
    description: z.string().nullable(),
    weightKg: z.number().nullable(),
    readyMin: minute.nullable(),
    deadlineMin: minute.nullable(),
  }),
  missing: z.array(z.enum(DRAFT_KEYS)),
  rejected: z.string().nullable(),
  source: z.enum(['gemini', 'offline']),
});
// Compile-time: the schema and the contract type describe the same object, in both directions.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const schemaMatchesContract: Same<z.infer<typeof ResponseSchema>, ParseRequestResponse> = true;

const StrictApiError = ApiError.strict();

let api: BootstrapApi | null = null;
let network: ReturnType<typeof noNetwork>;

async function start(): Promise<{ api: BootstrapApi; store: Store<RunV2> }> {
  network = noNetwork();
  api = await startBootstrapApi({ cache: 'sample', fetch: network.fetch });
  if (!api.store) throw new Error('/api/v2 did not load on the sample cache');
  return { api, store: api.store };
}
afterEach(async () => {
  await api?.close();
  api = null;
}, T);

const post = (body?: unknown) => (api as BootstrapApi).v2.post('/parse-request', body);

/** A 200 in the contract's shape, about businesses of the run only. */
function expectDraft(answer: Answer, run: RunV2): ParseRequestResponse {
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  expect(answer.headers.get('content-type')).toMatch(/^application\/json\b/);
  const body: ParseRequestResponse = ResponseSchema.parse(answer.body);
  expect(body.missing).toEqual(DRAFT_KEYS.filter((key) => body.draft[key] === null));
  const ids = run.scenario.businesses.map((b) => b.id);
  for (const id of [body.draft.originBusinessId, body.draft.destinationBusinessId]) {
    if (id !== null) expect(ids).toContain(id);
  }
  return body;
}

function expectRefused(answer: Answer, message: string) {
  expect(answer.status, JSON.stringify(answer.body)).toBe(400);
  expect(answer.headers.get('content-type')).toMatch(/^application\/json\b/);
  expect(StrictApiError.parse(answer.body)).toEqual({ error: INVALID_PARSE_REQUEST, fieldErrors: { text: message } });
}

/** The run right now (the very object) and a deep copy, to prove later that nothing was stored. */
const remember = (store: Store<RunV2>) => ({ run: store.get(), copy: structuredClone(store.get()) });
function expectUntouched(store: Store<RunV2>, before: ReturnType<typeof remember>) {
  expect(store.get()).toBe(before.run);       // no mutation was committed
  expect(store.get()).toEqual(before.copy);   // and nothing was changed in place
  expect(store.get().version).toBe(before.copy.version);
}

describe('POST /api/v2/parse-request', () => {
  it('answers 200 with the draft of the docs/mvp4.md example, parsed offline', async () => {
    const { store } = await start();
    const run = store.get();
    expect(run.clock.timeMin).toBe(run.scenario.settings.simStartMin);

    const body = expectDraft(await post({ text: EXAMPLE }), run);

    expect(body).toEqual({
      draft: {
        originBusinessId: 'biz-etsy',
        destinationBusinessId: 'biz-brooklyn-roasting',
        label: 'Envelope',
        category: 'envelope',
        description: null,
        weightKg: null,
        readyMin: run.clock.timeMin,   // the clock's minute (Day 1 15:30 = 930)
        deadlineMin: 2040,             // Day 2 10:00
      },
      missing: ['description', 'weightKg'],
      rejected: null,
      source: 'offline',
    });
    expect(run.clock.timeMin).toBe(930);
    // The route is the pure parser on the run's businesses and clock.
    expect(body).toEqual(parseOffline(EXAMPLE, { businesses: run.scenario.businesses, nowMin: run.clock.timeMin }));
  }, T);

  it('the draft, once its missing fields are filled in, is a request POST /shipments stores', async () => {
    const { api: server, store } = await start();
    const { draft, missing } = expectDraft(await post({ text: EXAMPLE }), store.get());
    expect(missing).toEqual(['description', 'weightKg']);

    const sent = await server.v2.post('/shipments', {
      ...draft, clientRequestId: 'parse-request-test-1', description: 'Signed papers', weightKg: 0.2,
    });

    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.shipment).toMatchObject({
      originBusinessId: 'biz-etsy', destinationBusinessId: 'biz-brooklyn-roasting', label: 'Envelope',
      category: 'envelope', readyMin: 930, deadlineMin: 2040, weightGrams: 200,
    });
  }, T);

  // #827: the sentence of the F1 browser check (#807) that came back with an empty Package name and Contents.
  it('a sentence with no package word: what is sent is the package name and the contents, and the Type stays open', async () => {
    const { api: server, store } = await start();
    const run = store.get();
    const text = 'Send espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow.';

    const body = expectDraft(await post({ text }), run);

    expect(body).toEqual({
      draft: {
        originBusinessId: null,
        destinationBusinessId: 'biz-blue-bottle-wall',
        label: 'Espresso blend samples',
        category: null,                // the Type is the user's choice
        description: 'Espresso blend samples',
        weightKg: null,
        readyMin: 930,
        deadlineMin: 2040,
      },
      missing: ['originBusinessId', 'category', 'weightKg'],
      rejected: null,
      source: 'offline',
    });
    expect(body).toEqual(parseOffline(text, { businesses: run.scenario.businesses, nowMin: run.clock.timeMin }));

    const weighed = expectDraft(await post({ text: 'Send 2 kg of coffee beans to Etsy.' }), run);
    expect(weighed.draft).toMatchObject({
      destinationBusinessId: 'biz-etsy', label: 'Coffee beans', category: null, description: 'Coffee beans', weightKg: 2,
    });

    // With the sender, the Type and the weight filled in on the card, the draft is a request POST /shipments stores.
    const sent = await server.v2.post('/shipments', {
      ...body.draft, clientRequestId: 'parse-request-test-827', originBusinessId: 'biz-brooklyn-roasting',
      category: 'small_box', weightKg: 0.5,
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.shipment).toMatchObject({
      originBusinessId: 'biz-brooklyn-roasting', destinationBusinessId: 'biz-blue-bottle-wall',
      label: 'Espresso blend samples', description: 'Espresso blend samples', category: 'small_box',
      readyMin: 930, deadlineMin: 2040, weightGrams: 500,
    });
  }, T);

  it('never changes the run, its version or the state file, whatever it answers', async () => {
    const { api: server, store } = await start();
    const before = remember(store);
    const exported = JSON.stringify((await server.v2.get('/scenario/export')).body);

    const bodies: unknown[] = [
      { text: EXAMPLE },
      { text: 'Deliver an envelope from Etsy to my home by noon' },   // a refused stop
      { text: 'hello' },                                              // nothing recognised
      { text: '' }, { text: 'x'.repeat(PARSE_TEXT_MAX + 1) }, {}, [], undefined,   // 400s
    ];
    for (const body of bodies) {
      const answer = await post(body);
      expect([200, 400]).toContain(answer.status);
      expectUntouched(store, before);
    }
    // Ten at once: still nothing stored.
    const together = await Promise.all(Array.from({ length: 10 }, () => post({ text: EXAMPLE })));
    expect(together.map((answer) => answer.status)).toEqual(Array(10).fill(200));
    expectUntouched(store, before);

    await store.flush();
    expect(fs.existsSync(server.repo.statePath)).toBe(false);   // a fresh run is only written by a change
    expect(JSON.stringify((await server.v2.get('/scenario/export')).body)).toBe(exported);
    expect((await server.v2.get('/simulator')).body.version).toBe(before.copy.version);
    expect(network.calls).toEqual([]);                          // and nothing left the machine
  }, T);

  it('works while the run is locked, and still stores nothing', async () => {
    const { api: server, store } = await start();
    const played = await server.v2.post('/simulator/control', { action: 'play' });
    expect(played.status).toBe(200);
    await server.v2.post('/simulator/control', { action: 'pause' });
    expect(store.get().clock.phase).toBe('locked');
    // A new delivery is refused now; the sentence is still read.
    const before = remember(store);

    const body = expectDraft(await post({ text: EXAMPLE }), store.get());

    expect(body.draft).toMatchObject({
      originBusinessId: 'biz-etsy', destinationBusinessId: 'biz-brooklyn-roasting', category: 'envelope',
      readyMin: Math.floor(before.copy.clock.timeMin), deadlineMin: 2040,
    });
    expect(body.source).toBe('offline');
    expectUntouched(store, before);
    expect(store.get().clock.phase).toBe('locked');
  }, T);

  it('a stop that is not a network business is refused in a plain sentence, with a 200', async () => {
    const { store } = await start();

    const home = expectDraft(await post({ text: 'Deliver an envelope from Etsy to my home by noon' }), store.get());
    expect(home.rejected).toBe('Relay delivers only between network businesses. "my home" is not one of them.');
    expect(home.draft).toMatchObject({ originBusinessId: 'biz-etsy', destinationBusinessId: null });
    expect(home.missing).toContain('destinationBusinessId');

    const address = expectDraft(await post({ text: 'Send a box from 350 5th Avenue to JetBlue' }), store.get());
    expect(address.rejected).toBe('Relay delivers only between network businesses. "350 5th Avenue" is not one of them.');
    expect(address.draft).toMatchObject({ originBusinessId: null, destinationBusinessId: 'biz-jetblue' });
    expect(address.missing).toContain('originBusinessId');
  }, T);

  it('reads the businesses and the clock of the run as it is now', async () => {
    const { store } = await start();
    // What an import or a preview does: another name for a business, the clock at Day 1 10:00.
    await store.mutate((run) => {
      const etsy = run.scenario.businesses.find((b) => b.id === 'biz-etsy');
      if (!etsy) throw new Error('the run has no biz-etsy');
      etsy.name = 'Handmade Headquarters';
      run.clock.timeMin = 600;
    });
    const before = remember(store);

    const renamed = expectDraft(await post({ text: 'A box from Handmade Headquarters to JetBlue by noon' }), store.get());
    expect(renamed.draft).toMatchObject({
      originBusinessId: 'biz-etsy', destinationBusinessId: 'biz-jetblue', readyMin: 600, deadlineMin: 720,
    });

    const gone = expectDraft(await post({ text: 'A box from Etsy to JetBlue by noon' }), store.get());
    expect(gone.draft.originBusinessId).toBeNull();
    expect(gone.rejected).toBe('Relay delivers only between network businesses. "Etsy" is not one of them.');
    expectUntouched(store, before);
  }, T);

  it('the text is trimmed: 500 characters pass, also with blanks around them', async () => {
    const { store } = await start();
    const longest = `${EXAMPLE} ${'x'.repeat(PARSE_TEXT_MAX - EXAMPLE.length - 1)}`;
    expect(longest).toHaveLength(500);

    for (const text of [longest, `   ${longest}\n\t `, `  ${EXAMPLE}  `]) {
      const body = expectDraft(await post({ text }), store.get());
      expect(body.draft).toMatchObject({ originBusinessId: 'biz-etsy', destinationBusinessId: 'biz-brooklyn-roasting' });
    }
    // Keys the contract does not have are ignored, like on the other v2 routes.
    expectDraft(await post({ text: EXAMPLE, source: 'gemini', draft: { originBusinessId: 'biz-jetblue' } }), store.get());
  }, T);

  it.each<[string, unknown, string]>([
    ['an empty text', { text: '' }, PARSE_TEXT_REQUIRED],
    ['a text of blanks only', { text: ' \n\t ' }, PARSE_TEXT_REQUIRED],
    ['a 501-character text', { text: 'x'.repeat(501) }, 'Max 500 characters'],
    ['a 501-character sentence', { text: `${EXAMPLE} ${'and more '.repeat(60)}`.slice(0, 501) }, 'Max 500 characters'],
    ['no text field', {}, PARSE_TEXT_REQUIRED],
    ['a text that is a number', { text: 42 }, PARSE_TEXT_REQUIRED],
    ['a text that is null', { text: null }, PARSE_TEXT_REQUIRED],
    ['a text that is a list', { text: [EXAMPLE] }, PARSE_TEXT_REQUIRED],
    ['a body that is a list', [{ text: EXAMPLE }], PARSE_TEXT_REQUIRED],
    ['no body', undefined, PARSE_TEXT_REQUIRED],
  ])('answers 400 with the v2 error body for %s', async (_name, body, message) => {
    const { store } = await start();
    const before = remember(store);
    const answer = await post(body);
    expectRefused(answer, message);
    expect(JSON.stringify(answer.body)).not.toContain('xxxxx');   // the text is never repeated
    expectUntouched(store, before);
  }, T);

  it('only POST is a route: the other methods are a JSON 404', async () => {
    const { api: server } = await start();
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      const answer = await server.call(method, '/api/v2/parse-request', method === 'GET' ? undefined : { text: EXAMPLE });
      expect(answer.status, method).toBe(404);
      expect(answer.body).toEqual({ error: 'Not found' });
    }
  }, T);

  it('without travel data it answers the 503 of every /api/v2 route', async () => {
    api = await startBootstrapApi({ cache: 'empty' });
    const answer = await post({ text: EXAMPLE });
    expect(answer.status).toBe(503);
    expect(answer.body.code).toBe('travel_data_missing');
  }, T);
});

describe('ParseRequestBody', () => {
  it('trims, and accepts 1 to 500 characters', () => {
    expect(ParseRequestBody.parse({ text: '  hello  ' })).toEqual({ text: 'hello' });
    expect(ParseRequestBody.safeParse({ text: 'x' }).success).toBe(true);
    expect(ParseRequestBody.safeParse({ text: 'x'.repeat(500) }).success).toBe(true);
    expect(ParseRequestBody.safeParse({ text: ` ${'x'.repeat(500)} ` }).success).toBe(true);
    expect(ParseRequestBody.safeParse({ text: 'x'.repeat(501) }).success).toBe(false);
    expect(ParseRequestBody.safeParse({ text: '   ' }).success).toBe(false);
    expect(ParseRequestBody.safeParse({}).success).toBe(false);
    expect(PARSE_TEXT_MAX).toBe(500);
  });
});
