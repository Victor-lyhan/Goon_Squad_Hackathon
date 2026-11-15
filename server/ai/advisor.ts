// The AI advisor (#862, reshaped by #959): POST /api/v2/advise turns a parsed draft into 1-3 priced options.
//
// 1. The ENGINE builds every candidate plan for the draft (`AdvisorEngine.candidates`: generateCandidates against
//    the current run, so trips already reserved stay reserved; direct and relay, every relay point and carrier
//    pair that fits), each with a stable id (p1, p2, ... in the matcher's own ranking, so p1 is the plan a sent
//    request would get, and every tie below goes to the plan the matcher prefers). It tags two of them:
//    'fastest' = the earliest deliveryMin (ties: the lower price) and 'cheapest' = the lowest customerPriceCents
//    (ties: the earlier delivery). One plan that is both is one option with both tags.
// 2. GEMINI (with a key) picks the third option, tagged 'recommended', in ONE structured-output call (no tool loop):
//    it gets the business's sentence, the parsed draft and the candidates as engine facts, and answers
//    { recommendedId, reason, sentences } (`GeminiAdvice`). The server checks it (`checkGeminiAdvice`): the id must
//    be a candidate and differ from the fastest and the cheapest when another plan exists; the reason and the
//    sentences may hold no number the facts do not hold. A bad id or reason drops the whole answer; a bad
//    sentence drops only that sentence.
// 3. FALLBACK: no key, a Gemini failure, its 6 s limit or an unusable answer give the third slot to 'balanced':
//    the remaining plan with the smallest (price - min)/(max - min) + (delivery - min)/(max - min), with the
//    server's own labels. The engine's options are built before Gemini is asked, so they never wait on it.
//
// Every number of an option is the engine's. The request as typed with no plan at all: the first what-if that has
// plans (ready 2 h earlier, else a deliver-by out to the flexibility window) is offered instead, with `changes`,
// and a note says why ("As typed, no commute can arrive before the deadline."). A kind with no plan gets the note
// of #954 ("No relay: every evening commute from Titan Foods is already carrying a package.").
//
// This file logs nothing, reads no environment and changes nothing. `advise` returns, beside the answer, the
// one word for the route's log line: 'gemini' or why the third slot is balanced.
import { z } from 'zod';
import type { AdviseOption, AdviseResponse, AdviseTag } from '../../shared/v2/api';
import type { DeliveryPlan } from '../../shared/v2/types';
import type { FetchLike } from '../geo/googleClient';
import { GeminiUnavailable, generateJson } from './gemini';

/** Gemini's time limit for its one call (docs/mvp4.md F1: the same 6 s as parse-request). */
export const ADVISE_TIMEOUT_MS = 6000;
/** Options shown: the fastest, the cheapest and the recommended (or balanced) plan. */
export const MAX_OPTIONS = 3;
export const MAX_LABEL_CHARS = 60;
export const MAX_SUMMARY_CHARS = 140;
/** Gemini's sentence for an option, and its reason for the recommendation. */
export const MAX_SENTENCE_CHARS = 120;
/** At most this many candidates are described to Gemini (the fastest, the cheapest and a spread of the rest). */
export const MAX_GEMINI_CANDIDATES = 12;
/** The "earlier" what-if when the request as typed has no plan: the package ready 2 hours earlier. */
export const OFFLINE_EARLIER_MIN = 120;

const METERS_PER_MILE = 1609.344;

/** The draft fields the engine needs, checked against the run by the route, plus what Gemini reads for intent. */
export type AdviseDraft = {
  originBusinessId: string;
  destinationBusinessId: string;
  readyMin: number;
  deadlineMin: number;
  /** The business's own sentence, when the page sent it. Only Gemini reads it. */
  text?: string | null;
  label?: string | null;
  category?: string | null;
  description?: string | null;
  weightKg?: number | null;
};

export type PlanKind = DeliveryPlan['kind'];
/** The two kinds, in the order their notes are written. */
export const KINDS: readonly PlanKind[] = ['direct', 'relay'];

/** The engine's answer for the draft with two given times: every free plan, and why a kind (or all) has none. */
export type CandidateAnswer = {
  /** Every plan whose trips are all free, in the matcher's ranking (`rankCandidates`): the first is its pick. */
  plans: DeliveryPlan[];
  /** For a kind with no plan: the matcher's reason, a sentence without a full stop. */
  reasons: Partial<Record<PlanKind, string>>;
  /** With no plan at all: the matcher's overall reason. */
  reason?: string;
};

/** What the advisor may read about the run. `candidates` must not change anything. */
export type AdvisorEngine = {
  draft: AdviseDraft;
  /** The run clock's minute: no what-if may be ready before it. */
  clockMin: number;
  /** `settings.simStartMin` and `settings.simEndMin`. */
  windowStartMin: number;
  windowEndMin: number;
  /** The run's `settings.flexWindowMin` (#861): the what-if deliver-by is ready + this. */
  flexWindowMin: number;
  /** Every plan for the draft with these two times, against the current run. Read-only, never reserves. */
  candidates: (readyMin: number, deadlineMin: number) => CandidateAnswer;
  employeeName: (employeeId: string) => string;
  businessName: (businessId: string) => string | null;
};

/** The times the candidates are for, and what they change from the draft (empty for the request as typed). */
export type Variant = { readyMin: number; deadlineMin: number; changes: { readyMin?: number; deadlineMin?: number } };

/** One candidate plan with its stable id and the numbers an option copies. */
export type Candidate = {
  id: string;
  plan: DeliveryPlan;
  /** Hand-overs between carriers: 0 for a direct plan, 1 for a relay. */
  handoffs: number;
  option: Omit<AdviseOption, 'id' | 'label' | 'summary' | 'tags' | 'reason'>;
};

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

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The matcher's reason as the end of a sentence: no full stop, and a small first letter
 * ("No commute can arrive before the deadline" -> "no commute can arrive before the deadline").
 */
function reasonClause(reason: string): string {
  const text = cleanText(reason, 160).replace(/[.!?]+$/, '') || 'no carrier can take it';
  // "Every ..." and "A relay ..." start small; a name in capitals ("UPS ...") stays as it is.
  return /^\p{Lu}(?:\p{Ll}|\s)/u.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/** "No relay: every evening commute from Titan Foods is already carrying a package." */
export function kindNote(kind: PlanKind, reason: string): string {
  return cleanText(`No ${kind}: ${reasonClause(reason)}.`, 200);
}

/** The relay point's name, or "a relay point". */
function relayName(candidate: Candidate, engine: AdvisorEngine): string {
  const id = candidate.option.relayBusinessId;
  return (id === undefined ? null : engine.businessName(id)) ?? 'a relay point';
}

/** How the plan is carried, in words: "Direct with Elena Rossi" / "Relay via Etsy". */
function routeWords(candidate: Candidate, engine: AdvisorEngine): string {
  return candidate.option.kind === 'relay'
    ? `Relay via ${relayName(candidate, engine)}`
    : `Direct with ${candidate.option.carrierNames.join(' and ')}`;
}

/** The server's own summary of an option: "Relay via Etsy with A and B, arrives Day 2, 9:40 AM, $9.50." */
export function defaultSummary(candidate: Candidate, engine: AdvisorEngine): string {
  const { option } = candidate;
  const route = option.kind === 'relay'
    ? `Via ${relayName(candidate, engine)} with ${option.carrierNames.join(' and ')}`
    : `Direct with ${option.carrierNames.join(' and ')}`;
  return cleanText(`${route}, arrives ${timeText(option.deliveryMin)}, ${money(option.customerPriceCents)}.`, MAX_SUMMARY_CHARS);
}

const TAG_WORDS: Record<AdviseTag, string> = {
  fastest: 'Fastest', cheapest: 'cheapest', recommended: 'Recommended', balanced: 'Balanced',
};

/** "Fastest", "Fastest and cheapest", "Cheapest", "Recommended", "Fastest and recommended". */
export function tagWords(tags: readonly AdviseTag[]): string {
  const words = tags.map((tag, i) => (i === 0 ? capitalised(TAG_WORDS[tag]) : TAG_WORDS[tag].toLowerCase()));
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * The label of an option: its tags, its route and its price, at most 60 characters with the price always kept
 * ("Fastest: Direct with Theo Martin, $7.00", "Fastest and cheapest: Relay via Etsy, $9.50").
 */
export function optionLabel(tags: readonly AdviseTag[], candidate: Candidate, engine: AdvisorEngine): string {
  const price = `, ${money(candidate.option.customerPriceCents)}`;
  const head = cleanText(`${tagWords(tags)}: ${routeWords(candidate, engine)}`, MAX_LABEL_CHARS - price.length);
  return `${head}${price}`;
}

// ---------- The engine's candidates ----------

/** One engine plan as a candidate: its id and the numbers an option copies. */
function candidateOf(id: string, plan: DeliveryPlan, changes: Variant['changes'], engine: AdvisorEngine): Candidate {
  const extraM = plan.legs.reduce((sum, leg) => sum + leg.extraDistanceM, 0);
  return {
    id, plan,
    handoffs: Math.max(0, plan.legs.length - 1),
    option: {
      changes: { ...changes },
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

/** The request as typed. */
const asTyped = (engine: AdvisorEngine): Variant =>
  ({ readyMin: engine.draft.readyMin, deadlineMin: engine.draft.deadlineMin, changes: {} });

/**
 * The what-ifs tried when the request as typed has no plan, in this order: ready 2 h earlier (never before the
 * run clock or the window), then the deliver-by moved to ready + the flexibility window (never after the window
 * end). A what-if that changes nothing, or repeats one before it, is left out.
 */
export function whatIfVariants(engine: AdvisorEngine): Variant[] {
  const { draft } = engine;
  const earliest = Math.min(draft.readyMin, Math.max(engine.clockMin, engine.windowStartMin));
  const latest = Math.max(draft.deadlineMin, engine.windowEndMin);
  const readyMin = Math.max(earliest, draft.readyMin - OFFLINE_EARLIER_MIN);
  const deadlineMin = Math.min(latest, Math.max(draft.deadlineMin, draft.readyMin + engine.flexWindowMin));
  const variants: Variant[] = [];
  if (readyMin < draft.readyMin) variants.push({ readyMin, deadlineMin: draft.deadlineMin, changes: { readyMin } });
  if (deadlineMin > draft.deadlineMin) variants.push({ readyMin: draft.readyMin, deadlineMin, changes: { deadlineMin } });
  return variants;
}

export type CandidateSet = {
  /** The variant the candidates are for: the request as typed, or the first what-if with a plan. */
  variant: Variant;
  candidates: Candidate[];
  /** The plain note: why a kind has no plan, or why the request as typed has none. */
  note?: string;
};

/** Every candidate for the request as typed or, when it has none, for the first what-if that has some. */
export function candidateSet(engine: AdvisorEngine): CandidateSet {
  const typed = asTyped(engine);
  const answer = engine.candidates(typed.readyMin, typed.deadlineMin);
  if (answer.plans.length > 0) {
    const notes = KINDS.flatMap((kind) => {
      const reason = answer.reasons[kind];
      return answer.plans.some((p) => p.kind === kind) || reason === undefined ? [] : [kindNote(kind, reason)];
    });
    return { variant: typed, candidates: idsFor(answer.plans, typed, engine), ...(notes.length > 0 ? { note: notes.join(' ') } : {}) };
  }
  const why = reasonClause(answer.reason ?? Object.values(answer.reasons)[0] ?? 'no carrier can take it');
  for (const variant of whatIfVariants(engine)) {
    const tried = engine.candidates(variant.readyMin, variant.deadlineMin);
    if (tried.plans.length === 0) continue;
    return { variant, candidates: idsFor(tried.plans, variant, engine), note: cleanText(`As typed, ${why}.`, 200) };
  }
  const note = whatIfVariants(engine).length > 0 ? `Even with more time, ${why}.` : `${capitalised(why)}.`;
  return { variant: typed, candidates: [], note: cleanText(note, 200) };
}

/** Stable ids p1, p2, ... in the engine's order. */
function idsFor(plans: readonly DeliveryPlan[], variant: Variant, engine: AdvisorEngine): Candidate[] {
  return plans.map((plan, i) => candidateOf(`p${i + 1}`, plan, variant.changes, engine));
}

const byDelivery = (a: Candidate, b: Candidate) =>
  a.option.deliveryMin - b.option.deliveryMin || a.option.customerPriceCents - b.option.customerPriceCents;
const byPrice = (a: Candidate, b: Candidate) =>
  a.option.customerPriceCents - b.option.customerPriceCents || a.option.deliveryMin - b.option.deliveryMin;

/** The first candidate by `order` (a stable sort: on a full tie the engine's order decides). */
const first = (candidates: readonly Candidate[], order: (a: Candidate, b: Candidate) => number) =>
  [...candidates].sort(order)[0];

/** 'fastest' = the earliest arrival (ties: the lower price); 'cheapest' = the lowest price (ties: the earlier arrival). */
export function fastestAndCheapest(candidates: readonly Candidate[]): { fastest: Candidate; cheapest: Candidate } | null {
  if (candidates.length === 0) return null;
  return { fastest: first(candidates, byDelivery), cheapest: first(candidates, byPrice) };
}

/** Same kind, price and arrival: an option that tells the user nothing new. */
const sameDeal = (a: Candidate, b: Candidate) => a.option.kind === b.option.kind
  && a.option.customerPriceCents === b.option.customerPriceCents && a.option.deliveryMin === b.option.deliveryMin;

/**
 * The balanced plan: of the candidates that are neither the fastest nor the cheapest (nor the same deal as one of
 * them), the one with the smallest (price - minPrice)/(maxPrice - minPrice) + (delivery - minDelivery)/(maxDelivery
 * - minDelivery), the ranges over every candidate (a range of 0 counts 0). Ties: lower price, earlier arrival,
 * engine order. Null when no such plan is left.
 */
export function balancedPick(candidates: readonly Candidate[]): Candidate | null {
  const ends = fastestAndCheapest(candidates);
  if (!ends) return null;
  const prices = candidates.map((c) => c.option.customerPriceCents);
  const times = candidates.map((c) => c.option.deliveryMin);
  const scale = (value: number, all: number[]) => {
    const low = Math.min(...all);
    const span = Math.max(...all) - low;
    return span === 0 ? 0 : (value - low) / span;
  };
  const score = (c: Candidate) => scale(c.option.customerPriceCents, prices) + scale(c.option.deliveryMin, times);
  const rest = candidates.filter((c) => c.id !== ends.fastest.id && c.id !== ends.cheapest.id
    && !sameDeal(c, ends.fastest) && !sameDeal(c, ends.cheapest));
  return first(rest, (a, b) => score(a) - score(b) || byPrice(a, b)) ?? null;
}

// ---------- Gemini ----------

export type AdvisorGeminiSettings = {
  apiKey: string | null | undefined;
  model: string;
  fetchImpl?: FetchLike;
  /** Gemini's time limit. Defaults to ADVISE_TIMEOUT_MS (6 s). */
  timeoutMs?: number;
};

/** What Gemini answers, after the shape check. */
export type GeminiAdvice = { recommendedId: string; reason: string; sentences: { id: string; text: string }[] };

const GeminiAdviceSchema = z.object({
  recommendedId: z.string(),
  reason: z.string(),
  sentences: z.array(z.object({ id: z.string(), text: z.string() })).optional().default([]),
});

/** Gemini `responseSchema` of the one call. */
export const ADVICE_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    recommendedId: { type: 'STRING', description: 'The id of the plan that best fits the request.' },
    reason: { type: 'STRING', description: `Why, in one friendly sentence of at most ${MAX_SENTENCE_CHARS} characters.` },
    sentences: {
      type: 'ARRAY',
      description: 'One friendly sentence for each plan that is shown.',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          text: { type: 'STRING', description: `At most ${MAX_SENTENCE_CHARS} characters.` },
        },
        required: ['id', 'text'],
      },
    },
  },
  required: ['recommendedId', 'reason', 'sentences'],
};

/**
 * The thinking setting of the one call: none for gemini-3.x Flash beyond 'minimal' and none at all for 2.5 Flash,
 * so an answer fits the 6 s limit. Other models keep their default (2.5 Pro cannot turn thinking off).
 */
export function adviceThinkingConfig(model: string): Record<string, unknown> | null {
  const id = model.trim().replace(/^models\//, '').toLowerCase();
  if (/^gemini-3(?:\.\d+)?-flash/.test(id)) return { thinkingLevel: 'minimal' };
  if (id.startsWith('gemini-2.5-flash')) return { thinkingBudget: 0 };
  return null;
}

/** What Gemini is told about one candidate: only facts the engine computed. */
export function candidateFacts(candidate: Candidate, engine: AdvisorEngine): Record<string, unknown> {
  const { option } = candidate;
  return {
    id: candidate.id,
    kind: option.kind,
    ...(option.kind === 'relay' ? { relayPoint: relayName(candidate, engine) } : {}),
    carriers: option.carrierNames.map((name) => name.split(/\s+/)[0]),
    arrives: timeText(option.deliveryMin),
    price: money(option.customerPriceCents),
    extraMinutes: option.extraMin,
    handoffs: candidate.handoffs,
  };
}

/** The facts of the draft Gemini is told (and that its sentences may quote). */
function draftFacts(engine: AdvisorEngine, variant: Variant): Record<string, unknown> {
  const { draft } = engine;
  const name = (id: string) => engine.businessName(id) ?? 'a network business';
  const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? cleanText(value, 200) : undefined);
  return {
    from: name(draft.originBusinessId),
    to: name(draft.destinationBusinessId),
    readyAt: timeText(variant.readyMin),
    deliverBy: timeText(variant.deadlineMin),
    ...(text(draft.label) ? { packageName: text(draft.label) } : {}),
    ...(text(draft.category) ? { category: text(draft.category) } : {}),
    ...(text(draft.description) ? { contents: text(draft.description) } : {}),
    ...(typeof draft.weightKg === 'number' && Number.isFinite(draft.weightKg) ? { weightKg: draft.weightKg } : {}),
  };
}

/**
 * At most MAX_GEMINI_CANDIDATES candidates for the prompt: the fastest and the cheapest first, then the best
 * plan of each kind by price, then the rest by price and arrival.
 */
export function shortlist(candidates: readonly Candidate[]): Candidate[] {
  const ends = fastestAndCheapest(candidates);
  if (!ends) return [];
  const byKind = KINDS.flatMap((kind) => {
    const pick = first(candidates.filter((c) => c.option.kind === kind), byPrice);
    return pick ? [pick] : [];
  });
  const fewestExtra = first(candidates, (a, b) => a.option.extraMin - b.option.extraMin || byPrice(a, b));
  const balanced = balancedPick(candidates);
  const ordered = [ends.fastest, ends.cheapest, ...(balanced ? [balanced] : []), ...byKind, fewestExtra, ...[...candidates].sort(byPrice)];
  const seen = new Set<string>();
  const list: Candidate[] = [];
  for (const c of ordered) {
    if (seen.has(c.id) || list.some((kept) => sameDeal(kept, c) && kept.option.carrierNames.join() === c.option.carrierNames.join())) continue;
    seen.add(c.id);
    list.push(c);
    if (list.length === MAX_GEMINI_CANDIDATES) break;
  }
  return list;
}

/** The system instruction of the one call. */
export function buildAdvicePrompt(): string {
  return [
    'You advise a business sending one package with Relay, where employees carry packages on their commutes.',
    'A plan goes direct (one carrier) or by relay (two carriers who hand it over at a third business).',
    'The matching engine has priced every plan. Pick the ONE plan that best fits what the business asked for:',
    '- fragile, valuable or delicate contents: fewer handoffs (a direct plan);',
    '- an event, a meeting or an opening time: a plan that arrives well before it;',
    '- "no rush", "whenever", "cheap", "budget": a lower price;',
    '- "avoid relay", "no handoffs", "same courier": a direct plan;',
    '- nothing special: the plan with a good balance of price and arrival.',
    'Prefer a plan that is neither the fastest nor the cheapest one named below, unless no other plan exists or',
    'that plan clearly fits the request best.',
    'Answer with recommendedId (one of the given ids), reason (one friendly sentence on why it fits the request),',
    'and sentences: one friendly sentence for each of the fastest, the cheapest and your recommended plan.',
    `Each sentence and the reason are at most ${MAX_SENTENCE_CHARS} characters, plain words, no ids.`,
    'Use only numbers that appear in the facts (prices, times, minutes, handoffs). Never compute or round a new',
    'number, never compare two prices as a difference, and never promise anything the facts do not say.',
  ].join('\n');
}

/** The user turn: the sentence, the draft and the candidates, as facts. */
export function buildAdviceRequest(
  engine: AdvisorEngine, set: CandidateSet, listed: readonly Candidate[], ends: { fastest: Candidate; cheapest: Candidate },
): string {
  const sentence = typeof engine.draft.text === 'string' ? cleanText(engine.draft.text, 500) : '';
  return [
    `The business wrote: ${sentence === '' ? '(no sentence; read the parsed request)' : JSON.stringify(sentence)}`,
    `Parsed request: ${JSON.stringify(draftFacts(engine, set.variant))}`,
    `Fastest plan: ${ends.fastest.id}. Cheapest plan: ${ends.cheapest.id}.`,
    'Plans:',
    ...listed.map((c) => JSON.stringify(candidateFacts(c, engine))),
  ].join('\n');
}

// ---------- Checking Gemini's numbers ----------

/** Every number in a text, normalised: "9:40" stays a time, "$9.50" is 9.5, "1,200" is 1200. */
export function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,:]\d+)*/g) ?? []).map((token) => {
    if (token.includes(':')) return token.split(':').map((part) => String(Number(part))).join(':');
    return String(Number(token.replace(/,/g, '')));
  });
}

/** The numbers a sentence may use: those of the facts, and the hour alone of a time on the hour ("9 AM"). */
export function allowedNumbers(facts: readonly unknown[]): Set<string> {
  const allowed = new Set<string>();
  for (const number of numbersIn(facts.map((f) => (typeof f === 'string' ? f : JSON.stringify(f))).join(' '))) {
    allowed.add(number);
    const onTheHour = /^(\d+):0$/.exec(number);
    if (onTheHour) allowed.add(onTheHour[1]);
  }
  return allowed;
}

/** The text when every number in it is allowed, else null. */
function onlyKnownNumbers(text: string, allowed: ReadonlySet<string>): string | null {
  return numbersIn(text).every((n) => allowed.has(n)) ? text : null;
}

/** Why Gemini's answer was not used. Fixed words, safe to log. */
export type AdviceRejection = 'invalid shape' | 'unknown id' | 'same as fastest or cheapest' | 'invented number in reason' | 'no reason';

export type CheckedAdvice = {
  recommended: Candidate;
  reason: string;
  /** The usable sentences by candidate id. A sentence with an invented number is left out. */
  sentences: Map<string, string>;
};

/**
 * Gemini's answer, checked against the candidates: the recommended id must be a candidate (one Gemini was shown)
 * and, when another plan exists, neither the fastest nor the cheapest; the reason may hold only numbers of the
 * draft, the business's sentence and the three plans it may talk about. A sentence is kept only for an id that is
 * shown, and only when its numbers are in the facts of that plan, the draft or the sentence.
 */
export function checkGeminiAdvice(
  answer: unknown, engine: AdvisorEngine, set: CandidateSet, listed: readonly Candidate[],
): CheckedAdvice | { rejected: AdviceRejection } {
  const parsed = GeminiAdviceSchema.safeParse(answer);
  if (!parsed.success) return { rejected: 'invalid shape' };
  const ends = fastestAndCheapest(set.candidates);
  if (!ends) return { rejected: 'unknown id' };
  const recommended = listed.find((c) => c.id === parsed.data.recommendedId.trim());
  if (!recommended) return { rejected: 'unknown id' };
  const others = set.candidates.some((c) => c.id !== ends.fastest.id && c.id !== ends.cheapest.id);
  if (others && (recommended.id === ends.fastest.id || recommended.id === ends.cheapest.id)) {
    return { rejected: 'same as fastest or cheapest' };
  }
  const common = [draftFacts(engine, set.variant), typeof engine.draft.text === 'string' ? engine.draft.text : ''];
  const factsOf = (c: Candidate) => candidateFacts(c, engine);
  const reason = cleanText(parsed.data.reason, MAX_SENTENCE_CHARS);
  if (reason === '') return { rejected: 'no reason' };
  const reasonAllowed = allowedNumbers([...common, factsOf(recommended), factsOf(ends.fastest), factsOf(ends.cheapest)]);
  if (onlyKnownNumbers(reason, reasonAllowed) === null) return { rejected: 'invented number in reason' };

  const shown = new Map([ends.fastest, ends.cheapest, recommended].map((c) => [c.id, c]));
  const sentences = new Map<string, string>();
  for (const { id, text } of parsed.data.sentences) {
    const candidate = shown.get(id.trim());
    const line = cleanText(text, MAX_SENTENCE_CHARS);
    if (!candidate || line === '' || sentences.has(candidate.id)) continue;
    if (onlyKnownNumbers(line, allowedNumbers([...common, factsOf(candidate)])) !== null) sentences.set(candidate.id, line);
  }
  return { recommended, reason, sentences };
}

// ---------- Options ----------

/** Why the third slot is balanced (or why there is no Gemini answer at all). Fixed words, safe to log. */
export type AdviceFallback =
  | 'no key' | 'no plan' | 'timeout' | 'network error' | `HTTP ${number}` | 'HTTP error' | 'bad JSON' | 'empty answer'
  | `invalid answer: ${AdviceRejection}`;

export type AdviceOutcome = {
  response: AdviseResponse;
  /** 'gemini' when Gemini's recommendation is shown, else why the third slot is the balanced plan. */
  by: 'gemini' | AdviceFallback;
};

/** The options of a candidate set: the fastest, the cheapest (when it is another plan) and the third plan. */
function buildOptions(
  engine: AdvisorEngine, set: CandidateSet, third: { candidate: Candidate; tag: 'recommended' | 'balanced'; reason?: string } | null,
  sentences: ReadonlyMap<string, string> = new Map(),
): AdviseOption[] {
  const ends = fastestAndCheapest(set.candidates);
  if (!ends) return [];
  const shown: { candidate: Candidate; tags: AdviseTag[]; reason?: string }[] = [{ candidate: ends.fastest, tags: ['fastest'] }];
  if (ends.cheapest.id === ends.fastest.id) shown[0].tags.push('cheapest');
  else shown.push({ candidate: ends.cheapest, tags: ['cheapest'] });
  if (third) {
    const same = shown.find((s) => s.candidate.id === third.candidate.id);
    const entry = { tags: [third.tag] as AdviseTag[], ...(third.reason === undefined ? {} : { reason: third.reason }) };
    if (same) {
      same.tags.push(third.tag);
      if (entry.reason !== undefined) same.reason = entry.reason;
    } else {
      shown.push({ candidate: third.candidate, ...entry });
    }
  }
  return shown.slice(0, MAX_OPTIONS).map(({ candidate, tags, reason }) => ({
    id: candidate.id,
    tags,
    label: optionLabel(tags, candidate, engine),
    summary: sentences.get(candidate.id) ?? defaultSummary(candidate, engine),
    ...(reason === undefined ? {} : { reason }),
    ...candidate.option,
    changes: { ...candidate.option.changes },
  }));
}

/** The answer without Gemini: the fastest, the cheapest and the balanced plan, with the server's own words. */
export function adviseOffline(engine: AdvisorEngine, set: CandidateSet = candidateSet(engine)): AdviseResponse {
  const balanced = balancedPick(set.candidates);
  const options = buildOptions(engine, set, balanced ? { candidate: balanced, tag: 'balanced' } : null);
  return { options, source: 'offline', ...(set.note === undefined ? {} : { note: set.note }) };
}

/** The fallback word for a GeminiUnavailable. */
function fallbackOf(err: GeminiUnavailable): AdviceFallback {
  switch (err.reason) {
    case 'no_key':
    case 'no_model':
      return 'no key';
    case 'timeout':
      return 'timeout';
    case 'network':
      return 'network error';
    case 'http':
      return err.status === null ? 'HTTP error' : `HTTP ${err.status}`;
    case 'bad_json':
      return 'bad JSON';
    default:
      return 'empty answer';
  }
}

/**
 * The options: the engine's fastest and cheapest plans, then Gemini's recommendation (one call, its own time
 * limit) or, without a key or on any failure, the balanced plan. The candidates and the offline answer are built
 * first and do not depend on Gemini. Never throws for Gemini; an engine error (a travel error) is thrown on.
 */
export async function advise(engine: AdvisorEngine, gemini?: AdvisorGeminiSettings): Promise<AdviceOutcome> {
  const set = candidateSet(engine);
  const offline = adviseOffline(engine, set);
  const ends = fastestAndCheapest(set.candidates);
  if (!ends) return { response: offline, by: 'no plan' };
  const key = typeof gemini?.apiKey === 'string' ? gemini.apiKey.trim() : '';
  if (!gemini || key === '') return { response: offline, by: 'no key' };

  const listed = shortlist(set.candidates);
  let answer: unknown;
  try {
    const thinkingConfig = adviceThinkingConfig(gemini.model);
    answer = await generateJson({
      apiKey: key, model: gemini.model, fetchImpl: gemini.fetchImpl,
      timeoutMs: gemini.timeoutMs ?? ADVISE_TIMEOUT_MS,
      systemText: buildAdvicePrompt(),
      userText: buildAdviceRequest(engine, set, listed, ends),
      responseSchema: ADVICE_RESPONSE_SCHEMA,
      thinkingConfig,
    });
  } catch (err) {
    if (err instanceof GeminiUnavailable) return { response: offline, by: fallbackOf(err) };
    throw err;
  }
  const checked = checkGeminiAdvice(answer, engine, set, listed);
  if ('rejected' in checked) return { response: offline, by: `invalid answer: ${checked.rejected}` };
  const options = buildOptions(
    engine, set, { candidate: checked.recommended, tag: 'recommended', reason: checked.reason }, checked.sentences,
  );
  return { response: { options, source: 'gemini', ...(set.note === undefined ? {} : { note: set.note }) }, by: 'gemini' };
}
