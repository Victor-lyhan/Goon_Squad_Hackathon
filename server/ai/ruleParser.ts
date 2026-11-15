// The offline parser of "requests in plain English" (docs/mvp4.md F1, DECISIONS pass 80): one sentence in,
// an editable DRAFT of a delivery request out. It is the fallback when Gemini has no key, fails or is slow,
// so it is deterministic and pure: no network, no clock of its own, no randomness, nothing stored.
//
//   "Deliver an envelope from Etsy to Brooklyn Roasting by 10 a.m. tomorrow."
//   -> origin biz-etsy, destination biz-brooklyn-roasting, category envelope, deadline Day 2 10:00 (2040)
//
// What it reads:
// - Stops: only the run's network businesses, by full name or a distinctive short form (the leading words
//   of the name, when no other business starts with them and they are more than a place or a generic word:
//   "Brooklyn Roasting" yes, "Brooklyn" no). "from X" is the sender and "to Y" the recipient, in either
//   order; a business named without from/to takes the role that is still open ("for Y": the recipient first).
// - A stop after from/to that is not a network business (a home, a street address, an unknown name) is never
//   guessed: the field stays null and `rejected` says so in one plain sentence.
// - Times: minutes since Day 1 00:00; "today" is Day 1 and "tomorrow" is Day 2 (DECISIONS pass 80).
//   A time without a day is its next occurrence after the run clock. "tomorrow morning" = by Day 2 10:00.
//   The ready time is "ready at 4 pm"; without the "at" it must be an exact time ("ready 4pm", "pickup 16:00").
// - Category, a package name, a description ("a box of coffee samples") and a weight ("1.5 kg") from words.
//   Without a package word, what is sent names the package and is its description ("Send coffee beans to
//   Etsy": "Coffee beans"); the category stays null, because the Type is the user's choice (#827).
// Whatever the sentence does not say stays null and is listed in `missing`; `readyMin` defaults to the clock.
import type { ParseDraft, ParseRequestResponse } from '../../shared/v2/parseRequest';
import type { NetworkBusiness, PackageCategory } from '../../shared/v2/types';

export type ParseContext = {
  /** `run.scenario.businesses`: the only stops a draft may name. */
  businesses: readonly (Pick<NetworkBusiness, 'id' | 'name'> & Partial<Pick<NetworkBusiness, 'neighborhood' | 'borough'>>)[];
  /** The run clock's minute (`run.clock.timeMin`). */
  nowMin: number;
};

const DAY_MIN = 1440;
const LAST_MIN = 2 * DAY_MIN;
/** "tomorrow morning" = by Day 2 10:00. */
export const TOMORROW_MORNING_MIN = DAY_MIN + 600;

export const NOT_A_NETWORK_BUSINESS = 'Relay delivers only between network businesses.';

const EMPTY_DRAFT: ParseDraft = {
  originBusinessId: null, destinationBusinessId: null, label: null, category: null,
  description: null, weightKg: null, readyMin: null, deadlineMin: null,
};
const DRAFT_KEYS = Object.keys(EMPTY_DRAFT) as (keyof ParseDraft)[];

// ---------- words ----------

/** One word of the sentence: `norm` for comparing, `start`/`end` to cut the original text. */
type Token = { norm: string; start: number; end: number };

const WORD = /[\p{L}\p{N}&]+(?:['’][\p{L}\p{N}]+)*/gu;

/** Lower case, no accents, no apostrophes: "Zabar's" and "zabars" are the same word. */
const normWord = (raw: string) => raw.normalize('NFKD').replace(/[̀-ͯ'’]/g, '').toLowerCase();

function tokenize(text: string): Token[] {
  return [...text.matchAll(WORD)].map((m) => {
    const start = m.index ?? 0;
    return { norm: normWord(m[0]), start, end: start + m[0].length };
  });
}

/** The sentence in lower case with every character still at its place, so an index fits the original too. */
const sameLengthLower = (text: string) =>
  text.replace(/[A-Z]/g, (c) => c.toLowerCase()).replace(/[‘’]/g, "'").replace(/[   ]/g, ' ');

const blank = (text: string, start: number, end: number) =>
  text.slice(0, start) + ' '.repeat(end - start) + text.slice(end);

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// ---------- business names ----------

type Alias = { words: string[]; businessId: string; full: boolean };

/** Words that say where, not who. A short form made only of these (and of GENERIC_WORDS) names no business. */
const PLACE_WORDS = [
  'new', 'york', 'nyc', 'city', 'manhattan', 'brooklyn', 'queens', 'bronx', 'staten', 'island',
  'downtown', 'uptown', 'midtown',
];
const GENERIC_WORDS = [
  'the', 'a', 'an', 'of', 'and', '&', 'coffee', 'cafe', 'shop', 'store', 'company', 'co', 'inc', 'bakery',
  'office', 'bookstore', 'books', 'foods', 'food', 'market', 'bar', 'restaurant', 'studio', 'house',
  'old', 'big', 'little',
];

/** Every way a business may be named, longest first, so "Blue Bottle Coffee" wins over "Blue Bottle". */
function buildAliases(businesses: ParseContext['businesses']): Alias[] {
  const weak = new Set([...PLACE_WORDS, ...GENERIC_WORDS]);
  for (const business of businesses) {
    for (const place of [business.neighborhood, business.borough]) {
      if (place) for (const token of tokenize(place)) weak.add(token.norm);
    }
  }

  const names = businesses
    .map((business) => {
      const words = tokenize(business.name).map((token) => token.norm);
      return { id: business.id, words: words.length > 1 && words[0] === 'the' ? words.slice(1) : words };
    })
    .filter((name) => name.words.length > 0);
  const startsWith = (words: string[], prefix: string[]) => prefix.every((word, i) => words[i] === word);

  const aliases: Alias[] = [];
  const fullNames = new Set<string>();
  for (const name of names) {
    const key = name.words.join(' ');
    if (!fullNames.has(key)) { // two businesses with one name: the first in the run's list
      fullNames.add(key);
      aliases.push({ words: name.words, businessId: name.id, full: true });
    }
    for (let length = name.words.length - 1; length >= 1; length -= 1) {
      const prefix = name.words.slice(0, length);
      if (prefix.every((word) => weak.has(word))) continue;
      if (length === 1 && prefix[0].length < 3) continue;
      if (names.some((other) => other !== name && startsWith(other.words, prefix))) continue;
      aliases.push({ words: prefix, businessId: name.id, full: false });
    }
  }
  return aliases.sort((a, b) => b.words.length - a.words.length);
}

/** A business named in the sentence, at word `at`. */
type Hit = { at: number; length: number; businessId: string; role: Role | null; forIt: boolean };
type Role = 'origin' | 'destination';

function aliasAt(tokens: Token[], at: number, aliases: Alias[]): Alias | null {
  for (const alias of aliases) {
    const { words } = alias;
    if (at + words.length > tokens.length) continue;
    // The last word may carry an "s": "Etsy's envelope".
    const fits = words.every((word, k) => {
      const typed = tokens[at + k].norm;
      return typed === word || (k === words.length - 1 && typed === `${word}s`);
    });
    if (fits) return alias;
  }
  return null;
}

/** "from [the] X" names the sender, "to [the] X" the recipient. */
function roleBefore(tokens: Token[], at: number): Role | null {
  const word = wordBefore(tokens, at);
  return word === 'from' ? 'origin' : word === 'to' ? 'destination' : null;
}

/** The word before the name at `at`, not counting "the". */
function wordBefore(tokens: Token[], at: number): string | undefined {
  let before = at - 1;
  while (before >= 0 && tokens[before].norm === 'the') before -= 1;
  return tokens[before]?.norm;
}

function findBusinesses(text: string, tokens: Token[], aliases: Alias[]): Hit[] {
  const hits: Hit[] = [];
  for (let at = 0; at < tokens.length; at += 1) {
    const alias = aliasAt(tokens, at, aliases);
    if (!alias) continue;
    const role = roleBefore(tokens, at);
    // "an envelope for X": a hint, weaker than from/to ("a box for Etsy to JetBlue" goes to JetBlue).
    const forIt = role === null && wordBefore(tokens, at) === 'for';
    // One common word ("blue", "print") names a business only after from/to or written as a name.
    const clear = alias.full || alias.words.length > 1 || /\p{Lu}/u.test(text.charAt(tokens[at].start));
    if (role === null && !clear) continue;
    hits.push({ at, length: alias.words.length, businessId: alias.businessId, role, forIt });
    at += alias.words.length - 1;
  }
  return hits;
}

// ---------- stops that are not network businesses ----------

const MAX_STOP_WORDS = 8;
const MAX_STOP_CHARS = 60;

/** Words that end the stop after from/to: the next part of the sentence starts here. */
const STOP_ENDS = new Set([
  'from', 'to', 'by', 'before', 'until', 'till', 'at', 'on', 'for', 'with', 'and', 'then', 'today', 'tomorrow',
  'tonight', 'this', 'next', 'no', 'asap', 'please', 'ready', 'due', 'weighing',
]);
const ABBREVIATIONS = new Set(['st', 'ave', 'rd', 'blvd', 'apt', 'dr', 'mt', 'ft', 'n', 's', 'e', 'w']);
const TIME_WORDS = new Set(['now', 'noon', 'midday', 'midnight', 'morning', 'afternoon', 'evening', 'day']);
const UNIT_WORDS = new Set([
  'am', 'pm', 'kg', 'kgs', 'kilo', 'kilos', 'g', 'grams', 'lb', 'lbs', 'pounds', 'oz', 'minutes', 'hours', 'days',
]);
const NOT_A_PLACE = new Set(['here', 'there', 'us', 'me', 'you', 'them', 'it', 'scratch']);
/** After "to", these start a place ("to my home", "to a friend"), not a verb ("to send"). */
const PLACE_STARTS = new Set(['my', 'our', 'his', 'her', 'their', 'your', 'the', 'a', 'an', 'home', 'someone', 'somebody']);

/** True when punctuation between two neighbouring words ends the phrase. "St." and "Ave." do not. */
function endsBetween(text: string, before: Token, after: Token): boolean {
  const gap = text.slice(before.end, after.start);
  if (/[,;:!?()\n]/.test(gap)) return true;
  return gap.includes('.') && !ABBREVIATIONS.has(before.norm);
}

/** The words after the from/to at `at`, up to the next part of the sentence: `[first, last]`, or null. */
function wordsAfter(text: string, tokens: Token[], at: number): [number, number] | null {
  let last = at;
  for (let k = at + 1; k < tokens.length && k - at <= MAX_STOP_WORDS; k += 1) {
    if (STOP_ENDS.has(tokens[k].norm) || endsBetween(text, tokens[k - 1], tokens[k])) break;
    last = k;
  }
  return last === at ? null : [at + 1, last];
}

/** "from 3 pm", "to 5", "up to 2 kg": a time or an amount, not a place. */
function isTimeOrAmount(text: string, tokens: Token[], first: number, last: number): boolean {
  const word = tokens[first].norm;
  if (TIME_WORDS.has(word)) return true;
  if (!/^\d/.test(word)) return false;
  if (first === last || UNIT_WORDS.has(tokens[first + 1].norm)) return true;
  return /^\d{1,2}(?:[:.]\d{2})?\s*(?:[ap]\.?m?\.?)?$/i.test(text.slice(tokens[first].start, tokens[last].end));
}

/**
 * Whether the words after from/to name a place Relay does not serve. After "from" nearly anything does;
 * "to" also starts verbs ("to send"), so there it must look like a place: a possessive or an article
 * ("my home", "the office"), a house number, or a name written with a capital.
 */
function isOutsideStop(role: Role, text: string, tokens: Token[], first: number, last: number): boolean {
  const word = tokens[first].norm;
  if (isTimeOrAmount(text, tokens, first, last) || NOT_A_PLACE.has(word)) return false;
  if (role === 'origin') return true;
  return PLACE_STARTS.has(word) || /^\d/.test(word) || /\p{Lu}/u.test(text.charAt(tokens[first].start));
}

type Stops = { originBusinessId: string | null; destinationBusinessId: string | null; rejected: string | null };

function resolveStops(text: string, tokens: Token[], hits: Hit[]): Stops {
  const stop: Record<Role, string | null> = { origin: null, destination: null };
  for (const hit of hits) {
    if (hit.role) stop[hit.role] ??= hit.businessId;
  }

  // The first stop after from/to that is not a business, per role, as the sender typed it.
  const hitAt = new Set(hits.map((hit) => hit.at));
  const outside: Record<Role, string | null> = { origin: null, destination: null };
  tokens.forEach((token, at) => {
    if (token.norm !== 'from' && token.norm !== 'to') return;
    const role: Role = token.norm === 'from' ? 'origin' : 'destination';
    if (outside[role] !== null) return;
    let next = at + 1;
    while (tokens[next]?.norm === 'the') next += 1;
    if (hitAt.has(next)) return;
    const words = wordsAfter(text, tokens, at);
    if (!words || !isOutsideStop(role, text, tokens, words[0], words[1])) return;
    const typed = text.slice(tokens[words[0]].start, tokens[words[1]].end);
    outside[role] = typed.length > MAX_STOP_CHARS ? `${typed.slice(0, MAX_STOP_CHARS)}…` : typed;
  });
  // A stop the sentence gave to a business is settled; only an open one can be refused.
  for (const role of ['origin', 'destination'] as const) {
    if (stop[role] !== null) outside[role] = null;
  }

  // A business named without from/to takes the role that is still open: the sender first, but after
  // "for" the recipient first ("an envelope for Blue Bottle").
  const open = (role: Role) => stop[role] === null && outside[role] === null;
  for (const hit of hits) {
    if (hit.role || hit.businessId === stop.origin || hit.businessId === stop.destination) continue;
    const order: Role[] = hit.forIt ? ['destination', 'origin'] : ['origin', 'destination'];
    const role = order.find(open);
    if (role) stop[role] = hit.businessId;
  }

  const refused = [outside.origin, outside.destination].filter((typed): typed is string => typed !== null);
  const [first, second] = refused;
  let rejected: string | null = null;
  if (first !== undefined && (second === undefined || second.toLowerCase() === first.toLowerCase())) {
    rejected = `${NOT_A_NETWORK_BUSINESS} "${first}" is not one of them.`;
  } else if (first !== undefined) {
    rejected = `${NOT_A_NETWORK_BUSINESS} "${first}" and "${second}" are not among them.`;
  }
  return { originBusinessId: stop.origin, destinationBusinessId: stop.destination, rejected };
}

// ---------- times ----------

const DAY = String.raw`(?:today|tonight|tomorrow|day\s?[12])`;
const DAY_PART = String.raw`(?:(?:morning|afternoon|evening)\s+)?`;
// "10", "10:30", "10 a.m.", "5pm", "17:00", "noon". The groups h, mm, mer and word are read by `clockMinutes`.
const CLOCK = String.raw`(?:(?<h>\d{1,2})(?!\d)(?:[:.](?<mm>\d{2})(?!\d))?(?:\s*(?<mer>a\.?m\b\.?|p\.?m\b\.?))?|(?<word>noon|midday|midnight)\b)`;
const DAY_AFTER = String.raw`(?:\s+(?:on\s+)?(?<d3>${DAY})\b)?`;

/** "by 10 a.m. tomorrow", "tomorrow by 10", "by tomorrow at 10", "before noon", "no later than 5 pm today". */
const DEADLINE_KEYED = new RegExp(
  String.raw`(?:\b(?<d1>${DAY})\s+${DAY_PART})?\b(?:by|before|until|till|no\s+later\s+than|due|deadline)(?:\s+(?:is|of|at|by))?\s+`
  + String.raw`(?:(?<d2>${DAY})\s+${DAY_PART})?(?:at\s+)?${CLOCK}${DAY_AFTER}`, 'g');
/** "tomorrow at 10 am". */
const DEADLINE_DAY_AT = new RegExp(String.raw`\b(?<d1>${DAY})\s+${DAY_PART}at\s+${CLOCK}`, 'g');
/** "at 10 am tomorrow". Without the day, "at 5" could be anything. */
const DEADLINE_AT_DAY = new RegExp(String.raw`\bat\s+${CLOCK}\s+(?:on\s+)?(?<d3>${DAY})\b`, 'g');
/**
 * "ready at 4 pm", "available from 4:30 today", "pick up after 9 tomorrow". Without the small word the time
 * must be exact, with am/pm or a colon ("ready 4pm", "pickup 16:00", "ready noon"): "pick up 2 boxes" is no time.
 */
const READY = new RegExp(
  String.raw`\b(?:ready|available|pick(?:ed)?[\s-]?up|collect(?:ion)?)\s+(?:is\s+)?(?:(?<d1>${DAY})\s+)?(?:(?<prep>at|by|from|after|around)\s+)?`
  + String.raw`(?:(?<d2>${DAY})\s+)?${CLOCK}${DAY_AFTER}`, 'g');

/** After a bare number ("by 10"), what may follow for it to be a time: the end, punctuation or a small word. */
const AFTER_BARE_HOUR = /^\s*(?:$|[,;!?)]|\.(?:\s|$)|(?:on|at|from|to|for|and|please|sharp)\b)/;

type TimeGroups = Partial<Record<'h' | 'mm' | 'mer' | 'word' | 'd1' | 'd2' | 'd3' | 'prep', string>>;

/** Minutes after midnight, or null for "25:00" and "10:75". Without am/pm, 1 to 7 is the afternoon. */
function clockMinutes(g: TimeGroups, tonight: boolean): number | null {
  if (g.word) return g.word === 'midnight' ? DAY_MIN : 720; // midnight = the end of that day
  let hour = Number(g.h);
  const minutes = g.mm ? Number(g.mm) : 0;
  if (minutes > 59) return null;
  if (g.mer) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (g.mer.startsWith('p') ? 12 : 0);
  } else {
    if (hour > 23) return null;
    if ((hour >= 1 && hour <= 7) || (tonight && hour >= 1 && hour < 12)) hour += 12;
  }
  return hour * 60 + minutes;
}

/**
 * The minute one match means, or null when it is no time after all.
 * With a day word: that day (today = Day 1, tomorrow = Day 2). Without: the next time the clock shows it.
 */
function minuteOf(match: RegExpMatchArray, lower: string, nowMin: number, mayBeNow: boolean): number | null {
  const g: TimeGroups = match.groups ?? {};
  const day = g.d1 ?? g.d2 ?? g.d3;
  const minutes = clockMinutes(g, day === 'tonight');
  if (minutes === null) return null;
  const bareHour = !g.word && !g.mer && !g.mm;
  if (bareHour && !g.d3 && !AFTER_BARE_HOUR.test(lower.slice((match.index ?? 0) + match[0].length))) return null;

  let value: number;
  if (day) {
    value = (/tomorrow|2/.test(day) ? DAY_MIN : 0) + minutes;
  } else {
    const later = (v: number) => (mayBeNow ? v >= nowMin : v > nowMin);
    value = later(minutes) ? minutes : DAY_MIN + minutes;
  }
  return value >= 0 && value <= LAST_MIN ? value : null;
}

function findDeadline(lower: string, nowMin: number): number | null {
  for (const pattern of [DEADLINE_KEYED, DEADLINE_DAY_AT, DEADLINE_AT_DAY]) {
    for (const match of lower.matchAll(pattern)) {
      const value = minuteOf(match, lower, nowMin, false);
      if (value !== null) return value;
    }
  }
  return /\btomorrow\s+morning\b/.test(lower) ? TOMORROW_MORNING_MIN : null;
}

/** The ready time the sentence states and the sentence without that phrase, so it is not read as the deadline. */
function findReady(lower: string, nowMin: number): { readyMin: number | null; rest: string } {
  for (const match of lower.matchAll(READY)) {
    const g: TimeGroups = match.groups ?? {};
    if (!g.prep && !g.mer && !g.word && !(g.mm && match[0].includes(':'))) continue;
    const value = minuteOf(match, lower, nowMin, true);
    const start = match.index ?? 0;
    if (value !== null) return { readyMin: value, rest: blank(lower, start, start + match[0].length) };
  }
  return { readyMin: null, rest: lower };
}

// ---------- the package ----------

const ITEM = /\b(?:(?<envelope>envelopes?|letters?|documents?|docs|paperwork|papers|contracts?|folders?)|(?<box>box(?:es)?|packages?|parcels?|cartons?))\b/;
// A note in brackets may stand between the item and its contents: "an envelope (0.5 kg) of samples".
const CONTENTS_START = /^(?:\s*\([^()]*\))?\s+(?:full\s+of|of|with|containing|holding)\s+(?:(?:a|an|the|some)\s+)?/;
// Where the contents end: the next part of the sentence, a bracket ("samples (0.5 kg)") or a full stop.
const CONTENTS_END = /\s+(?:from|to|by|before|until|till|for|at|on|ready|due|today|tomorrow|tonight|weighing|asap|please|delivered|sent|shipped)\b|\s*[,;!?()]|\.(?:\s|$)|$/;
const MAX_DESCRIPTION_CHARS = 120;
const WEIGHT = /(?<![\d.])(?<amount>\d+(?:\.\d+)?)\s*(?<unit>kg|kgs|kilos?|kilograms?|g|grams?|lbs?|pounds?|oz|ounces?)\b/;

// No package word (#827): "Send espresso blend samples to X" names what is sent right after the verb.
const SEND_VERB = /\b(?:send|deliver|ship|bring|take|drop[\s-]?off)\b/;
// What may stand before the thing itself: a weight ("2 kg of"), a count ("3", "two"), an article and the like.
const BEFORE_OBJECT = new RegExp(String.raw`^(?:\s+(?:${WEIGHT.source}(?:\s+of\b)?|\d+(?:\.\d+)?\b|(?:`
  + String.raw`a|an|the|some|any|several|few|this|that|these|those|my|our|your|his|her|their|over|out|along|`
  + String.raw`one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b))*`);
// Words that name nothing: a pronoun or a time as the first word ("it", "them", "now"), a vague word alone ("stuff").
const NO_OBJECT = /^(?:(?:it|them|something|anything|everything|me|us|you|him|now|noon|midday|midnight|later|soon)\b|(?:stuff|things?|items?|goods)$)/;
const MAX_LABEL_CHARS = 60; // as in geminiParser.ts

type Item = Pick<ParseDraft, 'label' | 'category' | 'description'>;

/**
 * What is sent, as typed, when the sentence has no package word: the words after the first send verb up to the
 * next part of the sentence (CONTENTS_END) or a business name. Null when they name nothing ("Send it to Etsy").
 */
function findObject(text: string, lower: string): string | null {
  const verb = SEND_VERB.exec(lower);
  if (!verb) return null;
  let from = verb.index + verb[0].length;
  from += BEFORE_OBJECT.exec(lower.slice(from))?.[0].length ?? 0;
  const rest = lower.slice(from);
  const phrase = rest.slice(0, rest.search(CONTENTS_END));
  const lead = phrase.search(/\S/);
  if (lead < 0) return null; // "Send to Etsy", "Deliver by noon"
  const start = from + lead;
  let end = from + phrase.length;
  // A business name is blanked in `lower` and still there in `text`: the phrase ends before it.
  for (let i = start; i < end; i += 1) {
    if (lower.charAt(i) === ' ' && /\S/.test(text.charAt(i))) end = i;
  }
  if (NO_OBJECT.test(lower.slice(start, end).trim())) return null;
  // One line, without a joining word left over by the cut ("Send Etsy samples and Zabar's bagels": "samples").
  const typed = text.slice(start, end).trim().replace(/\s+/g, ' ').replace(/(?: (?:and|or|of|with|the|a|an|&))+$/i, '');
  return /\p{L}/u.test(typed) && !/^\d/.test(typed) ? typed : null;
}

/** `lower` has the business names blanked, so "Print Shop" or "The Box Factory" is never the package. */
function findItem(text: string, lower: string): Item {
  const match = ITEM.exec(lower);
  if (!match) {
    // The object of the sentence is the package name and its contents. The Type stays the user's choice.
    const typed = findObject(text, lower);
    if (typed === null) return { label: null, category: null, description: null };
    return {
      label: capitalised(typed.slice(0, MAX_LABEL_CHARS).trimEnd()),
      category: null,
      description: capitalised(typed.slice(0, MAX_DESCRIPTION_CHARS).trimEnd()),
    };
  }
  const category: PackageCategory = match.groups?.envelope ? 'envelope' : 'small_box';
  const end = match.index + match[0].length;

  // "a box of coffee samples": what follows the item word, up to the next part of the sentence.
  let description: string | null = null;
  const contents = CONTENTS_START.exec(lower.slice(end));
  if (contents) {
    const from = end + contents[0].length;
    const length = lower.slice(from).search(CONTENTS_END);
    const typed = text.slice(from, from + length).trim();
    if (typed !== '' && !/^\d/.test(typed)) description = capitalised(typed.slice(0, MAX_DESCRIPTION_CHARS));
  }
  return { label: capitalised(match[0]), category, description };
}

const KG_PER: Record<string, number> = { k: 1, g: 0.001, l: 0.45359237, p: 0.45359237, o: 0.028349523 };

function findWeightKg(lower: string): number | null {
  const match = WEIGHT.exec(lower);
  if (!match?.groups) return null;
  const kg = Math.round(Number(match.groups.amount) * KG_PER[match.groups.unit.charAt(0)] * 1000) / 1000;
  return Number.isFinite(kg) && kg > 0 ? kg : null;
}

// ---------- the parser ----------

/**
 * The draft the sentence describes, with `source: 'offline'`. Pure: the same text, businesses and minute
 * always give the same answer. It never throws on any text.
 */
export function parseOffline(text: string, context: ParseContext): ParseRequestResponse {
  const nowMin = Number.isFinite(context.nowMin) ? Math.min(LAST_MIN, Math.max(0, Math.floor(context.nowMin))) : 0;

  const tokens = tokenize(text);
  const hits = findBusinesses(text, tokens, buildAliases(context.businesses));
  const stops = resolveStops(text, tokens, hits);

  // From here on the business names are out of the way: "Century 21" is not a time, "Print Shop" not a category.
  let lower = sameLengthLower(text);
  for (const hit of hits) lower = blank(lower, tokens[hit.at].start, tokens[hit.at + hit.length - 1].end);

  const ready = findReady(lower, nowMin);
  const draft: ParseDraft = {
    originBusinessId: stops.originBusinessId,
    destinationBusinessId: stops.destinationBusinessId,
    ...findItem(text, lower),
    weightKg: findWeightKg(lower),
    readyMin: ready.readyMin ?? nowMin,
    deadlineMin: findDeadline(ready.rest, nowMin),
  };
  // Spread order above follows ParseDraft; `missing` follows DRAFT_KEYS, which is the same order.
  return { draft, missing: DRAFT_KEYS.filter((key) => draft[key] === null), rejected: stops.rejected, source: 'offline' };
}
