// Pure model for the "Options" card of the Business New delivery page (#863, the AI what-if advisor).
// No React, no fetch: tested in Node. It turns the answer of POST /api/v2/advise into the rows of the card.
// Nothing about matching or pricing is decided here: every number is the server's (the engine's plan for
// that variant, #862). The model formats them, marks the lowest price it was given, and says which ready
// and deliver-by times an option stands for, so that choosing it can put them in the confirmation form.
import type { AdviseOption, AdviseResponse } from '../../../../../shared/v2/api';
import type { NetworkBusiness, PackageCategory } from '../../../../../shared/v2/types';
import { formatCents, formatDuration, formatMin } from '../../../ui/format';
import {
  dayTimeToMin, draftTimes, parseWeightKg, sameTimes, type DraftTimes, type NewDeliveryDraft,
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

/** `advise` of client/src/api/v2, which waits 15 s by default: the server's agent has 10 s (tests pass a stub). */
export type AdviseCall = (draft: AdviseDraft, opts?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<AdviseResponse>;

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
  byModel: 'Planned by Gemini, checked by the engine',
  offline: 'Options computed offline',
  /** The card's one line about who made the options (#880): the label as a sentence, and for an offline answer what that means. */
  byModelLine: 'Planned by Gemini, checked by the engine.',
  offlineLine: 'Options computed offline: priced by Relay’s matching engine, with no AI model.',
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
} as const;

/** The label names the model only when the server says the model planned the options; anything else is "offline". */
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
  const readyMin = dayTimeToMin(1, draft.readyTime);
  const deadlineMin = dayTimeToMin(draft.deadlineDay, draft.deadlineTime);
  if (!originId || !draft.recipientId || Number.isNaN(readyMin) || Number.isNaN(deadlineMin)) return null;
  const weight = parseWeightKg(draft.weightKg);
  return {
    originBusinessId: originId,
    destinationBusinessId: draft.recipientId,
    label: draft.label.trim() || null,
    category: draft.category,
    description: draft.description.trim() || null,
    weightKg: 'kg' in weight ? weight.kg : null,
    readyMin,
    deadlineMin,
  };
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
  /** The one line the card shows about who made the options: an offline answer says so in plain words. */
  sourceLine: string;
  /** The server's sentence, when it sent one. */
  note: string | null;
  rows: AdviceRow[];
};

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const text = (s: unknown) => (typeof s === 'string' ? s.trim() : '');

/** A time the option changes, or the request's own; NaN for a change that is not a number. */
function changed(value: unknown, own: number): number {
  return value === undefined || value === null ? own : isNum(value) ? value : NaN;
}

function row(
  raw: unknown, index: number, context: { draft: AdviseDraft; businesses: Pick<NetworkBusiness, 'id' | 'name'>[] },
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
 * What the card shows for an answer, or null when there is nothing to show (no usable option, or a body
 * that is not an advise answer): the page then hides the card. An option the page cannot show or apply is
 * left out; the others keep the server's order.
 */
export function adviceCard(
  response: unknown, context: { draft: AdviseDraft; businesses: Pick<NetworkBusiness, 'id' | 'name'>[] },
): AdviceCard | null {
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

/**
 * What the card says for an answer with no option to show (`adviceCard` is null): the server's own sentence
 * about why (its `note`), or a plain default. A body that is not an advise answer reads like a failed call.
 */
export function noOptionsText(response: unknown): string {
  const r = response as { options?: unknown; note?: unknown } | null;
  if (typeof r !== 'object' || r === null || !Array.isArray(r.options)) return ADVICE_COPY.failed;
  return `${text(r.note) || ADVICE_COPY.none} ${ADVICE_COPY.noneNext}`;
}

/**
 * The accessible name of an option's button (#880): what the button says, then which option and its price,
 * so a screen reader user hears the price on every stop ("Choose this option: As requested, $9.50").
 */
export function optionName(row: Pick<AdviceRow, 'label' | 'priceText' | 'cheapest'>, chosen: boolean): string {
  const price = row.cheapest ? `${row.priceText}, ${ADVICE_COPY.cheapest.toLowerCase()}` : row.priceText;
  return `${chosen ? ADVICE_COPY.chosen : ADVICE_COPY.choose}: ${row.label}, ${price}`;
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
