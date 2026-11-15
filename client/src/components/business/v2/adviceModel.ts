// Pure model for the "Options" card of the Business New delivery page (#863, the AI what-if advisor).
// No React, no fetch: tested in Node. It turns the answer of POST /api/v2/advise into the rows of the card.
// Nothing about matching or pricing is decided here: every number is the server's (the engine's plan for
// that option, #862), and so is what an option is marked as (#960: its `tags`, Fastest, Cheapest, Recommended
// or Balanced, with one sentence about it). The model formats them, puts the rows in the order of their
// marks, and says which ready and deliver-by times an option stands for, so that choosing it can put them
// in the confirmation form. Who made the options is not said on the card (#960).
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

/**
 * `advise` of client/src/api/v2, which waits 15 s by default: the server's model has 6 s (tests pass a stub).
 * `text` is the sentence the request was read from, for the server's choice of a recommended option (#960).
 */
export type AdviseCall = (
  draft: AdviseAsk, opts?: { signal?: AbortSignal; timeoutMs?: number; text?: string },
) => Promise<AdviseResponse>;

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
   * The line in the card while it waits (#880). The server answers within 10 s (its model has 6 s, #959); the
   * form below is not held up, so the line says that too. Since #959 the options are plans for the request
   * as typed, so the line no longer speaks of other times (#960).
   */
  loadingLine: 'Pricing your request. This takes up to 10 seconds; you can send the request as it is meanwhile.',
  /** The words of an option's badges (#960), one per tag of the answer. */
  fastest: 'Fastest',
  cheapest: 'Cheapest',
  recommended: 'Recommended',
  balanced: 'Balanced',
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

/**
 * What the server marks an option as (#960). The fastest and the cheapest plan are the matcher's; the third
 * is 'recommended' when a model chose it for the request's own words (it then comes with a `reason`), and
 * 'balanced' when the matcher chose it. One plan may have two tags.
 */
export type AdviceTag = 'fastest' | 'cheapest' | 'recommended' | 'balanced';

/** The order of the badges in a row, and of the rows on the card: Fastest, Cheapest, then Recommended or Balanced. */
export const ADVICE_TAGS: readonly AdviceTag[] = ['fastest', 'cheapest', 'recommended', 'balanced'];

export type AdviceRow = {
  /** The option's position in the answer. */
  key: string;
  /** The option's name: the answer's `label`, without the words of the row's own badges in front of it. */
  label: string;
  /** The row's badges, in the order of `ADVICE_TAGS`. Empty for an option the answer does not mark. */
  tags: AdviceTag[];
  /** One sentence about the option. For a recommended one, why it is recommended (its `reason`), when the answer says. */
  summary: string;
  /** `customerPriceCents`, formatted. */
  priceText: string;
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

/** An option's tags as the card shows them: the known ones, each once, in the order of `ADVICE_TAGS`. */
function tagsOf(raw: unknown): AdviceTag[] {
  return Array.isArray(raw) ? ADVICE_TAGS.filter((tag) => raw.includes(tag)) : [];
}

/**
 * An option's name without the words of its own badges in front (#960). The server's label says them for a
 * reader without badges ("Fastest and cheapest: Relay via Etsy, $9.50"); on the card the badges already do,
 * so the row is named "Relay via Etsy, $9.50". Any other label, also one with another colon, is left as it is.
 */
function withoutTagWords(label: string, tags: readonly AdviceTag[]): string {
  const colon = label.indexOf(': ');
  if (colon < 0) return label;
  const words = label.slice(0, colon).toLowerCase().split(/\s+and\s+|\s*,\s*/);
  const name = label.slice(colon + 2).trim();
  return name && words.every((word) => (tags as readonly string[]).includes(word)) ? name : label;
}

function row(raw: unknown, index: number, context: CardContext): AdviceRow | null {
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
  const tags = tagsOf(o.tags);
  return {
    key: `option-${index}`,
    label: withoutTagWords(label, tags),
    tags,
    summary: (tags.includes('recommended') && text(o.reason)) || text(o.summary),
    priceText: formatCents(o.customerPriceCents),
    arrivalText: formatMin(o.deliveryMin),
    routeText: o.kind === 'direct' ? 'Direct' : `Via ${relay ?? 'a relay point'}`,
    extraText: extra.join(' · ') || '—',
    carriersText: carriers.length > 0 ? carriers.join(', ') : null,
    times,
  };
}

/** Where a row stands on the card: by its first badge. A row without one comes last. */
const rank = (x: AdviceRow) => (x.tags.length > 0 ? ADVICE_TAGS.indexOf(x.tags[0]) : ADVICE_TAGS.length);

/**
 * The rows the card shows for an answer, or null when there is none (no usable option, or a body that is not
 * an advise answer): the card then says why (`noOptions`). An option the page cannot show or apply is left
 * out. The others are in the order of their badges (#960): Fastest, Cheapest, then Recommended or Balanced;
 * rows with the same first badge, and rows without one, keep the server's order. The badges are the server's
 * `tags` and nothing else: the model compares no price and no time.
 */
export function adviceCard(response: unknown, context: CardContext): AdviceCard | null {
  const r = response as { options?: unknown; note?: unknown } | null;
  if (typeof r !== 'object' || r === null || !Array.isArray(r.options)) return null;
  const rows = r.options
    .map((o, i) => row(o, i, context))
    .filter((x): x is AdviceRow => x !== null)
    .map((x, i) => ({ x, i }))
    .sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i)
    .slice(0, MAX_OPTIONS)
    .map(({ x }) => x);
  return rows.length === 0 ? null : { note: text(r.note) || null, rows };
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
 * The accessible name of an option's button (#880): what the button says, then which option, its price and
 * its badges in words, so a screen reader user hears them on every stop ("Choose this option: As requested,
 * $9.50, fastest, cheapest"). A label that already ends with the price ("Relay via Etsy, $9.50", #954) is
 * not followed by it twice.
 */
export function optionName(row: Pick<AdviceRow, 'label' | 'priceText' | 'tags'>, chosen: boolean): string {
  const price = [row.priceText, ...row.tags.map((tag) => ADVICE_COPY[tag].toLowerCase())].join(', ');
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
