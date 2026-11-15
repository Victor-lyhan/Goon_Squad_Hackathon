// The AI what-if advisor (#862): POST /api/v2/advise turns a parsed draft into 2-3 priced options.
// The ENGINE computes every number. Gemini (with a key) is a tool-using agent: it calls `try_variant` to ask the
// engine about the request with an earlier ready time or a later deliver-by, then calls `present_options` to
// pick which tool results to show and to write their label and summary. The server builds each option from its
// tool result, so a price, a time or a carrier Gemini writes anywhere is never used, and a pick that names no
// matched tool result is dropped.
// Without a key, or on any Gemini failure (HTTP, network, the 10 s budget, no usable picks), the options come
// from three fixed variants instead (`adviseOffline`) with `source: 'offline'`.
//
// Rules for a variant (checked on the server, whatever Gemini sends):
// - readyMin: whole minutes, never later than the draft's and never before the run clock (or the window start);
// - deadlineMin: whole minutes, never earlier than the draft's and never after `settings.simEndMin`;
// - a value outside those bounds is clamped to them; a value that is no number, or an unknown argument, is an error.
//
// This file logs nothing, reads no environment and changes nothing: `AdvisorEngine.match` is read-only.
import { z } from 'zod';
import type { AdviseOption, AdviseResponse } from '../../shared/v2/api';
import type { DeliveryPlan } from '../../shared/v2/types';
import type { FetchLike } from '../geo/googleClient';
import {
  GeminiUnavailable, generateWithTools, type GeminiContent, type GeminiFunctionDeclaration,
} from './gemini';

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
  employeeName: (employeeId: string) => string;
  businessName: (businessId: string) => string | null;
};

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
  const answer = engine.match(variant.readyMin, variant.deadlineMin);
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

/** The note when the request as typed finds no carrier. */
function unmatchedNote(outcomes: readonly VariantOutcome[]): string | undefined {
  const original = outcomes.find((o) => changeCount(o) === 0);
  if (original && !original.matched) {
    const anyMatched = outcomes.some((o) => o.matched);
    return anyMatched
      ? cleanText(`As typed, no carrier can take it: ${original.reason}.`, 200)
      : cleanText(`No carrier can take it, even with an earlier ready time or a later deliver-by: ${original.reason}.`, 240);
  }
  if (outcomes.length > 0 && outcomes.every((o) => !o.matched)) {
    return cleanText(`No carrier can take it: ${(outcomes[0] as { reason: string }).reason}.`, 200);
  }
  return undefined;
}

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

/** The user turn: the request's facts. */
export function buildAdvisorRequest(engine: AdvisorEngine): string {
  const { draft } = engine;
  const name = (id: string) => engine.businessName(id) ?? 'a network business';
  return [
    `From ${name(draft.originBusinessId)} to ${name(draft.destinationBusinessId)}.`,
    `Ready at ${draft.readyMin} (${timeText(draft.readyMin)}). Deliver by ${draft.deadlineMin} (${timeText(draft.deadlineMin)}).`,
    `The simulation clock is at ${engine.clockMin} (${timeText(engine.clockMin)}).`,
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
  constructor() {
    super('Gemini gave no usable options.');
    this.name = 'AdvisorNoAnswer';
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
  const contents: GeminiContent[] = [{ role: 'user', parts: [{ text: buildAdvisorRequest(engine) }] }];
  const results = new Map<string, VariantOutcome>();
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
        const options = optionsFromPicks(call.args, results, engine);
        if (options.length === 0) throw new AdvisorNoAnswer();
        const note = unmatchedNote([...results.values()]);
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
  const key = typeof gemini?.apiKey === 'string' ? gemini.apiKey.trim() : '';
  if (gemini && key !== '') {
    try {
      return await adviseWithGemini(engine, gemini, now);
    } catch (err) {
      if (!(err instanceof GeminiUnavailable) && !(err instanceof AdvisorNoAnswer)) throw err;
    }
  }
  return adviseOffline(engine);
}
