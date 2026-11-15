// @vitest-environment jsdom
// #863 (the AI what-if advisor, UI half): after "Read my request" the Business page asks POST /api/v2/advise
// (a stub here: no server, no Gemini) and shows the Options card above the confirmation card. Choosing an
// option only sets the form's ready and deliver-by times: the form's own button still sends, through the
// unchanged createShipment. A call the server answers with an error, or an answer without options, is one
// plain sentence in the card (#880), and the form still sends; only a call with no answer at all hides the
// card (#948; what the card says and asks again for: business-v2-dom-advice-notes.test.tsx).
// The pure model: business-v2-advice-model.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdviseOption, AdviseResponse, ShipmentResponse } from '../../shared/v2/api';
import type { ParseDraft, ParseRequestResponse } from '../../shared/v2/parseRequest';
import type { CreateShipmentRequest } from '../../shared/v2/schemas';
import { ApiRequestError } from '../../client/src/api/v2';
import { ADVICE_COPY, type AdviseCall } from '../../client/src/components/business/v2/adviceModel';
import type { BusinessWorkspaceState } from '../../client/src/components/business/v2/live/businessWorkspaceState';
import { RESULT_COPY } from '../../client/src/components/business/v2/newDeliveryModel';
import { BusinessPageView } from '../../client/src/components/business/v2/page/BusinessPageView';
import type { ParseRequestCall } from '../../client/src/components/business/v2/RequestTextBox';
import { REQUEST_COPY } from '../../client/src/components/business/v2/requestTextModel';
import { directPlan, view } from './business-v2-details-sample';
import { ACME, ATLAS, BAKERY, DASHBOARD, ready } from './business-v2-page-sample';
import { button, byLabel, click, deferred, flush, mount, press, select, tabOrder, textOf, typeInto } from './kitDom';

const T = 10_000;
const SENTENCE = 'Deliver an envelope from Acme Studio to Bakery Row by 10 a.m. tomorrow.';

/** Everything filled: ready Day 1 16:00, deliver by Day 2 10:00. */
const FULL: ParseDraft = {
  originBusinessId: ACME.id, destinationBusinessId: BAKERY.id, label: 'Envelope', category: 'envelope',
  description: 'Signed contract', weightKg: 0.2, readyMin: 960, deadlineMin: 2040,
};
const parsed = (draft: Partial<ParseDraft> = {}): ParseRequestResponse => {
  const d = { ...FULL, ...draft };
  return { draft: d, missing: (Object.keys(d) as (keyof ParseDraft)[]).filter((k) => d[k] === null), rejected: null, source: 'gemini' };
};

const AS_TYPED: AdviseOption = {
  label: 'As requested', summary: 'Next-morning relay through Atlas Books.', changes: {}, kind: 'relay',
  relayBusinessId: ATLAS.id, carrierNames: ['Maya Chen', 'Luis Ortega'], deliveryMin: 1985, extraMin: 17,
  extraMiles: 2.4, customerPriceCents: 1600,
};
const EARLIER: AdviseOption = {
  label: 'Ready 30 minutes earlier', summary: 'One carrier takes it tonight.', changes: { readyMin: 930 }, kind: 'direct',
  carrierNames: ['Maya Chen'], deliveryMin: 1110, extraMin: 9, extraMiles: 1, customerPriceCents: 1250,
};
const LATER: AdviseOption = {
  label: 'Deliver by noon', summary: 'A wider window earns the flexibility discount.', changes: { deadlineMin: 2160 },
  kind: 'relay', relayBusinessId: ATLAS.id, carrierNames: ['Maya Chen', 'Luis Ortega'], deliveryMin: 2010, extraMin: 17,
  extraMiles: 2.4, customerPriceCents: 1400,
};
const OPTIONS: AdviseResponse = { options: [AS_TYPED, EARLIER, LATER], source: 'gemini' };

const arranged = (id: string): ShipmentResponse => ({
  ...view({ ...directPlan, id: `plan-${id}`, shipmentId: id }, 'scheduled', {}, { id, label: 'Envelope' }),
  matched: true,
});
const noMatch = (id: string): ShipmentResponse => ({
  ...view(null, 'unmatched', { unmatchedReason: 'No commute passes both businesses in time.' }, { id, label: 'Envelope' }),
  matched: false,
});

type Setup = {
  advise?: () => Promise<AdviseResponse>;
  parse?: () => Promise<ParseRequestResponse>;
  send?: (id: string) => ShipmentResponse;
};

function setup({ advise: answer = async () => OPTIONS, parse = async () => parsed(), send = arranged }: Setup = {}) {
  const advise = vi.fn<AdviseCall>(() => answer());
  const parseRequest = vi.fn<ParseRequestCall>(() => parse());
  const createShipment = vi.fn(async (_req: CreateShipmentRequest) => send('shp-51'));
  const matchShipment = vi.fn(async (_id: string): Promise<ShipmentResponse> => arranged('shp-51'));
  const el = (s: BusinessWorkspaceState) => (
    <BusinessPageView
      state={s} shipmentId={null}
      createShipment={createShipment} matchShipment={matchShipment}
      refetchNow={async () => {}} dismissRunChanged={() => {}}
      onOpenShipment={() => {}} onCloseShipment={() => {}}
      businessHref={(id) => `/business/${id}`}
      parseRequest={parseRequest} advise={advise}
    />
  );
  const m = mount(el(ready()));
  const c = m.container;
  const form = () => c.querySelector<HTMLFormElement>('form.nd');
  const p = {
    ...m, advise, parseRequest, createShipment, matchShipment, form,
    poll: (s: BusinessWorkspaceState) => m.rerender(el(s)),
    card: () => c.querySelector<HTMLElement>('.nd-options'),
    rows: () => [...c.querySelectorAll<HTMLElement>('.nd-options .nd-option:not(.nd-option--skeleton)')],
    skeletons: () => [...c.querySelectorAll<HTMLElement>('.nd-options .nd-option--skeleton')],
    note: () => c.querySelector<HTMLElement>('.nd-parsed'),
    /** The row's one button: "Choose this option", or "In the form" on the option the form holds (#880). */
    choose: (row: number) => p.rows()[row].querySelector<HTMLButtonElement>('button.nd-option__choose')!,
    /** The card's one line under its title: the wait, who made the options, or why there are none. */
    status: () => textOf(p.card()!.querySelector('.nd-options__status')!),
    chosen: () => p.rows().map((r) => r.classList.contains('nd-option--chosen')),
    value: (label: string) => (byLabel(form()!, label) as HTMLInputElement | HTMLSelectElement).value,
    times: () => [p.value('Ready for pickup (Day 1)'), p.value('Deliver by: day'), p.value('Deliver by: time')],
    /** New delivery, the sentence, "Read my request", and the answers. */
    read: async () => {
      click(button(c, 'New delivery'));
      typeInto(byLabel(c, REQUEST_COPY.label), SENTENCE);
      click(button(c, 'Read my request'));
      await flush();
    },
    send: async () => { click(button(form()!, /^(Find a delivery match|Try matching again)$/)); await flush(); },
  };
  return p;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('the Options card after "Read my request"', () => {
  it('asks once, for the request as the form opens with it, sent from the signed-in business', async () => {
    const p = setup({ parse: async () => parsed({ originBusinessId: null, label: null, weightKg: null }) });
    await p.read();
    expect(p.advise).toHaveBeenCalledTimes(1);
    const [draft, opts] = p.advise.mock.calls[0];
    expect(draft).toEqual({
      originBusinessId: ACME.id, destinationBusinessId: BAKERY.id, label: null, category: 'envelope',
      description: 'Signed contract', weightKg: 0.5, readyMin: 960, deadlineMin: 2040, // 0.5 kg: what the form shows
    });
    expect(opts!.signal).toBeInstanceOf(AbortSignal);
    // A poll's re-render does not ask again.
    p.poll(ready({ ...DASHBOARD, version: DASHBOARD.version + 1 }));
    await flush();
    expect(p.advise).toHaveBeenCalledTimes(1);
    expect(p.createShipment).not.toHaveBeenCalled();
  }, T);

  it('lists the options with their prices above the confirmation card', async () => {
    const p = setup();
    await p.read();
    const card = p.card()!;
    // Above the note and the form, which stay next to each other as one card.
    expect(card.nextElementSibling).toBe(p.note());
    expect(p.note()!.nextElementSibling).toBe(p.form());
    expect(card.tagName).toBe('SECTION');
    expect(textOf(document.getElementById(card.getAttribute('aria-labelledby')!)!)).toBe('Options');
    expect(card.hasAttribute('aria-busy')).toBe(false);
    expect(p.status()).toBe('Planned by Gemini, priced by Relay.');
    expect(p.skeletons()).toHaveLength(0);

    const rows = p.rows();
    expect(rows.map((r) => textOf(r.querySelector('h3')!))).toEqual(['As requested', 'Ready 30 minutes earlier', 'Deliver by noon']);
    expect(rows.map((r) => textOf(r.querySelector('.nd-option__cents')!))).toEqual(['$16.00', '$12.50', '$14.00']);
    expect(rows.map((r) => textOf(r.querySelector('.nd-option__summary')!))).toEqual([
      'Next-morning relay through Atlas Books.', 'One carrier takes it tonight.', 'A wider window earns the flexibility discount.',
    ]);
    const facts = (row: Element) => Object.fromEntries([...row.querySelectorAll('dt')].map((dt) => [textOf(dt), textOf(dt.nextElementSibling!)]));
    expect(facts(rows[0])).toEqual({
      Arrives: 'Day 2, 9:05 AM', Route: 'Via Atlas Books', 'Added to commutes': '+17 min · +2.4 mi', 'Carried by': 'Maya Chen, Luis Ortega',
    });
    expect(facts(rows[1])).toEqual({
      Arrives: 'Day 1, 6:30 PM', Route: 'Direct', 'Added to commutes': '+9 min · +1.0 mi', 'Carried by': 'Maya Chen',
    });
    // Prices, arrival times and the extras are data: IBM Plex Mono. The route and the names are not.
    for (const row of rows) {
      expect(row.querySelector('.nd-option__cents')!.classList.contains('nd-mono')).toBe(true);
      const dds = [...row.querySelectorAll('dd')];
      expect(dds.map((dd) => dd.classList.contains('nd-mono'))).toEqual([true, false, true, false]);
    }
    // The cheapest one is marked, in words.
    expect(rows.map((r) => textOf(r.querySelector('.nd-option__price')!))).toEqual(['$16.00', 'Cheapest $12.50', '$14.00']);
    // Nothing was sent, and the form is as the request was read.
    expect(p.times()).toEqual(['16:00', '2', '10:00']);
    expect(p.createShipment).not.toHaveBeenCalled();
  }, T);

  it('offline options say so and never name Gemini', async () => {
    const p = setup({ advise: async () => ({ ...OPTIONS, source: 'offline', note: 'Only two variants found a carrier.' }) });
    await p.read();
    // One plain line: the label, and what "offline" means.
    expect(p.status()).toBe('Priced by Relay, with no AI model.');
    expect(textOf(p.card()!)).not.toContain('Gemini');
    expect(textOf(p.card()!)).toContain('Only two variants found a carrier.');
  }, T);

  it('while the options are on their way: skeleton rows, and the form is already usable', async () => {
    const pending = deferred<AdviseResponse>();
    const p = setup({ advise: () => pending.promise });
    await p.read();
    const card = p.card()!;
    expect(card.getAttribute('aria-busy')).toBe('true');
    expect(p.status()).toBe(ADVICE_COPY.loadingLine);
    expect(p.skeletons()).toHaveLength(2);
    expect(p.skeletons()[0].closest('[aria-hidden="true"]')).not.toBeNull(); // bars, not content
    expect(p.rows()).toHaveLength(0);
    expect(card.querySelectorAll('button')).toHaveLength(0);
    // The confirmation card is there in full, with the focus in the form as before.
    expect(p.form()!.contains(document.activeElement)).toBe(true);
    typeInto(byLabel(p.form()!, 'Package name'), 'Typed while waiting');

    pending.resolve(OPTIONS);
    await flush();
    expect(p.skeletons()).toHaveLength(0);
    expect(p.rows()).toHaveLength(3);
    expect(p.card()!.hasAttribute('aria-busy')).toBe(false);
    expect(p.value('Package name')).toBe('Typed while waiting'); // the answer does not touch the form
    expect(p.form()!.contains(document.activeElement)).toBe(true);
  }, T);
});

describe('choosing an option', () => {
  it('the option the form holds is marked from the start: the request as it was read', async () => {
    const p = setup();
    await p.read();
    expect(p.chosen()).toEqual([true, false, false]);
    expect([0, 1, 2].map((i) => p.choose(i).getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    // The option the form holds says so on its button; the others offer themselves (#880).
    expect(p.rows().map((r) => textOf(r.querySelector('.nd-option__foot')!))).toEqual(['In the form', 'Choose this option', 'Choose this option']);
    expect(textOf(p.card()!.querySelector('.nd-options__applied')!)).toBe('');
  }, T);

  it('puts its ready time in the form and sends nothing', async () => {
    const p = setup();
    await p.read();
    click(p.choose(1));
    expect(p.times()).toEqual(['15:30', '2', '10:00']);
    expect(p.chosen()).toEqual([false, true, false]);
    expect(p.choose(1).getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(p.choose(1)); // the pressed button keeps the focus
    const applied = p.card()!.querySelector('.nd-options__applied')!;
    expect(applied.getAttribute('aria-live')).toBe('polite');
    expect(textOf(applied)).toBe(
      'The form now says ready Day 1, 3:30 PM, deliver by Day 2, 10:00 AM. Nothing is sent until you press Find a delivery match.',
    );
    // The other fields are untouched, and nothing left the page.
    expect(p.value('Package name')).toBe('Envelope');
    expect(p.value('Weight (kg)')).toBe('0.2');
    await flush();
    expect(p.createShipment).not.toHaveBeenCalled();
    expect(p.advise).toHaveBeenCalledTimes(1);
  }, T);

  it('a later deadline, then back to the request as read: each press sets both times', async () => {
    const p = setup();
    await p.read();
    click(p.choose(2));
    expect(p.times()).toEqual(['16:00', '2', '12:00']);
    click(p.choose(1));
    expect(p.times()).toEqual(['15:30', '2', '10:00']); // the deadline of the option before is not kept
    click(p.choose(0));
    expect(p.times()).toEqual(['16:00', '2', '10:00']);
    expect(p.chosen()).toEqual([true, false, false]);
  }, T);

  it('then the form\'s own button sends the chosen times, once', async () => {
    const p = setup();
    await p.read();
    click(p.choose(1));
    await p.send();
    expect(p.createShipment).toHaveBeenCalledTimes(1);
    expect(p.createShipment.mock.calls[0][0]).toMatchObject({
      originBusinessId: ACME.id, destinationBusinessId: BAKERY.id, label: 'Envelope', weightKg: 0.2,
      readyMin: 930, deadlineMin: 2040,
    });
    expect(textOf(p.form()!.querySelector('.nd-result')!)).toContain(RESULT_COPY.matched);
    // The delivery is arranged: the options were about the request just sent, so they go with its note.
    expect(p.card()).toBeNull();
    expect(p.note()).toBeNull();
  }, T);

  it('times typed by hand unmark the option, and typing an option\'s times marks it', async () => {
    const p = setup();
    await p.read();
    click(p.choose(1));
    typeInto(byLabel(p.form()!, 'Ready for pickup (Day 1)'), '15:00');
    expect(p.chosen()).toEqual([false, false, false]);
    expect(textOf(p.card()!.querySelector('.nd-options__applied')!)).toBe('');
    typeInto(byLabel(p.form()!, 'Ready for pickup (Day 1)'), '16:00');
    typeInto(byLabel(p.form()!, 'Deliver by: time'), '12:00');
    expect(p.chosen()).toEqual([false, false, true]);
  }, T);

  it('a chosen option takes the "Check this" hint off the times it sets, and only those', async () => {
    const p = setup({ parse: async () => parsed({ readyMin: null, description: null }) });
    await p.read();
    const checks = () => [...p.form()!.querySelectorAll('.nd-field--check label')].map(textOf);
    expect(checks()).toEqual(['Contents', 'Ready for pickup (Day 1)']);
    click(p.choose(1));
    expect(checks()).toEqual(['Contents']);
    expect(p.times()).toEqual(['15:30', '2', '10:00']);
  }, T);

  it('after a no-match answer, another option is a new request, not a retry of the saved one', async () => {
    const p = setup({ send: noMatch });
    await p.read();
    await p.send();
    expect(textOf(p.form()!.querySelector('.nd-result')!)).toContain(RESULT_COPY.unmatched);
    expect(p.card()).not.toBeNull(); // the card stays with the request
    expect(button(p.form()!, 'Try matching again')).toBeTruthy();
    click(p.choose(1));
    await p.send();
    expect(p.matchShipment).not.toHaveBeenCalled();
    expect(p.createShipment).toHaveBeenCalledTimes(2);
    expect(p.createShipment.mock.calls[1][0]).toMatchObject({ readyMin: 930, deadlineMin: 2040 });
    expect(p.createShipment.mock.calls[1][0].clientRequestId).not.toBe(p.createShipment.mock.calls[0][0].clientRequestId);
  }, T);

  it('another recipient in the form: the prices are not for it, so the card goes, and comes back with the recipient', async () => {
    const p = setup();
    await p.read();
    select(byLabel(p.form()!, 'Recipient'), 'Atlas Books · Long Island City');
    expect(p.card()).toBeNull();
    select(byLabel(p.form()!, 'Recipient'), 'Bakery Row · Williamsburg');
    expect(p.rows()).toHaveLength(3);
    expect(p.advise).toHaveBeenCalledTimes(1); // the same answer, not a second call
  }, T);
});

describe('keyboard and screen reader', () => {
  it('every option has a real button, in Tab order before the form, named by its option', async () => {
    const p = setup();
    await p.read();
    const chooseButtons = [0, 1, 2].map((i) => p.choose(i));
    for (const [i, b] of chooseButtons.entries()) {
      expect(b.tagName).toBe('BUTTON');
      expect(b.type).toBe('button'); // never submits the form
      expect(textOf(b)).toBe(i === 0 ? 'In the form' : 'Choose this option');
      // The name starts with what the button says, then the option and its price (#880).
      expect(b.getAttribute('aria-label')).toContain(`${textOf(b)}: ${OPTIONS.options[i].label}, `);
    }
    expect(chooseButtons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'In the form: As requested, $16.00',
      'Choose this option: Ready 30 minutes earlier, $12.50, cheapest',
      'Choose this option: Deliver by noon, $14.00',
    ]);
    const order = tabOrder(p.container);
    const first = order.indexOf(chooseButtons[0]);
    expect(order.slice(first, first + 3)).toEqual(chooseButtons);
    expect(first + 2).toBeLessThan(order.indexOf(button(p.note()!, 'Edit request')));
    expect(order.indexOf(button(p.note()!, 'Edit request'))).toBeLessThan(order.indexOf(byLabel(p.form()!, 'Recipient')));
    // The line about who planned them is a polite status: announced when the options arrive.
    expect(p.card()!.querySelector('.nd-options__status')!.getAttribute('role')).toBe('status');
  }, T);

  it('Esc in the card does not close New delivery', async () => {
    const p = setup();
    await p.read();
    press('Escape', p.choose(1));
    expect(p.form()).not.toBeNull();
    expect(p.card()).not.toBeNull();
  }, T);
});

describe('no options: one plain sentence in the card, and the flow is as before', () => {
  // The server's sentence is the card's line; what can be done is a second, smaller line under it (#948).
  const NO_OPTION = `No carrier passes both businesses.${ADVICE_COPY.noneNext}`;
  const failures: Array<[string, () => Promise<AdviseResponse>, string]> = [
    ['a 404 (a server without the route)', async () => { throw new ApiRequestError(404, 'Not found'); }, ADVICE_COPY.failed],
    ['a 500', async () => { throw new ApiRequestError(500, 'Internal Server Error'); }, ADVICE_COPY.failed],
    ['an answer with no option', async () => ({ options: [], source: 'offline', note: 'No carrier passes both businesses.' }), NO_OPTION],
    ['an answer that is not one', async () => ({ error: 'nope' }) as unknown as AdviseResponse, ADVICE_COPY.failed],
  ];
  // No answer at all: the card is not drawn (#948), and the flow is the one of before the card.
  const unanswered: Array<[string, () => Promise<AdviseResponse>]> = [
    ['no answer in time', async () => { throw new ApiRequestError(0, 'Request timed out after 15000 ms', undefined, 'timeout'); }],
    ['no network', async () => { throw new ApiRequestError(0, 'Failed to fetch', undefined, 'network'); }],
    ['a thrown error', async () => { throw new TypeError('x is undefined'); }],
  ];

  for (const [name, advise] of unanswered) {
    it(`${name}: no card, nothing said, and Send works`, async () => {
      const p = setup({ advise });
      await p.read();
      expect(p.advise).toHaveBeenCalledTimes(1);
      expect(p.card()).toBeNull();
      expect([...p.container.querySelectorAll('[role="alert"]')].map(textOf).filter(Boolean)).toEqual([]);
      expect(p.note()!.nextElementSibling).toBe(p.form());
      await p.send();
      expect(p.createShipment).toHaveBeenCalledTimes(1);
      expect(textOf(p.form()!.querySelector('.nd-result')!)).toContain(RESULT_COPY.matched);
    }, T);
  }

  for (const [name, advise, sentence] of failures) {
    it(`${name}: one sentence, no rows, and Send works`, async () => {
      const p = setup({ advise });
      await p.read();
      expect(p.advise).toHaveBeenCalledTimes(1);
      // The card stays, with its title and one sentence (#880): never the server's error text or a status code.
      expect(textOf(p.card()!)).toBe(`Options${sentence}`);
      expect(p.card()!.hasAttribute('aria-busy')).toBe(false);
      expect(p.container.querySelector('.nd-option, .nd-skeleton')).toBeNull();
      expect(p.card()!.querySelectorAll('button')).toHaveLength(0);
      // It is a polite status, not an alert: the request is not in trouble, and the form is not blocked.
      expect([...p.container.querySelectorAll('[role="alert"]')].map(textOf).filter(Boolean)).toEqual([]);
      // The confirmation card is the one of before #863.
      expect(textOf(p.note()!.querySelector('.nd-parsed__source')!)).toBe('Read by Gemini');
      expect(p.note()!.nextElementSibling).toBe(p.form());
      expect(p.times()).toEqual(['16:00', '2', '10:00']);
      await p.send();
      expect(p.createShipment).toHaveBeenCalledTimes(1);
      expect(p.createShipment.mock.calls[0][0]).toMatchObject({ readyMin: 960, deadlineMin: 2040 });
      expect(textOf(p.form()!.querySelector('.nd-result')!)).toContain(RESULT_COPY.matched);
    }, T);
  }

  it('Send works without choosing, with the options on screen', async () => {
    const p = setup();
    await p.read();
    expect(p.rows()).toHaveLength(3);
    await p.send();
    expect(p.createShipment).toHaveBeenCalledTimes(1);
    expect(p.createShipment.mock.calls[0][0]).toMatchObject({
      originBusinessId: ACME.id, destinationBusinessId: BAKERY.id, label: 'Envelope', category: 'envelope',
      description: 'Signed contract', weightKg: 0.2, readyMin: 960, deadlineMin: 2040,
    });
    expect(textOf(p.form()!.querySelector('.nd-result')!)).toContain(RESULT_COPY.matched);
  }, T);

  it('Send works while the options are still on their way, and the late answer shows nothing', async () => {
    const pending = deferred<AdviseResponse>();
    const p = setup({ advise: () => pending.promise });
    await p.read();
    expect(p.skeletons()).toHaveLength(2);
    await p.send();
    expect(p.createShipment).toHaveBeenCalledTimes(1);
    expect(p.card()).toBeNull();
    expect(p.advise.mock.calls[0][1]!.signal!.aborted).toBe(true);
    pending.resolve(OPTIONS);
    await flush();
    expect(p.card()).toBeNull();
    expect(textOf(p.form()!.querySelector('.nd-result')!)).toContain(RESULT_COPY.matched);
  }, T);

  it('a request without a recipient has no price yet: the card stays and says what it waits for (#948)', async () => {
    const p = setup({
      parse: async () => parsed({ destinationBusinessId: null }),
      advise: async () => ({ options: [], source: 'offline', note: 'Choose a recipient to see options.' }),
    });
    await p.read();
    // Asked once, with the recipient null: the server's sentence is the card's line.
    expect(p.advise).toHaveBeenCalledTimes(1);
    expect(p.advise.mock.calls[0][0]).toMatchObject({ originBusinessId: ACME.id, destinationBusinessId: null, readyMin: 960, deadlineMin: 2040 });
    expect(p.status()).toBe('Choose a recipient to see options.');
    expect(textOf(p.card()!.querySelector('.nd-options__needed')!)).toBe('Still needed: Recipient');
    expect(p.rows()).toHaveLength(0);
    expect(p.form()).not.toBeNull();
  }, T);

  it('"Fill in the form instead" asks for nothing', async () => {
    const p = setup();
    click(button(p.container, 'New delivery'));
    click(button(p.container, 'Fill in the form instead'));
    await flush();
    expect(p.advise).not.toHaveBeenCalled();
    expect(p.card()).toBeNull();
  }, T);
});

describe('the card belongs to one read request', () => {
  it('"Edit request" drops the card and its call; reading again asks again', async () => {
    const pending = deferred<AdviseResponse>();
    const answers = [() => pending.promise, async () => ({ ...OPTIONS, options: [AS_TYPED, EARLIER] })];
    const p = setup({ advise: () => answers.shift()!() });
    await p.read();
    click(button(p.note()!, 'Edit request'));
    expect(p.card()).toBeNull();
    expect(p.advise.mock.calls[0][1]!.signal!.aborted).toBe(true);
    pending.resolve(OPTIONS);
    await flush();
    expect(p.card()).toBeNull(); // the late answer of the first read opens nothing

    click(button(p.container, 'Read my request'));
    await flush();
    expect(p.advise).toHaveBeenCalledTimes(2);
    expect(p.rows()).toHaveLength(2);
    expect(p.chosen()).toEqual([true, false]);
  }, T);

  it('an option chosen in one card is not applied to the next', async () => {
    const p = setup();
    await p.read();
    click(p.choose(1));
    expect(p.times()).toEqual(['15:30', '2', '10:00']);
    click(button(p.note()!, 'Edit request'));
    click(button(p.container, 'Read my request'));
    await flush();
    expect(p.times()).toEqual(['16:00', '2', '10:00']);
    expect(p.chosen()).toEqual([true, false, false]);
  }, T);

  it('Cancel closes New delivery with the card', async () => {
    const p = setup();
    await p.read();
    click(button(p.form()!, 'Cancel'));
    expect(p.card()).toBeNull();
    expect(p.form()).toBeNull();
  }, T);
});

describe('without a stub the page asks the server', () => {
  it('POST /api/v2/advise with { draft } after the parse, and the answer fills the card', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(url.endsWith('/advise') ? OPTIONS : parsed()), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const m = mount(
      <BusinessPageView
        state={ready()} shipmentId={null} createShipment={async () => arranged('shp-1')}
        matchShipment={async () => arranged('shp-1')} refetchNow={async () => {}} dismissRunChanged={() => {}}
        onOpenShipment={() => {}} onCloseShipment={() => {}} businessHref={(id) => `/business/${id}`}
      />,
    );
    click(button(m.container, 'New delivery'));
    typeInto(byLabel(m.container, REQUEST_COPY.label), SENTENCE);
    click(button(m.container, 'Read my request'));
    for (let i = 0; i < 20 && !m.container.querySelector('.nd-option__cents'); i++) await flush();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/v2/parse-request', '/api/v2/advise']);
    const init = fetchMock.mock.calls[1][1]!;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      draft: {
        originBusinessId: ACME.id, destinationBusinessId: BAKERY.id, label: 'Envelope', category: 'envelope',
        description: 'Signed contract', weightKg: 0.2, readyMin: 960, deadlineMin: 2040,
      },
    });
    expect([...m.container.querySelectorAll('.nd-option__cents')].map(textOf)).toEqual(['$16.00', '$12.50', '$14.00']);
  }, T);
});
