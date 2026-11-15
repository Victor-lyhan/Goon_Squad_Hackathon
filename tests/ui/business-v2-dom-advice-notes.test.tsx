// @vitest-environment jsdom
// #948 (human bug report: "the Options card shows nothing most of the time"), in a real DOM, through the
// Business page. POST /api/v2/parse-request and POST /api/v2/advise are stubs that answer as the server half
// (#947) does: `note` and `assumed` beside the contract's fields, and a 200 with no option and a note for a
// request that lacks a field.
// 1. Without an option the card stays and says why in one line, with the field the options wait for named
//    under it and marked in the form below. Only a call with no answer hides it.
// 2. The form shows what the server chose: the moved or assumed deliver-by time under the deliver-by fields
//    ("(assumed, change it if needed)"), a misspelt recipient as "Bakery Row (from ‘Bakry Row’)".
// 3. When the missing field is filled in, or the deliver-by time is changed, the card asks again by itself,
//    once the typing has paused (REASK_DELAY_MS).
// The pure models: business-v2-advice-notes-model.test.ts.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdviseOption, AdviseResponse, ShipmentResponse } from '../../shared/v2/api';
import type { ParseDraft, ParseRequestResponse } from '../../shared/v2/parseRequest';
import type { CreateShipmentRequest } from '../../shared/v2/schemas';
import { ApiRequestError } from '../../client/src/api/v2';
import { ADVICE_COPY, REASK_DELAY_MS, type AdviseAsk, type AdviseCall } from '../../client/src/components/business/v2/adviceModel';
import { NEEDS_INPUT_HINT } from '../../client/src/components/business/v2/newDeliveryModel';
import { BusinessPageView } from '../../client/src/components/business/v2/page/BusinessPageView';
import type { ParseRequestCall } from '../../client/src/components/business/v2/RequestTextBox';
import { REQUEST_COPY } from '../../client/src/components/business/v2/requestTextModel';
import { directPlan, view } from './business-v2-details-sample';
import { ACME, ATLAS, BAKERY, ready } from './business-v2-page-sample';
import { button, byLabel, click, mount, select, textOf, typeInto } from './kitDom';

const T = 10_000;
const SENTENCE = 'deliver a box of cookies to Bakry Row by tomorrow 5pm';

// What the server half (#947) writes; the page shows these words, it does not make them.
const CLAMPED = 'Relay delivers by 12:00 PM tomorrow, ahead of your 5:00 PM deadline.';
const ASSUMED = 'No deliver-by time given, so Relay delivers by 12:00 PM tomorrow.';
const NEAR = 'Read "Bakry Row" as Bakery Row.';
const NEED_RECIPIENT = 'Choose a recipient to see options.';
const NO_COMMUTE = 'No commute passes both businesses before the deadline.';

/** Everything filled: ready Day 1 16:00, deliver by Day 2 12:00 (the end of the run). */
const FULL: ParseDraft = {
  originBusinessId: ACME.id, destinationBusinessId: BAKERY.id, label: 'Cookies', category: 'small_box',
  description: 'A box of cookies', weightKg: 0.5, readyMin: 960, deadlineMin: 2160,
};
type Extras = { note?: string; assumed?: (keyof ParseDraft)[] };
const parsed = (draft: Partial<ParseDraft> = {}, extras: Extras = {}): ParseRequestResponse => {
  const d = { ...FULL, ...draft };
  return {
    draft: d, missing: (Object.keys(d) as (keyof ParseDraft)[]).filter((k) => d[k] === null), rejected: null, source: 'offline', ...extras,
  } as ParseRequestResponse;
};

const AS_TYPED: AdviseOption = {
  label: 'As requested', summary: 'Next-morning relay through Atlas Books.', changes: {}, kind: 'relay',
  relayBusinessId: ATLAS.id, carrierNames: ['Maya Chen', 'Luis Ortega'], deliveryMin: 1985, extraMin: 17,
  extraMiles: 2.4, customerPriceCents: 1600,
};
const EARLIER_DEADLINE: AdviseOption = {
  label: 'Deliver by 10:00 AM', summary: 'A tighter window.', changes: { deadlineMin: 2040 }, kind: 'direct',
  carrierNames: ['Maya Chen'], deliveryMin: 1110, extraMin: 9, extraMiles: 1, customerPriceCents: 1700,
};
const OPTIONS: AdviseResponse = { options: [AS_TYPED, EARLIER_DEADLINE], source: 'offline' };
const none = (note?: string): AdviseResponse => ({ options: [], source: 'offline', ...(note ? { note } : {}) });

/** The server half's /advise, as far as the card can tell: a missing recipient is a note, a full request has options. */
const server = async (ask: AdviseAsk): Promise<AdviseResponse> => (ask.destinationBusinessId === null ? none(NEED_RECIPIENT) : OPTIONS);

const arranged = (id: string): ShipmentResponse => ({
  ...view({ ...directPlan, id: `plan-${id}`, shipmentId: id }, 'scheduled', {}, { id, label: 'Cookies' }),
  matched: true,
});

/** Lets the stubs' promises settle and moves the (fake) clock on, inside React's act. */
async function tick(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

type Setup = { advise?: (ask: AdviseAsk) => Promise<AdviseResponse>; parse?: () => Promise<ParseRequestResponse> };

function setup({ advise: answer = server, parse = async () => parsed() }: Setup = {}) {
  const advise = vi.fn<AdviseCall>((ask) => answer(ask));
  const parseRequest = vi.fn<ParseRequestCall>(() => parse());
  const createShipment = vi.fn(async (_req: CreateShipmentRequest) => arranged('shp-51'));
  const m = mount(
    <BusinessPageView
      state={ready()} shipmentId={null}
      createShipment={createShipment} matchShipment={async () => arranged('shp-51')}
      refetchNow={async () => {}} dismissRunChanged={() => {}}
      onOpenShipment={() => {}} onCloseShipment={() => {}}
      businessHref={(id) => `/business/${id}`}
      parseRequest={parseRequest} advise={advise}
    />,
  );
  const c = m.container;
  const form = () => c.querySelector<HTMLFormElement>('form.nd')!;
  const p = {
    ...m, advise, parseRequest, createShipment, form,
    card: () => c.querySelector<HTMLElement>('.nd-options'),
    status: () => textOf(p.card()!.querySelector('.nd-options__status')!),
    needed: () => p.card()!.querySelector<HTMLElement>('.nd-options__needed'),
    hints: () => [...p.card()!.querySelectorAll('.nd-options__hint')].map(textOf),
    rows: () => [...c.querySelectorAll<HTMLElement>('.nd-options .nd-option:not(.nd-option--skeleton)')],
    skeletons: () => [...c.querySelectorAll<HTMLElement>('.nd-options .nd-option--skeleton')],
    choose: (row: number) => p.rows()[row].querySelector<HTMLButtonElement>('button.nd-option__choose')!,
    parsedNotes: () => [...c.querySelectorAll('.nd-parsed .nd-parsed__note')].map(textOf),
    field: (label: string) => byLabel(form(), label) as HTMLInputElement | HTMLSelectElement,
    /** The field's wrapper: its label, control and the lines under it. */
    wrap: (label: string) => p.field(label).closest<HTMLElement>('.nd-field')!,
    marked: () => [...form().querySelectorAll('.nd-field--check label')].map(textOf),
    /** The lines a screen reader reads with the field, in order. */
    described: (label: string) => (p.field(label).getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
      .map((id) => textOf(document.getElementById(id)!)),
    /** The lines about how the request was read, anywhere in the form. */
    fieldNotes: () => [...form().querySelectorAll('.nd-note')].map(textOf),
    /** The requests asked about, as recipient | ready | deliver by. */
    asked: () => advise.mock.calls.map(([ask]) => [ask.destinationBusinessId, ask.readyMin, ask.deadlineMin]),
    /** New delivery, the sentence, "Read my request", and the answers. */
    read: async () => {
      click(button(c, 'New delivery'));
      typeInto(byLabel(c, REQUEST_COPY.label), SENTENCE);
      click(button(c, 'Read my request'));
      await tick();
    },
    send: async () => { click(button(form(), 'Find a delivery match')); await tick(); },
  };
  return p;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('1. without an option the card stays and says why', () => {
  it('the server\'s note is the card\'s one line, a polite status, with what can be done under it', async () => {
    const p = setup({ advise: async () => none(NO_COMMUTE) });
    await p.read();
    expect(p.card()).not.toBeNull();
    expect(p.status()).toBe(NO_COMMUTE);
    expect(p.card()!.querySelector('.nd-options__status')!.getAttribute('role')).toBe('status');
    expect(p.card()!.querySelector('.nd-options__status')!.classList.contains('nd-options__status--note')).toBe(true);
    expect(p.hints()).toEqual([ADVICE_COPY.noneNext]);
    expect(p.needed()).toBeNull(); // the request lacks nothing
    expect(p.rows()).toHaveLength(0);
    expect(p.skeletons()).toHaveLength(0);
    expect(p.card()!.hasAttribute('aria-busy')).toBe(false);
    expect(p.card()!.querySelectorAll('button')).toHaveLength(0);
    expect([...p.container.querySelectorAll('[role="alert"]')].map(textOf).filter(Boolean)).toEqual([]);
    // The form is not held up.
    await p.send();
    expect(p.createShipment).toHaveBeenCalledTimes(1);
  }, T);

  it('a request without a recipient: the note, "Still needed: Recipient" under it, and the field marked in the form below', async () => {
    const p = setup({ parse: async () => parsed({ destinationBusinessId: null }) });
    await p.read();
    expect(p.asked()).toEqual([[null, 960, 2160]]);
    expect(p.status()).toBe(NEED_RECIPIENT);
    expect(textOf(p.needed()!)).toBe('Still needed: Recipient');
    expect(textOf(p.needed()!.querySelector('strong.nd-options__need')!)).toBe('Recipient'); // the name is the highlighted part
    expect(p.hints()).toEqual(['Fill it in below and the options load by themselves.']);
    // The card is above the request's lines and the form; the field it names is marked there.
    expect(p.card()!.compareDocumentPosition(p.form()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(p.marked()).toEqual(['Recipient']);
    expect(p.described('Recipient')).toEqual(['Any business in the network', NEEDS_INPUT_HINT]);
  }, T);

  it('a server that refuses such a request with a 400 (before #947): the same line, in the card\'s own words', async () => {
    const p = setup({
      parse: async () => parsed({ destinationBusinessId: null }),
      advise: async () => { throw new ApiRequestError(400, 'Invalid draft', { destinationBusinessId: 'Choose a recipient' }); },
    });
    await p.read();
    expect(p.status()).toBe('Choose a recipient to see options.');
    expect(textOf(p.needed()!)).toBe('Still needed: Recipient');
    expect(textOf(p.card()!)).not.toMatch(/400|Invalid draft/);
  }, T);

  it('a recipient taken out of the form again is named by the card and marked in the form, without "Check this"', async () => {
    const p = setup({ advise: async (ask) => (ask.destinationBusinessId === null ? none(NEED_RECIPIENT) : none(NO_COMMUTE)) });
    await p.read();
    expect(p.marked()).toEqual([]);
    select(p.field('Recipient'), 'Choose a business');
    // At once in the form; the card asks after the pause.
    expect(p.marked()).toEqual(['Recipient']);
    expect(p.described('Recipient')).toEqual(['Any business in the network', ADVICE_COPY.neededHint]);
    expect(textOf(p.wrap('Recipient'))).not.toContain(NEEDS_INPUT_HINT);
    await tick(REASK_DELAY_MS);
    expect(p.status()).toBe(NEED_RECIPIENT);
    expect(textOf(p.needed()!)).toBe('Still needed: Recipient');
    // Filled in again: the mark goes with it.
    select(p.field('Recipient'), 'Atlas Books · Long Island City');
    expect(p.marked()).toEqual([]);
  }, T);

  it('a time the server cannot take: its words about it, and the field to check', async () => {
    const p = setup({
      advise: async (ask) => {
        if (ask.deadlineMin! <= ask.readyMin!) throw new ApiRequestError(400, 'Invalid draft', { deadlineMin: 'Deliver-by must be after ready time' });
        return OPTIONS;
      },
      parse: async () => parsed({ readyMin: 1200, deadlineMin: 1080 }),
    });
    await p.read();
    expect(p.status()).toBe('Deliver-by must be after ready time.');
    expect(textOf(p.needed()!)).toBe('Check in the form: Deliver by: time');
    expect(p.hints()).toEqual([ADVICE_COPY.checkNext]);
    // Fixed in the form: the options come without another press.
    typeInto(p.field('Deliver by: time'), '22:00');
    await tick(REASK_DELAY_MS);
    expect(p.asked()).toEqual([[BAKERY.id, 1200, 1080], [BAKERY.id, 1200, 1320]]);
    expect(p.rows()).toHaveLength(2);
  }, T);

  it('only a call with no answer hides the card; a change in the form asks again and brings it back', async () => {
    const answers: Array<() => Promise<AdviseResponse>> = [
      async () => { throw new ApiRequestError(0, 'Failed to fetch', undefined, 'network'); },
      async () => OPTIONS,
    ];
    const p = setup({ advise: () => answers.shift()!() });
    await p.read();
    expect(p.card()).toBeNull();
    expect(p.form()).not.toBeNull();
    typeInto(p.field('Deliver by: time'), '11:00');
    await tick(REASK_DELAY_MS);
    expect(p.advise).toHaveBeenCalledTimes(2);
    expect(p.rows()).toHaveLength(2);
  }, T);
});

describe('2. the form shows what the server chose while reading', () => {
  it('a deliver-by time moved to the end of the run: the server\'s sentence under the deliver-by fields', async () => {
    const p = setup({ parse: async () => parsed({}, { note: CLAMPED }) });
    await p.read();
    expect([p.field('Deliver by: day').value, p.field('Deliver by: time').value]).toEqual(['2', '12:00']);
    expect(p.fieldNotes()).toEqual([CLAMPED]);
    // Under the row of the day and the time, inside the Timing group, and read with both fields.
    const note = p.form().querySelector<HTMLElement>('.nd-note')!;
    expect(note.previousElementSibling).toBe(p.wrap('Deliver by: time').parentElement);
    expect(note.classList.contains('nd-note--check')).toBe(false);
    expect(p.described('Deliver by: day')).toEqual([CLAMPED]);
    expect(p.described('Deliver by: time')).toEqual([CLAMPED]);
    expect(p.marked()).toEqual([]); // the time is the user's own, moved: nothing to check
    expect(p.parsedNotes()).toEqual([]); // said once, at the field
  }, T);

  it('no deliver-by time in the sentence: the assumed one is marked "(assumed, change it if needed)"', async () => {
    const p = setup({ parse: async () => parsed({}, { note: ASSUMED, assumed: ['deadlineMin'] }) });
    await p.read();
    const line = 'No deliver-by time given, so Relay delivers by 12:00 PM tomorrow (assumed, change it if needed)';
    expect(p.fieldNotes()).toEqual([line]);
    expect(p.form().querySelector('.nd-note')!.classList.contains('nd-note--check')).toBe(true);
    // Both deliver-by fields are ones to check, with the line as their description; "Check this" is not added to it.
    expect(p.marked()).toEqual(['Deliver by: day', 'Deliver by: time']);
    expect(p.described('Deliver by: time')).toEqual([line]);
    expect(textOf(p.form())).not.toContain(NEEDS_INPUT_HINT);
    // The options are asked for with the assumed time, and the form sends it.
    expect(p.asked()).toEqual([[BAKERY.id, 960, 2160]]);
    await p.send();
    expect(p.createShipment.mock.calls[0][0]).toMatchObject({ deadlineMin: 2160 });
  }, T);

  it('the line goes when the user changes the deliver-by time or day: the value is theirs now', async () => {
    const p = setup({ parse: async () => parsed({}, { note: ASSUMED, assumed: ['deadlineMin'] }) });
    await p.read();
    typeInto(p.field('Deliver by: time'), '11:30');
    expect(p.fieldNotes()).toEqual([]);
    expect(p.marked()).toEqual([]);
    expect(p.field('Deliver by: time').hasAttribute('aria-describedby')).toBe(false);

    const q = setup({ parse: async () => parsed({}, { note: CLAMPED }) });
    await q.read();
    typeInto(q.field('Package name'), 'Cookies, two boxes'); // another field leaves it
    expect(q.fieldNotes()).toEqual([CLAMPED]);
    select(q.field('Deliver by: day'), 'Day 1');
    expect(q.fieldNotes()).toEqual([]);
  }, T);

  it('an option with another deliver-by time takes the line off; the option as requested keeps it', async () => {
    const p = setup({ parse: async () => parsed({}, { note: CLAMPED }) });
    await p.read();
    expect(p.rows()).toHaveLength(2);
    click(p.choose(0)); // as requested: the same times
    expect(p.fieldNotes()).toEqual([CLAMPED]);
    click(p.choose(1)); // deliver by 10:00 AM
    expect(p.field('Deliver by: time').value).toBe('10:00');
    expect(p.fieldNotes()).toEqual([]);
  }, T);

  it('a misspelt recipient: "Bakery Row (from ‘Bakry Row’)" under the Recipient, until another one is chosen', async () => {
    const p = setup({ parse: async () => parsed({}, { note: `${NEAR} ${CLAMPED}` }) });
    await p.read();
    expect(textOf(p.field('Recipient').querySelector('option:checked')!)).toBe('Bakery Row · Williamsburg');
    expect(p.fieldNotes()).toEqual(['Bakery Row (from ‘Bakry Row’)', CLAMPED]);
    expect(p.wrap('Recipient').querySelector('.nd-note')).not.toBeNull();
    expect(p.described('Recipient')).toEqual(['Any business in the network', 'Bakery Row (from ‘Bakry Row’)']);
    expect(p.marked()).toEqual([]);
    expect(p.parsedNotes()).toEqual([]);
    select(p.field('Recipient'), 'Atlas Books · Long Island City');
    expect(p.fieldNotes()).toEqual([CLAMPED]); // the deliver-by line is about the time, and stays
  }, T);

  it('what has no field in the form is a plain line with the request, above the form', async () => {
    const p = setup({ parse: async () => parsed({}, { note: 'Read "acme studo" as Acme Studio.' }) });
    await p.read();
    expect(p.parsedNotes()).toEqual(['Acme Studio (from ‘acme studo’)']);
    expect(p.fieldNotes()).toEqual([]);
  }, T);

  it('an answer of the contract alone (no note, nothing assumed) shows no line', async () => {
    const p = setup();
    await p.read();
    expect(p.fieldNotes()).toEqual([]);
    expect(p.parsedNotes()).toEqual([]);
    expect(p.marked()).toEqual([]);
  }, T);
});

describe('3. the card asks again when the form changes and it has no option to show', () => {
  it('choosing the missing recipient asks again after the pause, and the options appear', async () => {
    const p = setup({ parse: async () => parsed({ destinationBusinessId: null }) });
    await p.read();
    expect(p.advise).toHaveBeenCalledTimes(1);
    select(p.field('Recipient'), 'Bakery Row · Williamsburg');
    // At once: the card says it is working on it, and nothing is named as missing any more.
    expect(p.status()).toBe(ADVICE_COPY.loadingLine);
    expect(p.card()!.getAttribute('aria-busy')).toBe('true');
    expect(p.skeletons()).toHaveLength(2);
    expect(p.needed()).toBeNull();
    expect(p.marked()).toEqual([]);
    // Not yet asked: the pause first.
    await tick(REASK_DELAY_MS - 1);
    expect(p.advise).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(p.asked()).toEqual([[null, 960, 2160], [BAKERY.id, 960, 2160]]);
    expect(p.advise.mock.calls[0][1]!.signal!.aborted).toBe(true); // the first call is over and dropped
    expect(p.rows().map((r) => textOf(r.querySelector('h3')!))).toEqual(['As requested', 'Deliver by 10:00 AM']);
    expect(p.status()).toBe(ADVICE_COPY.offlineLine);
    expect(p.card()!.hasAttribute('aria-busy')).toBe(false);
    expect(p.createShipment).not.toHaveBeenCalled(); // asking is never sending
  }, T);

  it('editing the deliver-by time re-requests the options, once, for the time the typing ends on', async () => {
    const p = setup({ advise: async (ask) => (ask.deadlineMin === 2160 ? none(NO_COMMUTE) : OPTIONS) });
    await p.read();
    expect(p.status()).toBe(NO_COMMUTE);
    // Typed in three steps, each inside the pause of the one before.
    typeInto(p.field('Deliver by: time'), '11:00');
    await tick(REASK_DELAY_MS - 100);
    typeInto(p.field('Deliver by: time'), '11:30');
    await tick(REASK_DELAY_MS - 100);
    typeInto(p.field('Deliver by: time'), '11:45');
    expect(p.advise).toHaveBeenCalledTimes(1);
    expect(p.status()).toBe(ADVICE_COPY.loadingLine);
    await tick(REASK_DELAY_MS);
    expect(p.asked()).toEqual([[BAKERY.id, 960, 2160], [BAKERY.id, 960, 2145]]);
    expect(p.rows()).toHaveLength(2);
    // The second option changes the deliver-by time of the request that was asked about last.
    click(p.choose(1));
    expect(p.field('Deliver by: time').value).toBe('10:00');
  }, T);

  it('still no option after the change: the new answer\'s line, and a later change asks once more', async () => {
    const notes = ['No commute by noon.', 'No commute by 11:00 AM.', 'No commute tonight.'];
    const p = setup({ advise: async () => none(notes.shift()) });
    await p.read();
    expect(p.status()).toBe('No commute by noon.');
    typeInto(p.field('Deliver by: time'), '11:00');
    await tick(REASK_DELAY_MS);
    expect(p.status()).toBe('No commute by 11:00 AM.');
    select(p.field('Deliver by: day'), 'Day 1');
    typeInto(p.field('Deliver by: time'), '23:00');
    await tick(REASK_DELAY_MS);
    expect(p.status()).toBe('No commute tonight.');
    expect(p.asked()).toEqual([[BAKERY.id, 960, 2160], [BAKERY.id, 960, 2100], [BAKERY.id, 960, 1380]]);
  }, T);

  it('a time changed back inside the pause asks nothing: the answer on screen is still about the form', async () => {
    const p = setup({ advise: async () => none(NO_COMMUTE) });
    await p.read();
    typeInto(p.field('Deliver by: time'), '11:00');
    expect(p.status()).toBe(ADVICE_COPY.loadingLine);
    typeInto(p.field('Deliver by: time'), '12:00');
    expect(p.status()).toBe(NO_COMMUTE);
    await tick(REASK_DELAY_MS * 2);
    expect(p.advise).toHaveBeenCalledTimes(1);
  }, T);

  it('the package name, the weight and the contents never ask again', async () => {
    const p = setup({ advise: async () => none(NO_COMMUTE) });
    await p.read();
    typeInto(p.field('Package name'), 'Cookies, two boxes');
    typeInto(p.field('Weight (kg)'), '1.5');
    typeInto(p.field('Contents'), 'Oat and raisin');
    await tick(REASK_DELAY_MS * 2);
    expect(p.advise).toHaveBeenCalledTimes(1);
    expect(p.status()).toBe(NO_COMMUTE);
  }, T);

  it('with options on screen a change of the times does not ask again: they stay the options of the request as read', async () => {
    const p = setup();
    await p.read();
    expect(p.rows()).toHaveLength(2);
    typeInto(p.field('Deliver by: time'), '11:00');
    typeInto(p.field('Ready for pickup (Day 1)'), '17:00');
    await tick(REASK_DELAY_MS * 2);
    expect(p.advise).toHaveBeenCalledTimes(1);
    expect(p.rows()).toHaveLength(2);
  }, T);

  it('a card that is gone asks nothing: Edit request and a sent delivery stop the pause', async () => {
    const p = setup({ advise: async () => none(NO_COMMUTE) });
    await p.read();
    typeInto(p.field('Deliver by: time'), '11:00');
    click(button(p.container, 'Edit request'));
    await tick(REASK_DELAY_MS * 2);
    expect(p.advise).toHaveBeenCalledTimes(1);

    const q = setup({ advise: async () => none(NO_COMMUTE) });
    await q.read();
    typeInto(q.field('Deliver by: time'), '11:00');
    await q.send();
    expect(q.createShipment).toHaveBeenCalledTimes(1);
    expect(q.card()).toBeNull();
    await tick(REASK_DELAY_MS * 2);
    expect(q.advise).toHaveBeenCalledTimes(1);
  }, T);
});
