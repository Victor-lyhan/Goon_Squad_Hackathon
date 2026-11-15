// #948 (human bug report: "the Options card shows nothing most of the time"), the pure models.
// 1. adviceModel: the request as the form holds it (a missing recipient or time is null, not "no card"), what
//    the card says without an option, and which rejected call hides it.
// 2. requestTextModel: what the server chose or changed while reading (#947: `note` and `assumed` beside the
//    contract's fields; mocked here, the server half is its own issue) and where the page shows it.
// The card and the form in a real DOM: business-v2-dom-advice-notes.test.tsx.
import { describe, expect, it } from 'vitest';
import type { ParseDraft, ParseRequestResponse } from '../../shared/v2/parseRequest';
import { ApiRequestError } from '../../client/src/api/v2';
import {
  ADVICE_COPY, adviceCard, adviceFailure, adviseAsk, adviseDraft, askKey, askMissing, askTimes, noOptions, sameAsk,
  type AdviseAsk,
} from '../../client/src/components/business/v2/adviceModel';
import { emptyDraft, notesAfterEdit, type FieldNotes, type NewDeliveryDraft } from '../../client/src/components/business/v2/newDeliveryModel';
import {
  REQUEST_COPY, nearMissText, parseNotes, parsedFields, parsedRequest, placeNotes,
} from '../../client/src/components/business/v2/requestTextModel';
import { ACME, ATLAS, BAKERY, BUSINESSES } from './business-v2-details-sample';

const form = (over: Partial<NewDeliveryDraft> = {}): NewDeliveryDraft => ({
  ...emptyDraft(), recipientId: BAKERY.id, label: 'Envelope', description: 'Signed contract', weightKg: '0.2', ...over,
});
/** Ready Day 1 16:00, deliver by Day 2 10:00, to Bakery Row. */
const ASK: AdviseAsk = {
  originBusinessId: ACME.id, destinationBusinessId: BAKERY.id, label: 'Envelope', category: 'envelope',
  description: 'Signed contract', weightKg: 0.2, readyMin: 960, deadlineMin: 2040,
};

// The sentences the server half (#947) writes; the client only needs their shape.
const CLAMPED = 'Relay delivers by 12:00 PM tomorrow, ahead of your 5:00 PM deadline.';
const ASSUMED = 'No deliver-by time given, so Relay delivers by 12:00 PM tomorrow.';
const NEAR = 'Read "Bakry Row" as Bakery Row.';

describe('adviseAsk: the request as the form holds it now', () => {
  it('a full form is the request of adviseDraft', () => {
    expect(adviseAsk(form(), ACME.id)).toEqual(ASK);
    expect(adviseAsk(form(), ACME.id)).toEqual(adviseDraft(form(), ACME.id));
    expect(askMissing(ASK)).toEqual([]);
  });

  it('no recipient or an empty time is null and named, in screen order; the rest of the request stays', () => {
    const none = adviseAsk(form({ recipientId: '', readyTime: '', deadlineTime: '25:00' }), ACME.id);
    expect(none).toEqual({ ...ASK, destinationBusinessId: null, readyMin: null, deadlineMin: null });
    expect(askMissing(none)).toEqual(['recipientId', 'readyTime', 'deadlineTime']);
    expect(askMissing(adviseAsk(form({ recipientId: '' }), ACME.id))).toEqual(['recipientId']);
    // adviseDraft still has nothing to price for such a form.
    expect(adviseDraft(form({ recipientId: '' }), ACME.id)).toBeNull();
  });

  it('askKey changes with the recipient and the two times only: a package name never asks again', () => {
    expect(askKey(adviseAsk(form({ label: 'Other', weightKg: '1', description: '' }), ACME.id))).toBe(askKey(ASK));
    for (const over of [{ recipientId: ATLAS.id }, { recipientId: '' }, { readyTime: '15:30' }, { deadlineTime: '12:00' }, { deadlineDay: 1 as const }]) {
      expect(askKey(adviseAsk(form(over), ACME.id)), JSON.stringify(over)).not.toBe(askKey(ASK));
    }
  });

  it('sameAsk compares every field, so the page keeps one object across re-renders', () => {
    expect(sameAsk(ASK, { ...ASK })).toBe(true);
    expect(sameAsk(ASK, { ...ASK, label: 'Other' })).toBe(false);
    expect(sameAsk(ASK, { ...ASK, deadlineMin: null })).toBe(false);
  });

  it('askTimes: the times as the form holds them, null while one is missing', () => {
    expect(askTimes(ASK)).toEqual({ readyTime: '16:00', deadlineDay: 2, deadlineTime: '10:00' });
    expect(askTimes({ ...ASK, readyMin: null })).toBeNull();
    expect(askTimes({ ...ASK, deadlineMin: null })).toBeNull();
  });

  it('an option of a request without a time cannot be applied, so it is not a row', () => {
    const option = { label: 'As requested', summary: '', changes: {}, kind: 'direct', carrierNames: [], deliveryMin: 1110, extraMin: 9, extraMiles: 1, customerPriceCents: 1250 };
    expect(adviceCard({ options: [option], source: 'offline' }, { draft: { ...ASK, deadlineMin: null }, businesses: BUSINESSES })).toBeNull();
    expect(adviceCard({ options: [option], source: 'offline' }, { draft: ASK, businesses: BUSINESSES })!.rows).toHaveLength(1);
  });
});

describe('adviceFailure: only a call with no answer hides the card', () => {
  it('no answer at all: no network, a timeout, anything thrown that is not an HTTP answer', () => {
    for (const error of [
      new ApiRequestError(0, 'Failed to fetch', undefined, 'network'),
      new ApiRequestError(0, 'Request timed out after 15000 ms', undefined, 'timeout'),
      new TypeError('x is undefined'), null, undefined, 'boom',
    ]) expect(adviceFailure(error), String(error)).toEqual({ kind: 'no_answer' });
  });

  it('an HTTP error keeps the card; a 400 carries the server\'s words about the recipient or a time', () => {
    expect(adviceFailure(new ApiRequestError(500, 'Internal Server Error'))).toEqual({ kind: 'failed', refused: {} });
    expect(adviceFailure(new ApiRequestError(404, 'Not found'))).toEqual({ kind: 'failed', refused: {} });
    expect(adviceFailure(new ApiRequestError(400, 'Invalid draft', {
      destinationBusinessId: 'Choose a different business', readyMin: ' Choose a ready time inside the simulation hours ',
      deadlineMin: 'Deliver-by must be after ready time', originBusinessId: 'Choose a business from the list',
    }))).toEqual({
      kind: 'failed',
      refused: {
        recipientId: 'Choose a different business', readyTime: 'Choose a ready time inside the simulation hours',
        deadlineTime: 'Deliver-by must be after ready time',
      },
    });
    // Field words of another status are not shown.
    expect(adviceFailure(new ApiRequestError(500, 'x', { deadlineMin: 'y' }))).toEqual({ kind: 'failed', refused: {} });
  });
});

describe('noOptions: the card says why, in one line', () => {
  it('the server\'s sentence, then what can be done', () => {
    expect(noOptions({ options: [], source: 'offline', note: '  No commute passes both businesses in time.  ' }, ASK)).toEqual({
      note: 'No commute passes both businesses in time.', lead: '', fields: [], next: ADVICE_COPY.noneNext,
    });
    expect(noOptions({ options: [], source: 'gemini' }, ASK).note).toBe(ADVICE_COPY.none);
  });

  it('a missing field: the server\'s sentence, the field named under it, and that the options come by themselves', () => {
    const noRecipient = { ...ASK, destinationBusinessId: null };
    expect(noOptions({ options: [], source: 'offline', note: 'Choose a recipient to see options.' }, noRecipient)).toEqual({
      note: 'Choose a recipient to see options.', lead: 'Still needed:', fields: ['Recipient'], next: ADVICE_COPY.neededNext,
    });
    expect(ADVICE_COPY.neededNext).toBe('Fill it in below and the options load by themselves.');
  });

  it('a server that refuses such a request (a 400) or sends no sentence: the same words, from the card', () => {
    const noRecipient = { ...ASK, destinationBusinessId: null };
    for (const response of [null, { options: [], source: 'offline' }, { error: 'Invalid draft' }]) {
      expect(noOptions(response, noRecipient).note, JSON.stringify(response)).toBe('Choose a recipient to see options.');
    }
    expect(noOptions(null, { ...ASK, destinationBusinessId: null, readyMin: null })).toMatchObject({
      note: 'Choose a recipient and a ready time to see options.', fields: ['Recipient', 'Ready for pickup'],
    });
    expect(noOptions(null, { ...ASK, destinationBusinessId: null, readyMin: null, deadlineMin: null })).toMatchObject({
      note: 'Choose a recipient, a ready time and a deliver-by time to see options.',
      fields: ['Recipient', 'Ready for pickup', 'Deliver by: time'],
    });
  });

  it('a time the server could not take: its own words as a sentence, and the field to check', () => {
    expect(noOptions(null, ASK, { deadlineTime: 'Deliver-by must be after ready time' })).toEqual({
      note: 'Deliver-by must be after ready time.', lead: 'Check in the form:', fields: ['Deliver by: time'], next: ADVICE_COPY.checkNext,
    });
    expect(noOptions(null, ASK, { readyTime: 'Too early.', deadlineTime: 'Too late' })).toMatchObject({
      note: 'Too early.', fields: ['Ready for pickup', 'Deliver by: time'],
    });
  });

  it('an error with nothing to name, or a body that is no answer: the failed sentence, which says what to do itself', () => {
    for (const response of [null, { error: 'nope' }, 'Internal Server Error', 500]) {
      expect(noOptions(response, ASK), JSON.stringify(response)).toEqual({ note: ADVICE_COPY.failed, lead: '', fields: [], next: null });
    }
  });
});

// ---------- What the server chose or changed while reading (#947's fields, mocked) ----------

const FULL: ParseDraft = {
  originBusinessId: ACME.id, destinationBusinessId: BAKERY.id, label: 'Envelope', category: 'envelope',
  description: 'Signed contract', weightKg: 0.2, readyMin: 960, deadlineMin: 2160,
};
type Extras = { note?: unknown; notes?: unknown; assumed?: unknown };
const answer = (draft: Partial<ParseDraft> = {}, extras: Extras = {}): ParseRequestResponse => {
  const d = { ...FULL, ...draft };
  return {
    draft: d, missing: (Object.keys(d) as (keyof ParseDraft)[]).filter((k) => d[k] === null), rejected: null, source: 'offline', ...extras,
  } as ParseRequestResponse;
};
const CONTEXT = { origin: ACME, businesses: BUSINESSES };
const shown = (response: ParseRequestResponse) => {
  const p = parsedRequest(response, CONTEXT, 'a sentence');
  return { fieldNotes: p.fieldNotes, notes: p.notes, needsInput: p.needsInput, deadline: `${p.draft.deadlineDay} ${p.draft.deadlineTime}` };
};

describe('parseNotes: the answer\'s sentences, sorted', () => {
  it('an answer of the contract alone says nothing', () => {
    expect(parseNotes(answer(), BUSINESSES)).toEqual({ nearMisses: [], rest: null, deadlineAssumed: false });
    for (const odd of [null, undefined, 'x', { note: 7, assumed: 'deadlineMin' }, { note: '   ', notes: [null, 3] }]) {
      expect(parseNotes(odd, BUSINESSES), JSON.stringify(odd)).toEqual({ nearMisses: [], rest: null, deadlineAssumed: false });
    }
  });

  it('a misspelt name is taken out of the note; what is left is the rest', () => {
    expect(parseNotes(answer({}, { note: `${NEAR} ${CLAMPED}` }), BUSINESSES)).toEqual({
      nearMisses: [{ typed: 'Bakry Row', businessId: BAKERY.id, name: 'Bakery Row' }], rest: CLAMPED, deadlineAssumed: false,
    });
    expect(parseNotes(answer({}, { note: NEAR }), BUSINESSES).rest).toBeNull();
    // Two names, in the order of the note; other quote marks; no full stop at the end.
    expect(parseNotes({ note: 'Read “Atlas Boks” as Atlas Books. Read \'acme studo\' as Acme Studio' }, BUSINESSES).nearMisses).toEqual([
      { typed: 'Atlas Boks', businessId: ATLAS.id, name: 'Atlas Books' },
      { typed: 'acme studo', businessId: ACME.id, name: 'Acme Studio' },
    ]);
  });

  it('the longest business name wins, and a name that is not in the directory stays in the rest', () => {
    const shops = [{ id: 'biz-bb', name: 'Blue Bottle' }, { id: 'biz-bbc', name: 'Blue Bottle Coffee' }];
    expect(parseNotes({ note: 'Read "blu bottle cofee" as Blue Bottle Coffee.' }, shops).nearMisses).toEqual([
      { typed: 'blu bottle cofee', businessId: 'biz-bbc', name: 'Blue Bottle Coffee' },
    ]);
    expect(parseNotes({ note: 'Read "x" as Nowhere Deli.' }, shops)).toEqual({ nearMisses: [], rest: 'Read "x" as Nowhere Deli.', deadlineAssumed: false });
    // A name with a character that means something in a pattern.
    expect(parseNotes({ note: 'Read "century 12" as Century 21 (Downtown).' }, [{ id: 'biz-c', name: 'Century 21 (Downtown)' }]).nearMisses).toHaveLength(1);
  });

  it('`assumed` lists the deliver-by time; a list of sentences reads like one note', () => {
    expect(parseNotes(answer({}, { note: ASSUMED, assumed: ['deadlineMin'] }), BUSINESSES)).toEqual({ nearMisses: [], rest: ASSUMED, deadlineAssumed: true });
    expect(parseNotes(answer({}, { assumed: ['readyMin'] }), BUSINESSES).deadlineAssumed).toBe(false);
    expect(parseNotes({ notes: [NEAR, CLAMPED] }, BUSINESSES)).toEqual(parseNotes({ note: `${NEAR} ${CLAMPED}` }, BUSINESSES));
  });

  it('nearMissText: the business in the form, and the words it was read from', () => {
    expect(nearMissText({ typed: 'Kinshop coffee', name: 'Kinship Coffee' })).toBe('Kinship Coffee (from ‘Kinshop coffee’)');
  });
});

describe('parsedRequest: where the page shows what the server chose', () => {
  it('a deliver-by time the server moved: its sentence under the deliver-by fields, not marked', () => {
    expect(shown(answer({}, { note: CLAMPED }))).toEqual({
      fieldNotes: { deadline: { text: CLAMPED, check: false } }, notes: [], needsInput: [], deadline: '2 12:00',
    });
  });

  it('an assumed deliver-by time: the sentence, marked "(assumed, change it if needed)", and the field is one to check', () => {
    expect(shown(answer({}, { note: ASSUMED, assumed: ['deadlineMin'] }))).toEqual({
      fieldNotes: { deadline: { text: 'No deliver-by time given, so Relay delivers by 12:00 PM tomorrow (assumed, change it if needed)', check: true } },
      notes: [], needsInput: [], deadline: '2 12:00',
    });
    // Without a sentence of the server's own, the page's.
    expect(shown(answer({}, { assumed: ['deadlineMin'] })).fieldNotes).toEqual({
      deadline: { text: `${REQUEST_COPY.assumedDeadline} (assumed, change it if needed)`, check: true },
    });
    expect(REQUEST_COPY.assumed).toBe('(assumed, change it if needed)');
  });

  it('an assumed time the server also lists as missing is still the form\'s value, with the line, not "Check this"', () => {
    const response = { ...answer({}, { note: ASSUMED, assumed: ['deadlineMin'] }), missing: ['deadlineMin'] as (keyof ParseDraft)[] };
    expect(parsedFields(response).deadlineMin).toBe(2160);
    expect(shown(response)).toMatchObject({ needsInput: [], deadline: '2 12:00', fieldNotes: { deadline: { check: true } } });
    // Listed as missing and not assumed: null, as before.
    expect(parsedFields({ ...answer(), missing: ['deadlineMin'] }).deadlineMin).toBeNull();
  });

  it('a misspelt recipient: "Bakery Row (from ‘Bakry Row’)" under the Recipient', () => {
    expect(shown(answer({}, { note: NEAR }))).toMatchObject({
      fieldNotes: { recipientId: { text: 'Bakery Row (from ‘Bakry Row’)', check: false } }, notes: [],
    });
    // Together with a moved time: each under its own field.
    expect(shown(answer({}, { note: `${NEAR} ${CLAMPED}` })).fieldNotes).toEqual({
      recipientId: { text: 'Bakery Row (from ‘Bakry Row’)', check: false }, deadline: { text: CLAMPED, check: false },
    });
  });

  it('what has no field of its own is a plain line above the form', () => {
    // A misspelt sender: the form has no sender field.
    expect(shown(answer({}, { note: 'Read "acme studo" as Acme Studio.' }))).toMatchObject({ fieldNotes: {}, notes: ['Acme Studio (from ‘acme studo’)'] });
    // A sentence about something else.
    expect(shown(answer({}, { note: 'Weights are rounded to whole grams.' }))).toMatchObject({ fieldNotes: {}, notes: ['Weights are rounded to whole grams.'] });
    // A recipient the form could not take (the sender itself): the line is not under an empty field.
    expect(shown(answer({ destinationBusinessId: ACME.id }, { note: 'Read "acme studo" as Acme Studio.' }))).toMatchObject({
      fieldNotes: {}, notes: ['Acme Studio (from ‘acme studo’)'], needsInput: ['recipientId'],
    });
  });

  it('a deliver-by time the form cannot hold keeps "Check this"; the server\'s sentence moves above the form', () => {
    const p = shown(answer({ deadlineMin: 3000 }, { note: CLAMPED }));
    expect(p.needsInput).toEqual(['deadlineDay', 'deadlineTime']);
    expect(p.fieldNotes).toEqual({});
    expect(p.notes).toEqual([CLAMPED]);
  });

  it('placeNotes needs no server sentence to be about the deadline when it is assumed', () => {
    const placed = placeNotes({ nearMisses: [], rest: 'Latest slot used.', deadlineAssumed: true }, form(), []);
    expect(placed).toEqual({ fieldNotes: { deadline: { text: 'Latest slot used (assumed, change it if needed)', check: true } }, lines: [] });
  });
});

describe('notesAfterEdit: a line goes with the value it was about', () => {
  const notes: FieldNotes = { recipientId: { text: 'r', check: false }, deadline: { text: 'd', check: true } };

  it('the recipient\'s line with the recipient, the deliver-by line with its day or its time', () => {
    expect(notesAfterEdit(notes, 'recipientId')).toEqual({ recipientId: undefined, deadline: notes.deadline });
    expect(notesAfterEdit(notes, 'deadlineDay')).toEqual({ recipientId: notes.recipientId, deadline: undefined });
    expect(notesAfterEdit(notes, 'deadlineTime')).toEqual({ recipientId: notes.recipientId, deadline: undefined });
  });

  it('any other field leaves the same object, so nothing re-renders', () => {
    for (const f of ['label', 'weightKg', 'readyTime', 'description'] as const) expect(notesAfterEdit(notes, f)).toBe(notes);
    expect(notesAfterEdit({}, 'recipientId')).toEqual({});
  });
});
