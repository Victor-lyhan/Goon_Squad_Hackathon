// #919: Business → New delivery speaks plain words (human polish backlog, QUESTIONS 23:01, item 6).
// The sentence box, the Options card and the form's result lines say who did the work and what happened
// without "engine", "offline", "parsed" or "server", and never show "API", "ms" or a 3-digit status.
//
// Every case goes the way the page goes: the server's answer or the failed call through the model
// (requestTextModel, adviceModel, newDeliveryModel), then, where the component picks the line, through a
// static render of that component. The source rule is unchanged: Gemini is named only for `source: 'gemini'`,
// and since #960 only by the sentence box: the Options card no longer says who made the options.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdviseOption, ShipmentResponse } from '../../shared/v2/api';
import type { ParseDraft, ParseRequestResponse } from '../../shared/v2/parseRequest';
import { ApiRequestError } from '../../client/src/api/v2';
import {
  ADVICE_COPY, adviceCard, noOptions, type AdviseAsk, type AdviseDraft, type NoOptions,
} from '../../client/src/components/business/v2/adviceModel';
import { NewDeliveryFormView } from '../../client/src/components/business/v2/NewDeliveryForm';
import {
  NEEDS_INPUT_HINT, RESULT_COPY, emptyDraft, initialSubmitState, statusForError, submitReducer,
  type NewDeliveryDraft, type SubmitState, type SubmitStatus,
} from '../../client/src/components/business/v2/newDeliveryModel';
import { ParsedRequestNote, RequestTextBox } from '../../client/src/components/business/v2/RequestTextBox';
import { REQUEST_COPY, parsedRequest, readProblem } from '../../client/src/components/business/v2/requestTextModel';
import { ACME, ATLAS, BAKERY, BUSINESSES } from './business-v2-details-sample';

// ---------- The words that must not be on the page ----------

const BANNED: ReadonlyArray<{ word: string; re: RegExp }> = [
  { word: 'engine', re: /engine/i },
  { word: 'offline', re: /off-?line/i },
  { word: 'parsed', re: /\bpars(e|ed|er|es|ing)\b/i },
  { word: 'server', re: /server/i },
  { word: 'API', re: /\bapis?\b/i },
  { word: 'ms', re: /\d\s?ms\b|\bms\b/i },
  { word: 'a 3-digit status', re: /\b\d{3}\b/ },
];
const bannedIn = (text: string) => BANNED.filter((b) => b.re.test(text)).map((b) => b.word);

function expectPlain(text: string | null | undefined) {
  expect(typeof text, String(text)).toBe('string');
  expect(text!.trim().length, 'an empty line says nothing').toBeGreaterThan(0);
  expect(bannedIn(text!), text!).toEqual([]);
  expect(text!).not.toMatch(/fetch|undefined|null|NaN|\bHTTP\b/);
}

// ---------- Samples ----------

const noop = () => {};
const SENTENCE = 'Deliver an envelope from Acme Studio to Bakery Row by 10 a.m. tomorrow.';
const CONTEXT = { origin: ACME, businesses: BUSINESSES };
/** Ready Day 1 16:00, deliver by Day 2 10:00. */
const DRAFT: ParseDraft & AdviseDraft = {
  originBusinessId: ACME.id, destinationBusinessId: BAKERY.id, label: 'Envelope', category: 'envelope',
  description: 'Signed contract', weightKg: 0.2, readyMin: 960, deadlineMin: 2040,
};
const parseAnswer = (source: unknown) =>
  ({ draft: DRAFT, missing: [], rejected: null, source }) as unknown as ParseRequestResponse;
const OPTION: AdviseOption = {
  label: 'As requested', summary: 'Next-morning relay through Atlas Books.', changes: {}, kind: 'relay',
  relayBusinessId: ATLAS.id, carrierNames: ['Maya Chen', 'Luis Ortega'], deliveryMin: 1985, extraMin: 17,
  extraMiles: 2.4, customerPriceCents: 1600,
};
const card = (source: unknown) => adviceCard({ options: [OPTION], source }, { draft: DRAFT, businesses: BUSINESSES })!;

/** Every source that is not exactly the contract's 'gemini': none of them may put Gemini on the page. */
const NOT_GEMINI = ['offline', undefined, null, '', 'GEMINI', 'Gemini', 'openai', 7] as const;

const FILLED: NewDeliveryDraft = { ...emptyDraft(), recipientId: BAKERY.id, label: 'Envelope', description: 'Signed contract' };
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const inside = (html: string, className: string) =>
  [...html.matchAll(new RegExp(`<p class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)</p>`, 'g'))].map((m) => text(m[1]));

/** The form as the page draws it for a status; the alert is the one danger line (empty when there is none). */
const formHtml = (status: SubmitStatus, over: { phase?: 'planning' | 'locked'; retry?: boolean } = {}) =>
  renderToStaticMarkup(createElement(NewDeliveryFormView, {
    origin: ACME, businesses: BUSINESSES, phase: over.phase ?? 'planning', retry: over.retry, draft: FILLED, errors: {},
    status, onChange: noop, onSubmit: noop, onOpenDelivery: noop, onCancel: noop,
  }));
const formAlert = (status: SubmitStatus, over: { phase?: 'planning' | 'locked'; retry?: boolean } = {}) =>
  inside(formHtml(status, over), 'nd-result__line--danger');

const noteHtml = (source: unknown) =>
  renderToStaticMarkup(createElement(ParsedRequestNote, { parsed: parsedRequest(parseAnswer(source), CONTEXT, SENTENCE), onEdit: noop }));

const failed = (state: SubmitState, error: unknown) => submitReducer(state, { type: 'failure', error });
const sending = () => submitReducer(initialSubmitState('req-1'), { type: 'submit' });
/** A saved delivery that found no match, with "Try matching again" pressed: the state a retry's answer meets. */
const retrying = () => {
  const noMatch = { matched: false, shipment: { id: 'shp-0007' }, unmatchedReason: 'No commute passes both stops in time.' } as unknown as ShipmentResponse;
  const saved = submitReducer(sending(), { type: 'success', response: noMatch, draft: FILLED, nextRequestId: 'req-2' });
  expect(saved.retryOf?.shipmentId).toBe('shp-0007');
  return submitReducer(saved, { type: 'retry' });
};

const NO_ANSWER_ERRORS = [
  new ApiRequestError(0, 'Failed to fetch'),
  new ApiRequestError(0, 'Request timed out after 10000 ms', undefined, 'timeout'),
];
const UNAVAILABLE_CODES = ['google_key_missing', 'travel_data_missing', 'google_unavailable'] as const;
const unavailableError = (code: string) =>
  new ApiRequestError(503, 'Travel data is not available on the server (HTTP 503).', undefined, 'http', code);

// ---------- The cases ----------

describe('#919 the sentence box: who read the request', () => {
  it('source gemini: "Read by Gemini", and no second line', () => {
    const p = parsedRequest(parseAnswer('gemini'), CONTEXT, SENTENCE);
    expect(p.sourceLabel).toBe('Read by Gemini');
    expect(p.sourceLine).toBeNull();
    expectPlain(p.sourceLabel);
    const html = noteHtml('gemini');
    expect(inside(html, 'nd-parsed__source')).toEqual(['Read by Gemini']);
    expect(inside(html, 'nd-parsed__how')).toEqual([]);
  });

  it.each(NOT_GEMINI)('source %j: "Read by Relay’s rules" with one plain line, and Gemini is not named', (source) => {
    const p = parsedRequest(parseAnswer(source), CONTEXT, SENTENCE);
    expect(p.sourceLabel).toBe('Read by Relay’s rules');
    expect(p.sourceLine).toBe('No AI model was used.');
    expectPlain(p.sourceLabel);
    expectPlain(p.sourceLine);
    const html = noteHtml(source);
    expect(inside(html, 'nd-parsed__source')).toEqual([p.sourceLabel]);
    expect(inside(html, 'nd-parsed__how')).toEqual([p.sourceLine]);
    expect(html).not.toMatch(/gemini/i);
  });

  it.each(['gemini', 'offline'])('source %s: the whole card above the form is plain', (source) => {
    // Without the sentence the user typed: those words are theirs.
    const shown = text(noteHtml(source)).replace(SENTENCE, '');
    expect(bannedIn(shown), shown).toEqual([]);
    expect(shown).toContain(REQUEST_COPY.confirm);
  });
});

describe('#919 the Options card: its lines (who made the options is no longer said, #960)', () => {
  it.each(['gemini', ...NOT_GEMINI])('source %j: the card holds no line about its source, and Gemini is not named', (source) => {
    const c = card(source);
    expect(Object.keys(c).sort()).toEqual(['note', 'rows']);
    expect(JSON.stringify(c)).not.toMatch(/gemini|AI model|Priced by|Planned by/i);
  });

  it('the source changes nothing: the same rows, prices and times for either one', () => {
    const { rows: byModel } = card('gemini');
    expect(card('offline').rows).toEqual(byModel);
    expect(byModel.map((r) => [r.label, r.priceText, r.arrivalText, r.routeText])).toEqual([
      ['As requested', '$16.00', 'Day 2, 9:05 AM', 'Via Atlas Books'],
    ]);
  });

  it('the wait, a failed call and an answer with no option are plain too', () => {
    expectPlain(ADVICE_COPY.loadingLine);
    expectPlain(ADVICE_COPY.failed);
    // #948: the card stays without an option; its line, the names under it and what to do next are plain.
    const ask: AdviseAsk = { ...DRAFT };
    const lines = (n: NoOptions) => [n.note, n.lead, ...n.fields, n.next].filter((line): line is string => Boolean(line));
    for (const none of [
      noOptions({ options: [], source: 'offline' }, ask),
      noOptions({ nonsense: true }, ask),
      noOptions({ options: [], source: 'offline' }, { ...ask, destinationBusinessId: null, readyMin: null, deadlineMin: null }),
      noOptions(null, ask, { deadlineTime: 'Deliver-by must be after ready time' }),
    ]) for (const line of lines(none)) expectPlain(line);
    expectPlain(ADVICE_COPY.neededHint);
    expect(noOptions('Internal Server Error', ask).note).toBe(ADVICE_COPY.failed);
  });
});

describe('#919 no answer at all', () => {
  it.each(NO_ANSWER_ERRORS)('the sentence box (%s): what happened and what to do, not the browser\'s text', (error) => {
    const problem = readProblem(error);
    expect(problem).toEqual({ kind: 'failed', text: 'Relay did not answer, so your request was not read. Try again, or fill in the form instead.' });
    expectPlain(problem.text);
    expect(problem.text).not.toContain(error.message);
  });

  it.each(NO_ANSWER_ERRORS)('the form (%s): the request is still in the form, try again', (error) => {
    const state = failed(sending(), error);
    expect(state.status).toEqual({ kind: 'error', message: 'Relay did not answer. Your request is still in the form. Try again.', fieldErrors: {} });
    expect(state.clientRequestId).toBe('req-1'); // sending again is the same request
    const shown = formAlert(state.status);
    expect(shown).toEqual([RESULT_COPY.noAnswer]);
    expectPlain(shown[0]);
    expect(shown[0]).not.toContain(error.message);
  });
});

describe('#919 travel times unavailable', () => {
  it.each(UNAVAILABLE_CODES)('a new request (%s): not matched, nothing was saved, try again later', (code) => {
    const error = unavailableError(code);
    const state = failed(sending(), error);
    expect(state.status).toEqual({ kind: 'unavailable', code });
    const shown = formAlert(state.status);
    expect(shown).toEqual(['Travel times are not available right now, so this request could not be matched. Nothing was saved. Try again later.']);
    expectPlain(shown[0]);
    expect(shown[0]).not.toContain(error.message);
    expect(shown[0]).not.toContain(code);
    expect(shown[0]).not.toMatch(/still saved/);
  });

  it.each(UNAVAILABLE_CODES)('"Try matching again" (%s): matching did not run, the request is still saved', (code) => {
    const error = unavailableError(code);
    const state = failed(retrying(), error);
    expect(state.status).toEqual({ kind: 'unavailable', code, saved: true });
    expect(state.retryOf?.shipmentId).toBe('shp-0007'); // the next press is still a retry of the saved delivery
    const shown = formAlert(state.status, { retry: true });
    expect(shown).toEqual(['Travel times are not available right now, so matching could not run. Your request is still saved. Try again later.']);
    expectPlain(shown[0]);
    expect(shown[0]).not.toContain(error.message);
    expect(shown[0]).not.toContain(code);
    expect(shown[0]).not.toMatch(/nothing was saved/i);
  });

  it('the two lines differ only in what was saved', () => {
    expect(RESULT_COPY.unavailable).toMatch(/ Nothing was saved\. Try again later\.$/);
    expect(RESULT_COPY.unavailableRetry).toMatch(/ Your request is still saved\. Try again later\.$/);
    expect(RESULT_COPY.unavailable.split(',')[0]).toBe(RESULT_COPY.unavailableRetry.split(',')[0]);
  });
});

describe('#919 the 409 fallback: requests are closed', () => {
  const NO_TEXT = [new ApiRequestError(409, ''), new ApiRequestError(409, '   '), { status: 409 }];

  it.each(NO_TEXT)('a 409 with no sentence of its own (%j): the form says why and where to reopen', (error) => {
    expect(statusForError(error)).toEqual({ kind: 'locked' });
    const state = failed(sending(), error);
    const shown = formAlert(state.status);
    expect(shown).toEqual([RESULT_COPY.locked]);
    expectPlain(shown[0]);
    expect(shown[0]).toMatch(/Back to start/);
    expect(formHtml(state.status)).toMatch(/<button type="submit"[^>]*disabled=""/);
  });

  it('the same line in the form and in the sentence box of a started run', () => {
    expect(formAlert({ kind: 'idle' }, { phase: 'locked' })).toEqual([RESULT_COPY.locked]);
    const box = renderToStaticMarkup(createElement(RequestTextBox, {
      origin: ACME, businesses: BUSINESSES, phase: 'locked', parseRequest: () => new Promise<ParseRequestResponse>(noop),
      onParsed: noop, onFillForm: noop, onCancel: noop,
    }));
    expect(inside(box, 'nd-result__line--danger')).toEqual([RESULT_COPY.locked]);
  });
});

describe('#919 every line the three models hold', () => {
  const COPY: Record<string, Record<string, string>> = { REQUEST_COPY, ADVICE_COPY, RESULT_COPY, hints: { NEEDS_INPUT_HINT } };
  const lines = Object.entries(COPY).flatMap(([name, copy]) => Object.entries(copy).map(([key, value]) => ({ name: `${name}.${key}`, value })));

  it('is read here: the three constants and the form\'s hint', () => {
    expect(lines.length).toBeGreaterThan(35);
    for (const l of lines) expect(typeof l.value, l.name).toBe('string');
  });

  it.each(lines)('$name is plain', ({ value }) => {
    expectPlain(value);
  });

  it('names Gemini in the sentence box\'s label of a Gemini answer only', () => {
    expect(lines.filter((l) => /gemini/i.test(l.value)).map((l) => l.name).sort()).toEqual(['REQUEST_COPY.parsedByModel']);
  });

  it('keeps the labels README.md quotes', () => {
    expect(REQUEST_COPY.read).toBe('Read my request');
    expect(REQUEST_COPY.fillForm).toBe('Fill in the form instead');
    expect(ADVICE_COPY.title).toBe('Options');
    expect(formHtml({ kind: 'idle' })).toMatch(/<button type="submit"[^>]*>Find a delivery match</);
  });

  it('the check itself finds each word', () => {
    expect(bannedIn('Planned by Gemini, checked by the engine')).toEqual(['engine']);
    expect(bannedIn('Options computed offline')).toEqual(['offline']);
    expect(bannedIn('Parsed by Gemini')).toEqual(['parsed']);
    expect(bannedIn('The server did not answer.')).toEqual(['server']);
    expect(bannedIn('The API did not answer within 8000 ms (503).')).toEqual(['API', 'ms', 'a 3-digit status']);
    expect(bannedIn('Request failed (409)')).toEqual(['a 3-digit status']);
    expect(bannedIn('Ready Day 1, 4:00 PM. This takes up to 10 seconds. $16.00 for sparse terms, 2.4 mi.')).toEqual([]);
  });
});
