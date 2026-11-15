// @vitest-environment jsdom
// #807 (docs/mvp4.md F1): the New delivery text box with the eight sentences a judge may type, signed in as
// Brooklyn Roasting Company, with no Gemini key. The answers below are the real server's, recorded from
// POST /api/v2/parse-request on a fresh default NYC run (built client, headless Chrome, 1440 and 390 px);
// `parseRequest` is a stub that gives them back, so this file needs no server, network or key.
// Part 1: what each card shows. Part 2: one test per page fault that the browser run found and #807 fixed:
//   A. at 390 px the top of the card ("Read by Relay’s rules", the sentence, the notes) was scrolled off screen;
//   B. after "Find a delivery match" the focus was on the page body;
//   C. the second press of a double press on "Read my request" landed on the card.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BusinessDashboard, ShipmentResponse } from '../../shared/v2/api';
import type { ParseDraft, ParseRequestResponse } from '../../shared/v2/parseRequest';
import type { CreateShipmentRequest } from '../../shared/v2/schemas';
import type { NetworkBusiness } from '../../shared/v2/types';
import {
  businessWorkspaceReducer, initialBusinessWorkspaceState, type BusinessWorkspaceState,
} from '../../client/src/components/business/v2/live/businessWorkspaceState';
import {
  REPEAT_PRESS_MS, REPEAT_PRESS_PX, isEchoPress, pressOf, type Press,
} from '../../client/src/components/business/v2/NewDeliveryForm';
import { NEEDS_INPUT_HINT, RESULT_COPY } from '../../client/src/components/business/v2/newDeliveryModel';
import { BusinessPageView } from '../../client/src/components/business/v2/page/BusinessPageView';
import type { ParseRequestCall } from '../../client/src/components/business/v2/RequestTextBox';
import { REQUEST_COPY } from '../../client/src/components/business/v2/requestTextModel';
import { directPlan, view } from './business-v2-details-sample';
import { button, buttons, byLabel, click, deferred, flush, mount, press, textOf, typeInto } from './kitDom';

const T = 10_000;

// ---------- the run: the committed NYC businesses, signed in as the README demo's sender ----------

const BUSINESSES: NetworkBusiness[] = (JSON.parse(
  readFileSync(resolve(__dirname, '../../fixtures/nyc/businesses.json'), 'utf8'),
) as { businesses: Omit<NetworkBusiness, 'lat' | 'lng'>[] }).businesses.map((b) => ({ ...b, lat: 0, lng: 0 }));
const SENDER = BUSINESSES.find((b) => b.id === 'biz-brooklyn-roasting')!;
const DASHBOARD: BusinessDashboard = {
  business: SENDER, outgoing: [], incoming: [], notifications: [],
  totals: { sent: 0, matched: 0, delivered: 0, spendCents: 0 }, phase: 'planning', version: 3,
};
function ready(): BusinessWorkspaceState {
  const s = businessWorkspaceReducer(initialBusinessWorkspaceState, { type: 'dashboard', dashboard: DASHBOARD, runId: 'run-nyc' });
  return businessWorkspaceReducer(s, { type: 'directories', businesses: BUSINESSES, employees: [] });
}

// ---------- the eight sentences and the server's recorded answers ----------

const offline = (draft: ParseDraft, missing: (keyof ParseDraft)[], rejected: string | null = null): ParseRequestResponse =>
  ({ draft, missing, rejected, source: 'offline' });

const LONG = ('Please deliver a small box of espresso blend samples from Brooklyn Roasting Company to Blue Bottle Coffee by '
  + '10 a.m. tomorrow, ready at 4 p.m.; the box holds twelve sample bags for the new winter menu, each one labelled with '
  + 'its roast date, and it should be handed to the shift manager at the front counter, who knows it is coming and will '
  + 'sign for it, so the courier does not need to wait in the line with the morning customers or call ahead before '
  + 'arriving at the shop.').padEnd(500, '.');

const CONFIRM = REQUEST_COPY.confirm;
const SENDER_NOTE = 'You are signed in as Brooklyn Roasting Company; this request will be sent from Brooklyn Roasting Company.';
const BLUE_BOTTLE = 'Blue Bottle Coffee · Financial District';

/** What the card showed in Chrome, the same at 1440 and 390 px. `fields` in screen order. */
type Card = {
  n: number; what: string; text: string; answer: ParseRequestResponse;
  fields: [recipient: string, name: string, type: string, weight: string, contents: string, ready: string, day: string, time: string];
  checks: string[]; notes: string[]; focus: string;
};

const CARDS: Card[] = [
  {
    n: 1, what: 'a complete sentence: two network businesses, a category and "by 10 a.m. tomorrow"',
    text: 'Deliver an envelope from Brooklyn Roasting Company to Blue Bottle Coffee by 10 a.m. tomorrow.',
    answer: offline({
      originBusinessId: 'biz-brooklyn-roasting', destinationBusinessId: 'biz-blue-bottle-wall', label: 'Envelope',
      category: 'envelope', description: null, weightKg: null, readyMin: 930, deadlineMin: 2040,
    }, ['description', 'weightKg']),
    fields: [BLUE_BOTTLE, 'Envelope', 'envelope', '0.5', '', '15:30', '2', '10:00'],
    checks: ['Weight (kg)', 'Contents'], notes: [CONFIRM], focus: 'Weight (kg)',
  },
  {
    n: 2, what: 'no deadline',
    text: 'Send a small box of coffee beans to Etsy.',
    answer: offline({
      originBusinessId: null, destinationBusinessId: 'biz-etsy', label: 'Box', category: 'small_box',
      description: 'Coffee beans', weightKg: null, readyMin: 930, deadlineMin: null,
    }, ['originBusinessId', 'weightKg', 'deadlineMin']),
    fields: ['Etsy · DUMBO', 'Box', 'small_box', '0.5', 'Coffee beans', '15:30', '2', '10:00'],
    checks: ['Weight (kg)', 'Deliver by: day', 'Deliver by: time'], notes: [CONFIRM], focus: 'Weight (kg)',
  },
  {
    // #827: the server now reads what is sent as the Package name and the Contents; the Type stays to check.
    n: 3, what: 'no category',
    text: 'Send espresso blend samples to Blue Bottle Coffee by 10 a.m. tomorrow.',
    answer: offline({
      originBusinessId: null, destinationBusinessId: 'biz-blue-bottle-wall', label: 'Espresso blend samples', category: null,
      description: 'Espresso blend samples', weightKg: null, readyMin: 930, deadlineMin: 2040,
    }, ['originBusinessId', 'category', 'weightKg']),
    fields: [BLUE_BOTTLE, 'Espresso blend samples', 'envelope', '0.5', 'Espresso blend samples', '15:30', '2', '10:00'],
    checks: ['Type', 'Weight (kg)'], notes: [CONFIRM], focus: 'Type',
  },
  {
    n: 4, what: 'a street address as the recipient',
    text: 'Deliver an envelope to 123 Main Street, Brooklyn by 10 a.m. tomorrow.',
    answer: offline({
      originBusinessId: null, destinationBusinessId: null, label: 'Envelope', category: 'envelope',
      description: null, weightKg: null, readyMin: 930, deadlineMin: 2040,
    }, ['originBusinessId', 'destinationBusinessId', 'description', 'weightKg'],
    'Relay delivers only between network businesses, and "123 Main Street" is not one.'),
    fields: ['Choose a business', 'Envelope', 'envelope', '0.5', '', '15:30', '2', '10:00'],
    checks: ['Recipient', 'Weight (kg)', 'Contents'],
    notes: ['Relay delivers only between network businesses, and "123 Main Street" is not one.', CONFIRM],
    focus: 'Recipient',
  },
  {
    n: 5, what: 'a business that is not in the network',
    text: "Send an envelope to Joe's Pizza by 9 a.m. tomorrow.",
    answer: offline({
      originBusinessId: null, destinationBusinessId: null, label: 'Envelope', category: 'envelope',
      description: null, weightKg: null, readyMin: 930, deadlineMin: 1980,
    }, ['originBusinessId', 'destinationBusinessId', 'description', 'weightKg'],
    'Relay delivers only between network businesses, and "Joe\'s Pizza" is not one.'),
    fields: ['Choose a business', 'Envelope', 'envelope', '0.5', '', '15:30', '2', '09:00'],
    checks: ['Recipient', 'Weight (kg)', 'Contents'],
    notes: ['Relay delivers only between network businesses, and "Joe\'s Pizza" is not one.', CONFIRM],
    focus: 'Recipient',
  },
  {
    n: 6, what: 'another business as the sender',
    text: 'Deliver an envelope from Etsy to Blue Bottle Coffee by 10 a.m. tomorrow.',
    answer: offline({
      originBusinessId: 'biz-etsy', destinationBusinessId: 'biz-blue-bottle-wall', label: 'Envelope',
      category: 'envelope', description: null, weightKg: null, readyMin: 930, deadlineMin: 2040,
    }, ['description', 'weightKg']),
    fields: [BLUE_BOTTLE, 'Envelope', 'envelope', '0.5', '', '15:30', '2', '10:00'],
    checks: ['Weight (kg)', 'Contents'], notes: [SENDER_NOTE, CONFIRM], focus: 'Weight (kg)',
  },
  {
    n: 7, what: '500 characters',
    text: LONG,
    answer: offline({
      originBusinessId: 'biz-brooklyn-roasting', destinationBusinessId: 'biz-blue-bottle-wall', label: 'Box',
      category: 'small_box', description: 'Espresso blend samples', weightKg: null, readyMin: 960, deadlineMin: 2040,
    }, ['weightKg']),
    fields: [BLUE_BOTTLE, 'Box', 'small_box', '0.5', 'Espresso blend samples', '16:00', '2', '10:00'],
    checks: ['Weight (kg)'], notes: [CONFIRM], focus: 'Weight (kg)',
  },
];
const card = (n: number) => CARDS.find((c) => c.n === n)!;

/** The form fields that show a draft field the server lists in `missing`. The sender is not a field (pass 81). */
const FIELDS_OF: Record<keyof ParseDraft, string[]> = {
  originBusinessId: [], destinationBusinessId: ['Recipient'], label: ['Package name'], category: ['Type'],
  description: ['Contents'], weightKg: ['Weight (kg)'], readyMin: ['Ready for pickup (Day 1)'],
  deadlineMin: ['Deliver by: day', 'Deliver by: time'],
};
const FIELD_LABELS = ['Recipient', 'Package name', 'Type', 'Weight (kg)', 'Contents', 'Ready for pickup (Day 1)', 'Deliver by: day', 'Deliver by: time'];

const arranged = (id: string): ShipmentResponse => ({
  ...view({ ...directPlan, id: `plan-${id}`, shipmentId: id }, 'scheduled', {}, { id, label: 'Envelope' }),
  matched: true,
});
const noMatch = (id: string): ShipmentResponse => ({
  ...view(null, 'unmatched', { unmatchedReason: 'No commute passes both businesses in time.' }, { id, label: 'Envelope' }),
  matched: false,
});

// ---------- the page ----------

type Send = (req: CreateShipmentRequest) => Promise<ShipmentResponse>;

function setup(send: Send = async () => arranged('shp-25')) {
  const parseRequest = vi.fn<ParseRequestCall>(async (text) => {
    const found = CARDS.find((c) => c.text === text);
    if (!found) throw new Error(`no recorded answer for "${text}"`);
    return found.answer;
  });
  const createShipment = vi.fn(send);
  const m = mount(
    <BusinessPageView
      state={ready()} shipmentId={null}
      createShipment={createShipment}
      matchShipment={async () => { throw new Error('not called'); }}
      refetchNow={async () => {}} dismissRunChanged={() => {}}
      onOpenShipment={() => {}} onCloseShipment={() => {}}
      businessHref={(id) => `/business/${id}`}
      parseRequest={parseRequest}
    />,
  );
  const c = m.container;
  const p = {
    ...m, parseRequest, createShipment,
    box: () => c.querySelector<HTMLFormElement>('form.nd-request'),
    form: () => c.querySelector<HTMLFormElement>('form.nd'),
    note: () => c.querySelector<HTMLElement>('.nd-parsed'),
    textarea: () => byLabel(c, REQUEST_COPY.label) as HTMLTextAreaElement,
    readButton: () => p.box()!.querySelector<HTMLButtonElement>('button[type="submit"]')!,
    sendButton: () => p.form()!.querySelector<HTMLButtonElement>('.nd-actions button[type="submit"]')!,
    field: (label: string) => byLabel(p.form()!, label) as HTMLInputElement | HTMLSelectElement,
    /** The toolbar's button (a business with no delivery yet has a second one in the empty table). */
    opener: () => buttons(c, 'New delivery')[0],
    open: () => click(p.opener()),
    type: (text: string) => typeInto(p.textarea(), text),
    /** New delivery, the sentence, "Read my request", and the answer. */
    read: async (text: string) => {
      p.open();
      p.type(text);
      click(p.readButton());
      await flush();
    },
    /** The eight fields as the card shows them, in screen order. */
    fields: () => FIELD_LABELS.map((label) => {
      const el = p.field(label);
      return label === 'Recipient' ? (el as HTMLSelectElement).selectedOptions[0]?.text.trim() ?? '' : el.value;
    }),
    /** The labels of the fields that carry the "Check this" hint, in screen order. */
    checks: () => [...p.form()!.querySelectorAll('.nd-field--check')].map((f) => {
      expect(textOf(f.querySelector('.nd-check')!)).toBe(NEEDS_INPUT_HINT);
      return textOf(f.querySelector('label')!);
    }),
    notes: () => [...p.note()!.querySelectorAll('.nd-parsed__notes > *')].map(textOf),
    result: () => textOf(p.form()!.querySelector('.nd-result')!),
  };
  return p;
}

const savedScroll = Element.prototype.scrollIntoView;
afterEach(() => {
  vi.restoreAllMocks();
  Element.prototype.scrollIntoView = savedScroll;
});

// ---------- Part 1: what each card shows ----------

describe('the eight sentences, read offline as Brooklyn Roasting Company (#807)', () => {
  it('the recorded answers are answers of the contract: `missing` lists exactly the null fields', () => {
    for (const c of CARDS) {
      const nulls = (Object.keys(c.answer.draft) as (keyof ParseDraft)[]).filter((k) => c.answer.draft[k] === null);
      expect(c.answer.missing, `sentence ${c.n}`).toEqual(nulls);
      expect(c.answer.source).toBe('offline');
      expect(c.text.length).toBeLessThanOrEqual(500);
    }
    expect(card(7).text).toHaveLength(500);
  });

  it.each(CARDS)('($n) $what: the card opens with "Read by Relay’s rules", the missing fields marked, nothing sent', async (c) => {
    const p = setup();
    await p.read(c.text);
    expect(p.parseRequest).toHaveBeenCalledTimes(1);
    expect(p.parseRequest.mock.calls[0][0]).toBe(c.text);
    // The box has turned into the card: the lines about the request, then the form.
    expect(p.box()).toBeNull();
    const note = p.note()!;
    expect(note.nextElementSibling).toBe(p.form());
    expect(textOf(note.querySelector('.nd-parsed__source')!)).toBe('Read by Relay’s rules');
    expect(textOf(note)).not.toContain('Gemini');
    expect(textOf(note.querySelector('.nd-parsed__text')!)).toBe(`“${c.text}”`);
    expect(p.notes()).toEqual(c.notes);
    expect(textOf(p.form()!)).toContain('From Brooklyn Roasting Company · Brooklyn Navy Yard');
    // The fields, and "Check this" on exactly the fields the server listed in `missing`.
    expect(p.fields()).toEqual(c.fields);
    expect(p.checks()).toEqual(c.checks);
    const listed = c.answer.missing.flatMap((k) => FIELDS_OF[k]);
    expect([...p.checks()].sort()).toEqual([...listed].sort());
    expect(document.activeElement).toBe(p.field(c.focus)); // the first field to check
    // Only the form's own button sends.
    expect(textOf(p.sendButton())).toBe('Find a delivery match');
    expect(p.sendButton().disabled).toBe(false);
    expect(p.form()!.querySelectorAll('.nd-error')).toHaveLength(0);
    expect(p.createShipment).not.toHaveBeenCalled();
  }, T);

  it('(1) ends in "Delivery arranged" once Contents, which the sentence left out, is typed', async () => {
    const p = setup();
    await p.read(card(1).text);
    // As the card opened: the form's own check answers, with the focus on the field, and nothing is sent.
    click(p.sendButton());
    await flush();
    expect([...p.form()!.querySelectorAll('.nd-error')].map(textOf)).toEqual(['Describe the contents']);
    expect(document.activeElement).toBe(p.field('Contents'));
    expect(p.createShipment).not.toHaveBeenCalled();
    typeInto(p.field('Contents'), 'Signed contract');
    expect(p.checks()).toEqual(['Weight (kg)']); // an edited field is the user's own
    click(p.sendButton());
    await flush();
    expect(p.createShipment).toHaveBeenCalledTimes(1);
    expect(p.createShipment.mock.calls[0][0]).toMatchObject({
      originBusinessId: 'biz-brooklyn-roasting', destinationBusinessId: 'biz-blue-bottle-wall', label: 'Envelope',
      category: 'envelope', description: 'Signed contract', weightKg: 0.5, readyMin: 930, deadlineMin: 2040,
    });
    expect(p.result()).toContain(RESULT_COPY.matched);
    expect(p.parseRequest).toHaveBeenCalledTimes(1);
  }, T);

  it('(1) with no commute to take it ends in the no-match message, and the card stays', async () => {
    const p = setup(async () => noMatch('shp-25'));
    await p.read(card(1).text);
    typeInto(p.field('Contents'), 'Signed contract');
    click(p.sendButton());
    await flush();
    expect(p.result()).toContain(RESULT_COPY.unmatched);
    expect(textOf(p.note()!.querySelector('.nd-parsed__source')!)).toBe('Read by Relay’s rules');
    expect(p.fields()[1]).toBe('Envelope');
  }, T);

  it('(6) is sent from the signed-in business, never from the one the sentence names', async () => {
    const p = setup();
    await p.read(card(6).text);
    typeInto(p.field('Contents'), 'Signed contract');
    click(p.sendButton());
    await flush();
    expect(p.createShipment.mock.calls[0][0]).toMatchObject({ originBusinessId: 'biz-brooklyn-roasting', destinationBusinessId: 'biz-blue-bottle-wall' });
  }, T);

  it('(4) and (5): the card cannot be sent while no network business is chosen', async () => {
    for (const n of [4, 5]) {
      const p = setup();
      await p.read(card(n).text);
      typeInto(p.field('Contents'), 'Signed contract');
      click(p.sendButton());
      await flush();
      expect([...p.form()!.querySelectorAll('.nd-error')].map(textOf), `sentence ${n}`).toEqual(['Choose a recipient business']);
      expect(document.activeElement).toBe(p.field('Recipient'));
      expect(p.createShipment).not.toHaveBeenCalled();
      p.unmount();
    }
  }, T);

  it('(7) the box takes 500 characters and counts them', () => {
    const p = setup();
    p.open();
    expect(p.textarea().maxLength).toBe(500);
    p.type(card(7).text);
    expect(textOf(p.box()!.querySelector('.nd-request__count')!)).toBe('500 / 500 characters');
    expect(p.box()!.querySelector('.nd-error')).toBeNull();
  }, T);

  it.each([['an empty box', ''], ['only spaces', '     ']])('(8) %s: a plain message beside the box, nothing asked, nothing sent', async (_what, text) => {
    const p = setup();
    p.open();
    if (text) p.type(text);
    click(p.readButton());
    await flush();
    expect(p.form()).toBeNull();
    const box = p.box()!;
    expect(textOf(box.querySelector('.nd-error')!)).toBe('Describe the delivery in one sentence');
    expect(p.textarea().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(p.textarea());
    // Enter does the same, and typing takes the message away.
    press('Enter', p.textarea());
    await flush();
    expect(textOf(box.querySelector('.nd-error')!)).toBe('Describe the delivery in one sentence');
    p.type('S');
    expect(box.querySelector('.nd-error')).toBeNull();
    expect(p.parseRequest).not.toHaveBeenCalled();
    expect(p.createShipment).not.toHaveBeenCalled();
  }, T);
});

// ---------- Part 2: the page faults ----------

describe('fault A: the top of the card stays on screen when it opens (#807)', () => {
  // Chrome, 390 x 844, sentence (1): the first "Check this" field (Weight) took the focus and was scrolled to
  // the middle of the screen, so "Read by Relay’s rules", the sentence and the notes ended 2 px above the screen.
  it('the first "Check this" field gets the focus without scrolling the page', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const p = setup();
    p.open();
    p.type(card(6).text);
    focus.mockClear();
    click(p.readButton());
    await flush();
    const weight = p.field('Weight (kg)');
    expect(document.activeElement).toBe(weight);
    const calls = focus.mock.contexts.map((el, i) => ({ el, options: focus.mock.calls[i][0] })).filter((call) => p.form()!.contains(call.el as Node));
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.el).toBe(weight);
      expect(call.options).toEqual({ preventScroll: true });
    }
  }, T);

  it('the lines about the request are brought on screen, and only if they are not there already', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const p = setup();
    await p.read(card(6).text); // the sender note is the line a user must not miss
    expect(scroll.mock.contexts).toEqual([p.note()]);
    expect(scroll.mock.calls).toEqual([[{ block: 'nearest' }]]); // `nearest` moves nothing when it is in view
    // Once, when the card opens: not on an edit, and not for the empty form, which has no such lines.
    typeInto(p.field('Contents'), 'Signed contract');
    expect(scroll).toHaveBeenCalledTimes(1);
    click(button(p.form()!, 'Cancel'));
    p.open();
    click(button(p.box()!, 'Fill in the form instead'));
    expect(p.note()).toBeNull();
    expect(scroll).toHaveBeenCalledTimes(1);
  }, T);

  it('a browser without scrollIntoView (plain jsdom) opens the card all the same', async () => {
    // @ts-expect-error the property is not optional in lib.dom
    Element.prototype.scrollIntoView = undefined;
    const p = setup();
    await p.read(card(4).text);
    expect(p.notes()).toEqual(card(4).notes);
    expect(document.activeElement).toBe(p.field('Recipient'));
  }, T);
});

describe('fault B: the focus comes back to the card after "Find a delivery match" (#807)', () => {
  // Chrome: the fields and the button are disabled while the request is on its way, and Chrome moves the
  // focus of a disabled control to the page body. jsdom 31 does the same at its next frame (its focus fixup),
  // so by now the focus is either still on the disabled control or on the body already: both end on the body.
  const browserDropsFocus = () => {
    const active = document.activeElement as HTMLElement;
    if (active !== document.body) {
      // The button is disabled itself; a field is inside a disabled fieldset.
      expect((active as HTMLButtonElement).disabled || active.closest('fieldset')?.disabled).toBe(true);
      act(() => { active.blur(); });
    }
    expect(document.activeElement).toBe(document.body);
  };

  async function pendingSend(answer: 'arranged' | 'noMatch' | 'fails' = 'arranged') {
    const sending = deferred<ShipmentResponse>();
    const p = setup(() => sending.promise);
    await p.read(card(1).text);
    typeInto(p.field('Contents'), 'Signed contract');
    const finish = async () => {
      if (answer === 'fails') sending.reject(Object.assign(new Error('Failed to fetch'), { status: 0 }));
      else sending.resolve(answer === 'arranged' ? arranged('shp-25') : noMatch('shp-25'));
      await flush();
    };
    return { p, finish };
  }

  it('a pointer press: back on the button, without scrolling away from the answer', async () => {
    const { p, finish } = await pendingSend();
    click(p.sendButton());
    await flush();
    expect(p.sendButton().disabled).toBe(true);
    browserDropsFocus();
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    await finish();
    expect(p.result()).toContain(RESULT_COPY.matched);
    expect(document.activeElement).toBe(p.sendButton());
    expect(p.sendButton().disabled).toBe(false);
    expect(focus.mock.calls).toEqual([[{ preventScroll: true }]]);
  }, T);

  it('Enter in a field: back in that field', async () => {
    const { p, finish } = await pendingSend();
    const contents = p.field('Contents');
    act(() => { contents.focus(); p.form()!.requestSubmit(); });
    await flush();
    expect(p.createShipment).toHaveBeenCalledTimes(1);
    browserDropsFocus();
    await finish();
    expect(p.result()).toContain(RESULT_COPY.matched);
    expect(document.activeElement).toBe(p.field('Contents'));
  }, T);

  it.each([
    ['no match', 'noMatch', RESULT_COPY.unmatched, 'Try matching again'],
    ['no answer from the server', 'fails', '', 'Find a delivery match'],
  ] as const)('%s: back on the button too', async (_what, answer, result, name) => {
    const { p, finish } = await pendingSend(answer);
    click(p.sendButton());
    await flush();
    browserDropsFocus();
    await finish();
    if (result) expect(p.result()).toContain(result);
    else expect(textOf(p.form()!.querySelector('.nd-alert')!)).toBe(RESULT_COPY.noAnswer);
    expect(textOf(p.sendButton())).toBe(name);
    expect(document.activeElement).toBe(p.sendButton());
  }, T);

  it('a user who moved on while waiting keeps the focus where they put it', async () => {
    const { p, finish } = await pendingSend();
    click(p.sendButton());
    await flush();
    browserDropsFocus();
    const elsewhere = p.opener();
    act(() => { elsewhere.focus(); });
    await finish();
    expect(p.result()).toContain(RESULT_COPY.matched);
    expect(document.activeElement).toBe(elsewhere);
  }, T);

  it('a press that sends nothing (a field is still empty) is not touched: the focus is on that field', async () => {
    const p = setup();
    await p.read(card(1).text);
    click(p.sendButton());
    await flush();
    expect(document.activeElement).toBe(p.field('Contents'));
    expect(p.createShipment).not.toHaveBeenCalled();
  }, T);
});

describe('fault C: the second press of a double press on the text box never reaches the card (#807)', () => {
  // Chrome, 1440 px, sentence (1): the card opens between the two presses, and the Recipient list is where
  // "Read my request" was. The second press took the focus from the first "Check this" field to that list.
  const AT = { x: 180, y: 600, time: 5000 };
  type PressInit = { detail?: number; after?: number; dx?: number; dy?: number };

  /** A mouse event as the browser reports a pointer press: `detail` is the click count, 0 for a key press. */
  function pointer(type: 'mousedown' | 'click', el: Element, o: PressInit = {}): MouseEvent {
    const e = new MouseEvent(type, {
      bubbles: true, cancelable: true, button: 0, detail: o.detail ?? 1,
      clientX: AT.x + (o.dx ?? 0), clientY: AT.y + (o.dy ?? 0),
    });
    Object.defineProperty(e, 'timeStamp', { value: AT.time + (o.after ?? 0) });
    act(() => { el.dispatchEvent(e); });
    return e;
  }
  /** The whole press: the browser acts on mousedown (focus, an opening list) and on click (a button, a link). */
  const pressAt = (el: Element, o: PressInit = {}) => [pointer('mousedown', el, o), pointer('click', el, o)].map((e) => e.defaultPrevented);

  async function opened(by: 'Read my request' | 'Fill in the form instead' = 'Read my request', n = 1) {
    const p = setup();
    p.open();
    p.type(card(n).text);
    pointer('click', button(p.box()!, by));
    await flush();
    expect(p.form()).not.toBeNull();
    return p;
  }

  it('a second press 150 ms later at the same place is dropped, whatever the card has there', async () => {
    const p = await opened();
    expect(pressAt(p.field('Recipient'), { detail: 2, after: 150 })).toEqual([true, true]);
    expect(pressAt(p.form()!.querySelector('.nd-legend')!, { detail: 2, after: 150, dx: 3, dy: -4 })).toEqual([true, true]);
    // A tap on a touch screen reports every press as a first click.
    expect(pressAt(p.field('Contents'), { after: 300 })).toEqual([true, true]);
    expect(document.activeElement).toBe(p.field('Weight (kg)')); // still on the first field to check
  }, T);

  it('it never sends, cancels or goes back to the box', async () => {
    const p = await opened('Read my request', 7); // (7) is complete but for the weight, which has the form's value
    pressAt(p.sendButton(), { detail: 2, after: 150 });
    await flush();
    expect(p.createShipment).not.toHaveBeenCalled();
    pressAt(button(p.form()!, 'Cancel'), { detail: 2, after: 160 });
    expect(p.form()).not.toBeNull();
    pressAt(button(p.note()!, REQUEST_COPY.edit), { detail: 2, after: 170 });
    expect(p.box()).toBeNull();
    expect(p.fields()).toEqual(card(7).fields);
    // The same buttons work for a press of the user's own.
    pressAt(p.sendButton(), { after: 900 });
    await flush();
    expect(p.createShipment).toHaveBeenCalledTimes(1);
  }, T);

  it('the same for "Fill in the form instead"', async () => {
    const p = await opened('Fill in the form instead');
    expect(p.note()).toBeNull();
    expect(pressAt(p.field('Type'), { detail: 2, after: 120 })).toEqual([true, true]);
    pressAt(button(p.form()!, 'Cancel'), { detail: 2, after: 130 });
    expect(p.form()).not.toBeNull();
    pressAt(button(p.form()!, 'Cancel'), { after: 800 });
    expect(p.form()).toBeNull();
  }, T);

  it('a press later, elsewhere, or after reading with Enter is the user\'s own', async () => {
    const p = await opened();
    expect(pressAt(p.field('Recipient'), { after: REPEAT_PRESS_MS })).toEqual([false, false]);
    const q = await opened();
    expect(pressAt(q.field('Recipient'), { detail: 2, after: 150, dx: REPEAT_PRESS_PX + 1 })).toEqual([false, false]);
    expect(pressAt(q.field('Recipient'), { detail: 2, after: 150, dy: -(REPEAT_PRESS_PX + 1) })).toEqual([false, false]);
    // Enter in the box: no pointer press to echo.
    const r = setup();
    r.open();
    r.type(card(1).text);
    press('Enter', r.textarea());
    await flush();
    expect(r.form()).not.toBeNull();
    expect(pressAt(r.field('Recipient'), { after: 150 })).toEqual([false, false]);
    // Enter or Space on a focused control of the card (`detail` 0) is never a pointer press.
    const s = await opened();
    expect(pressAt(s.field('Recipient'), { detail: 0, after: 150 })).toEqual([false, false]);
  }, T);

  it('isEchoPress and pressOf(e, "button"): the rule on its own', () => {
    const first: Press = { time: AT.time, x: AT.x, y: AT.y };
    const ev = (o: PressInit = {}) => ({
      detail: o.detail ?? 1, timeStamp: AT.time + (o.after ?? 0), clientX: AT.x + (o.dx ?? 0), clientY: AT.y + (o.dy ?? 0),
    });
    expect(isEchoPress(ev({ after: 0 }), first)).toBe(true);
    expect(isEchoPress(ev({ after: REPEAT_PRESS_MS - 1, dx: REPEAT_PRESS_PX, dy: -REPEAT_PRESS_PX }), first)).toBe(true);
    expect(isEchoPress(ev({ after: REPEAT_PRESS_MS }), first)).toBe(false);
    // Unlike a repeat press on a button that stays (isRepeatPress), a late second click is not dropped:
    // the button is gone, and a double click on a field of the card selects a word.
    expect(isEchoPress(ev({ detail: 2, after: REPEAT_PRESS_MS + 400 }), first)).toBe(false);
    expect(isEchoPress(ev({ after: -1 }), first)).toBe(false);
    expect(isEchoPress(ev({ after: 100, dx: REPEAT_PRESS_PX + 1 }), first)).toBe(false);
    expect(isEchoPress(ev({ detail: 0, after: 100 }), first)).toBe(false);
    expect(isEchoPress(ev({ after: 100 }), null)).toBe(false);

    const host = document.createElement('div');
    host.innerHTML = '<form><button type="submit" id="read">Read</button><button type="button" id="fill">Fill</button><textarea id="text"></textarea></form>';
    const on = (id: string, o: PressInit = {}) => ({ ...ev(o), target: host.querySelector(`#${id}`)! });
    expect(pressOf(on('read'), 'button')).toEqual(first);
    expect(pressOf(on('fill'), 'button')).toEqual(first);
    expect(pressOf(on('fill'))).toBeNull(); // the default is still the submit button only
    expect(pressOf(on('text'), 'button')).toBeNull();
    expect(pressOf(on('read', { detail: 0 }), 'button')).toBeNull(); // Enter on the button
  });
});
