// #863 (the AI what-if advisor, UI half): the pure model between POST /api/v2/advise (#862) and the Options
// card of the Business New delivery page. The card in the page: business-v2-dom-advice.test.tsx. The call
// itself (`advise` of client/src/api/v2): tests/api/v2-client-routes.test.ts.
import { describe, expect, it } from 'vitest';
import type { AdviseOption, AdviseResponse } from '../../shared/v2/api';
import {
  ADVICE_COPY, adviceCard, adviceSourceLabel, adviseDraft, appliedText, chosenKey, type AdviseDraft,
} from '../../client/src/components/business/v2/adviceModel';
import { draftTimes, emptyDraft, sameTimes, type NewDeliveryDraft } from '../../client/src/components/business/v2/newDeliveryModel';
import { ACME, ATLAS, BAKERY, BUSINESSES } from './business-v2-details-sample';

/** Ready Day 1 16:00, deliver by Day 2 10:00. */
const DRAFT: AdviseDraft = {
  originBusinessId: ACME.id, destinationBusinessId: BAKERY.id, label: 'Envelope', category: 'envelope',
  description: 'Signed contract', weightKg: 0.2, readyMin: 960, deadlineMin: 2040,
};
const option = (over: Partial<AdviseOption> = {}): AdviseOption => ({
  label: 'As requested', summary: 'Next-morning relay through Atlas Books.', changes: {}, kind: 'relay',
  relayBusinessId: ATLAS.id, carrierNames: ['Maya Chen', 'Luis Ortega'], deliveryMin: 1985, extraMin: 17,
  extraMiles: 2.4, customerPriceCents: 1600, ...over,
});
const EARLIER = option({
  label: 'Ready 30 minutes earlier', summary: 'One carrier takes it tonight.', changes: { readyMin: 930 }, kind: 'direct',
  relayBusinessId: undefined, carrierNames: ['Maya Chen'], deliveryMin: 1110, extraMin: 9, extraMiles: 1, customerPriceCents: 1250,
});
const LATER = option({
  label: 'Deliver by noon', summary: 'A wider window earns the flexibility discount.', changes: { deadlineMin: 2160 },
  customerPriceCents: 1400, deliveryMin: 2010,
});
const answer = (options: unknown[], over: Partial<AdviseResponse> = {}) => ({ options, source: 'gemini', ...over });
const card = (response: unknown) => adviceCard(response, { draft: DRAFT, businesses: BUSINESSES });

describe('adviseDraft: the request the options are asked for', () => {
  const form = (over: Partial<NewDeliveryDraft> = {}): NewDeliveryDraft => ({
    ...emptyDraft(), recipientId: BAKERY.id, label: ' Envelope ', description: 'Signed contract', weightKg: '0.2', ...over,
  });

  it('is the form\'s starting draft in the units of the parse-request draft, sent from the signed-in business', () => {
    expect(adviseDraft(form(), ACME.id)).toEqual(DRAFT);
  });

  it('keeps null where the form has nothing to say', () => {
    expect(adviseDraft(form({ label: '  ', description: '', weightKg: 'heavy' }), ACME.id)).toEqual({
      ...DRAFT, label: null, description: null, weightKg: null,
    });
  });

  it('is null without a recipient or with a time that is no time: nothing to price', () => {
    expect(adviseDraft(form({ recipientId: '' }), ACME.id)).toBeNull();
    expect(adviseDraft(form({ readyTime: '' }), ACME.id)).toBeNull();
    expect(adviseDraft(form({ deadlineTime: '25:00' }), ACME.id)).toBeNull();
    expect(adviseDraft(form(), '')).toBeNull();
  });
});

describe('draftTimes: minutes as the form holds them', () => {
  it('ready on Day 1, deliver-by on Day 1 or Day 2', () => {
    expect(draftTimes(960, 2040)).toEqual({ readyTime: '16:00', deadlineDay: 2, deadlineTime: '10:00' });
    expect(draftTimes(845, 1439)).toEqual({ readyTime: '14:05', deadlineDay: 1, deadlineTime: '23:59' });
  });

  it('null for what the form cannot hold', () => {
    expect(draftTimes(1440, 2040)).toBeNull();   // ready on Day 2
    expect(draftTimes(960, 2880)).toBeNull();    // deliver by on Day 3
    expect(draftTimes(-1, 2040)).toBeNull();
    expect(draftTimes(960.5, 2040)).toBeNull();
    expect(draftTimes(NaN, 2040)).toBeNull();
  });

  it('sameTimes compares the three fields', () => {
    const t = draftTimes(960, 2040)!;
    expect(sameTimes(t, { ...t })).toBe(true);
    expect(sameTimes(t, { ...t, deadlineDay: 1 })).toBe(false);
    expect(sameTimes(t, { ...t, readyTime: '16:01' })).toBe(false);
  });
});

describe('adviceCard: the rows of the Options card', () => {
  it('formats every number of the answer and computes none', () => {
    const c = card(answer([option(), EARLIER, LATER]))!;
    expect(c.sourceLabel).toBe('Planned by Gemini, priced by Relay');
    expect(c.note).toBeNull();
    expect(c.rows).toEqual([
      {
        key: 'option-0', label: 'As requested', summary: 'Next-morning relay through Atlas Books.', priceText: '$16.00',
        cheapest: false, arrivalText: 'Day 2, 9:05 AM', routeText: 'Via Atlas Books', extraText: '+17\u00a0min · +2.4\u00a0mi',
        carriersText: 'Maya Chen, Luis Ortega', times: { readyTime: '16:00', deadlineDay: 2, deadlineTime: '10:00' },
      },
      {
        key: 'option-1', label: 'Ready 30 minutes earlier', summary: 'One carrier takes it tonight.', priceText: '$12.50',
        cheapest: true, arrivalText: 'Day 1, 6:30 PM', routeText: 'Direct', extraText: '+9\u00a0min · +1.0\u00a0mi',
        carriersText: 'Maya Chen', times: { readyTime: '15:30', deadlineDay: 2, deadlineTime: '10:00' },
      },
      {
        key: 'option-2', label: 'Deliver by noon', summary: 'A wider window earns the flexibility discount.', priceText: '$14.00',
        cheapest: false, arrivalText: 'Day 2, 9:30 AM', routeText: 'Via Atlas Books', extraText: '+17\u00a0min · +2.4\u00a0mi',
        carriersText: 'Maya Chen, Luis Ortega', times: { readyTime: '16:00', deadlineDay: 2, deadlineTime: '12:00' },
      },
    ]);
  });

  it('the source label never claims Gemini unless the server says so', () => {
    expect(adviceSourceLabel('gemini')).toBe(ADVICE_COPY.byModel);
    expect(adviceSourceLabel('offline')).toBe('Priced by Relay, no AI model');
    expect(adviceSourceLabel(undefined)).toBe(ADVICE_COPY.offline);
    expect(card(answer([option()], { source: 'offline' }))!.sourceLabel).toBe('Priced by Relay, no AI model');
    expect(card({ options: [option()] })!.sourceLabel).toBe('Priced by Relay, no AI model');
  });

  it('marks the lowest price, every row that has it, and none when all cost the same or there is one row', () => {
    const cheapest = (options: AdviseOption[]) => card(answer(options))!.rows.map((r) => r.cheapest);
    expect(cheapest([option(), EARLIER, LATER])).toEqual([false, true, false]);
    expect(cheapest([option({ customerPriceCents: 1250 }), EARLIER, LATER])).toEqual([true, true, false]);
    expect(cheapest([option(), option({ changes: { readyMin: 900 } })])).toEqual([false, false]);
    expect(cheapest([option()])).toEqual([false]);
  });

  it('shows at most three rows, in the server\'s order', () => {
    const c = card(answer([option(), EARLIER, LATER, option({ label: 'A fourth', changes: { readyMin: 930 } })]))!;
    expect(c.rows.map((r) => r.label)).toEqual(['As requested', 'Ready 30 minutes earlier', 'Deliver by noon']);
  });

  it('a relay point that is not in the directory is still named as one; the note is passed on', () => {
    const c = card(answer([option({ relayBusinessId: 'biz-gone' }), option({ relayBusinessId: undefined, changes: { readyMin: 900 } })], {
      note: '  Only relay plans fit this window.  ',
    }))!;
    expect(c.rows.map((r) => r.routeText)).toEqual(['Via a relay point', 'Via a relay point']);
    expect(c.note).toBe('Only relay plans fit this window.');
  });

  it('leaves out an option it cannot show or apply, and keeps the others', () => {
    const bad: unknown[] = [
      null, 'option', {},
      option({ label: '   ' }),
      { ...option(), kind: 'drone' },
      { ...option(), customerPriceCents: '16.00' },
      option({ customerPriceCents: -1 }),
      { ...option(), deliveryMin: null },
      option({ changes: { readyMin: 1500 } }),        // ready on Day 2: the form has no day for it
      option({ changes: { deadlineMin: 3000 } }),     // deliver by on Day 3
      { ...option(), changes: { readyMin: '14:00' } },
    ];
    for (const o of bad) expect(card(answer([o])), JSON.stringify(o)).toBeNull();
    const c = card(answer([...bad, EARLIER]))!;
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0].label).toBe('Ready 30 minutes earlier');
    expect(c.rows[0].key).toBe(`option-${bad.length}`);
  });

  it('missing extras and carriers are a dash and no line, never a made-up number', () => {
    const c = card(answer([{ ...option(), extraMin: undefined, extraMiles: undefined, carrierNames: undefined, summary: undefined, changes: undefined }]))!;
    expect(c.rows[0]).toMatchObject({ extraText: '—', carriersText: null, summary: '', times: draftTimes(960, 2040) });
    expect(card(answer([option({ extraMiles: 0, extraMin: 0 })]))!.rows[0].extraText).toBe('+0\u00a0min · +0.0\u00a0mi');
  });

  it('is null for no option and for anything that is not an advise answer: the card is hidden', () => {
    for (const r of [answer([]), { source: 'gemini' }, { options: 'none' }, { error: 'Not found' }, null, undefined, 'ok', 404]) {
      expect(card(r), JSON.stringify(r)).toBeNull();
    }
  });
});

describe('which option the form holds', () => {
  const c = card(answer([option(), EARLIER, LATER]))!;

  it('the row with the form\'s times; none when the user typed other times or the form is about another request', () => {
    expect(chosenKey(c, draftTimes(960, 2040))).toBe('option-0');
    expect(chosenKey(c, draftTimes(930, 2040))).toBe('option-1');
    expect(chosenKey(c, draftTimes(960, 2160))).toBe('option-2');
    expect(chosenKey(c, draftTimes(900, 2040))).toBeNull();
    expect(chosenKey(c, null)).toBeNull();
  });

  it('the line after a press names both times and says that nothing was sent', () => {
    expect(appliedText(draftTimes(930, 2040)!)).toBe(
      'The form now says ready Day 1, 3:30 PM, deliver by Day 2, 10:00 AM. Nothing is sent until you press Find a delivery match.',
    );
  });
});
