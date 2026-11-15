// MVP IV F1 (#786, docs/mvp4.md; DECISIONS pass 81): the pure model between POST /api/v2/parse-request and
// the New delivery form. The text box and the page in a real DOM: business-v2-request-text-dom.test.tsx.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PARSE_TEXT_MAX, type ParseDraft, type ParseRequestResponse } from '../../shared/v2/parseRequest';
import { ApiRequestError } from '../../client/src/api/v2';
import { emptyDraft, validate } from '../../client/src/components/business/v2/newDeliveryModel';
import {
  REQUEST_COPY, checkRequestText, countText, exampleRequest, isParseAnswer, parsedFields, parsedRequest,
  readProblem, senderNote, sourceLabel,
} from '../../client/src/components/business/v2/requestTextModel';
import { ACME, ATLAS, BAKERY, BUSINESSES } from './business-v2-details-sample';

const CONTEXT = { origin: ACME, businesses: BUSINESSES };
const SENTENCE = 'Deliver an envelope from Acme Studio to Bakery Row by 10 a.m. tomorrow.';

/** Everything filled: ready Day 1 16:00, deliver by Day 2 10:00. */
const FULL: ParseDraft = {
  originBusinessId: ACME.id, destinationBusinessId: BAKERY.id, label: 'Envelope', category: 'envelope',
  description: 'Signed contract', weightKg: 0.2, readyMin: 960, deadlineMin: 2040,
};
const answer = (draft: Partial<ParseDraft> = {}, over: Partial<ParseRequestResponse> = {}): ParseRequestResponse => {
  const d = { ...FULL, ...draft };
  const missing = (Object.keys(d) as (keyof ParseDraft)[]).filter((k) => d[k] === null);
  return { draft: d, missing, rejected: null, source: 'gemini', ...over };
};

describe('the source label', () => {
  it('"Read by Gemini" for gemini, "Read by Relay’s rules" for offline', () => {
    expect(sourceLabel('gemini')).toBe('Read by Gemini');
    expect(sourceLabel('offline')).toBe('Read by Relay’s rules');
  });

  it('never claims Gemini for a source it does not know', () => {
    for (const s of [undefined, null, '', 'GEMINI', 'openai', 7]) expect(sourceLabel(s)).toBe('Read by Relay’s rules');
  });
});

describe('the sender note (DECISIONS pass 81)', () => {
  it('none when the sentence names the signed-in business or no sender', () => {
    expect(senderNote(ACME.id, ACME)).toBeNull();
    expect(senderNote(null, ACME)).toBeNull();
    expect(senderNote(undefined, ACME)).toBeNull();
  });

  it('another business: the plain sentence, naming only the signed-in one', () => {
    expect(senderNote(ATLAS.id, ACME)).toBe('You are signed in as Acme Studio; this request will be sent from Acme Studio.');
  });
});

describe('parsedFields: the draft as the form takes it', () => {
  it('copies the seven form fields and leaves the sender out', () => {
    const { originBusinessId: _sender, ...rest } = FULL;
    expect(parsedFields(answer())).toEqual(rest);
    expect(parsedFields(answer({ originBusinessId: ATLAS.id }))).toEqual(rest);
  });

  it('a field listed in `missing` is null, whatever the draft holds', () => {
    const res = answer({}, { missing: ['label', 'weightKg', 'originBusinessId'] });
    expect(parsedFields(res)).toMatchObject({ label: null, weightKg: null, destinationBusinessId: BAKERY.id, description: 'Signed contract' });
  });

  it('a null or absent field is null; a broken `missing` is read as empty', () => {
    const res = { draft: { destinationBusinessId: BAKERY.id, label: null }, source: 'offline', rejected: null } as unknown as ParseRequestResponse;
    expect(parsedFields(res)).toEqual({
      destinationBusinessId: BAKERY.id, label: null, category: null, description: null, weightKg: null, readyMin: null, deadlineMin: null,
    });
  });
});

describe('parsedRequest: what the page shows for an answer', () => {
  it('a full Gemini draft: the form\'s draft, nothing to check, no notes', () => {
    const p = parsedRequest(answer(), CONTEXT, SENTENCE);
    expect(p).toEqual({
      text: SENTENCE,
      draft: {
        ...emptyDraft(), recipientId: BAKERY.id, label: 'Envelope', category: 'envelope', weightKg: '0.2',
        description: 'Signed contract', readyTime: '16:00', deadlineDay: 2, deadlineTime: '10:00',
      },
      needsInput: [],
      sourceLabel: 'Read by Gemini',
      sourceLine: null, // only an offline answer gets the plain line (#880)
      senderNote: null,
      rejected: null,
    });
    expect(validate(p.draft, ACME.id)).toEqual({}); // the form accepts it as it is
  });

  it('an offline draft with missing fields: they keep the form\'s defaults and are listed in screen order', () => {
    const p = parsedRequest(answer({ originBusinessId: null, label: null, description: null, weightKg: null }, { source: 'offline' }), CONTEXT, SENTENCE);
    expect(p.sourceLabel).toBe('Read by Relay’s rules');
    expect(p.sourceLine).toBe('No AI model was used.');
    expect(p.needsInput).toEqual(['label', 'weightKg', 'description']);
    expect(p.draft).toMatchObject({ recipientId: BAKERY.id, label: '', weightKg: emptyDraft().weightKg, description: '' });
    expect(p.senderNote).toBeNull(); // no sender in the sentence: it is the signed-in business, nothing to say
  });

  it('another sender: the note, and the draft is still this business\'s', () => {
    const p = parsedRequest(answer({ originBusinessId: ATLAS.id }), CONTEXT, SENTENCE);
    expect(p.senderNote).toBe('You are signed in as Acme Studio; this request will be sent from Acme Studio.');
    expect(p.draft.recipientId).toBe(BAKERY.id);
  });

  it('the recipient is the signed-in business itself: the stop is left to check', () => {
    const p = parsedRequest(answer({ originBusinessId: ATLAS.id, destinationBusinessId: ACME.id }), CONTEXT, SENTENCE);
    expect(p.draft.recipientId).toBe('');
    expect(p.needsInput).toEqual(['recipientId']);
  });

  it('a rejected stop: the server\'s sentence, trimmed; the stop stays empty and is listed', () => {
    const rejected = 'Stops must be businesses in the network. "12 Main Street" is not one of them.';
    const p = parsedRequest(answer({ destinationBusinessId: null }, { rejected: `  ${rejected} `, source: 'offline' }), CONTEXT, SENTENCE);
    expect(p.rejected).toBe(rejected);
    expect(p.draft.recipientId).toBe('');
    expect(p.needsInput).toEqual(['recipientId']);
    expect(parsedRequest(answer({}, { rejected: '   ' }), CONTEXT, SENTENCE).rejected).toBeNull();
  });
});

describe('the sentence before it is sent', () => {
  it('trims it; an empty one gets the contract\'s message and is not sent', () => {
    expect(checkRequestText(`  ${SENTENCE}\n`)).toEqual({ text: SENTENCE });
    expect(checkRequestText('')).toEqual({ error: 'Describe the delivery in one sentence' });
    expect(checkRequestText('  \n ')).toEqual({ error: 'Describe the delivery in one sentence' });
  });

  it('the limit is the contract\'s 500 characters after trimming', () => {
    expect(PARSE_TEXT_MAX).toBe(500);
    expect(checkRequestText('a'.repeat(500))).toEqual({ text: 'a'.repeat(500) });
    expect(checkRequestText(` ${'a'.repeat(500)} `)).toEqual({ text: 'a'.repeat(500) });
    expect(checkRequestText('a'.repeat(501))).toEqual({ error: 'Max 500 characters' });
    expect(countText('Hello')).toBe('5 / 500');
  });

  it('the example names the signed-in business as the sender and a real recipient', () => {
    expect(exampleRequest(ACME, BUSINESSES)).toBe('Deliver an envelope from Acme Studio to Atlas Books by 10 a.m. tomorrow.');
    expect(exampleRequest(BAKERY, BUSINESSES)).toBe('Deliver an envelope from Bakery Row to Acme Studio by 10 a.m. tomorrow.');
    // No directory yet: the sentence of docs/mvp4.md.
    expect(exampleRequest(ACME, [])).toBe('Deliver an envelope from Etsy to Brooklyn Roasting by 10 a.m. tomorrow.');
  });
});

describe('readProblem: a failed read', () => {
  it('a 400 goes beside the box with its fieldErrors.text', () => {
    expect(readProblem(new ApiRequestError(400, 'Invalid request', { text: 'Max 500 characters' })))
      .toEqual({ kind: 'field', text: 'Max 500 characters' });
    // Without the field: the server's message, then the contract's sentence.
    expect(readProblem(new ApiRequestError(400, 'Body must be JSON'))).toEqual({ kind: 'field', text: 'Body must be JSON' });
    expect(readProblem({ status: 400 })).toEqual({ kind: 'field', text: REQUEST_COPY.empty });
  });

  it('anything else says so plainly and names the form', () => {
    for (const e of [new ApiRequestError(500, 'boom'), new ApiRequestError(503, 'x'), new ApiRequestError(404, 'Not found'), new Error('?'), null, 'x']) {
      expect(readProblem(e)).toEqual({ kind: 'failed', text: REQUEST_COPY.failed });
    }
    expect(readProblem(new ApiRequestError(0, 'Failed to fetch'))).toEqual({ kind: 'failed', text: REQUEST_COPY.noAnswer });
    expect(readProblem(new ApiRequestError(0, 'Request timed out after 10000 ms', undefined, 'timeout'))).toEqual({ kind: 'failed', text: REQUEST_COPY.noAnswer });
    for (const text of [REQUEST_COPY.failed, REQUEST_COPY.noAnswer]) expect(text).toMatch(/fill in the form instead\.$/);
    for (const text of [REQUEST_COPY.failed, REQUEST_COPY.noAnswer]) expect(text).not.toMatch(/fetch|\d{3}|undefined/i);
  });

  it('an answer without a draft is not an answer', () => {
    expect(isParseAnswer(answer())).toBe(true);
    for (const v of [null, undefined, '', '<html>', {}, { draft: null }, { draft: 'x' }]) expect(isParseAnswer(v)).toBe(false);
  });
});

describe('the text box in newDelivery.css', () => {
  const css = readFileSync('client/src/components/business/v2/newDelivery.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector: string, within = css) =>
    new RegExp(`(?:^|[}\\s])${selector.replace(/[.+]/g, '\\$&')} \\{([^}]*)\\}`).exec(within)?.[1] ?? '';

  it('the box is large, and at 390 px it is taller than the 44 px of a form control', () => {
    expect(rule('.nd-request__text')).toMatch(/min-height: 120px;/);
    expect(rule('.nd-request__text')).toMatch(/height: auto;/);
    const narrow = css.match(/@media \(max-width: 480px\) \{([\s\S]*?)\n\}/)![1];
    // After the rule that sets every .nd-input to 44 px, so the box keeps its height.
    expect(narrow.indexOf('.nd-request__text {')).toBeGreaterThan(narrow.indexOf('.nd-input, .nd-btn {'));
    expect(rule('.nd-request__text', narrow)).toMatch(/height: auto; min-height: 132px;/);
  });

  it('the note and the form below it read as one card', () => {
    expect(rule('.nd-parsed')).toMatch(/border-bottom: 0;/);
    expect(rule('.nd-parsed + .nd')).toMatch(/border-radius: 0 0 var\(--radius, 4px\) var\(--radius, 4px\);/);
  });
});
