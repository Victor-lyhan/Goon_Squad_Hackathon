// The offline rule parser of "requests in plain English" (docs/mvp4.md F1, server/ai/ruleParser.ts).
// Pure: the committed NYC business list is read once, nothing else. No network, no key, no clock.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NOT_A_NETWORK_BUSINESS, TOMORROW_MORNING_MIN, parseOffline, type ParseContext } from '../../server/ai/ruleParser';
import type { ParseDraft, ParseRequestResponse } from '../../shared/v2/parseRequest';
import type { NycBusinessesFile } from '../../shared/v2/types';

const { businesses } = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../fixtures/nyc/businesses.json'), 'utf8'),
) as NycBusinessesFile;

/** Day 1 15:30, where a fresh run's clock stands. */
const NOW = 930;
const DAY2 = 1440;
const parse = (text: string, nowMin = NOW, list: ParseContext['businesses'] = businesses) =>
  parseOffline(text, { businesses: list, nowMin });
const draftOf = (text: string, nowMin = NOW) => parse(text, nowMin).draft;

const ETSY = 'biz-etsy';
const ROASTING = 'biz-brooklyn-roasting';
const KEYS: (keyof ParseDraft)[] = [
  'originBusinessId', 'destinationBusinessId', 'label', 'category', 'description', 'weightKg', 'readyMin', 'deadlineMin',
];
const RULE = NOT_A_NETWORK_BUSINESS.replace(/\.$/, '');
const refusal = (...stops: string[]) => (stops.length === 1
  ? `${RULE}, and "${stops[0]}" is not one.`
  : `${RULE}, and "${stops[0]}" and "${stops[1]}" are not.`);

/** What every answer must be, whatever the text. */
function expectWellFormed(answer: ParseRequestResponse) {
  expect(Object.keys(answer)).toEqual(['draft', 'missing', 'rejected', 'source']);
  expect(Object.keys(answer.draft)).toEqual(KEYS);
  expect(answer.source).toBe('offline');
  expect(answer.missing).toEqual(KEYS.filter((key) => answer.draft[key] === null));
  const ids = businesses.map((b) => b.id);
  for (const id of [answer.draft.originBusinessId, answer.draft.destinationBusinessId]) {
    if (id !== null) expect(ids).toContain(id);
  }
  for (const minute of [answer.draft.readyMin, answer.draft.deadlineMin]) {
    if (minute !== null) {
      expect(Number.isInteger(minute)).toBe(true);
      expect(minute).toBeGreaterThanOrEqual(0);
      expect(minute).toBeLessThanOrEqual(2880);
    }
  }
  expect(answer.draft.readyMin).not.toBeNull();
  if (answer.rejected === null) return;
  expect(answer.rejected.startsWith(`${RULE}, and "`)).toBe(true);
  expect(answer.rejected.slice(0, -1).replace(/"[^"]*"/g, '')).not.toMatch(/[.!?;]/);   // one sentence (#898)
  // A refusal always leaves the refused stop empty.
  expect(answer.draft.originBusinessId === null || answer.draft.destinationBusinessId === null).toBe(true);
}

describe('the docs/mvp4.md example', () => {
  it('"Deliver an envelope from Etsy to Brooklyn Roasting by 10 a.m. tomorrow." fills the two stops, the item and the deadline', () => {
    const answer = parse('Deliver an envelope from Etsy to Brooklyn Roasting by 10 a.m. tomorrow.');
    expect(answer).toEqual({
      draft: {
        originBusinessId: ETSY,
        destinationBusinessId: ROASTING,
        label: 'Envelope',
        category: 'envelope',
        description: null,
        weightKg: null,
        readyMin: NOW,               // the clock's minute
        deadlineMin: DAY2 + 600,     // Day 2 10:00 = 2040
      },
      missing: ['description', 'weightKg'],
      rejected: null,
      source: 'offline',
    });
    expectWellFormed(answer);
  });

  it('is deterministic and does not change what it is given', () => {
    const list = structuredClone(businesses);
    const text = 'Deliver an envelope from Etsy to Brooklyn Roasting by 10 a.m. tomorrow.';
    const first = parseOffline(text, { businesses: list, nowMin: NOW });
    expect(parseOffline(text, { businesses: list, nowMin: NOW })).toEqual(first);
    expect(list).toEqual(businesses);
  });
});

describe('business names', () => {
  it.each([
    ['the full name', 'a box from Brooklyn Roasting Company to Etsy'],
    ['a short form', 'a box from Brooklyn Roasting to Etsy'],
    ['lower case', 'a box from brooklyn roasting company to etsy'],
    ['upper case', 'A BOX FROM BROOKLYN ROASTING TO ETSY'],
    ['"to Y from X"', 'a box to Etsy from Brooklyn Roasting'],
    ['"the" before the name', 'a box from the Brooklyn Roasting Company to the Etsy office'],
    ['a possessive', "a box from Brooklyn Roasting to Etsy's front desk"],
  ])('%s: "%s"', (_name, text) => {
    const answer = parse(text);
    expect(answer.draft).toMatchObject({ originBusinessId: ROASTING, destinationBusinessId: ETSY, category: 'small_box' });
    expect(answer.rejected).toBeNull();
    expectWellFormed(answer);
  });

  it('every business is found by its full name, in any case, as sender and as recipient', () => {
    for (const business of businesses) {
      const other = business.id === ETSY ? ROASTING : ETSY;
      const otherName = business.id === ETSY ? 'Brooklyn Roasting Company' : 'Etsy';
      for (const name of [business.name, business.name.toLowerCase(), business.name.toUpperCase()]) {
        expect(draftOf(`Deliver a box from ${name} to ${otherName}`), name)
          .toMatchObject({ originBusinessId: business.id, destinationBusinessId: other });
        expect(draftOf(`Deliver a box to ${name} from ${otherName}`), name)
          .toMatchObject({ originBusinessId: other, destinationBusinessId: business.id });
      }
    }
  });

  it.each([
    ['Starbucks', 'biz-starbucks-reserve'],
    ['Blue Bottle', 'biz-blue-bottle-wall'],
    ['B&H', 'biz-bh-photo'],
    ['McGraw-Hill', 'biz-mcgraw-hill'],
    ['Penguin', 'biz-penguin-random-house'],
    ['Zabars', 'biz-zabars'],
    ['Mast Brothers', 'biz-mast-brothers'],
    ['Levain', 'biz-levain-uws'],
    ['Sweetleaf', 'biz-sweetleaf'],
    ['Century 21', 'biz-century-21'],
  ])('the short form "%s" is %s', (short, id) => {
    expect(draftOf(`Send a parcel from ${short} to Etsy`)).toMatchObject({ originBusinessId: id, destinationBusinessId: ETSY });
  });

  it('a place alone is not a short form: "Brooklyn" names no business', () => {
    const answer = parse('Send a parcel from Etsy to Brooklyn by noon');
    expect(answer.draft).toMatchObject({ originBusinessId: ETSY, destinationBusinessId: null });
    expect(answer.rejected).toBe(refusal('Brooklyn'));
    expectWellFormed(answer);
  });

  it('a business named without from/to takes the role that is still open', () => {
    expect(draftOf('Etsy needs documents taken to Levain Bakery')).toMatchObject({
      originBusinessId: ETSY, destinationBusinessId: 'biz-levain-uws', category: 'envelope', label: 'Documents',
    });
    expect(draftOf('an envelope for JetBlue from WeWork')).toMatchObject({
      originBusinessId: 'biz-wework-montague', destinationBusinessId: 'biz-jetblue',
    });
  });

  // #798: on the Business page the sender is the signed-in business, so the sentence often names one business.
  it('"for X" names the recipient when no "to" does, and never wins over from/to', () => {
    expect(draftOf('An envelope for Blue Bottle Coffee, due tomorrow 10 am')).toMatchObject({
      originBusinessId: null, destinationBusinessId: 'biz-blue-bottle-wall', deadlineMin: DAY2 + 600,
    });
    expect(draftOf('an envelope for the Levain bakery')).toMatchObject({ originBusinessId: null, destinationBusinessId: 'biz-levain-uws' });
    // One common word is still a business only as a name: "for blue pens" is not Blue Bottle Coffee.
    expect(draftOf('a box for blue pens to Etsy')).toMatchObject({ originBusinessId: null, destinationBusinessId: ETSY });
    expect(draftOf('Etsy has a box for JetBlue')).toMatchObject({ originBusinessId: ETSY, destinationBusinessId: 'biz-jetblue' });
    // "to" is the recipient; the business after "for" takes what is left, as before.
    expect(draftOf('Send a box for Etsy to JetBlue')).toMatchObject({ originBusinessId: ETSY, destinationBusinessId: 'biz-jetblue' });
    expect(draftOf('A box from Etsy for JetBlue')).toMatchObject({ originBusinessId: ETSY, destinationBusinessId: 'biz-jetblue' });
    // A stop Relay does not serve stays refused: the business after "for" does not fill its place.
    const home = parse('Send a box for Etsy to my home');
    expect(home.draft).toMatchObject({ originBusinessId: ETSY, destinationBusinessId: null });
    expect(home.rejected).toBe(refusal('my home'));
    expectWellFormed(home);
  });

  it('a common word is a business only as a name: "a blue envelope" is not Blue Bottle Coffee', () => {
    expect(draftOf('Bring a blue envelope to Century 21')).toMatchObject({
      originBusinessId: null, destinationBusinessId: 'biz-century-21',
    });
  });

  it('uses only the businesses it is given', () => {
    const custom = [
      { id: 'biz-print', name: 'Print Shop' },
      { id: 'biz-cafe', name: 'The Corner Cafe' },
      { id: 'biz-cafe-2', name: 'Corner Books' },
    ];
    expect(parse('a box from Print Shop to the Corner Cafe', NOW, custom).draft)
      .toMatchObject({ originBusinessId: 'biz-print', destinationBusinessId: 'biz-cafe' });
    // "Corner" starts two names, so it is not a short form of either; Etsy is not in this run.
    const answer = parse('a box from Etsy to Corner', NOW, custom);
    expect(answer.draft).toMatchObject({ originBusinessId: null, destinationBusinessId: null });
    expect(answer.rejected).toBe(refusal('Etsy', 'Corner'));
    expect(parse('a box from Etsy to Print Shop', NOW, []).draft)
      .toMatchObject({ originBusinessId: null, destinationBusinessId: null });
  });
});

describe('a stop that is not a network business is refused, never guessed', () => {
  it('a home', () => {
    const answer = parse('Deliver an envelope from Etsy to my home by noon');
    expect(answer.draft).toMatchObject({ originBusinessId: ETSY, destinationBusinessId: null, category: 'envelope' });
    expect(answer.rejected).toBe('Relay delivers only between network businesses, and "my home" is not one.');
    expect(answer.missing).toContain('destinationBusinessId');
    expectWellFormed(answer);
  });

  it('a street address', () => {
    const answer = parse('Send a box from 350 5th Avenue, New York to JetBlue by 9:30 am tomorrow');
    expect(answer.draft).toMatchObject({ originBusinessId: null, destinationBusinessId: 'biz-jetblue', deadlineMin: DAY2 + 570 });
    expect(answer.rejected).toBe('Relay delivers only between network businesses, and "350 5th Avenue" is not one.');
    expect(answer.missing).toContain('originBusinessId');
    expectWellFormed(answer);
  });

  // Until #898 the address of a network business was refused like any other address. It now names that
  // business (see "a network business by its street address" below); any other address is still refused.
  it('an address next to a network business is still an address', () => {
    const answer = parse('Pick up a parcel from Etsy and take it to 202 Flushing Avenue');
    expect(answer.draft).toMatchObject({ originBusinessId: ETSY, destinationBusinessId: null });
    expect(answer.rejected).toBe(refusal('202 Flushing Avenue'));
    expectWellFormed(answer);
  });

  it('an unknown name', () => {
    const answer = parse('Deliver a letter from Acme Corp to Etsy');
    expect(answer.draft).toMatchObject({ originBusinessId: null, destinationBusinessId: ETSY });
    expect(answer.rejected).toBe(refusal('Acme Corp'));
    expectWellFormed(answer);
  });

  it('both stops', () => {
    const answer = parse('Move a box from my home in Brooklyn to 12 Main St. Apt 4');
    expect(answer.draft).toMatchObject({ originBusinessId: null, destinationBusinessId: null });
    expect(answer.rejected).toBe(refusal('my home in Brooklyn', '12 Main St. Apt 4'));
    expectWellFormed(answer);
  });

  it('"to" before a verb, a time or an amount is not a stop', () => {
    for (const text of [
      'I need to send a box from Etsy',
      'I would like to get an envelope from Etsy by 5 pm',
      'A box from Etsy, ready from 4 pm, up to 2 kg',
    ]) {
      const answer = parse(text);
      expect(answer.rejected, text).toBeNull();
      expect(answer.draft, text).toMatchObject({ originBusinessId: ETSY, destinationBusinessId: null });
    }
  });

  it('a very long stop is cut in the message', () => {
    const { rejected } = parse(`Send a box from ${'Supercalifragilistic'.repeat(10)} Depot to Etsy`);
    expect(rejected).toMatch(/^Relay delivers only between network businesses, and "Supercali.{51}…" is not one\.$/);
  });
});

describe('a network business by its street address (#898)', () => {
  const BLUE_BOTTLE = 'biz-blue-bottle-wall';   // 1 Wall Street, New York, NY 10005
  const LEVAIN = 'biz-levain-uws';              // 167 West 74th Street, New York, NY 10023
  const JETBLUE = 'biz-jetblue';                // 27-01 Queens Plaza North, Long Island City, NY 11101
  const BH = 'biz-bh-photo';                    // 420 9th Avenue, New York, NY 10001

  it.each<[string, string]>([
    ['1 Wall Street', BLUE_BOTTLE],
    ['1 Wall St', BLUE_BOTTLE],
    ['1 Wall St.', BLUE_BOTTLE],
    ['1 wall street', BLUE_BOTTLE],
    ['1 WALL STREET', BLUE_BOTTLE],
    ['One Wall Street', BLUE_BOTTLE],
    ['1 Wall Street, New York', BLUE_BOTTLE],
    ['1 Wall Street, New York, NY 10005', BLUE_BOTTLE],
    ['the 1 Wall Street', BLUE_BOTTLE],
    ['200 Flushing Avenue', ROASTING],
    ['200 Flushing Ave', ROASTING],
    ['200 flushing ave., brooklyn', ROASTING],
    ['167 West 74th Street', LEVAIN],
    ['167 W 74th St', LEVAIN],
    ['167 W. 74th St.', LEVAIN],
    ['420 9th Avenue', BH],
    ['420 Ninth Ave', BH],
    ['27-01 Queens Plaza North', JETBLUE],
    ['27-01 Queens Plaza N', JETBLUE],
  ])('"to %s" is %s', (address, id) => {
    const answer = parse(`Send an envelope from Etsy to ${address} by 10 a.m. tomorrow`);
    expect(answer.draft).toMatchObject({ originBusinessId: ETSY, destinationBusinessId: id, deadlineMin: DAY2 + 600 });
    expect(answer.rejected).toBeNull();
    expect(answer.missing).not.toContain('destinationBusinessId');
    expectWellFormed(answer);
  });

  it('after "from" it is the sender, and both stops may be addresses', () => {
    const answer = parse('Send a 0.5 kg envelope from 200 Flushing Ave to 1 Wall St by 10 a.m. tomorrow, ready at 4 p.m.');
    expect(answer.draft).toMatchObject({
      originBusinessId: ROASTING, destinationBusinessId: BLUE_BOTTLE, weightKg: 0.5, readyMin: 960, deadlineMin: DAY2 + 600,
    });
    expect(answer.rejected).toBeNull();
  });

  it('the house number is not read as a time or a weight', () => {
    expect(draftOf('Send an envelope to 1 Wall Street by 5')).toMatchObject({ destinationBusinessId: BLUE_BOTTLE, deadlineMin: 1020, weightKg: null });
    expect(draftOf('Send a 2 kg box by 10 Wall Street tomorrow to 1 Wall St')).toMatchObject({ destinationBusinessId: BLUE_BOTTLE, weightKg: 2 });
  });

  it.each<[string, string]>([
    ['2 Wall Street', '2 Wall Street'],                 // another house number
    ['11 Wall Street', '11 Wall Street'],
    ['12-1 Wall Street', '12-1 Wall Street'],
    ['Wall Street', 'Wall Street'],                     // no house number
    ['1 Wall Street Court', '1 Wall Street Court'],     // another street
    ['1 Wall Avenue', '1 Wall Avenue'],
    ['1 Water Street', '1 Water Street'],
    ['201 Flushing Avenue', '201 Flushing Avenue'],
    ['1325 6th Ave', '1325 6th Ave'],                   // "Avenue of the Americas" under another name: not guessed
  ])('"to %s" is not a network business: refused, never matched to the nearest one', (address, typed) => {
    const answer = parse(`Send an envelope from Etsy to ${address} by 10 a.m. tomorrow`);
    expect(answer.draft).toMatchObject({ originBusinessId: ETSY, destinationBusinessId: null });
    expect(answer.rejected).toBe(refusal(typed));
    expectWellFormed(answer);
  });

  it('an address names a stop only after from/to: elsewhere it is left alone', () => {
    const answer = parse('Send an envelope, 1 Wall Street, by 10 a.m. tomorrow');
    expect(answer.draft).toMatchObject({ originBusinessId: null, destinationBusinessId: null });
    expect(answer.rejected).toBeNull();
  });

  it('after the business\'s own name the address is a part of that name, and gives no second stop', () => {
    const own = parse('Send an envelope to Blue Bottle Coffee, 1 Wall Street, New York by 10 a.m. tomorrow');
    expect(own.draft).toMatchObject({ originBusinessId: null, destinationBusinessId: BLUE_BOTTLE });
    // The address of another business after a name is not a hint for the open stop either: the name wins.
    const other = parse('Send an envelope to Blue Bottle Coffee, 117 Adams Street by 10 a.m. tomorrow');
    expect(other.draft).toMatchObject({ originBusinessId: null, destinationBusinessId: BLUE_BOTTLE });
    expect([own.rejected, other.rejected]).toStrictEqual([null, null]);
  });

  it('an address two businesses share names neither, and a list without addresses still parses', () => {
    const shared = businesses.map((b) => (b.id === ETSY ? { ...b, address: '1 Wall St, New York, NY 10005' } : b));
    const answer = parse('Send an envelope to 1 Wall Street', NOW, shared);
    expect(answer.draft.destinationBusinessId).toBeNull();
    expect(answer.rejected).toBe(refusal('1 Wall Street'));

    const bare = businesses.map(({ id, name }) => ({ id, name }));
    expect(parse('Send an envelope from Etsy to 1 Wall Street', NOW, bare).draft).toMatchObject({ originBusinessId: ETSY, destinationBusinessId: null });
    expect(parse('Send an envelope from Etsy to Blue Bottle', NOW, bare).draft).toMatchObject({ originBusinessId: ETSY, destinationBusinessId: BLUE_BOTTLE });
  });
});

describe('time phrases, in minutes since Day 1 00:00 (today = Day 1, tomorrow = Day 2)', () => {
  const base = 'An envelope from Etsy to Brooklyn Roasting';
  it.each<[string, number | null, number?]>([
    ['by 10 a.m. tomorrow', DAY2 + 600],
    ['by 10 AM tomorrow', DAY2 + 600],
    ['by 10am tomorrow', DAY2 + 600],
    ['tomorrow by 10', DAY2 + 600],
    ['by tomorrow at 10:30', DAY2 + 630],
    ['tomorrow at 9 am', DAY2 + 540],
    ['at 9 am tomorrow', DAY2 + 540],
    ['by 5 pm today', 1020],
    ['by 5 p.m. today', 1020],
    ['before 17:30 today', 1050],
    ['no later than 6 pm', 1080],                 // still ahead of 15:30 today
    ['by 5', 1020],                               // 1 to 7 without am/pm is the afternoon
    ['by 8 tonight', 1200],
    ['by noon', DAY2 + 720],                      // noon today has passed at 15:30
    ['by noon', 720, 600],                        // at 10:00 it is still ahead
    ['by noon today', 720],
    ['by noon tomorrow', DAY2 + 720],
    ['by midnight', 1440],
    ['by 11 am', DAY2 + 660],
    ['by 11 am', 660, 480],
    ['tomorrow morning', TOMORROW_MORNING_MIN],
    ['by tomorrow morning', TOMORROW_MORNING_MIN],
    ['by Day 2 9:15', DAY2 + 555],
    // #898: the next morning is tomorrow's, and the part of the day says which 8 is meant.
    ['next morning', TOMORROW_MORNING_MIN],
    ['by next morning', TOMORROW_MORNING_MIN],
    ['by the next morning', TOMORROW_MORNING_MIN],
    ['by 10 the next morning', DAY2 + 600],
    ['by 9 next morning', DAY2 + 540],
    ['by 9 a.m. the next day', DAY2 + 540],
    ['by 7 tomorrow morning', DAY2 + 420],          // not 7 p.m.
    ['by 8 this evening', 1200],
    ['by 8 pm this evening', 1200],
    ['this evening at 8', 1200],
    ['by 8 in the evening', 1200],
    ['by 8 tomorrow evening', DAY2 + 1200],
    ['tomorrow evening at 8', DAY2 + 1200],
    ['by 5 this afternoon', 1020],
    ['tomorrow 10am', DAY2 + 600],                  // a day and an exact time, with no "by" or "at"
    ['tomorrow morning 10:00', DAY2 + 600],
    ['Day 2 9:15', DAY2 + 555],
    ['tomorrow 10', null],                          // not exact: "tomorrow 10 boxes"
    ['Day 1 16:00 to Day 2 10:00', null],           // two such times: nothing says which is the deliver-by
    ['this evening', null],                         // an evening without an hour is no time
    ['by this evening', null],
    ['tonight', null],
    ['', null],
    ['tomorrow', null],                            // a day without a time is not a deadline
    ['by 25:00 tomorrow', null],
    ['by 10:75 tomorrow', null],
    ['by 10 boxes', null],
    ['at 5', null],
  ])('"%s" -> %s', (phrase, deadlineMin, nowMin = NOW) => {
    const answer = parse(`${base} ${phrase}`.trim(), nowMin);
    expect(answer.draft.deadlineMin).toBe(deadlineMin);
    expect(answer.draft.readyMin).toBe(nowMin);
    expect(answer.missing.includes('deadlineMin')).toBe(deadlineMin === null);
    expect(answer.draft).toMatchObject({ originBusinessId: ETSY, destinationBusinessId: ROASTING });
    expectWellFormed(answer);
  });

  it('"tomorrow morning" is by 10:00 on Day 2', () => {
    expect(TOMORROW_MORNING_MIN).toBe(2040);
  });

  it('readyMin defaults to the clock\'s minute, as a whole minute inside the two days', () => {
    expect(draftOf('hello', 930).readyMin).toBe(930);
    expect(draftOf('hello', 1950).readyMin).toBe(1950);
    expect(draftOf('hello', 1000.7).readyMin).toBe(1000);
    expect(draftOf('hello', -5).readyMin).toBe(0);
    expect(draftOf('hello', 99999).readyMin).toBe(2880);
    expect(draftOf('hello', Number.NaN).readyMin).toBe(0);
  });

  it('a stated ready time is the ready time, not the deadline', () => {
    expect(draftOf(`${base}, ready at 4 pm, by tomorrow at 11`)).toMatchObject({ readyMin: 960, deadlineMin: DAY2 + 660 });
    expect(draftOf(`${base}, pick up after 4:30 pm today`)).toMatchObject({ readyMin: 990, deadlineMin: null });
    expect(draftOf(`${base}, available from 9 am tomorrow, deliver by noon tomorrow`))
      .toMatchObject({ readyMin: DAY2 + 540, deadlineMin: DAY2 + 720 });
  });

  // #798: "ready 4pm" was skipped, so the ready time stayed at the clock's minute.
  it.each<[string, number]>([
    ['ready 4pm', 960],
    ['ready 4 p.m.', 960],
    ['pickup 16:00', 960],
    ['ready today 4:30 pm', 990],
    ['ready at 4 this afternoon', 960],             // #898: was skipped, so ready stayed at the clock
    ['ready this afternoon at 4', 960],
    ['ready at 6 this evening', 1080],
    ['ready noon tomorrow', DAY2 + 720],
    ['available 9 am tomorrow', DAY2 + 540],
  ])('an exact ready time needs no "at": "%s" -> %s', (phrase, readyMin) => {
    expect(draftOf(`${base}, ${phrase}, by tomorrow at 11`)).toMatchObject({ readyMin, deadlineMin: DAY2 + 660 });
  });

  it.each([
    'pick up 2 boxes',          // an amount
    'ready 4',                  // a bare number
    'collect 12.50 dollars',    // a price
    'ready 25:00',              // no time
  ])('without "at", "%s" is no ready time', (phrase) => {
    expect(draftOf(`${base}, ${phrase}, by tomorrow at 11`)).toMatchObject({ readyMin: NOW, deadlineMin: DAY2 + 660 });
  });

  it('a number in a business name is not a time', () => {
    expect(draftOf('A box from Etsy by Century 21')).toMatchObject({ deadlineMin: null });
  });
});

describe('the package', () => {
  it.each([
    ['envelope', 'envelope', 'Envelope'],
    ['letter', 'envelope', 'Letter'],
    ['documents', 'envelope', 'Documents'],
    ['contract', 'envelope', 'Contract'],
    ['box', 'small_box', 'Box'],
    ['package', 'small_box', 'Package'],
    ['parcel', 'small_box', 'Parcel'],
    ['Parcels', 'small_box', 'Parcels'],
  ])('"%s" is %s', (word, category, label) => {
    expect(draftOf(`Send the ${word} from Etsy to JetBlue`)).toMatchObject({ category, label });
  });

  it('no item word: category and label stay null and are listed as missing', () => {
    const answer = parse('From Etsy to JetBlue by noon');
    expect(answer.draft).toMatchObject({ category: null, label: null, description: null, weightKg: null });
    expect(answer.missing).toEqual(['label', 'category', 'description', 'weightKg']);
    expectWellFormed(answer);
  });

  it('the first item word decides', () => {
    expect(draftOf('A package of documents from Etsy to JetBlue')).toMatchObject({
      category: 'small_box', label: 'Package', description: 'Documents',
    });
  });

  it('what the item holds becomes the description', () => {
    expect(draftOf('A parcel of coffee samples, 1.5 kg, from Blue Bottle to Zabar\'s tomorrow morning')).toEqual({
      originBusinessId: 'biz-blue-bottle-wall', destinationBusinessId: 'biz-zabars', label: 'Parcel', category: 'small_box',
      description: 'Coffee samples', weightKg: 1.5, readyMin: NOW, deadlineMin: TOMORROW_MORNING_MIN,
    });
    expect(parse('A parcel of coffee samples, 1.5 kg, from Blue Bottle to Zabar\'s tomorrow morning').missing).toEqual([]);
    expect(draftOf('A box with the signed lease from Etsy to JetBlue').description).toBe('Signed lease');
  });

  // #798: wordings of the README demo package that put the weight in brackets or end on "delivered".
  it.each([
    'An envelope of espresso blend samples (0.5 kg) from Etsy to JetBlue',
    'An envelope (0.5 kg) of espresso blend samples from Etsy to JetBlue',
    'An envelope(0.5 kg) with espresso blend samples, from Etsy to JetBlue',
    'We need a 0.5 kg envelope of espresso blend samples delivered from Etsy to JetBlue',
    'A 0.5 kg envelope of espresso blend samples sent from Etsy to JetBlue',
    'From Etsy to JetBlue: a 0.5 kg envelope of espresso blend samples.',
  ])('the description is the contents only: "%s"', (text) => {
    expect(draftOf(text)).toMatchObject({
      originBusinessId: ETSY, destinationBusinessId: 'biz-jetblue', label: 'Envelope', category: 'envelope',
      description: 'Espresso blend samples', weightKg: 0.5,
    });
  });

  it('a bracket that is not followed by the contents is no description', () => {
    expect(draftOf('An envelope (signed) from Etsy to JetBlue').description).toBeNull();
    expect(draftOf('An envelope of (see note) from Etsy to JetBlue').description).toBeNull();
  });

  it.each<[string, number | null]>([
    ['1.5 kg', 1.5], ['2kg', 2], ['500 g', 0.5], ['200 grams', 0.2], ['1 lb', 0.454], ['8 oz', 0.227],
    ['0 kg', null], ['about two kilos', null],
  ])('weight "%s" -> %s kg', (phrase, weightKg) => {
    expect(draftOf(`A box from Etsy to JetBlue, ${phrase}`).weightKg).toBe(weightKg);
  });
});

// #827: the F1 browser check (#807) typed "Send espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow."
// and got an empty Package name and Contents, although the sentence says what is sent.
describe('no package word: what is sent names the package and is its contents (#827)', () => {
  const BLUE_BOTTLE = 'biz-blue-bottle-wall';

  it('"Send espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow." fills the name and the contents, never the Type', () => {
    const answer = parse('Send espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow.');
    expect(answer).toEqual({
      draft: {
        originBusinessId: null, destinationBusinessId: BLUE_BOTTLE, label: 'Espresso blend samples', category: null,
        description: 'Espresso blend samples', weightKg: null, readyMin: NOW, deadlineMin: DAY2 + 600,
      },
      missing: ['originBusinessId', 'category', 'weightKg'],   // the Type is the user's choice
      rejected: null,
      source: 'offline',
    });
    expectWellFormed(answer);
  });

  it('"Send 2 kg of coffee beans to Etsy." gives the weight and the contents', () => {
    const answer = parse('Send 2 kg of coffee beans to Etsy.');
    expect(answer.draft).toMatchObject({
      destinationBusinessId: ETSY, label: 'Coffee beans', category: null, description: 'Coffee beans', weightKg: 2,
    });
    expect(answer.missing).toEqual(['originBusinessId', 'category', 'deadlineMin']);
    expectWellFormed(answer);
  });

  it.each(['Send', 'send', 'Deliver', 'Ship', 'Bring', 'Take', 'Drop off', 'Please deliver', 'I need to send', 'Can you bring'])(
    'after the verb: "%s coffee beans to Etsy"', (verb) => {
      expect(draftOf(`${verb} coffee beans to Etsy`)).toMatchObject({
        destinationBusinessId: ETSY, label: 'Coffee beans', category: null, description: 'Coffee beans',
      });
    });

  it.each([
    'a', 'an', 'the', 'some', 'two', 'twelve', '3', 'a few', 'the two', 'this', 'our', 'over the',
    '2 kg of', '0.5kg', 'a 500 g', '1 lb of the',
  ])('"%s" before it is dropped', (before) => {
    expect(draftOf(`Send ${before} espresso samples to Etsy`)).toMatchObject({
      label: 'Espresso samples', description: 'Espresso samples', category: null,
    });
  });

  it.each([
    'to Etsy', 'from Etsy to JetBlue', 'by noon', 'before 5 pm today', 'for Etsy', 'at Etsy', 'tomorrow morning to Etsy',
    'ready at 4 pm', 'weighing 1 kg', 'asap', 'please', ', to Etsy', '; thanks', '(1 kg) to Etsy', '. Thanks!', '.', '',
    'Etsy',   // a business name ends it too
  ])('it ends at the next part of the sentence: "Send coffee beans %s"', (rest) => {
    expect(draftOf(`Send coffee beans ${rest}`.trim())).toMatchObject({ label: 'Coffee beans', description: 'Coffee beans' });
  });

  it('is kept as typed, on one line, with a capital first letter', () => {
    expect(draftOf('send the Kenya AA beans & two V60 filters to Etsy').description).toBe('Kenya AA beans & two V60 filters');
    expect(draftOf('SEND COFFEE\n  BEANS TO ETSY').label).toBe('COFFEE BEANS');
    expect(draftOf("Send étienne's croissants to Etsy").label).toBe("Étienne's croissants");
  });

  it('the name is cut to 60 characters and the contents to 120', () => {
    const words = 'very long words '.repeat(12).trim();   // 191 characters
    const { label, description } = draftOf(`Send ${words} to Etsy`);
    expect(label).toBe(`V${words.slice(1, 60).trimEnd()}`);
    expect(label!.length).toBeLessThanOrEqual(60);
    expect(description).toBe(`V${words.slice(1, 120).trimEnd()}`);
    expect(description!.length).toBeLessThanOrEqual(120);
  });

  it.each([
    'Send it to Etsy',
    'Send this to Etsy',
    'Send something to Etsy',
    'Send stuff to Etsy',
    'Send some stuff to Etsy',
    'Send them over to Etsy',
    'Send one to Etsy',
    'Send to Etsy by noon',               // an empty phrase
    'Deliver by noon to Etsy',
    'Deliver tomorrow morning to Etsy',
    'Deliver now to Etsy',
    'Deliver 9:30 tomorrow to Etsy',
    'Send 350 5th Avenue to Etsy',        // what is left starts with a number
    'Send',
    'Send.',
    'Send 2 kg to Etsy',
    'Coffee beans to Etsy by noon',       // no verb: nothing says where the object starts
  ])('a pronoun, an empty phrase or no verb gives nothing: "%s"', (text) => {
    const answer = parse(text);
    expect(answer.draft).toMatchObject({ label: null, category: null, description: null });
    expect(answer.missing).toEqual(expect.arrayContaining(['label', 'category', 'description']));
    expectWellFormed(answer);
  });

  it('a business name is never the package', () => {
    // "Blue Bottle Coffee" is a stop (blanked), not coffee to send.
    expect(draftOf('Send Blue Bottle Coffee to Etsy')).toMatchObject({
      originBusinessId: BLUE_BOTTLE, destinationBusinessId: ETSY, label: null, description: null,
    });
    expect(draftOf('Deliver to Etsy from Blue Bottle Coffee')).toMatchObject({ label: null, description: null });
    // Before and inside the phrase: the name is left out and ends the phrase.
    expect(draftOf('Send Etsy coffee beans')).toMatchObject({ originBusinessId: ETSY, label: 'Coffee beans' });
    expect(draftOf("Send Etsy samples and Zabar's bagels to JetBlue")).toMatchObject({
      destinationBusinessId: 'biz-jetblue', label: 'Samples', description: 'Samples',
    });
  });

  it('a sentence with a package word keeps that name and its Type (DECISIONS pass 86)', () => {
    expect(draftOf('Send espresso blend samples in a box to Etsy')).toMatchObject({ label: 'Box', category: 'small_box', description: null });
    expect(draftOf('Send the documents to Etsy')).toMatchObject({ label: 'Documents', category: 'envelope', description: null });
    expect(draftOf('Send a box to Etsy')).toMatchObject({ label: 'Box', category: 'small_box', description: null });
    expect(draftOf('Send a box of 12 bagels to Etsy')).toMatchObject({ label: 'Box', category: 'small_box', description: null });
  });

  // Nothing else changes: the answers the server gave before #827, as recorded by the browser check
  // (tests/ui/business-v2-request-text-sentences.test.tsx, sentences 1, 2 and 4 to 7) and by #798 for the
  // README demo sentence (tests/api/v2-f1-demo-sentence.test.ts sends it and checks the match).
  const LONG = ('Please deliver a small box of espresso blend samples from Brooklyn Roasting Company to Blue Bottle Coffee by '
    + '10 a.m. tomorrow, ready at 4 p.m.; the box holds twelve sample bags for the new winter menu, each one labelled with '
    + 'its roast date, and it should be handed to the shift manager at the front counter, who knows it is coming and will '
    + 'sign for it, so the courier does not need to wait in the line with the morning customers or call ahead before '
    + 'arriving at the shop.').padEnd(500, '.');
  const recorded = (draft: ParseDraft, missing: (keyof ParseDraft)[], rejected: string | null = null): ParseRequestResponse =>
    ({ draft, missing, rejected, source: 'offline' });
  it.each<[string, string, ParseRequestResponse]>([
    ['sentence 1', 'Deliver an envelope from Brooklyn Roasting Company to Blue Bottle Coffee by 10 a.m. tomorrow.', recorded({
      originBusinessId: ROASTING, destinationBusinessId: BLUE_BOTTLE, label: 'Envelope',
      category: 'envelope', description: null, weightKg: null, readyMin: 930, deadlineMin: 2040,
    }, ['description', 'weightKg'])],
    ['sentence 2', 'Send a small box of coffee beans to Etsy.', recorded({
      originBusinessId: null, destinationBusinessId: ETSY, label: 'Box', category: 'small_box',
      description: 'Coffee beans', weightKg: null, readyMin: 930, deadlineMin: null,
    }, ['originBusinessId', 'weightKg', 'deadlineMin'])],
    ['sentence 4', 'Deliver an envelope to 123 Main Street, Brooklyn by 10 a.m. tomorrow.', recorded({
      originBusinessId: null, destinationBusinessId: null, label: 'Envelope', category: 'envelope',
      description: null, weightKg: null, readyMin: 930, deadlineMin: 2040,
    }, ['originBusinessId', 'destinationBusinessId', 'description', 'weightKg'], refusal('123 Main Street'))],
    ['sentence 5', "Send an envelope to Joe's Pizza by 9 a.m. tomorrow.", recorded({
      originBusinessId: null, destinationBusinessId: null, label: 'Envelope', category: 'envelope',
      description: null, weightKg: null, readyMin: 930, deadlineMin: 1980,
    }, ['originBusinessId', 'destinationBusinessId', 'description', 'weightKg'], refusal("Joe's Pizza"))],
    ['sentence 6', 'Deliver an envelope from Etsy to Blue Bottle Coffee by 10 a.m. tomorrow.', recorded({
      originBusinessId: ETSY, destinationBusinessId: BLUE_BOTTLE, label: 'Envelope',
      category: 'envelope', description: null, weightKg: null, readyMin: 930, deadlineMin: 2040,
    }, ['description', 'weightKg'])],
    ['sentence 7 (500 characters)', LONG, recorded({
      originBusinessId: ROASTING, destinationBusinessId: BLUE_BOTTLE, label: 'Box',
      category: 'small_box', description: 'Espresso blend samples', weightKg: null, readyMin: 960, deadlineMin: 2040,
    }, ['weightKg'])],
    ['the README demo sentence', 'Send a 0.5 kg envelope of espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow, ready at 4 p.m.', recorded({
      originBusinessId: null, destinationBusinessId: BLUE_BOTTLE, label: 'Envelope',
      category: 'envelope', description: 'Espresso blend samples', weightKg: 0.5, readyMin: 960, deadlineMin: 2040,
    }, ['originBusinessId'])],
  ])('a sentence with a package word is read as before: %s', (_name, text, answer) => {
    expect(parse(text, 930)).toEqual(answer);
  });
});

describe('any text gives a well-formed answer', () => {
  it.each([
    'hello',
    '?',
    '   ',
    'from',
    'to',
    'from to from to by by at',
    'by tomorrow',
    'from Etsy to Etsy',
    '🚚📦 from Etsy ➡ JetBlue',
    'Liefer einen Umschlag von Etsy nach JetBlue',
    '<script>alert(1)</script> from "x" to \'y\'',
    'a.m. p.m. 10 10 10 :: .. ,,',
    'x'.repeat(500),
    `${'from my home to '.repeat(31)}Etsy`,
    'send send send',
    'Send a an the some two',
    `Send ${'the '.repeat(120)}`,
    `deliver ${'y'.repeat(480)}`,
    'Send <b>bold</b> & "quotes" to Etsy',
  ])('%s', (text) => {
    expectWellFormed(parse(text));
  });

  it('nothing recognised: everything but readyMin is missing', () => {
    expect(parse('hello')).toEqual({
      draft: {
        originBusinessId: null, destinationBusinessId: null, label: null, category: null,
        description: null, weightKg: null, readyMin: NOW, deadlineMin: null,
      },
      missing: ['originBusinessId', 'destinationBusinessId', 'label', 'category', 'description', 'weightKg', 'deadlineMin'],
      rejected: null,
      source: 'offline',
    });
  });
});
