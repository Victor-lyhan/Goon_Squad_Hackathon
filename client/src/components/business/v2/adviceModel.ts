// Pure model for the "Options" card of the Business New delivery page (#863, the AI what-if advisor).
// No React, no fetch: tested in Node. It turns the answer of POST /api/v2/advise into the rows of the card.
// Nothing about matching or pricing is decided here: every number is the server's (the engine's plan for
// that variant, #862). The model formats them, marks the lowest price it was given, and says which ready
// and deliver-by times an option stands for, so that choosing it can put them in the confirmation form.
import type { AdviseOption, AdviseResponse } from '../../../../../shared/v2/api';
import type { NetworkBusiness, PackageCategory } from '../../../../../shared/v2/types';
import { formatCents, formatDuration, formatMin } from '../../../ui/format';
import {
  dayTimeToMin, draftTimes, parseWeightKg, sameTimes, type DraftField, type DraftTimes, type FieldErrors, type NewDeliveryDraft,
} from './newDeliveryModel';

// ---------- The request (contract: AdviseRequest / AdviseResponse in shared/v2/api.ts, #862) ----------

/**
 * The body's `draft`: a parse-request draft (shared/v2/parseRequest.ts `ParseDraft`) with both businesses
 * and both times filled, which is what the server needs to answer with anything but a 400.
 */
export type AdviseDraft = {
  originBusinessId: string;
  destinationBusinessId: string;
  label: string | null;
  category: PackageCategory | null;
  description: string | null;
  weightKg: number | null;
  readyMin: number;
  deadlineMin: number;
};

/**
 * The request as the form holds it now (#948): an `AdviseDraft` whose recipient and two times are null while
 * the form does not hold them (no recipient chosen, a time field that is empty). It is still a parse-request
 * draft, so it can be sent: the server answers a request with a null field with no option and a sentence.
 */
export type AdviseAsk = Omit<AdviseDraft, 'destinationBusinessId' | 'readyMin' | 'deadlineMin'> & {
  destinationBusinessId: string | null;
  readyMin: number | null;
  deadlineMin: number | null;
};

/** `advise` of client/src/api/v2, which waits 15 s by default: the server's agent has 10 s (tests pass a stub). */
export type AdviseCall = (draft: AdviseAsk, opts?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<AdviseResponse>;

/**
 * How long the card waits after the last change of the recipient or a time before it asks again (#948):
 * a time typed digit by digit is one call, not four.
 */
export const REASK_DELAY_MS = 600;

/** The card never shows more rows than this, whatever the answer holds. */
export const MAX_OPTIONS = 3;
/**
 * The still rows drawn while the card waits (#880). Two short ones: three as high as an option pushed the
 * form's send button off a 900 px screen for the whole wait, and the answer may hold one option only.
 */
export const WAITING_ROWS = 2;

export const ADVICE_COPY = {
  title: 'Options',
  /**
   * The line in the card while it waits (#880). The server's agent has 10 s; the form below is not held up,
   * so the line says that too.
   */
  loadingLine: 'Pricing your request and a few other times. This takes up to 10 seconds; you can send the request as it is meanwhile.',
  /**
   * Who made the options (#919: plain words, so no "engine" and no "offline"). Relay prices every option
   * either way; the model only chooses which times to try. The keys keep the names of the contract's two
   * `source` values; `offline` is for every source but 'gemini'.
   */
  byModel: 'Planned by Gemini, priced by Relay',
  offline: 'Priced by Relay, no AI model',
  /** The card's one line about who made the options (#880): the label as a sentence. */
  byModelLine: 'Planned by Gemini, priced by Relay.',
  offlineLine: 'Priced by Relay, with no AI model.',
  cheapest: 'Cheapest',
  chosen: 'In the form',
  choose: 'Choose this option',
  /** The fact that says what the carriers add to their commutes for this option. */
  extra: 'Added to commutes',
  hint: 'Prices and times are for your request as it was read. Choosing an option sets the ready and deliver-by times in the form below.',
  /** Under a card with one option: there is nothing to choose, so the line only says what the numbers are. */
  hintSingle: 'The price and arrival time are for your request as it was read.',
  /** After a press, with the two times in front. */
  applied: 'Nothing is sent until you press Find a delivery match.',
  /** The call failed (#880): one sentence, and the form below still sends. */
  failed: 'Options could not be loaded. You can still send your request: press Find a delivery match.',
  /** An answer with no option and no sentence of the server's own. */
  none: 'No option was found for this request as it was read.',
  /** After the server's sentence about a request with no option: the form is still there to change and send. */
  noneNext: 'You can change the times in the form below, or send the request as it is.',
  /** In front of the names of the fields the options wait for (#948). */
  needed: 'Still needed:',
  /** Under those names: what to do, and that nothing has to be pressed for the options to come. */
  neededNext: 'Fill it in below and the options load by themselves.',
  /** In front of the names of the fields the server could not take as they are (a time outside the simulation hours). */
  check: 'Check in the form:',
  checkNext: 'Change it below and the options load by themselves.',
  /** In the form, under a field the options wait for that has no "Check this" line of its own. */
  neededHint: 'Needed for the options above',
} as const;

/** The form fields the options cannot do without, in screen order, each with its name in a sentence. */
const NEEDED_FIELDS: { field: DraftField; key: keyof AdviseAsk; name: string; inSentence: string }[] = [
  { field: 'recipientId', key: 'destinationBusinessId', name: 'Recipient', inSentence: 'a recipient' },
  { field: 'readyTime', key: 'readyMin', name: 'Ready for pickup', inSentence: 'a ready time' },
  { field: 'deadlineTime', key: 'deadlineMin', name: 'Deliver by: time', inSentence: 'a deliver-by time' },
];

/** The label names the model only when the server says the model planned the options; anything else is Relay alone. */
export function adviceSourceLabel(source: unknown): string {
  return source === 'gemini' ? ADVICE_COPY.byModel : ADVICE_COPY.offline;
}

/** The card's plain line about who made the options; like the label, it names the model only when the server does. */
export function adviceSourceLine(source: unknown): string {
  return source === 'gemini' ? ADVICE_COPY.byModelLine : ADVICE_COPY.offlineLine;
}

/**
 * The draft to ask options for: the request as the confirmation form opens with it, so with the signed-in
 * business as the sender (DECISIONS pass 81) and the form's own value where the sentence gave none. Null
 * when there is nothing to price yet: no recipient, or a time the form does not hold as a time.
 */
export function adviseDraft(draft: NewDeliveryDraft, originId: string): AdviseDraft | null {
  const ask = adviseAsk(draft, originId);
  return originId && askMissing(ask).length === 0 ? (ask as AdviseDraft) : null;
}

/**
 * The request to ask options for, as the form holds it now (#948). Like `adviseDraft`, but a form without a
 * recipient or with an empty time still gives a request: those fields are null, and `askMissing` names them.
 */
export function adviseAsk(draft: NewDeliveryDraft, originId: string): AdviseAsk {
  const readyMin = dayTimeToMin(1, draft.readyTime);
  const deadlineMin = dayTimeToMin(draft.deadlineDay, draft.deadlineTime);
  const weight = parseWeightKg(draft.weightKg);
  return {
    originBusinessId: originId,
    destinationBusinessId: draft.recipientId || null,
    label: draft.label.trim() || null,
    category: draft.category,
    description: draft.description.trim() || null,
    weightKg: 'kg' in weight ? weight.kg : null,
    readyMin: Number.isNaN(readyMin) ? null : readyMin,
    deadlineMin: Number.isNaN(deadlineMin) ? null : deadlineMin,
  };
}

const ASK_KEYS = [
  'originBusinessId', 'destinationBusinessId', 'label', 'category', 'description', 'weightKg', 'readyMin', 'deadlineMin',
] as const satisfies readonly (keyof AdviseAsk)[];

export function sameAsk(a: AdviseAsk, b: AdviseAsk): boolean {
  return ASK_KEYS.every((k) => a[k] === b[k]);
}

/**
 * What a new call is decided on: the recipient and the two times, the fields a request can lack and the
 * ones an option depends on. A package name typed in the form never asks again.
 */
export function askKey(ask: AdviseAsk): string {
  return [ask.destinationBusinessId ?? '', ask.readyMin ?? '', ask.deadlineMin ?? ''].join('|');
}

/** The form fields the options still wait for, in screen order. Empty for a request that can be priced. */
export function askMissing(ask: AdviseAsk): DraftField[] {
  return NEEDED_FIELDS.filter((n) => ask[n.key] === null).map((n) => n.field);
}

/** The times of a request as the form holds them (the option with the same times is marked); null when one is missing. */
export function askTimes(ask: AdviseAsk): DraftTimes | null {
  return ask.readyMin === null || ask.deadlineMin === null ? null : draftTimes(ask.readyMin, ask.deadlineMin);
}

// ---------- The card ----------

export type AdviceRow = {
  /** The option's position in the answer. */
  key: string;
  label: string;
  summary: string;
  /** `customerPriceCents`, formatted. */
  priceText: string;
  /** True for the lowest price of the card, when the rows do not all cost the same. */
  cheapest: boolean;
  /** `deliveryMin` as "Day 2, 9:40 AM". */
  arrivalText: string;
  /** "Direct" or "Via <relay point>". */
  routeText: string;
  /** "+12 min · +1.4 mi": what the carriers add to their commutes (a no-break space before each unit). */
  extraText: string;
  /** "Elena Park, Sam Lee"; null when the answer names no carrier. */
  carriersText: string | null;
  /** The ready and deliver-by times this option was computed for, as the form holds them. */
  times: DraftTimes;
};

export type AdviceCard = {
  sourceLabel: string;
  /** The one line the card shows about who made the options, in plain words. */
  sourceLine: string;
  /** The server's sentence, when it sent one. */
  note: string | null;
  rows: AdviceRow[];
};

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const text = (s: unknown) => (typeof s === 'string' ? s.trim() : '');

/** A time the option changes, or the request's own; NaN for a change that is not a number or a request without that time. */
function changed(value: unknown, own: number | null): number {
  return value === undefined || value === null ? own ?? NaN : isNum(value) ? value : NaN;
}

/** What the rows are read against: the times of the request that was asked about, and the names of the relay points. */
type CardContext = { draft: AdviseAsk; businesses: Pick<NetworkBusiness, 'id' | 'name'>[] };

function row(
  raw: unknown, index: number, context: CardContext,
): (AdviceRow & { cents: number }) | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Partial<Record<keyof AdviseOption, unknown>>;
  const label = text(o.label);
  if (!label || (o.kind !== 'direct' && o.kind !== 'relay')) return null;
  if (!isNum(o.customerPriceCents) || o.customerPriceCents < 0 || !isNum(o.deliveryMin)) return null;
  const changes = (typeof o.changes === 'object' && o.changes !== null ? o.changes : {}) as Record<string, unknown>;
  const times = draftTimes(changed(changes.readyMin, context.draft.readyMin), changed(changes.deadlineMin, context.draft.deadlineMin));
  if (!times) return null; // the form could not hold it, so choosing it could not be honest
  const relay = typeof o.relayBusinessId === 'string' ? context.businesses.find((b) => b.id === o.relayBusinessId)?.name : undefined;
  // Each value keeps its unit on its line (no-break spaces): a narrow column breaks at the dot, not inside "2.4 mi".
  const extra = [
    isNum(o.extraMin) ? `+${formatDuration(Math.max(0, o.extraMin))}` : '',
    isNum(o.extraMiles) ? `+${Math.max(0, o.extraMiles).toFixed(1)} mi` : '',
  ].filter(Boolean).map((part) => part.replace(/ /g, '\u00a0'));
  const carriers = Array.isArray(o.carrierNames) ? o.carrierNames.map(text).filter(Boolean) : [];
  return {
    key: `option-${index}`,
    label,
    summary: text(o.summary),
    priceText: formatCents(o.customerPriceCents),
    cents: o.customerPriceCents,
    cheapest: false,
    arrivalText: formatMin(o.deliveryMin),
    routeText: o.kind === 'direct' ? 'Direct' : `Via ${relay ?? 'a relay point'}`,
    extraText: extra.join(' · ') || '—',
    carriersText: carriers.length > 0 ? carriers.join(', ') : null,
    times,
  };
}

/**
 * The rows the card shows for an answer, or null when there is none (no usable option, or a body that is not
 * an advise answer): the card then says why (`noOptions`). An option the page cannot show or apply is left
 * out; the others keep the server's order.
 */
export function adviceCard(response: unknown, context: CardContext): AdviceCard | null {
  const r = response as { options?: unknown; source?: unknown; note?: unknown } | null;
  if (typeof r !== 'object' || r === null || !Array.isArray(r.options)) return null;
  const rows = r.options
    .map((o, i) => row(o, i, context))
    .filter((x): x is AdviceRow & { cents: number } => x !== null)
    .slice(0, MAX_OPTIONS);
  if (rows.length === 0) return null;
  const lowest = Math.min(...rows.map((x) => x.cents));
  const differ = rows.some((x) => x.cents !== lowest);
  return {
    sourceLabel: adviceSourceLabel(r.source),
    sourceLine: adviceSourceLine(r.source),
    note: text(r.note) || null,
    rows: rows.map(({ cents, ...x }) => ({ ...x, cheapest: differ && cents === lowest })),
  };
}

/** What a call that was rejected means for the card (#948). */
export type AdviceFailure =
  /** No answer from the server at all (no network, a timeout): the card is hidden, the form is as without it. */
  | { kind: 'no_answer' }
  /**
   * The server answered with an error: the card stays and says so in one sentence. `refused` holds the
   * server's own words about the recipient or a time it could not take (a 400), keyed by the form's field.
   */
  | { kind: 'failed'; refused: FieldErrors };

/** Classifies a rejected `advise` (an ApiRequestError of client/src/api, or anything else that was thrown). */
export function adviceFailure(error: unknown): AdviceFailure {
  const e = (error ?? {}) as { status?: unknown; fieldErrors?: unknown };
  if (typeof e.status !== 'number' || e.status <= 0) return { kind: 'no_answer' };
  const sent = (e.status === 400 && typeof e.fieldErrors === 'object' && e.fieldErrors !== null ? e.fieldErrors : {}) as Record<string, unknown>;
  const refused: FieldErrors = {};
  for (const n of NEEDED_FIELDS) {
    const message = text(sent[n.key]);
    if (message) refused[n.field] = message;
  }
  return { kind: 'failed', refused };
}

/** The card without an option to show (#948): it stays, and says why in one line. */
export type NoOptions = {
  /** One plain line: the server's own sentence (its `note`, or its words about a field) when it sent one. */
  note: string;
  /** What stands in front of `fields`: "Still needed:" or "Check in the form:". */
  lead: string;
  /** The names of the form fields the options wait for ("Recipient"), highlighted under the line. Often empty. */
  fields: string[];
  /** What to do next, under the line; null when the line says it itself. */
  next: string | null;
};

/**
 * What the card says when it has no option to show (`adviceCard` is null). `response` is the answer, or null
 * for a call the server answered with an error (`refused`: its words about a field, if any). `ask` is the
 * request as the form holds it now: a field it lacks is named, in the server's sentence or, without one (a
 * server that refuses such a request), in the same words. A body that is not an advise answer reads like a
 * failed call.
 */
export function noOptions(response: unknown, ask: AdviseAsk, refused: FieldErrors = {}): NoOptions {
  const r = response as { options?: unknown; note?: unknown } | null;
  const answered = typeof r === 'object' && r !== null && Array.isArray(r.options);
  const note = answered ? text(r.note) : '';
  const lacking = NEEDED_FIELDS.filter((n) => ask[n.key] === null);
  if (lacking.length > 0) {
    return {
      note: note || `Choose ${listText(lacking.map((n) => n.inSentence))} to see options.`,
      lead: ADVICE_COPY.needed,
      fields: lacking.map((n) => n.name),
      next: ADVICE_COPY.neededNext,
    };
  }
  const wrong = NEEDED_FIELDS.filter((n) => refused[n.field]);
  if (wrong.length > 0) {
    const message = refused[wrong[0].field]!;
    return {
      note: /[.!?]$/.test(message) ? message : `${message}.`,
      lead: ADVICE_COPY.check,
      fields: wrong.map((n) => n.name),
      next: ADVICE_COPY.checkNext,
    };
  }
  if (!answered) return { note: ADVICE_COPY.failed, lead: '', fields: [], next: null };
  return { note: note || ADVICE_COPY.none, lead: '', fields: [], next: ADVICE_COPY.noneNext };
}

/** "a recipient", "a recipient and a ready time", "a recipient, a ready time and a deliver-by time". */
function listText(parts: string[]): string {
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The accessible name of an option's button (#880): what the button says, then which option and its price,
 * so a screen reader user hears the price on every stop ("Choose this option: As requested, $9.50").
 * A label that already ends with the price ("Relay via Etsy, $9.50", #954) is not followed by it twice.
 */
export function optionName(row: Pick<AdviceRow, 'label' | 'priceText' | 'cheapest'>, chosen: boolean): string {
  const price = row.cheapest ? `${row.priceText}, ${ADVICE_COPY.cheapest.toLowerCase()}` : row.priceText;
  const ending = `, ${row.priceText}`;
  const label = row.label.endsWith(ending) ? row.label.slice(0, -ending.length) : row.label;
  return `${chosen ? ADVICE_COPY.chosen : ADVICE_COPY.choose}: ${label}, ${price}`;
}

/** The row whose times the form holds now (the first one, should two options share their times), or null. */
export function chosenKey(card: AdviceCard, current: DraftTimes | null): string | null {
  return (current && card.rows.find((x) => sameTimes(x.times, current))?.key) ?? null;
}

/** The line shown after a press: the two times that are now in the form, and that nothing was sent. */
export function appliedText(times: DraftTimes): string {
  const ready = formatMin(dayTimeToMin(1, times.readyTime));
  const deadline = formatMin(dayTimeToMin(times.deadlineDay, times.deadlineTime));
  return `The form now says ready ${ready}, deliver by ${deadline}. ${ADVICE_COPY.applied}`;
}
