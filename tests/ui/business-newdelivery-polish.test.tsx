// @vitest-environment jsdom
// #880: the Business half of the 30-second path, New delivery -> the sentence -> "Read my request" -> the
// Options card -> "Find a delivery match". These tests pin what the browser walk of the PR found and fixed:
// no wait is blank (the button is disabled and one plain line says what is happening), an offline answer
// says so in one plain line, a failed /advise is one sentence and the form still sends, every option is one
// Tab stop whose name holds its price, the send action has one name, and the path is three presses.
// Layout (the send bar that stays on screen, 390 px) is CSS, checked here as rules and in Chrome for the PR.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdviseOption, AdviseResponse, ShipmentResponse } from '../../shared/v2/api';
import type { ParseDraft, ParseRequestResponse } from '../../shared/v2/parseRequest';
import type { CreateShipmentRequest } from '../../shared/v2/schemas';
import { ApiRequestError } from '../../client/src/api/v2';
import {
  ADVICE_COPY, WAITING_ROWS, adviceCard, adviceSourceLine, noOptionsText, optionName, type AdviseCall,
} from '../../client/src/components/business/v2/adviceModel';
import { RESULT_COPY } from '../../client/src/components/business/v2/newDeliveryModel';
import { BusinessPageView } from '../../client/src/components/business/v2/page/BusinessPageView';
import type { ParseRequestCall } from '../../client/src/components/business/v2/RequestTextBox';
import { REQUEST_COPY, sourceLine } from '../../client/src/components/business/v2/requestTextModel';
import { directPlan, view } from './business-v2-details-sample';
import { ACME, ATLAS, BAKERY, ready } from './business-v2-page-sample';
import { button, byLabel, click, deferred, flush, mount, press, tabOrder, textOf, typeInto } from './kitDom';

const T = 10_000;
const SENTENCE = 'Deliver an envelope from Acme Studio to Bakery Row by 10 a.m. tomorrow.';

const DRAFT: ParseDraft = {
  originBusinessId: ACME.id, destinationBusinessId: BAKERY.id, label: 'Envelope', category: 'envelope',
  description: 'Signed contract', weightKg: 0.2, readyMin: 960, deadlineMin: 2040,
};
const read = (source: ParseRequestResponse['source']): ParseRequestResponse => ({ draft: DRAFT, missing: [], rejected: null, source });

const AS_TYPED: AdviseOption = {
  label: 'As requested', summary: 'Next-morning relay through Atlas Books.', changes: {}, kind: 'relay',
  relayBusinessId: ATLAS.id, carrierNames: ['Maya Chen', 'Luis Ortega'], deliveryMin: 1985, extraMin: 17,
  extraMiles: 2.4, customerPriceCents: 1050,
};
const LATER: AdviseOption = {
  ...AS_TYPED, label: 'Deliver by Day 2, 12:00 PM', summary: 'A wider window earns the flexibility discount.',
  changes: { deadlineMin: 2160 }, customerPriceCents: 950,
};
const options = (source: AdviseResponse['source'], list: AdviseOption[] = [AS_TYPED, LATER]): AdviseResponse => ({ options: list, source });

const arranged = (id: string): ShipmentResponse => ({
  ...view({ ...directPlan, id: `plan-${id}`, shipmentId: id }, 'scheduled', {}, { id, label: 'Envelope' }),
  matched: true,
});

type Setup = { parse?: () => Promise<ParseRequestResponse>; advise?: () => Promise<AdviseResponse>; send?: () => Promise<ShipmentResponse> };

function setup({ parse = async () => read('offline'), advise: answer = async () => options('offline'), send = async () => arranged('shp-88') }: Setup = {}) {
  const advise = vi.fn<AdviseCall>(() => answer());
  const parseRequest = vi.fn<ParseRequestCall>(() => parse());
  const createShipment = vi.fn((_req: CreateShipmentRequest) => send());
  const m = mount(
    <BusinessPageView
      state={ready()} shipmentId={null}
      createShipment={createShipment} matchShipment={async () => arranged('shp-88')}
      refetchNow={async () => {}} dismissRunChanged={() => {}}
      onOpenShipment={() => {}} onCloseShipment={() => {}}
      businessHref={(id) => `/business/${id}`}
      parseRequest={parseRequest} advise={advise}
    />,
  );
  const c = m.container;
  /** Every press of the path goes through here, so a test can count them. */
  const presses: string[] = [];
  const pressButton = (b: HTMLElement) => { presses.push(textOf(b)); click(b); };
  const p = {
    ...m, advise, parseRequest, createShipment, presses, pressButton,
    area: () => c.querySelector<HTMLElement>('.bp-new')!,
    box: () => c.querySelector<HTMLFormElement>('form.nd-request'),
    textarea: () => byLabel(c, REQUEST_COPY.label) as HTMLTextAreaElement,
    readButton: () => c.querySelector<HTMLButtonElement>('form.nd-request button[type="submit"]')!,
    wait: () => c.querySelector<HTMLElement>('form.nd-request .nd-wait')!,
    form: () => c.querySelector<HTMLFormElement>('form.nd'),
    sendButton: () => c.querySelector<HTMLButtonElement>('form.nd button[type="submit"]')!,
    formStatus: () => textOf(c.querySelector('form.nd .nd-result')!),
    note: () => c.querySelector<HTMLElement>('.nd-parsed'),
    card: () => c.querySelector<HTMLElement>('.nd-options'),
    cardStatus: () => c.querySelector<HTMLElement>('.nd-options .nd-options__status')!,
    rows: () => [...c.querySelectorAll<HTMLElement>('.nd-options .nd-option:not(.nd-option--skeleton)')],
    optionButtons: () => [...c.querySelectorAll<HTMLButtonElement>('.nd-options button')],
    /** New delivery and the sentence, typed. */
    type: () => {
      pressButton(button(c, 'New delivery'));
      typeInto(p.textarea(), SENTENCE);
    },
    /** New delivery, the sentence, "Read my request", and the answers. */
    read: async () => {
      p.type();
      pressButton(p.readButton());
      await flush();
    },
  };
  return p;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('the path is three presses, with one name for the send action', () => {
  it('New delivery, Read my request, Find a delivery match: a sent delivery', async () => {
    const p = setup();
    await p.read();
    p.pressButton(p.sendButton());
    await flush();
    expect(p.presses).toEqual(['New delivery', 'Read my request', 'Find a delivery match']);
    expect(p.formStatus()).toContain(RESULT_COPY.matched);
    expect(p.createShipment).toHaveBeenCalledTimes(1);
    expect(p.createShipment.mock.calls[0][0]).toMatchObject({ destinationBusinessId: BAKERY.id, readyMin: 960, deadlineMin: 2040 });
  }, T);

  it('the confirmation view has one primary button, the form\'s; no option is a primary action', async () => {
    const p = setup();
    await p.read();
    const primary = [...p.area().querySelectorAll('.nd-btn--primary')];
    expect(primary.map(textOf)).toEqual(['Find a delivery match']);
    expect(primary[0]).toBe(p.sendButton());
    expect(p.optionButtons()).toHaveLength(2);
    for (const b of p.optionButtons()) {
      expect(b.type).toBe('button'); // never sends
      expect(b.classList.contains('nd-btn--primary')).toBe(false);
    }
  }, T);

  it('the button, its wait and every line that names it use the same words', async () => {
    for (const line of [REQUEST_COPY.confirm, ADVICE_COPY.applied, ADVICE_COPY.failed]) expect(line).toContain('press Find a delivery match');
    expect(RESULT_COPY.sending).toBe('Finding a match…');
    expect(RESULT_COPY.sendingLine).toBe('Finding a delivery match for your request…');

    const sending = deferred<ShipmentResponse>();
    const p = setup({ send: () => sending.promise });
    await p.read();
    expect(textOf(p.sendButton())).toBe('Find a delivery match');
    click(p.sendButton());
    // The wait is not blank: the button is disabled and says what it is doing, and so does the line above it.
    expect(p.sendButton().disabled).toBe(true);
    expect(textOf(p.sendButton())).toBe('Finding a match…');
    expect(p.formStatus()).toBe('Finding a delivery match for your request…');
    expect(textOf(p.form()!)).not.toMatch(/Sending|Submit/);
    sending.resolve(arranged('shp-88'));
    await flush();
    expect(p.formStatus()).toContain(RESULT_COPY.matched);
    expect(textOf(p.sendButton())).toBe('Find a delivery match');
  }, T);
});

describe('while the request is read (up to 6 s)', () => {
  it('the button is disabled and one plain line says what is happening', async () => {
    const reading = deferred<ParseRequestResponse>();
    const p = setup({ parse: () => reading.promise });
    p.type();
    // The line's region is in the page before the wait, empty: a screen reader announces what comes into it.
    expect(p.wait().getAttribute('role')).toBe('status');
    expect(textOf(p.wait())).toBe('');

    click(p.readButton());
    expect(p.readButton().disabled).toBe(true);
    expect(p.readButton().getAttribute('aria-busy')).toBe('true');
    expect(textOf(p.readButton())).toBe('Reading…');
    expect(textOf(p.wait())).toBe('Reading your request. This takes a few seconds at most.');
    // The spinner is decoration: the line is the one status in the box, so it is announced once.
    expect(p.readButton().querySelector('.ui-spinner')!.getAttribute('aria-hidden')).toBe('true');
    expect([...p.box()!.querySelectorAll('[role="status"]')].map(textOf)).toEqual([REQUEST_COPY.readingLine]);
    // No dead end: the other two ways on stay open during the wait.
    expect(button(p.box()!, REQUEST_COPY.fillForm).disabled).toBe(false);
    expect(button(p.box()!, 'Cancel').disabled).toBe(false);

    reading.resolve(read('offline'));
    await flush();
    expect(p.box()).toBeNull();
    expect(p.form()).not.toBeNull();
  }, T);

  it('a read that fails ends the wait: the line goes, the button is back, and one sentence says what to do', async () => {
    const p = setup({ parse: async () => { throw new ApiRequestError(500, 'Internal Server Error'); } });
    await p.read();
    expect(textOf(p.wait())).toBe('');
    expect(p.readButton().disabled).toBe(false);
    expect(textOf(p.readButton())).toBe('Read my request');
    expect(textOf(p.box()!.querySelector('[role="alert"]')!)).toBe(REQUEST_COPY.failed);
    expect(p.textarea().value).toBe(SENTENCE); // the sentence is still there to try again
  }, T);

  it('"Read my request" is reached by Tab from the box, and Enter in the box reads too', async () => {
    const p = setup();
    p.type();
    const order = tabOrder(p.container);
    expect(order[order.indexOf(p.textarea()) + 1]).toBe(p.readButton());
    press('Enter', p.textarea());
    await flush();
    expect(p.parseRequest).toHaveBeenCalledTimes(1);
    expect(p.form()).not.toBeNull();
  }, T);
});

describe('an offline answer says so in one plain line', () => {
  it('the request: "Read by Relay’s rules" and what that means, without naming Gemini', async () => {
    const p = setup();
    await p.read();
    expect(textOf(p.note()!.querySelector('.nd-parsed__source')!)).toBe('Read by Relay’s rules');
    expect([...p.note()!.querySelectorAll('.nd-parsed__how')].map(textOf)).toEqual(['No AI model was used.']);
    expect(textOf(p.note()!)).not.toContain('Gemini');
  }, T);

  it('a request Gemini read has the label only', async () => {
    const p = setup({ parse: async () => read('gemini'), advise: async () => options('gemini') });
    await p.read();
    expect(textOf(p.note()!.querySelector('.nd-parsed__source')!)).toBe('Read by Gemini');
    expect(p.note()!.querySelector('.nd-parsed__how')).toBeNull();
    expect(sourceLine('gemini')).toBeNull();
    for (const s of [undefined, null, 'GEMINI', 'offline']) expect(sourceLine(s)).toBe(REQUEST_COPY.offlineLine);
  }, T);

  it('the options: one line under the title, and a Gemini answer names Gemini there', async () => {
    const offline = setup();
    await offline.read();
    expect(textOf(offline.cardStatus())).toBe('Priced by Relay, with no AI model.');
    expect(textOf(offline.card()!)).not.toContain('Gemini');
    offline.unmount();

    const model = setup({ parse: async () => read('gemini'), advise: async () => options('gemini') });
    await model.read();
    expect(textOf(model.cardStatus())).toBe('Planned by Gemini, priced by Relay.');
    // Anything but "gemini" never claims the model.
    for (const s of [undefined, null, 'GEMINI', 'offline']) expect(adviceSourceLine(s)).toBe(ADVICE_COPY.offlineLine);
  }, T);
});

describe('while the Options card waits (up to 10 s)', () => {
  it('one plain line says what is happening, nothing in the card can be pressed, and the form is not held up', async () => {
    const pricing = deferred<AdviseResponse>();
    const p = setup({ advise: () => pricing.promise });
    await p.read();
    expect(p.card()!.getAttribute('aria-busy')).toBe('true');
    expect(p.cardStatus().getAttribute('role')).toBe('status');
    expect(textOf(p.cardStatus())).toBe(
      'Pricing your request and a few other times. This takes up to 10 seconds; you can send the request as it is meanwhile.',
    );
    // Still rows stand in for the options: not buttons, and hidden from a screen reader.
    const still = [...p.card()!.querySelectorAll('.nd-option--skeleton')];
    expect(still).toHaveLength(WAITING_ROWS);
    expect(still[0].closest('[aria-hidden="true"]')).not.toBeNull();
    expect(p.optionButtons()).toHaveLength(0);
    // The wait never blocks the request: the form's button is enabled, as the line says.
    expect(p.sendButton().disabled).toBe(false);

    pricing.resolve(options('offline'));
    await flush();
    expect(p.card()!.hasAttribute('aria-busy')).toBe(false);
    expect(textOf(p.cardStatus())).toBe(ADVICE_COPY.offlineLine); // the same region: the line changes in place
    expect(p.rows()).toHaveLength(2);
  }, T);

  it('sending during the wait works, and the card goes with the sent request', async () => {
    const pricing = deferred<AdviseResponse>();
    const p = setup({ advise: () => pricing.promise });
    await p.read();
    click(p.sendButton());
    await flush();
    expect(p.createShipment).toHaveBeenCalledTimes(1);
    expect(p.formStatus()).toContain(RESULT_COPY.matched);
    expect(p.card()).toBeNull();
  }, T);
});

describe('an /advise that fails is one plain sentence, and the form still sends', () => {
  const failures: Array<[string, () => Promise<AdviseResponse>]> = [
    ['a 500', async () => { throw new ApiRequestError(500, 'Internal Server Error'); }],
    ['no answer in time', async () => { throw new ApiRequestError(0, 'Request timed out after 15000 ms', undefined, 'timeout'); }],
    ['a body that is not an answer', async () => ({ error: 'server_error' }) as unknown as AdviseResponse],
  ];
  for (const [name, advise] of failures) {
    it(`${name}`, async () => {
      const p = setup({ advise });
      await p.read();
      expect(textOf(p.card()!)).toBe('OptionsOptions could not be loaded. You can still send your request: press Find a delivery match.');
      expect(p.cardStatus().getAttribute('role')).toBe('status'); // told politely, not as an alert
      expect([...p.container.querySelectorAll('[role="alert"]')].map(textOf).filter(Boolean)).toEqual([]);
      expect(p.card()!.hasAttribute('aria-busy')).toBe(false);
      expect(p.card()!.querySelector('.nd-option, button')).toBeNull();
      // Never the server's words or a status code.
      expect(textOf(p.card()!)).not.toMatch(/500|Internal|timed out|server_error/);
      // The form is the confirmation card as before, and sends.
      expect(p.sendButton().disabled).toBe(false);
      click(p.sendButton());
      await flush();
      expect(p.createShipment).toHaveBeenCalledTimes(1);
      expect(p.formStatus()).toContain(RESULT_COPY.matched);
    }, T);
  }

  it('an answer with no option: the server\'s sentence about why, then what can be done', async () => {
    const note = 'No carrier can take it, even with an earlier ready time or a later deliver-by: every matching commute is full.';
    const p = setup({ advise: async () => ({ options: [], source: 'offline', note }) });
    await p.read();
    expect(textOf(p.card()!)).toBe(`Options${note} You can change the times in the form below, or send the request as it is.`);
    expect(p.sendButton().disabled).toBe(false);
    // Without a sentence of the server's own, a plain default.
    expect(noOptionsText({ options: [], source: 'offline' })).toBe(`${ADVICE_COPY.none} ${ADVICE_COPY.noneNext}`);
    expect(noOptionsText(null)).toBe(ADVICE_COPY.failed);
  }, T);
});

describe('each option is one Tab stop whose name holds its price', () => {
  it('the names: what the button says, the option, its price, and "cheapest" in words', async () => {
    const p = setup();
    await p.read();
    const buttons = p.optionButtons();
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'In the form: As requested, $10.50',
      'Choose this option: Deliver by Day 2, 12:00 PM, $9.50, cheapest',
    ]);
    // The name starts with the words on the button, so what is seen is what is heard.
    for (const b of buttons) expect(b.getAttribute('aria-label')!.startsWith(`${textOf(b)}: `)).toBe(true);
    // One button per option, in the Tab order, before the request's lines and the form.
    expect(p.rows().map((r) => r.querySelectorAll('button, a, input, select, [tabindex]').length)).toEqual([1, 1]);
    const order = tabOrder(p.container);
    const first = order.indexOf(buttons[0]);
    expect(order.slice(first, first + 3)).toEqual([...buttons, button(p.note()!, REQUEST_COPY.edit)]);
  }, T);

  it('the option the form holds says "In the form" on its button; choosing another moves the words', async () => {
    const p = setup();
    await p.read();
    expect(p.optionButtons().map((b) => [textOf(b), b.getAttribute('aria-pressed')])).toEqual([
      ['In the form', 'true'], ['Choose this option', 'false'],
    ]);
    click(p.optionButtons()[1]);
    expect(p.optionButtons().map((b) => [textOf(b), b.getAttribute('aria-pressed')])).toEqual([
      ['Choose this option', 'false'], ['In the form', 'true'],
    ]);
    expect(p.optionButtons()[1].getAttribute('aria-label')).toBe('In the form: Deliver by Day 2, 12:00 PM, $9.50, cheapest');
    expect(document.activeElement).toBe(p.optionButtons()[1]); // the pressed button keeps the focus
    expect((byLabel(p.form()!, 'Deliver by: time') as HTMLInputElement).value).toBe('12:00');
    expect(p.createShipment).not.toHaveBeenCalled(); // choosing sends nothing
  }, T);

  it('the cheapest is marked by a word next to its price, and prices are in the mono class', async () => {
    const p = setup();
    await p.read();
    expect(p.rows().map((r) => textOf(r.querySelector('.nd-option__price')!))).toEqual(['$10.50', 'Cheapest $9.50']);
    for (const r of p.rows()) expect(r.querySelector('.nd-option__cents')!.classList.contains('nd-mono')).toBe(true);
    expect(optionName({ label: 'As requested', priceText: '$9.50', cheapest: false }, false)).toBe('Choose this option: As requested, $9.50');
  }, T);

  it('one option only: it is the request, so the card offers nothing to choose and says what the price is for', async () => {
    const p = setup({ advise: async () => options('offline', [AS_TYPED]) });
    await p.read();
    expect(p.optionButtons().map(textOf)).toEqual(['In the form']);
    expect(textOf(p.card()!)).not.toContain('Choose this option');
    expect([...p.card()!.querySelectorAll('.nd-options__hint')].map(textOf)).toEqual([ADVICE_COPY.hintSingle]);
    // With several, the line says what choosing does.
    const card = adviceCard(options('offline'), { draft: { ...DRAFT, originBusinessId: ACME.id, destinationBusinessId: BAKERY.id, readyMin: 960, deadlineMin: 2040 }, businesses: [ACME, ATLAS, BAKERY] });
    expect(card!.rows).toHaveLength(2);
    expect(ADVICE_COPY.hint).toContain('Choosing an option sets the ready and deliver-by times');
  }, T);

  it('what the carriers add is named in plain words', async () => {
    const p = setup();
    await p.read();
    expect([...p.rows()[0].querySelectorAll('dt')].map(textOf)).toEqual(['Arrives', 'Route', 'Added to commutes', 'Carried by']);
  }, T);
});

describe('newDelivery.css: the send button stays on screen, and the card fits 390 px', () => {
  const css = readFileSync('client/src/components/business/v2/newDelivery.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const narrow = css.match(/@media \(max-width: 480px\) \{([\s\S]*?)\n\}/)![1];
  const rule = (source: string, selector: string) => {
    const at = source.indexOf(`${selector} {`);
    return at === -1 ? null : source.slice(at, source.indexOf('}', at));
  };

  it('the form\'s send bar is sticky at the bottom, on a panel background, inside the form', () => {
    const bar = rule(css, '.nd > .nd-actions')!;
    expect(bar).toMatch(/position: sticky;/);
    expect(bar).toMatch(/bottom: 0;/);
    expect(bar).toMatch(/background: var\(--panel, #FFFFFF\);/);
    expect(bar).toMatch(/border-top: 1px solid var\(--border, #E3E3DE\);/);
    // Only the form's bar: the text box's buttons stay where they are.
    expect(css).not.toMatch(/\.nd-request[^{]*\{[^}]*position: sticky/);
  });

  it('the body is no scroll box of its own while the form is open, or the bar would stick to nothing', () => {
    expect(rule(css, 'body:has(.nd)')).toMatch(/overflow-x: clip;/);
    // Sideways overflow stays cut off either way (styles/global.css hides it on html and body).
    expect(readFileSync('client/src/styles/global.css', 'utf8')).toMatch(/html, body \{ overflow-x: hidden; \}/);
  });

  it('a focused field or button is scrolled clear of the bar', () => {
    expect(rule(css, '.nd .nd-input, .nd .nd-btn')).toMatch(/scroll-margin-bottom: \d+px;/);
  });

  it('at 390 px the bar is one row with the send button taking the room', () => {
    expect(rule(narrow, '.nd > .nd-actions')).toMatch(/flex-direction: row;/);
    expect(rule(narrow, '.nd > .nd-actions .nd-btn--primary')).toMatch(/flex: 1;/);
  });

  it('the wait and status lines take no room when empty, and nothing in the card has a fixed width', () => {
    expect(css).toMatch(/\.nd-wait:empty \{ display: none; \}/);
    expect(css).toMatch(/\.nd-options__status:empty \{ display: none; \}/);
    for (const [, selector, body] of css.matchAll(/(\.nd-option[^{]*)\{([^}]*)\}/g)) {
      expect(body, selector).not.toMatch(/(^|[\s;])(min-)?width: \d+px/);
    }
    expect(rule(narrow, '.nd-option__facts')).toMatch(/grid-template-columns: 1fr 1fr;/);
  });

  it('the option buttons take the ring of every button in the form', () => {
    expect(css).toMatch(/\.nd-btn:focus-visible \{ outline: 2px solid var\(--accent, #1D5075\); outline-offset: 2px; \}/);
    expect(css).not.toMatch(/\.nd-option__choose[^{]*\{[^}]*outline: (none|0)/);
  });
});
