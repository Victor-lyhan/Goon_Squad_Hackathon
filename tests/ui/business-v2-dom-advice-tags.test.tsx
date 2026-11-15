// @vitest-environment jsdom
// #960: the Options card of Business -> New delivery shows what the server marks each option as. The answer
// of POST /api/v2/advise is mocked here in the shape of #959 (its server half, AdviseOption in
// shared/v2/api.ts; the card on the real server's answer: demo-walk-postfreeze.test.ts): every option has `tags`
// ('fastest', 'cheapest', 'recommended' or 'balanced'; one plan may have two) and a `summary` sentence, and
// a 'recommended' one also a `reason`. The card shows the tags as small badges, the price as the row's large
// figure with the arrival time, and one sentence under them (the reason, for a recommended option). Rows
// are in the order Fastest, Cheapest, then Recommended or Balanced. The card no longer says who made the
// options. The rest of the card (the wait, the notes, choosing): business-v2-dom-advice*.test.tsx.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AdviseOption, AdviseResponse } from '../../shared/v2/api';
import {
  ADVICE_COPY, ADVICE_TAGS, adviceCard, noOptions, optionName, type AdviceTag, type AdviseAsk, type AdviseCall,
} from '../../client/src/components/business/v2/adviceModel';
import { AdviceOptions } from '../../client/src/components/business/v2/AdviceOptions';
import type { DraftTimes } from '../../client/src/components/business/v2/newDeliveryModel';
import { ACME, ATLAS, BAKERY, BUSINESSES } from './business-v2-details-sample';
import { click, flush, mount, textOf } from './kitDom';

const T = 10_000;
const SENTENCE = 'Send a fragile vase from Acme Studio to Bakery Row by 10 a.m. tomorrow, no rush.';

/** Ready Day 1 16:00, deliver by Day 2 10:00. */
const ASK: AdviseAsk = {
  originBusinessId: ACME.id, destinationBusinessId: BAKERY.id, label: 'Vase', category: 'small_box',
  description: 'Fragile', weightKg: 2, readyMin: 960, deadlineMin: 2040,
};

/**
 * An option of #959's answer, with `tags` and `reason` typed loosely, so a case can hold a value the server
 * would never send.
 */
type TaggedOption = Omit<AdviseOption, 'id' | 'tags' | 'reason'> & { id?: string; tags?: unknown; reason?: unknown };
const option = (over: Partial<TaggedOption>): TaggedOption => ({
  label: 'Direct with Maya Chen', summary: 'One carrier, no handoff.', changes: {}, kind: 'direct',
  carrierNames: ['Maya Chen'], deliveryMin: 1110, extraMin: 9, extraMiles: 1, customerPriceCents: 1400, ...over,
});
const FAST = option({ id: 'p1', tags: ['fastest'], label: 'Direct with Maya Chen', summary: 'Arrives tonight at 6:30 PM.', deliveryMin: 1110, customerPriceCents: 1400 });
const CHEAP = option({
  id: 'p2', tags: ['cheapest'], label: 'Relay via Atlas Books', summary: 'The lowest price, with one handoff at Atlas Books.', kind: 'relay',
  relayBusinessId: ATLAS.id, carrierNames: ['Maya Chen', 'Luis Ortega'], deliveryMin: 1985, extraMin: 17, extraMiles: 2.4, customerPriceCents: 950,
});
const PICKED = option({
  id: 'p3', tags: ['recommended'], label: 'Direct with Luis Ortega', summary: 'One carrier, tomorrow morning.',
  reason: 'One carrier and no handoff, which suits a fragile package.', carrierNames: ['Luis Ortega'], deliveryMin: 1965, customerPriceCents: 1100,
});
const BALANCED = option({
  id: 'p3', tags: ['balanced'], label: 'Direct with Luis Ortega', summary: 'Between the two on price and arrival.',
  carrierNames: ['Luis Ortega'], deliveryMin: 1965, customerPriceCents: 1100,
});
const answer = (options: TaggedOption[], over: Partial<AdviseResponse> = {}) =>
  ({ options, source: 'gemini', ...over }) as unknown as AdviseResponse;
const model = (response: unknown) => adviceCard(response, { draft: ASK, businesses: BUSINESSES });

/** The card on its own, with a stubbed call. */
async function show(response: AdviseResponse, sentence: string | undefined = SENTENCE) {
  const advise = vi.fn<AdviseCall>(async () => response);
  const onChoose = vi.fn<(times: DraftTimes) => void>();
  const m = mount(<AdviceOptions request={ASK} sentence={sentence} businesses={BUSINESSES} advise={advise} onChoose={onChoose} />);
  await flush();
  const card = () => m.container.querySelector<HTMLElement>('.nd-options')!;
  const rows = () => [...card().querySelectorAll<HTMLElement>('.nd-option')];
  return {
    ...m, advise, onChoose, card, rows,
    badges: () => rows().map((r) => [...r.querySelectorAll('.nd-option__tag')].map(textOf)),
    names: () => rows().map((r) => textOf(r.querySelector('h3')!)),
    sentences: () => rows().map((r) => textOf(r.querySelector('.nd-option__summary')!)),
    status: () => textOf(card().querySelector('.nd-options__status')!),
  };
}

describe('#960 the model: tags, order and the sentence of a row', () => {
  it('the four tags, in the order of the badges and of the rows', () => {
    expect(ADVICE_TAGS).toEqual(['fastest', 'cheapest', 'recommended', 'balanced']);
    expect(ADVICE_TAGS.map((tag) => ADVICE_COPY[tag])).toEqual(['Fastest', 'Cheapest', 'Recommended', 'Balanced']);
  });

  it('sorts the rows Fastest, Cheapest, then Recommended, whatever order the answer has', () => {
    const want = [['fastest'], ['cheapest'], ['recommended']];
    for (const options of [[FAST, CHEAP, PICKED], [PICKED, CHEAP, FAST], [CHEAP, PICKED, FAST], [PICKED, FAST, CHEAP]]) {
      const c = model(answer(options))!;
      expect(c.rows.map((r) => r.tags)).toEqual(want);
      expect(c.rows.map((r) => r.label)).toEqual(['Direct with Maya Chen', 'Relay via Atlas Books', 'Direct with Luis Ortega']);
    }
    // A row keeps the key of its place in the answer, so the same option has the same key after the sort.
    expect(model(answer([PICKED, CHEAP, FAST]))!.rows.map((r) => r.key)).toEqual(['option-2', 'option-1', 'option-0']);
  });

  it('Balanced stands where Recommended does: third', () => {
    const c = model(answer([BALANCED, CHEAP, FAST], { source: 'offline' }))!;
    expect(c.rows.map((r) => r.tags)).toEqual([['fastest'], ['cheapest'], ['balanced']]);
  });

  it('one plan with two tags is one row with two badges, Fastest first', () => {
    const both = option({ id: 'p1', tags: ['cheapest', 'fastest'], summary: 'The fastest and the cheapest plan.' });
    const c = model(answer([PICKED, both]))!;
    expect(c.rows.map((r) => r.tags)).toEqual([['fastest', 'cheapest'], ['recommended']]);
    // A plan that is the fastest and the recommended one is still the first row.
    expect(model(answer([CHEAP, option({ tags: ['recommended', 'fastest'], reason: 'It arrives well before the event.' })]))!.rows.map((r) => r.tags))
      .toEqual([['fastest', 'recommended'], ['cheapest']]);
  });

  it('a recommended row says why (its reason) in place of its summary; every other row its summary', () => {
    const c = model(answer([FAST, CHEAP, PICKED]))!;
    expect(c.rows.map((r) => r.summary)).toEqual([
      'Arrives tonight at 6:30 PM.',
      'The lowest price, with one handoff at Atlas Books.',
      'One carrier and no handoff, which suits a fragile package.',
    ]);
    // No reason in the answer (or an empty one): the summary stays.
    for (const reason of [undefined, '', '   ', 7, null]) {
      expect(model(answer([{ ...PICKED, reason }]))!.rows[0].summary, String(reason)).toBe('One carrier, tomorrow morning.');
    }
    // A reason is the recommended option's only: on another row it is not shown.
    expect(model(answer([{ ...BALANCED, reason: 'Why not.' }, { ...FAST, reason: 'Why not.' }]))!.rows.map((r) => r.summary))
      .toEqual(['Arrives tonight at 6:30 PM.', 'Between the two on price and arrival.']);
  });

  it('a tag it does not know is left out, each tag is shown once, and a row without one comes last', () => {
    const odd = option({ label: 'Odd', tags: ['greenest', 'cheapest', 'cheapest', 7, null] });
    const bare = option({ label: 'Bare', tags: [] });
    const c = model(answer([bare, PICKED, odd]))!;
    expect(c.rows.map((r) => [r.label, r.tags])).toEqual([['Odd', ['cheapest']], ['Direct with Luis Ortega', ['recommended']], ['Bare', []]]);
    for (const tags of ['fastest', { fastest: true }, 7, null]) {
      expect(model(answer([option({ tags }), CHEAP]))!.rows.map((r) => r.tags), JSON.stringify(tags)).toEqual([['cheapest'], []]);
    }
  });

  it('with more than three options, the three first by their badges are shown', () => {
    const extra = option({ label: 'A fourth', tags: [] });
    expect(model(answer([extra, PICKED, CHEAP, FAST]))!.rows.map((r) => r.label))
      .toEqual(['Direct with Maya Chen', 'Relay via Atlas Books', 'Direct with Luis Ortega']);
  });

  it('a label that starts with the words of its own badges is shown without them: the badges say it', () => {
    const name = (label: string, tags: unknown) => model(answer([option({ label, tags })]))!.rows[0].label;
    expect(name('Fastest: Direct with Theo Martin, $7.00', ['fastest'])).toBe('Direct with Theo Martin, $7.00');
    expect(name('Fastest and cheapest: Relay via Etsy, $9.50', ['fastest', 'cheapest'])).toBe('Relay via Etsy, $9.50');
    expect(name('Fastest and recommended: Relay via Etsy, $9.50', ['recommended', 'fastest'])).toBe('Relay via Etsy, $9.50');
    expect(name('Balanced: Relay via Titan Foods, $9.50', ['balanced'])).toBe('Relay via Titan Foods, $9.50');
    expect(name('cheapest: Relay via Etsy', ['cheapest'])).toBe('Relay via Etsy');
    // Words that are not this row's badges stay: the label is the answer's.
    expect(name('Fastest: Direct with Theo Martin', ['cheapest'])).toBe('Fastest: Direct with Theo Martin');
    expect(name('Fastest and cheapest: Relay via Etsy', ['fastest'])).toBe('Fastest and cheapest: Relay via Etsy');
    expect(name('Fastest: Direct with Theo Martin', undefined)).toBe('Fastest: Direct with Theo Martin');
    expect(name('Deliver by Day 2: 10:00 AM', ['fastest'])).toBe('Deliver by Day 2: 10:00 AM');
    expect(name('Fastest:', ['fastest'])).toBe('Fastest:');
    expect(name('Relay via Etsy, $9.50', ['fastest'])).toBe('Relay via Etsy, $9.50');
    // The button's name follows: the option, its price once, its badges.
    const [r] = model(answer([option({ label: 'Fastest and cheapest: Relay via Etsy, $14.00', tags: ['fastest', 'cheapest'] })]))!.rows;
    expect(optionName(r, false)).toBe('Choose this option: Relay via Etsy, $14.00, fastest, cheapest');
  });

  it('the badges are the answer\'s: the model marks no price itself once the answer speaks of tags', () => {
    // The lowest price is not tagged cheapest here, and the model does not add it.
    const c = model(answer([option({ tags: ['fastest'], customerPriceCents: 1400 }), option({ tags: [], customerPriceCents: 900 })]))!;
    expect(c.rows.map((r) => [r.priceText, r.tags])).toEqual([['$14.00', ['fastest']], ['$9.00', []]]);
    // Nor for an answer without any `tags` (the samples written before #959): no badge at all.
    const { tags: _a, ...oldFast } = FAST;
    const { tags: _b, ...oldCheap } = CHEAP;
    expect(model(answer([oldFast, oldCheap]))!.rows.map((r) => [r.priceText, r.tags])).toEqual([['$14.00', []], ['$9.50', []]]);
  });

  it('the card holds its note and its rows, and nothing about who made the options', () => {
    for (const source of ['gemini', 'offline'] as const) {
      const c = model(answer([FAST, CHEAP, PICKED], { source, note: 'No other relay point fits.' }))!;
      expect(Object.keys(c).sort()).toEqual(['note', 'rows']);
      expect(c.note).toBe('No other relay point fits.');
      expect(JSON.stringify(c)).not.toMatch(/gemini|AI model|Priced by|Planned by/i);
    }
    expect(Object.values<string>(ADVICE_COPY).filter((line) => /gemini|AI model|Priced by|Planned by/i.test(line))).toEqual([]);
  });

  it('the name of a row\'s button says its badges in words', () => {
    const tags = (...t: AdviceTag[]) => ({ label: 'Direct with Maya Chen', priceText: '$14.00', tags: t });
    expect(optionName(tags('fastest', 'cheapest'), false)).toBe('Choose this option: Direct with Maya Chen, $14.00, fastest, cheapest');
    expect(optionName(tags('recommended'), true)).toBe('In the form: Direct with Maya Chen, $14.00, recommended');
    expect(optionName(tags('balanced'), false)).toBe('Choose this option: Direct with Maya Chen, $14.00, balanced');
    expect(optionName(tags(), false)).toBe('Choose this option: Direct with Maya Chen, $14.00');
  });
});

describe('#960 the card: badges, the price, the arrival time and one sentence', () => {
  it('each row shows its badges as words, in the order Fastest, Cheapest, Recommended', async () => {
    const p = await show(answer([PICKED, CHEAP, FAST]));
    expect(p.names()).toEqual(['Direct with Maya Chen', 'Relay via Atlas Books', 'Direct with Luis Ortega']);
    expect(p.badges()).toEqual([['Fastest'], ['Cheapest'], ['Recommended']]);
    expect(p.rows().map((r) => [...r.querySelectorAll('.nd-option__tag')].map((b) => b.className))).toEqual([
      ['nd-option__tag nd-option__tag--fastest'], ['nd-option__tag nd-option__tag--cheapest'], ['nd-option__tag nd-option__tag--recommended'],
    ]);
    // The badges come before the row's name, so they are read with it.
    for (const r of p.rows()) {
      const head = r.querySelector('.nd-option__head')!;
      expect([...head.children].map((c) => c.className)).toEqual(['nd-option__tags', 'nd-option__label']);
    }
  }, T);

  it('the price is the row\'s large figure, with the arrival time under it and the sentence under both', async () => {
    const p = await show(answer([FAST, CHEAP, PICKED]));
    const [first] = p.rows();
    expect([...first.children].map((c) => c.className)).toEqual(['nd-option__top', 'nd-option__summary', 'nd-option__facts', 'nd-option__foot']);
    const deal = first.querySelector('.nd-option__top > .nd-option__deal')!;
    expect([...deal.children].map((c) => c.className)).toEqual(['nd-option__price', 'nd-option__arrives']);
    expect(p.rows().map((r) => textOf(r.querySelector('.nd-option__price')!))).toEqual(['$14.00', '$9.50', '$11.00']);
    expect(p.rows().map((r) => [...r.querySelector('.nd-option__arrives')!.children].map(textOf))).toEqual([
      ['Arrives', 'Day 1, 6:30 PM'], ['Arrives', 'Day 2, 9:05 AM'], ['Arrives', 'Day 2, 8:45 AM'],
    ]);
    // Prices and times are data: IBM Plex Mono.
    for (const r of p.rows()) {
      expect(r.querySelector('.nd-option__cents')!.classList.contains('nd-mono')).toBe(true);
      expect(r.querySelector('.nd-option__arrives dd')!.classList.contains('nd-mono')).toBe(true);
    }
    // The other facts of the plan stay under the sentence.
    expect([...first.querySelectorAll('.nd-option__facts dt')].map(textOf)).toEqual(['Route', 'Added to commutes', 'Carried by']);
  }, T);

  it('a recommended row shows its reason in place of its summary', async () => {
    const p = await show(answer([FAST, CHEAP, PICKED]));
    expect(p.sentences()).toEqual([
      'Arrives tonight at 6:30 PM.',
      'The lowest price, with one handoff at Atlas Books.',
      'One carrier and no handoff, which suits a fragile package.',
    ]);
    expect(textOf(p.card())).not.toContain(PICKED.summary);
  }, T);

  it('the fallback: a Balanced badge in the third row, with its summary', async () => {
    const p = await show(answer([FAST, CHEAP, BALANCED], { source: 'offline' }));
    expect(p.badges()).toEqual([['Fastest'], ['Cheapest'], ['Balanced']]);
    expect(p.rows()[2].querySelector('.nd-option__tag')!.className).toBe('nd-option__tag nd-option__tag--balanced');
    expect(p.sentences()[2]).toBe('Between the two on price and arrival.');
    expect(textOf(p.card())).not.toContain('Recommended');
  }, T);

  it('one plan that is the fastest and the cheapest: one row with both badges', async () => {
    const both = option({ id: 'p1', tags: ['fastest', 'cheapest'], summary: 'The fastest and the cheapest plan.' });
    const p = await show(answer([both, PICKED]));
    expect(p.badges()).toEqual([['Fastest', 'Cheapest'], ['Recommended']]);
    expect(textOf(p.rows()[0].querySelector('.nd-option__tags')!)).toBe('Fastest Cheapest'); // two words, not one
    expect(p.rows()[0].querySelector('button')!.getAttribute('aria-label')).toBe('In the form: Direct with Maya Chen, $14.00, fastest, cheapest');
    // A single plan: one row, both badges, and nothing to choose between.
    p.unmount();
    const one = await show(answer([both], { source: 'offline' }));
    expect(one.badges()).toEqual([['Fastest', 'Cheapest']]);
    expect([...one.card().querySelectorAll('.nd-options__hint')].map(textOf)).toEqual([ADVICE_COPY.hintSingle]);
  }, T);

  it('a row the answer does not tag has no badge and no empty badge line', async () => {
    const p = await show(answer([FAST, option({ label: 'Bare', tags: [] })]));
    expect(p.badges()).toEqual([['Fastest'], []]);
    expect(p.rows()[1].querySelector('.nd-option__tags')).toBeNull();
  }, T);

  it.each(['gemini', 'offline'] as const)('no source line (source %s): the status line is empty and nothing names who made the options', async (source) => {
    const p = await show(answer([FAST, CHEAP, source === 'gemini' ? PICKED : BALANCED], { source }));
    expect(p.status()).toBe('');
    expect(p.card().querySelector('.nd-options__status')!.getAttribute('role')).toBe('status');
    expect(textOf(p.card())).not.toMatch(/Gemini|AI model|Priced by|Planned by|checked by/i);
    // What is left under the title: the rows, then the hint.
    expect([...p.card().children].map((c) => c.className)).toEqual([
      'nd-options__title', 'nd-options__status', 'nd-options__list', 'nd-options__hint', 'nd-options__applied',
    ]);
  }, T);

  it('keeps the note line: with options under the rows, without options as the card\'s one sentence', async () => {
    const withRows = await show(answer([FAST, CHEAP], { note: 'No relay: every evening commute from Acme Studio is already carrying a package.' }));
    expect([...withRows.card().querySelectorAll('.nd-options__hint')].map(textOf)).toEqual([
      'No relay: every evening commute from Acme Studio is already carrying a package.', ADVICE_COPY.hint,
    ]);
    withRows.unmount();

    const note = 'No carrier can take it: every matching commute is full.';
    const none = await show(answer([], { source: 'offline', note }));
    expect(none.status()).toBe(note);
    expect(none.rows()).toHaveLength(0);
    expect(none.card().querySelector('.nd-options__status')!.classList.contains('nd-options__status--note')).toBe(true);
    expect(noOptions(answer([], { note }), ASK).note).toBe(note);
  }, T);

  it('choosing still only hands the option\'s times to the page', async () => {
    const p = await show(answer([FAST, CHEAP, PICKED]));
    click(p.rows()[2].querySelector('button')!);
    expect(p.onChoose).toHaveBeenCalledTimes(1);
    expect(p.onChoose).toHaveBeenCalledWith({ readyTime: '16:00', deadlineDay: 2, deadlineTime: '10:00' });
    expect(p.advise).toHaveBeenCalledTimes(1); // a press asks nothing
  }, T);

  it('the sentence the request was read from goes with the call; without one the call is as before', async () => {
    const p = await show(answer([FAST]));
    const [draft, opts] = p.advise.mock.calls[0];
    expect(draft).toEqual(ASK);
    expect(opts!.text).toBe(SENTENCE);
    expect(opts!.signal).toBeInstanceOf(AbortSignal);
    expect(textOf(p.card())).not.toContain(SENTENCE); // sent, never shown
    p.unmount();

    const bare = await show(answer([FAST]), '');
    expect(Object.keys(bare.advise.mock.calls[0][1]!)).toEqual(['signal']);
  }, T);
});

describe('#960 the look of a badge and of the price (newDelivery.css)', () => {
  const css = readFileSync('client/src/components/business/v2/newDelivery.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector: string) => {
    const at = css.indexOf(`\n${selector} {`);
    if (at < 0) throw new Error(`no rule for ${selector}`);
    return css.slice(at, css.indexOf('}', at));
  };

  it('a badge is small, a filled box of its own colour: amber, green, the primary blue; Balanced is neutral', () => {
    const base = rule('.nd-option__tag');
    expect(base).toMatch(/font-size: var\(--text-xs, 12px\);/);
    expect(base).toMatch(/border-radius: var\(--radius, 4px\);/);
    expect(base).toMatch(/white-space: nowrap;/);
    expect(base).not.toMatch(/text-transform/);
    // Balanced has no rule of its own: it is the base badge, a hairline box with quiet text.
    expect(base).toMatch(/border: 1px solid var\(--border, #E3E3DE\);/);
    expect(base).toMatch(/color: var\(--muted, #5B6472\);/);
    expect(css).not.toContain('.nd-option__tag--balanced');
    const fill = (token: string) => new RegExp(`border-color: var\\(${token}\\); background: var\\(${token}\\); color: var\\(--panel, #FFFFFF\\);`);
    expect(rule('.nd-option__tag--fastest')).toMatch(fill('--warn, #8A5A00'));
    expect(rule('.nd-option__tag--cheapest')).toMatch(fill('--ok, #2F6B4F'));
    expect(rule('.nd-option__tag--recommended')).toMatch(fill('--accent, #1D5075'));
    // The word of #863 inside the price is gone with its class.
    expect(css).not.toContain('.nd-option__tag--ok');
  });

  it('the price is the largest text of the row, and the row still fits a phone', () => {
    expect(rule('.nd-option__cents')).toMatch(/font-size: var\(--text-xl, 28px\);/);
    for (const selector of ['.nd-option__label', '.nd-option__arrives dd', '.nd-option__summary']) {
      expect(rule(selector), selector).not.toMatch(/font-size: var\(--text-(lg|xl)/);
    }
    const narrow = css.slice(css.indexOf('@media (max-width: 480px)'));
    expect(narrow).toMatch(/\.nd-option__top \{ flex-wrap: wrap; \}/);
    expect(narrow).toMatch(/\.nd-option__deal \{ align-items: flex-start; \}/);
    expect(rule('.nd-option__tags')).toMatch(/flex-wrap: wrap;/);
  });
});
