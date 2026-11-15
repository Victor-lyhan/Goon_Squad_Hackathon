// Pure model for the Business "New delivery" text box (MVP IV F1, docs/mvp4.md; DECISIONS pass 81).
// No React, no fetch: tested in Node. It turns the answer of POST /api/v2/parse-request into what the
// existing New delivery form opens with (`draftFromParsed`), plus the lines shown above that form.
// Nothing about matching is decided here, and nothing is sent: the form's own button does that.
import { PARSE_TEXT_MAX, ParseRequestBody, type ParseRequestResponse } from '../../../../../shared/v2/parseRequest';
import type { NetworkBusiness } from '../../../../../shared/v2/types';
import {
  draftFromParsed, recipientOptions, type DraftField, type FieldNotes, type NewDeliveryDraft, type ParsedFields,
} from './newDeliveryModel';

export { PARSE_TEXT_MAX };

/** The server falls back to its own rules after 6 s (docs/mvp4.md F1), so the page waits a little longer. */
export const PARSE_TIMEOUT_MS = 10_000;

export const REQUEST_COPY = {
  label: 'Describe the delivery',
  hint: 'One sentence: what to send, to which business and by when. Stops must be businesses in the network.',
  read: 'Read my request',
  reading: 'Reading…',
  /**
   * The line beside the disabled button while the server reads (#880): the wait is at most the 6 s the
   * model gets before the server's own rules take over (docs/mvp4.md F1), so the line says what happens and how long.
   */
  readingLine: 'Reading your request. This takes a few seconds at most.',
  fillForm: 'Fill in the form instead',
  edit: 'Edit request',
  /**
   * Who read the sentence (#919: plain words, so no "parsed" and no "offline"). The keys keep the names of
   * the contract's two `source` values; the second label is for every source but 'gemini'.
   */
  parsedByModel: 'Read by Gemini',
  parsedOffline: 'Read by Relay’s rules',
  /**
   * One plain line under "Read by Relay’s rules" (#880): what that means for the user. Not shown when the
   * model read the sentence, and it does not name the model: a card without it never does.
   */
  offlineLine: 'No AI model was used.',
  /** Under the source label: the form below is the confirmation card, and only its button sends. */
  confirm: 'Check the details below. Nothing is sent until you press Find a delivery match.',
  failed: 'Your request could not be read. Try again, or fill in the form instead.',
  noAnswer: 'Relay did not answer, so your request was not read. Try again, or fill in the form instead.',
  empty: 'Describe the delivery in one sentence',
  /** After the line about a deliver-by time the sentence did not give (#948): it is the server's, not the user's. */
  assumed: '(assumed, change it if needed)',
  /** The line about an assumed deliver-by time when the server sent no sentence of its own. */
  assumedDeadline: 'No deliver-by time in your request, so the latest one is in the form',
} as const;

/** "Read by Gemini" only when the server says so; anything else never claims the model read it. */
export function sourceLabel(source: unknown): string {
  return source === 'gemini' ? REQUEST_COPY.parsedByModel : REQUEST_COPY.parsedOffline;
}

/** The plain line under "Read by Relay’s rules"; null when the server says the model read the sentence. */
export function sourceLine(source: unknown): string | null {
  return source === 'gemini' ? null : REQUEST_COPY.offlineLine;
}

/**
 * The example in the empty box. The sender is the signed-in business (DECISIONS pass 81), so the example
 * names it, with the first other business of the recipient list. Without one: the sentence of docs/mvp4.md.
 */
export function exampleRequest(origin: Pick<NetworkBusiness, 'id' | 'name'>, businesses: NetworkBusiness[]): string {
  const first = recipientOptions(businesses, origin.id)[0];
  const to = businesses.find((b) => b.id === first?.id);
  if (!to) return 'Deliver an envelope from Etsy to Brooklyn Roasting by 10 a.m. tomorrow.';
  return `Deliver an envelope from ${origin.name} to ${to.name} by 10 a.m. tomorrow.`;
}

/** "12 / 500": the typed length against the limit of the contract. */
export function countText(text: string): string {
  return `${text.length} / ${PARSE_TEXT_MAX}`;
}

/** The trimmed sentence to send, or the contract's own message for an empty or too long one. */
export function checkRequestText(raw: string): { text: string } | { error: string } {
  const res = ParseRequestBody.safeParse({ text: raw });
  if (res.success) return { text: res.data.text };
  return { error: res.error.issues[0]?.message || REQUEST_COPY.empty };
}

/** Where a failed read is shown: beside the box (a 400 about the text) or as the box's alert (anything else). */
export type ReadProblem = { kind: 'field' | 'failed'; text: string };

/** Classifies a rejected parseRequest (an ApiRequestError from client/src/api, or anything else). */
export function readProblem(error: unknown): ReadProblem {
  const e = (error ?? {}) as { status?: unknown; fieldErrors?: Record<string, unknown>; message?: unknown };
  if (e.status === 400) {
    const field = e.fieldErrors?.text;
    const message = typeof field === 'string' && field.trim() ? field.trim()
      : typeof e.message === 'string' && e.message.trim() ? e.message.trim() : REQUEST_COPY.empty;
    return { kind: 'field', text: message };
  }
  // No HTTP answer (network failure or timeout, status 0): the browser's own text says nothing.
  return { kind: 'failed', text: e.status === 0 ? REQUEST_COPY.noAnswer : REQUEST_COPY.failed };
}

/** True for an answer the page can show: a body with a draft object (anything else is a failed read). */
export function isParseAnswer(value: unknown): value is ParseRequestResponse {
  const v = value as { draft?: unknown } | null;
  return typeof v === 'object' && v !== null && typeof v.draft === 'object' && v.draft !== null;
}

// ---------- What the server chose or changed (#947, shown by #948) ----------
// Beside the contract's fields, a parse answer may carry `note` (plain sentences about what the server chose:
// 'Read "Kinshop coffee" as Kinship Coffee.', "Relay delivers by 12:00 PM tomorrow, ahead of your 5:00 PM
// deadline.", "No deliver-by time given, so Relay delivers by 12:00 PM tomorrow.") and `assumed` (the draft
// fields the sentence did not say and the server filled in: `deadlineMin`). Neither is in shared/v2 (human
// owned), so both are read as unknown here, and an answer without them reads as before.

/** A misspelt business name the server took for a network business: the words as typed, and the business. */
export type NearMiss = { typed: string; businessId: string; name: string };

/** What a parse answer says beside its draft, sorted by where the page shows it. */
export type ParseNotes = {
  /** Misspelt names and the businesses they were read as, in the order of the note. */
  nearMisses: NearMiss[];
  /** The rest of the note: what the server says about the deliver-by time (or anything else). Null when empty. */
  rest: string | null;
  /** True when the deliver-by time is the server's, not the sentence's. */
  deadlineAssumed: boolean;
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The answer's sentences: `note`, or a list `notes`, as one text. */
function noteText(response: unknown): string {
  const r = (response ?? {}) as { note?: unknown; notes?: unknown };
  const parts = [r.note, ...(Array.isArray(r.notes) ? r.notes : [])];
  return parts.filter((part): part is string => typeof part === 'string').map((part) => part.trim()).filter(Boolean).join(' ');
}

/** The draft fields the server lists as assumed. */
function assumedFields(response: unknown): string[] {
  const assumed = (response as { assumed?: unknown } | null)?.assumed;
  return Array.isArray(assumed) ? assumed.filter((key): key is string => typeof key === 'string') : [];
}

/**
 * Reads the answer's note. A sentence 'Read "<typed>" as <business name>.' about a business of the directory
 * is taken out as a near miss (the longest name first, so "Blue Bottle" never wins over "Blue Bottle Coffee");
 * what is left is `rest`.
 */
export function parseNotes(response: unknown, businesses: readonly Pick<NetworkBusiness, 'id' | 'name'>[]): ParseNotes {
  let rest = noteText(response);
  const found: (NearMiss & { at: number })[] = [];
  for (const b of [...businesses].sort((a, c) => c.name.length - a.name.length)) {
    if (!b.name.trim()) continue;
    const sentence = new RegExp(`Read ["“‘']([^"“”‘’]+)["”’'] as ${escapeRegExp(b.name)}(?:\\.|(?=\\s|$))`);
    for (let m = sentence.exec(rest); m; m = sentence.exec(rest)) {
      found.push({ typed: m[1].trim(), businessId: b.id, name: b.name, at: m.index });
      // Blanked, not cut, so the places of the other sentences stay comparable.
      rest = rest.slice(0, m.index) + ' '.repeat(m[0].length) + rest.slice(m.index + m[0].length);
    }
  }
  rest = rest.replace(/\s+/g, ' ').trim();
  return {
    nearMisses: found.sort((a, c) => a.at - c.at).map(({ at: _at, ...miss }) => miss),
    rest: rest || null,
    deadlineAssumed: assumedFields(response).includes('deadlineMin'),
  };
}

/** "Kinship Coffee (from ‘Kinshop coffee’)": the business in the form, and the words it was read from. */
export function nearMissText(miss: Pick<NearMiss, 'typed' | 'name'>): string {
  return `${miss.name} (from ‘${miss.typed}’)`;
}

/** True for a sentence about the deliver-by time: it belongs under that field. */
const aboutDeadline = (sentence: string) => /deliver|deadline/i.test(sentence);

/**
 * Where the notes go (#948). Under the Recipient: the business a misspelt name was read as, when it is the
 * one in the form. Under the deliver-by fields: the server's sentence about a time it moved, and an assumed
 * one marked "(assumed, change it if needed)"; only when the form holds the time that was read. Everything
 * else (a misspelt sender, a sentence about something else) is a plain line above the form.
 */
export function placeNotes(
  notes: ParseNotes, draft: NewDeliveryDraft, needsInput: readonly DraftField[],
): { fieldNotes: FieldNotes; lines: string[] } {
  const fieldNotes: FieldNotes = {};
  const lines: string[] = [];
  for (const miss of notes.nearMisses) {
    if (!fieldNotes.recipientId && draft.recipientId !== '' && miss.businessId === draft.recipientId) {
      fieldNotes.recipientId = { text: nearMissText(miss), check: false };
    } else lines.push(nearMissText(miss));
  }
  const deadlineRead = !needsInput.includes('deadlineDay') && !needsInput.includes('deadlineTime');
  const sentence = notes.rest && (notes.deadlineAssumed || aboutDeadline(notes.rest)) ? notes.rest : null;
  if (deadlineRead && notes.deadlineAssumed) {
    const said = (sentence ?? REQUEST_COPY.assumedDeadline).replace(/\.$/, '');
    fieldNotes.deadline = { text: `${said} ${REQUEST_COPY.assumed}`, check: true };
  } else if (deadlineRead && sentence) {
    fieldNotes.deadline = { text: sentence, check: false };
  }
  if (notes.rest && !(fieldNotes.deadline && sentence)) lines.push(notes.rest);
  return { fieldNotes, lines };
}

/**
 * The draft's fields as the form takes them. The sender is left out (always the signed-in business), and a
 * field the server lists in `missing` is null whatever the draft holds, so it gets the form's "Check this";
 * unless the server also lists it as assumed (#947): then its value is the server's choice, and the form
 * shows it with a line that says so.
 */
export function parsedFields(response: ParseRequestResponse): ParsedFields {
  const d = response.draft;
  const assumed = assumedFields(response);
  const missing: readonly string[] = (Array.isArray(response.missing) ? response.missing : []).filter((key) => !assumed.includes(key));
  const given = <K extends keyof ParsedFields>(key: K): ParsedFields[K] | null =>
    (missing.includes(key) ? null : d[key] ?? null);
  return {
    destinationBusinessId: given('destinationBusinessId'),
    label: given('label'),
    category: given('category'),
    description: given('description'),
    weightKg: given('weightKg'),
    readyMin: given('readyMin'),
    deadlineMin: given('deadlineMin'),
  };
}

/**
 * "You are signed in as Y; this request will be sent from Y." when the sentence names another business as
 * the sender; null when it names the signed-in one or none (DECISIONS pass 81: the page never switches accounts).
 */
export function senderNote(originBusinessId: string | null | undefined, origin: Pick<NetworkBusiness, 'id' | 'name'>): string | null {
  if (!originBusinessId || originBusinessId === origin.id) return null;
  return `You are signed in as ${origin.name}; this request will be sent from ${origin.name}.`;
}

/** What the page shows for a read request: the form's starting draft and the lines above the form. */
export type ParsedRequest = {
  /** The sentence as the user typed it; "Edit request" puts it back in the box. */
  text: string;
  draft: NewDeliveryDraft;
  /** Fields that still need the user (the form's "Check this" hints), in screen order. */
  needsInput: DraftField[];
  sourceLabel: string;
  /** One plain line that says the sentence was read without the model; null when the model read it. */
  sourceLine: string | null;
  senderNote: string | null;
  /** The server's plain sentence about a stop that is not a network business, or null. */
  rejected: string | null;
  /** Lines under the form's Recipient and deliver-by fields: a misspelt name, a moved or assumed time (#948). */
  fieldNotes: FieldNotes;
  /** What else the server chose or changed, as plain lines above the form. Usually empty. */
  notes: string[];
};

export function parsedRequest(
  response: ParseRequestResponse,
  context: { origin: NetworkBusiness; businesses: NetworkBusiness[] },
  text: string,
): ParsedRequest {
  const { draft, needsInput } = draftFromParsed(parsedFields(response), { originId: context.origin.id, businesses: context.businesses });
  const rejected = typeof response.rejected === 'string' && response.rejected.trim() ? response.rejected.trim() : null;
  const placed = placeNotes(parseNotes(response, context.businesses), draft, needsInput);
  return {
    text,
    draft,
    needsInput,
    fieldNotes: placed.fieldNotes,
    notes: placed.lines,
    sourceLabel: sourceLabel(response.source),
    sourceLine: sourceLine(response.source),
    senderNote: senderNote(response.draft.originBusinessId, context.origin),
    rejected,
  };
}
