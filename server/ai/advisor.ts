// The AI what-if advisor (#862): POST /api/v2/advise turns a parsed draft into 2-3 priced options.
// The ENGINE computes every number. Gemini (with a key) is a tool-using agent: it calls `try_variant` to ask the
// engine about the request with an earlier ready time or a later deliver-by, then calls `present_options` to
// pick which tool results to show and to write their label and summary. The server builds each option from its
// tool result, so a price, a time or a carrier Gemini writes anywhere is never used, and a pick that names no
// matched tool result is dropped.
// Without a key, or on any Gemini failure (HTTP, network, the 10 s budget, no usable picks), the options come
// from three fixed variants instead (`adviseOffline`) with `source: 'offline'`.
// After one such failure Gemini is left alone for 2 minutes (`adviseUnlessPaused`, #884): the pause is shared
// with parse-request (server/ai/geminiPause.ts), so a slow key costs its 10 s only once.
//
// Rules for a variant (checked on the server, whatever Gemini sends):
// - readyMin: whole minutes, never later than the draft's and never before the run clock (or the window start);
// - deadlineMin: whole minutes, never earlier than the draft's and never after `settings.simEndMin`;
// - a value outside those bounds is clamped to them; a value that is no number, or an unknown argument, is an error.
//
// #954: with an engine that has `matchKinds` (the route's always has), the options are built by kind instead:
// the best DIRECT plan and the best RELAY plan of the request as typed (each shown when it exists, even when the
// other is cheaper), plus at most one what-if (ready earlier, else a later deliver-by) when it changes the price
// or the arrival. A kind with no plan gets a plain note with the matcher's reason ("No relay: every evening
// commute from Titan Foods is already carrying a package."). With Gemini, the two kinds are given to it up front
// as results r1 and r2; it may try what-ifs, and it picks and words the options, but the server always shows
// each kind that matched. An engine without `matchKinds` (a test's fake) gets the variant options of #862.
//
// This file logs nothing, reads no environment and changes nothing: `AdvisorEngine.match` is read-only.
import { z } from 'zod';
import type { AdviseOption, AdviseResponse } from '../../shared/v2/api';
import type { DeliveryPlan } from '../../shared/v2/types';
import type { FetchLike } from '../geo/googleClient';
import {
  GeminiUnavailable, generateWithTools, type GeminiContent, type GeminiFunctionDeclaration,
} from './gemini';
import { pauseCause, type GeminiPause, type GeminiPauseState } from './geminiPause';

/** Gemini's whole budget for one /advise request (all model turns together). */
export const ADVISE_TIMEOUT_MS = 10_000;
/** At most this many `try_variant` calls are run per request; later ones get an error answer. */
export const MAX_TOOL_CALLS = 4;
/** At most this many model turns, so a model that never calls `present_options` cannot loop. */
export const MAX_MODEL_TURNS = 6;
export const MAX_OPTIONS = 3;
export const MAX_LABEL_CHARS = 60;
export const MAX_SUMMARY_CHARS = 140;
/** The offline "earlier" variant: the package ready 2 hours earlier. */
export const OFFLINE_EARLIER_MIN = 120;

const METERS_PER_MILE = 1609.344;

/** The four draft fields the engine needs, already checked against the run by the route. */
export type AdviseDraft = {
  originBusinessId: string;
  destinationBusinessId: string;
  readyMin: number;
  deadlineMin: number;
};

/** What the advisor may read about the run. `match` must not change anything. */
export type AdvisorEngine = {
  draft: AdviseDraft;
  /** The run clock's minute: no variant may be ready before it. */
  clockMin: number;
  /** `settings.simStartMin` and `settings.simEndMin`. */
  windowStartMin: number;
  windowEndMin: number;
  /**
   * The run's `settings.flexWindowMin` (#861): a deliver-by at least this many minutes after the ready time
   * gets the flexibility discount. Always the run's own value; the advisor has no default of its own (#867).
   */
  flexWindowMin: number;
  /**
   * The matcher for the draft with these two times, against the current run (trips already reserved stay
   * reserved): the best plan it would pick, or its unmatched reason. Read-only, never reserves, never saves.
   */
  match: (readyMin: number, deadlineMin: number) => { plan: DeliveryPlan } | { reason: string };
  /**
   * The best direct plan and the best relay plan for the draft with these two times (#954), each with the same
   * rules as `match` but among the candidates of its kind only, or the reason that kind has none. Read-only.
   */
  matchKinds?: (readyMin: number, deadlineMin: number) => Record<PlanKind, KindAnswer>;
  employeeName: (employeeId: string) => string;
  businessName: (businessId: string) => string | null;
};

export type PlanKind = DeliveryPlan['kind'];
/** The engine's answer for one kind: its best plan, or the reason it has none (a sentence, no full stop). */
export type KindAnswer = { plan: DeliveryPlan } | { reason: string };
/** The two kinds, in the order the options show them. */
export const KINDS: readonly PlanKind[] = ['direct', 'relay'];

export type VariantChanges = { readyMin?: number; deadlineMin?: number };

/** A variant after the server's checks: the two times the engine is asked about. */
export type Variant = { readyMin: number; deadlineMin: number; changes: VariantChanges; clamped: boolean };

export type VariantOutcome =
  | (Variant & { matched: true; plan: DeliveryPlan; option: Omit<AdviseOption, 'label' | 'summary'> })
  | (Variant & { matched: false; reason: string });

// ---------- Variants ----------

/** The earliest ready minute a variant may have: the run clock (not before the window), never after the draft's. */
function earliestReady(engine: AdvisorEngine): number {
  return Math.min(engine.draft.readyMin, Math.max(engine.clockMin, engine.windowStartMin));
}

/** The latest deliver-by a variant may have: the end of the window, never before the draft's. */
function latestDeadline(engine: AdvisorEngine): number {
  return Math.max(engine.draft.deadlineMin, engine.windowEndMin);
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Checks and clamps the arguments of one `try_variant` call. `{}` (or null/undefined) is the request as typed.
 * An unknown argument or a value that is not a finite number is an error; a value out of bounds is clamped.
 */
export function resolveVariant(args: unknown, engine: AdvisorEngine): Variant | { error: string } {
  const value = args === undefined || args === null ? {} : args;
  if (!isRecord(value)) return { error: 'The arguments must be an object with readyMin and/or deadlineMin.' };
  const unknown = Object.keys(value).filter((key) => key !== 'readyMin' && key !== 'deadlineMin');
  if (unknown.length > 0) return { error: 'Only readyMin and deadlineMin can be changed.' };
  const { draft } = engine;
  const read = (key: 'readyMin' | 'deadlineMin'): number | null | { error: string } => {
    const raw = value[key];
    if (raw === undefined || raw === null) return null;
    const num = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    if (typeof num !== 'number' || !Number.isFinite(num)) return { error: `${key} must be a whole number of minutes.` };
    return Math.round(num);
  };
  const ready = read('readyMin');
  const deadline = read('deadlineMin');
  if (isRecord(ready)) return ready;
  if (isRecord(deadline)) return deadline;
  const readyMin = ready === null ? draft.readyMin : clamp(ready, earliestReady(engine), draft.readyMin);
  const deadlineMin = deadline === null ? draft.deadlineMin : clamp(deadline, draft.deadlineMin, latestDeadline(engine));
  return {
    readyMin, deadlineMin,
    changes: {
      ...(readyMin === draft.readyMin ? {} : { readyMin }),
      ...(deadlineMin === draft.deadlineMin ? {} : { deadlineMin }),
    },
    clamped: (ready !== null && ready !== readyMin) || (deadline !== null && deadline !== deadlineMin),
  };
}

/** Runs the engine for one checked variant and copies the plan's numbers into the option fields. */
export function runVariant(variant: Variant, engine: AdvisorEngine): VariantOutcome {
  return outcomeOf(variant, engine.match(variant.readyMin, variant.deadlineMin), engine);
}

/** A variant with the engine's answer for it: the plan's numbers copied into the option fields, or the reason. */
function outcomeOf(variant: Variant, answer: KindAnswer, engine: AdvisorEngine): VariantOutcome {
  if ('reason' in answer) return { ...variant, matched: false, reason: answer.reason };
  const { plan } = answer;
  const extraM = plan.legs.reduce((sum, leg) => sum + leg.extraDistanceM, 0);
  return {
    ...variant, matched: true, plan,
    option: {
      changes: { ...variant.changes },
      kind: plan.kind,
      ...(plan.kind === 'relay' && plan.relayBusinessId !== undefined ? { relayBusinessId: plan.relayBusinessId } : {}),
      carrierNames: plan.legs.map((leg) => engine.employeeName(leg.employeeId)),
      deliveryMin: plan.deliveryMin,
      extraMin: plan.legs.reduce((sum, leg) => sum + leg.extraMin, 0),
      extraMiles: Math.round((Math.max(0, extraM) / METERS_PER_MILE) * 10) / 10,
      customerPriceCents: plan.customerPriceCents,
    },
  };
}

// ---------- Text ----------

const two = (n: number) => String(n).padStart(2, '0');

/** "Day 2, 9:40 AM" for 1960. */
export function timeText(min: number): string {
  const whole = Math.max(0, Math.round(min));
  const day = Math.floor(whole / 1440) + 1;
  const rest = whole % 1440;
  const hour = Math.floor(rest / 60);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `Day ${day}, ${h12}:${two(rest % 60)} ${hour < 12 ? 'AM' : 'PM'}`;
}

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** One line, no control characters, at most `max` characters. '' when nothing is left. */
export function cleanText(text: unknown, max: number): string {
  if (typeof text !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const line = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

/** How the option is carried, in words: "Direct with Elena Rossi" / "Via Etsy with A and B". */
function routeText(outcome: Extract<VariantOutcome, { matched: true }>, engine: AdvisorEngine): string {
  const { option } = outcome;
  const carriers = option.carrierNames.join(' and ');
  if (option.kind === 'relay') {
    const relay = option.relayBusinessId === undefined ? null : engine.businessName(option.relayBusinessId);
    return `Via ${relay ?? 'a relay point'} with ${carriers}`;
  }
  return `Direct with ${carriers}`;
}

/** The server's own summary of an option, from its numbers. */
export function defaultSummary(outcome: Extract<VariantOutcome, { matched: true }>, engine: AdvisorEngine): string {
  const { option } = outcome;
  return cleanText(
    `${routeText(outcome, engine)}, arrives ${timeText(option.deliveryMin)}, ${money(option.customerPriceCents)}.`,
    MAX_SUMMARY_CHARS,
  );
}

/** The label of a kind's option (#954): "Direct with Elena Rossi, $7.00" / "Relay via Kinship Coffee, $10.50". */
export function kindLabel(outcome: Extract<VariantOutcome, { matched: true }>, engine: AdvisorEngine): string {
  const { option } = outcome;
  const price = money(option.customerPriceCents);
  if (option.kind === 'relay') {
    const relay = option.relayBusinessId === undefined ? null : engine.businessName(option.relayBusinessId);
    return cleanText(`Relay via ${relay ?? 'a relay point'}, ${price}`, MAX_LABEL_CHARS);
  }
  return cleanText(`Direct with ${option.carrierNames.join(' and ')}, ${price}`, MAX_LABEL_CHARS);
}

/** The server's own label of a variant, from what it changes. */
export function defaultLabel(variant: Variant, engine: AdvisorEngine): string {
  const parts: string[] = [];
  if (variant.changes.readyMin !== undefined) {
    const earlier = engine.draft.readyMin - variant.changes.readyMin;
    parts.push(earlier % 60 === 0 ? `Ready ${earlier / 60} h earlier` : `Ready ${earlier} min earlier`);
  }
  if (variant.changes.deadlineMin !== undefined) parts.push(`Deliver by ${timeText(variant.changes.deadlineMin)}`);
  return parts.length === 0 ? 'As requested' : cleanText(parts.join(', '), MAX_LABEL_CHARS);
}

// ---------- Picking options ----------

type Deal = Pick<AdviseOption, 'customerPriceCents' | 'deliveryMin'>;
type Matched = Extract<VariantOutcome, { matched: true }>;
const dealOf = (x: AdviseOption | Matched): Deal => ('option' in x ? x.option : x);
/** Two options that arrive at the same minute for the same price show the user nothing new. */
const sameDeal = (a: AdviseOption | Matched, b: AdviseOption | Matched) => {
  const da = dealOf(a);
  const db = dealOf(b);
  return da.customerPriceCents === db.customerPriceCents && da.deliveryMin === db.deliveryMin;
};
/** `kept` is at least as cheap and arrives at least as early: `other` adds no reason to choose it. */
const noWorse = (kept: AdviseOption | Matched, other: AdviseOption | Matched) => {
  const dk = dealOf(kept);
  const d = dealOf(other);
  return dk.customerPriceCents <= d.customerPriceCents && dk.deliveryMin <= d.deliveryMin;
};

const changeCount = (v: Variant) => Object.keys(v.changes).length;

/**
 * The matcher's reason as the end of a sentence: no full stop, and a small first letter
 * ("No commute can arrive before the deadline" -> "no commute can arrive before the deadline").
 */
function reasonClause(reason: string): string {
  const text = cleanText(reason, 160).replace(/[.!?]+$/, '') || 'no carrier can take it';
  // "Every ..." and "A relay ..." start small; a name in capitals ("UPS ...") stays as it is.
  return /^\p{Lu}(?:\p{Ll}|\s)/u.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/**
 * The note when the request as typed finds no carrier: one plain sentence (#898), the matcher's own reason
 * with a few words in front that say what was tried.
 *   "As typed, no commute can arrive before the deadline."          (another option below does match)
 *   "Even with more time, every matching commute is already carrying a package."   (no option matches)
 */
function unmatchedNote(outcomes: readonly VariantOutcome[]): string | undefined {
  const original = outcomes.find((o) => changeCount(o) === 0);
  if (original && !original.matched) {
    const anyMatched = outcomes.some((o) => o.matched);
    return cleanText(`${anyMatched ? 'As typed' : 'Even with more time'}, ${reasonClause(original.reason)}.`, 200);
  }
  if (outcomes.length > 0 && outcomes.every((o) => !o.matched)) {
    return cleanText(`${capitalised(reasonClause((outcomes[0] as { reason: string }).reason))}.`, 200);
  }
  return undefined;
}

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The offline variants, in this order: the request as typed; ready 2 h earlier (not before the clock);
 * deliver-by extended so the flexibility discount applies (ready + the flex window, clamped to the window end).
 * Variants with the same two times are tried once.
 */
export function offlineVariants(engine: AdvisorEngine): Variant[] {
  const { draft } = engine;
  const wanted: VariantChanges[] = [
    {},
    { readyMin: draft.readyMin - OFFLINE_EARLIER_MIN },
    { deadlineMin: Math.max(draft.deadlineMin, draft.readyMin + engine.flexWindowMin) },
  ];
  const variants: Variant[] = [];
  for (const args of wanted) {
    const variant = resolveVariant(args, engine);
    if ('error' in variant) continue;
    if (variants.some((v) => v.readyMin === variant.readyMin && v.deadlineMin === variant.deadlineMin)) continue;
    variants.push(variant);
  }
  return variants;
}

/**
 * The engine's answers for the offline variants, as 0-3 options. Deterministic. The first matched variant is
 * kept; a later one only when it is cheaper or arrives earlier than every option kept before it.
 */
export function adviseOffline(engine: AdvisorEngine): AdviseResponse {
  if (engine.matchKinds) return adviseByKind(engine, kindOutcomes(engine));
  const outcomes = offlineVariants(engine).map((variant) => runVariant(variant, engine));
  const options: AdviseOption[] = [];
  for (const outcome of outcomes) {
    if (!outcome.matched || options.some((o) => noWorse(o, outcome))) continue;
    options.push({ label: defaultLabel(outcome, engine), summary: defaultSummary(outcome, engine), ...outcome.option });
    if (options.length === MAX_OPTIONS) break;
  }
  const note = unmatchedNote(outcomes);
  return { options, source: 'offline', ...(note === undefined ? {} : { note }) };
}

// ---------- By kind (#954) ----------

/** One kind's best plan for the request as typed, as an outcome with no changes. */
export type KindOutcome = { kind: PlanKind; outcome: VariantOutcome };

/** The request as typed, as a variant. */
const asTyped = (engine: AdvisorEngine): Variant =>
  ({ readyMin: engine.draft.readyMin, deadlineMin: engine.draft.deadlineMin, changes: {}, clamped: false });

/** The best direct plan and the best relay plan of the request as typed, in that order. Needs `matchKinds`. */
export function kindOutcomes(engine: AdvisorEngine): KindOutcome[] {
  if (!engine.matchKinds) throw new Error('kindOutcomes needs an engine with matchKinds');
  const variant = asTyped(engine);
  const answers = engine.matchKinds(variant.readyMin, variant.deadlineMin);
  return KINDS.map((kind) => ({ kind, outcome: outcomeOf(variant, answers[kind], engine) }));
}

/** The what-if variants, in the order they are tried: ready 2 h earlier, then the discount deliver-by. */
export function whatIfVariants(engine: AdvisorEngine): Variant[] {
  return offlineVariants(engine).filter((variant) => changeCount(variant) > 0);
}

/** A what-if is shown only when no option kept so far is at least as cheap and at least as early. */
const changesTheDeal = (options: readonly AdviseOption[], outcome: VariantOutcome): outcome is Matched =>
  outcome.matched && !options.some((o) => noWorse(o, outcome));

/** "No relay: every evening commute from Titan Foods is already carrying a package." */
export function kindNote(kind: PlanKind, reason: string): string {
  return cleanText(`No ${kind}: ${reasonClause(reason)}.`, 200);
}

/**
 * The note of a by-kind answer. A kind matched: one sentence for each kind that did not. Neither matched: the
 * note of #898 from the matcher's own answer for the request as typed and the what-ifs tried.
 */
function byKindNote(engine: AdvisorEngine, kinds: readonly KindOutcome[], tried: readonly VariantOutcome[]): string | undefined {
  if (kinds.some((k) => k.outcome.matched)) {
    const lines = kinds.flatMap((k) => (k.outcome.matched ? [] : [kindNote(k.kind, k.outcome.reason)]));
    return lines.length === 0 ? undefined : lines.join(' ');
  }
  return unmatchedNote([runVariant(asTyped(engine), engine), ...tried]);
}

/**
 * The offline answer by kind: the best direct and the best relay plan as typed (each when it exists), then at
 * most one what-if, the first of `whatIfVariants` that changes the price or the arrival. Deterministic.
 */
export function adviseByKind(engine: AdvisorEngine, kinds: readonly KindOutcome[]): AdviseResponse {
  const options: AdviseOption[] = [];
  for (const { outcome } of kinds) {
    if (outcome.matched) options.push({ label: kindLabel(outcome, engine), summary: defaultSummary(outcome, engine), ...outcome.option });
  }
  const tried: VariantOutcome[] = [];
  for (const variant of whatIfVariants(engine)) {
    const outcome = runVariant(variant, engine);
    tried.push(outcome);
    if (!changesTheDeal(options, outcome)) continue;
    options.push({ label: defaultLabel(outcome, engine), summary: defaultSummary(outcome, engine), ...outcome.option });
    break;
  }
  const note = byKindNote(engine, kinds, tried);
  return { options, source: 'offline', ...(note === undefined ? {} : { note }) };
}

/** The result ids the two kinds have in a Gemini conversation: r1 direct, r2 relay. */
const KIND_RESULT_IDS: Record<PlanKind, string> = { direct: 'r1', relay: 'r2' };

/**
 * Gemini's picks with the kinds given up front: each kind that matched (Gemini's label and summary when it
 * picked it, the server's otherwise), then at most one other matched result Gemini picked that changes the
 * price or the arrival. Every number is the engine's.
 */
export function kindOptionsFromPicks(
  picksArgs: unknown, results: ReadonlyMap<string, VariantOutcome>, engine: AdvisorEngine,
): AdviseOption[] {
  const parsed = Picks.safeParse(picksArgs);
  const picks = parsed.success
    ? parsed.data.options.flatMap((raw) => { const pick = Pick.safeParse(raw); return pick.success ? [pick.data] : []; })
    : [];
  // Picks that name no matched result are an unusable answer, as in `optionsFromPicks`: the offline options follow.
  if (!picks.some((p) => results.get(p.resultId)?.matched)) return [];
  const options: AdviseOption[] = [];
  for (const kind of KINDS) {
    const outcome = results.get(KIND_RESULT_IDS[kind]);
    if (!outcome?.matched) continue;
    const pick = picks.find((p) => p.resultId === KIND_RESULT_IDS[kind]);
    options.push({
      label: cleanText(pick?.label, MAX_LABEL_CHARS) || kindLabel(outcome, engine),
      summary: cleanText(pick?.summary, MAX_SUMMARY_CHARS) || defaultSummary(outcome, engine),
      ...outcome.option,
      changes: { ...outcome.option.changes },
    });
  }
  const kindIds = new Set(Object.values(KIND_RESULT_IDS));
  for (const pick of picks) {
    const outcome = results.get(pick.resultId);
    if (kindIds.has(pick.resultId) || !outcome || !changesTheDeal(options, outcome)) continue;
    options.push({
      label: cleanText(pick.label, MAX_LABEL_CHARS) || defaultLabel(outcome, engine),
      summary: cleanText(pick.summary, MAX_SUMMARY_CHARS) || defaultSummary(outcome, engine),
      ...outcome.option,
      changes: { ...outcome.option.changes },
    });
    break;
  }
  return options;
}

// ---------- Gemini ----------

export type AdvisorGeminiSettings = {
  apiKey: string | null | undefined;
  model: string;
  fetchImpl?: FetchLike;
  /** The budget of the whole conversation. Defaults to ADVISE_TIMEOUT_MS (10 s). */
  timeoutMs?: number;
};

export const TRY_VARIANT = 'try_variant';
export const PRESENT_OPTIONS = 'present_options';

export const ADVISOR_FUNCTIONS: GeminiFunctionDeclaration[] = [
  {
    name: TRY_VARIANT,
    description:
      'Asks the matching engine about the delivery request with a changed ready time and/or deliver-by time. '
      + 'Read-only. No arguments = the request as typed. Returns a resultId and the best plan (carriers, arrival, '
      + 'price) or the reason no carrier can take it.',
    parameters: {
      type: 'OBJECT',
      properties: {
        readyMin: { type: 'INTEGER', description: 'An earlier ready time, in minutes since Day 1 00:00.' },
        deadlineMin: { type: 'INTEGER', description: 'A later deliver-by time, in minutes since Day 1 00:00.' },
      },
    },
  },
  {
    name: PRESENT_OPTIONS,
    description:
      'Shows the customer 2 or 3 of the matched tool results, by resultId, each with a short label and a one-sentence '
      + 'summary. Call it once, last.',
    parameters: {
      type: 'OBJECT',
      properties: {
        options: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              resultId: { type: 'STRING', description: 'The resultId of a matched try_variant result.' },
              label: { type: 'STRING', description: `At most ${MAX_LABEL_CHARS} characters.` },
              summary: { type: 'STRING', description: `One sentence, at most ${MAX_SUMMARY_CHARS} characters.` },
            },
            required: ['resultId', 'label', 'summary'],
          },
        },
      },
      required: ['options'],
    },
  },
];

/**
 * The run's flexibility window in words: "18 hours" for 1080. A window that is no whole number of hours is
 * written in minutes ("630 minutes"), so the prompt never names a rounded window the engine would not discount.
 */
export function flexWindowText(flexWindowMin: number): string {
  if (flexWindowMin % 60 !== 0) return `${flexWindowMin} minutes`;
  const hours = flexWindowMin / 60;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/** The system instruction: the job, the allowed variants with their bounds, the limits. */
export function buildAdvisorPrompt(engine: AdvisorEngine): string {
  const earliest = earliestReady(engine);
  const latest = latestDeadline(engine);
  const { draft } = engine;
  if (engine.matchKinds) {
    return [
      'You advise a business sending one package with Relay, where employees carry packages on their commutes.',
      'A package goes direct (one carrier) or by relay (two carriers who hand it over at a third business).',
      'Times are whole minutes since Day 1 00:00 (Day 2 08:30 = 1950).',
      `The request as typed is already priced: result ${KIND_RESULT_IDS.direct} is the best direct plan and`
        + ` ${KIND_RESULT_IDS.relay} the best relay plan (or why there is none). Each one that matched is always shown.`,
      `You may use the ${TRY_VARIANT} tool to ask the matching engine about one what-if:`,
      `- an earlier ready time: readyMin from ${earliest} (${timeText(earliest)}) up to ${draft.readyMin} (preferred);`,
      `- or a later deliver-by: deadlineMin from ${draft.deadlineMin} up to ${latest} (${timeText(latest)}).`,
      `A deliver-by at least ${flexWindowText(engine.flexWindowMin)} after the ready time gets a flexibility discount.`,
      `Call ${TRY_VARIANT} at most ${MAX_TOOL_CALLS} times. Then call ${PRESENT_OPTIONS} once with a label and summary`,
      `for each matched result of ${KIND_RESULT_IDS.direct} and ${KIND_RESULT_IDS.relay}, plus at most one what-if result`,
      'that changes the price or the arrival time.',
      `Each label is at most ${MAX_LABEL_CHARS} characters, each summary one plain sentence of at most ${MAX_SUMMARY_CHARS}.`,
      'Write no number that is not in a tool result. The server copies every price and time from the engine.',
    ].join('\n');
  }
  return [
    'You advise a business sending one package with Relay, where employees carry packages on their commutes.',
    'Times are whole minutes since Day 1 00:00 (Day 2 08:30 = 1950).',
    `Use the ${TRY_VARIANT} tool to ask the matching engine about variants of the request. Allowed variants only:`,
    '- the request as typed (no arguments);',
    `- an earlier ready time: readyMin from ${earliest} (${timeText(earliest)}) up to ${draft.readyMin};`,
    `- a later deliver-by: deadlineMin from ${draft.deadlineMin} up to ${latest} (${timeText(latest)});`,
    '- or both.',
    `A deliver-by at least ${flexWindowText(engine.flexWindowMin)} after the ready time gets a flexibility discount.`,
    `Call ${TRY_VARIANT} at most ${MAX_TOOL_CALLS} times. Then call ${PRESENT_OPTIONS} once with 2 or 3 matched results`,
    'that are worth choosing between, preferring results that differ in price or arrival time.',
    `Each label is at most ${MAX_LABEL_CHARS} characters, each summary one plain sentence of at most ${MAX_SUMMARY_CHARS}.`,
    'Write no number that is not in a tool result. The server copies every price and time from the engine.',
  ].join('\n');
}

/**
 * The user turn: the request's facts, and with `kinds` the engine's best plan of each kind as typed (#954),
 * written like a tool result.
 */
export function buildAdvisorRequest(engine: AdvisorEngine, kinds?: readonly KindOutcome[]): string {
  const { draft } = engine;
  const name = (id: string) => engine.businessName(id) ?? 'a network business';
  return [
    `From ${name(draft.originBusinessId)} to ${name(draft.destinationBusinessId)}.`,
    `Ready at ${draft.readyMin} (${timeText(draft.readyMin)}). Deliver by ${draft.deadlineMin} (${timeText(draft.deadlineMin)}).`,
    `The simulation clock is at ${engine.clockMin} (${timeText(engine.clockMin)}).`,
    ...(kinds ?? []).map(({ kind, outcome }) =>
      `Best ${kind} plan as typed: ${JSON.stringify(toolAnswer(KIND_RESULT_IDS[kind], outcome, engine))}`),
  ].join('\n');
}

/** What Gemini sees of a tool result. Only facts the engine computed. */
function toolAnswer(resultId: string, outcome: VariantOutcome, engine: AdvisorEngine): Record<string, unknown> {
  const base = {
    resultId,
    readyMin: outcome.readyMin, readyAt: timeText(outcome.readyMin),
    deadlineMin: outcome.deadlineMin, deliverBy: timeText(outcome.deadlineMin),
    ...(outcome.clamped ? { note: 'A value was outside the allowed range and was moved to its nearest allowed value.' } : {}),
  };
  if (!outcome.matched) return { ...base, matched: false, reason: outcome.reason };
  const { option } = outcome;
  return {
    ...base, matched: true,
    route: routeText(outcome, engine),
    kind: option.kind,
    carriers: option.carrierNames,
    arrivesMin: option.deliveryMin, arrivesAt: timeText(option.deliveryMin),
    extraMinutes: option.extraMin, extraMiles: option.extraMiles,
    price: money(option.customerPriceCents),
  };
}

/** Gemini answered, but with nothing the server can show. */
export class AdvisorNoAnswer extends Error {
  /**
   * True when Gemini tried variants and the engine matched none of them: it had nothing to present, which is
   * no fault of Gemini's (and no reason to pause it, #884).
   */
  readonly nothingMatched: boolean;

  constructor(nothingMatched = false) {
    super('Gemini gave no usable options.');
    this.name = 'AdvisorNoAnswer';
    this.nothingMatched = nothingMatched;
  }
}

const Picks = z.object({
  options: z.array(z.unknown()),
});
const Pick = z.object({ resultId: z.string(), label: z.unknown().optional(), summary: z.unknown().optional() });

/** Gemini's picks as options: only matched tool results, each once, no two the same deal; at most 3. */
export function optionsFromPicks(
  picksArgs: unknown, results: ReadonlyMap<string, VariantOutcome>, engine: AdvisorEngine,
): AdviseOption[] {
  const parsed = Picks.safeParse(picksArgs);
  if (!parsed.success) return [];
  const options: AdviseOption[] = [];
  const used = new Set<string>();
  for (const raw of parsed.data.options) {
    const pick = Pick.safeParse(raw);
    if (!pick.success) continue;
    const outcome = results.get(pick.data.resultId);
    if (!outcome || !outcome.matched || used.has(pick.data.resultId)) continue;
    const option: AdviseOption = {
      label: cleanText(pick.data.label, MAX_LABEL_CHARS) || defaultLabel(outcome, engine),
      summary: cleanText(pick.data.summary, MAX_SUMMARY_CHARS) || defaultSummary(outcome, engine),
      ...outcome.option,
      changes: { ...outcome.option.changes },
    };
    if (options.some((o) => sameDeal(o, option))) continue;
    used.add(pick.data.resultId);
    options.push(option);
    if (options.length === MAX_OPTIONS) break;
  }
  // Gemini picked one: add another matched result it tried that is cheaper or earlier (server text).
  if (options.length === 1) {
    for (const outcome of results.values()) {
      if (options.length >= 2) break;
      if (!outcome.matched || options.some((o) => noWorse(o, outcome))) continue;
      options.push({ label: defaultLabel(outcome, engine), summary: defaultSummary(outcome, engine), ...outcome.option });
    }
  }
  return options;
}

/**
 * The Gemini conversation. Throws GeminiUnavailable (no key, HTTP, network, the time budget) or AdvisorNoAnswer
 * (no `present_options` with at least one usable pick); `advise` then answers offline.
 */
export async function adviseWithGemini(
  engine: AdvisorEngine, settings: AdvisorGeminiSettings, now: () => number = Date.now,
): Promise<AdviseResponse> {
  const budget = settings.timeoutMs ?? ADVISE_TIMEOUT_MS;
  const endAt = now() + budget;
  const systemText = buildAdvisorPrompt(engine);
  // #954: the two kinds as typed are results r1 and r2 before Gemini says anything.
  const kinds = engine.matchKinds ? kindOutcomes(engine) : null;
  const results = new Map<string, VariantOutcome>();
  for (const { kind, outcome } of kinds ?? []) results.set(KIND_RESULT_IDS[kind], outcome);
  const contents: GeminiContent[] = [{ role: 'user', parts: [{ text: buildAdvisorRequest(engine, kinds ?? undefined) }] }];
  let toolCalls = 0;

  for (let turn = 0; turn < MAX_MODEL_TURNS; turn++) {
    const remaining = endAt - now();
    if (remaining <= 0) throw new GeminiUnavailable('timeout', { timeoutMs: budget });
    const answer = await generateWithTools({
      apiKey: settings.apiKey ?? null, model: settings.model, fetchImpl: settings.fetchImpl,
      timeoutMs: remaining, systemText, contents, functions: ADVISOR_FUNCTIONS, mode: 'ANY',
    });
    if (answer.calls.length === 0) throw new AdvisorNoAnswer();
    contents.push(answer.content);

    const responses: Record<string, unknown>[] = [];
    for (const call of answer.calls) {
      if (call.name === PRESENT_OPTIONS) {
        const options = kinds ? kindOptionsFromPicks(call.args, results, engine) : optionsFromPicks(call.args, results, engine);
        if (options.length === 0) {
          const outcomes = [...results.values()];
          throw new AdvisorNoAnswer(outcomes.length > 0 && outcomes.every((o) => !o.matched));
        }
        const tried = [...results.entries()]
          .filter(([id]) => !kinds || !Object.values(KIND_RESULT_IDS).includes(id)).map(([, outcome]) => outcome);
        const note = kinds ? byKindNote(engine, kinds, tried) : unmatchedNote(tried);
        return { options, source: 'gemini', ...(note === undefined ? {} : { note }) };
      }
      let response: Record<string, unknown>;
      if (call.name !== TRY_VARIANT) {
        response = { error: `Unknown function. Use ${TRY_VARIANT} or ${PRESENT_OPTIONS}.` };
      } else if (toolCalls >= MAX_TOOL_CALLS) {
        response = { error: `The limit of ${MAX_TOOL_CALLS} tries is reached. Call ${PRESENT_OPTIONS} now.` };
      } else {
        toolCalls++;
        const variant = resolveVariant(call.args, engine);
        if ('error' in variant) {
          response = { error: variant.error };
        } else {
          const resultId = `r${results.size + 1}`;
          const outcome = runVariant(variant, engine);
          results.set(resultId, outcome);
          response = toolAnswer(resultId, outcome, engine);
        }
      }
      responses.push({ functionResponse: { name: call.name, response } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  throw new AdvisorNoAnswer();
}

/** Gemini first when there is a key, the offline variants otherwise or on any failure. Never throws for Gemini. */
export async function advise(
  engine: AdvisorEngine, gemini?: AdvisorGeminiSettings, now?: () => number,
): Promise<AdviseResponse> {
  return (await adviseUnlessPaused(engine, gemini, undefined, now)).response;
}

export type AdviseAttempt = {
  response: AdviseResponse;
  /** Set when Gemini was not asked because the shared pause is on: why, and how long is left. Else null. */
  paused: GeminiPauseState | null;
};

/**
 * `advise` behind the shared pause (#884, server/ai/geminiPause.ts). With a key and the pause on, Gemini is not
 * asked: the offline options come back at once, with the pause's state for the route's log line. Otherwise the
 * conversation runs as usual: a failure starts the pause, usable options clear it. Two things start no pause:
 * a missing key or model name (nothing was sent), and a conversation in which the engine matched no variant
 * (Gemini worked; there was nothing to show). Without `pause`, or without a key, this is `advise` as before.
 * `now` is the clock of the 10 s budget; the pause has its own.
 */
export async function adviseUnlessPaused(
  engine: AdvisorEngine, gemini?: AdvisorGeminiSettings, pause?: GeminiPause, now?: () => number,
): Promise<AdviseAttempt> {
  const key = typeof gemini?.apiKey === 'string' ? gemini.apiKey.trim() : '';
  if (gemini && key !== '') {
    const paused = pause?.current() ?? null;
    if (paused) return { response: adviseOffline(engine), paused };
    try {
      const response = await adviseWithGemini(engine, gemini, now);
      pause?.clear();
      return { response, paused: null };
    } catch (err) {
      let cause: string | null;
      if (err instanceof GeminiUnavailable) cause = pauseCause(err.reason, err.status);
      else if (err instanceof AdvisorNoAnswer) cause = err.nothingMatched ? null : pauseCause('invalid_answer');
      else throw err;
      if (cause !== null) pause?.fail(cause);
    }
  }
  return { response: adviseOffline(engine), paused: null };
}
