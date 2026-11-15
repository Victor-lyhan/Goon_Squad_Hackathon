// Pure model for the Business "New delivery" text box (MVP IV F1, docs/mvp4.md; DECISIONS pass 81).
// No React, no fetch: tested in Node. It turns the answer of POST /api/v2/parse-request into what the
// existing New delivery form opens with (`draftFromParsed`), plus the lines shown above that form.
// Nothing about matching is decided here, and nothing is sent: the form's own button does that.
import { PARSE_TEXT_MAX, ParseRequestBody, type ParseRequestResponse } from '../../../../../shared/v2/parseRequest';
import type { NetworkBusiness } from '../../../../../shared/v2/types';
import {
  draftFromParsed, recipientOptions, type DraftField, type NewDeliveryDraft, type ParsedFields,
} from './newDeliveryModel';

export { PARSE_TEXT_MAX };

/** The server falls back to its offline parser after 6 s (docs/mvp4.md F1), so the page waits a little longer. */
export const PARSE_TIMEOUT_MS = 10_000;

export const REQUEST_COPY = {
  label: 'Describe the delivery',
  hint: 'One sentence: what to send, to which business and by when. Stops must be businesses in the network.',
  read: 'Read my request',
  reading: 'Reading…',
  /**
   * The line beside the disabled button while the server reads (#880): the wait is at most the 6 s the
   * model gets before the offline parser takes over (docs/mvp4.md F1), so the line says what happens and how long.
   */
  readingLine: 'Reading your request. This takes a few seconds at most.',
  fillForm: 'Fill in the form instead',
  edit: 'Edit request',
  parsedByModel: 'Parsed by Gemini',
  parsedOffline: 'Parsed offline',
  /**
   * What "Parsed offline" means, in one plain line under the label (#880). Not shown when the model read
   * the sentence, and it does not name the model: an offline card never does.
   */
  offlineLine: 'Read by Relay’s built-in rules, with no AI model.',
  /** Under the source label: the form below is the confirmation card, and only its button sends. */
  confirm: 'Check the details below. Nothing is sent until you press Find a delivery match.',
  failed: 'Your request could not be read. Try again, or fill in the form instead.',
  noAnswer: 'The server did not answer, so your request was not read. Try again, or fill in the form instead.',
  empty: 'Describe the delivery in one sentence',
} as const;

/** "Parsed by Gemini" only when the server says so; anything else never claims the model read it. */
export function sourceLabel(source: unknown): string {
  return source === 'gemini' ? REQUEST_COPY.parsedByModel : REQUEST_COPY.parsedOffline;
}

/** The plain line under "Parsed offline"; null when the server says the model read the sentence. */
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

/**
 * The draft's fields as the form takes them. The sender is left out (always the signed-in business), and a
 * field the server lists in `missing` is null whatever the draft holds, so it gets the form's "Check this".
 */
export function parsedFields(response: ParseRequestResponse): ParsedFields {
  const d = response.draft;
  const missing: readonly string[] = Array.isArray(response.missing) ? response.missing : [];
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
};

export function parsedRequest(
  response: ParseRequestResponse,
  context: { origin: NetworkBusiness; businesses: NetworkBusiness[] },
  text: string,
): ParsedRequest {
  const { draft, needsInput } = draftFromParsed(parsedFields(response), { originId: context.origin.id, businesses: context.businesses });
  const rejected = typeof response.rejected === 'string' && response.rejected.trim() ? response.rejected.trim() : null;
  return {
    text,
    draft,
    needsInput,
    sourceLabel: sourceLabel(response.source),
    sourceLine: sourceLine(response.source),
    senderNote: senderNote(response.draft.originBusinessId, context.origin),
    rejected,
  };
}
