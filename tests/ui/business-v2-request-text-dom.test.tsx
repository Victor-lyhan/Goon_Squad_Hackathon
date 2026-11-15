// @vitest-environment jsdom
// MVP IV F1 (#786, docs/mvp4.md; DECISIONS pass 81): the Business page's New delivery opens on one text box.
// Its button asks parseRequest (a stub here: no server, no Gemini) and the existing New delivery form opens
// prefilled as the confirmation card. Nothing is sent until that form's own button is pressed.
// The pure model: business-v2-request-text-model.test.ts. The form's prefill: business-v2-newdelivery-prefill.test.tsx.
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentResponse } from '../../shared/v2/api';
import type { ParseDraft, ParseRequestResponse } from '../../shared/v2/parseRequest';
import type { CreateShipmentRequest } from '../../shared/v2/schemas';
import { ApiRequestError } from '../../client/src/api/v2';
import type { BusinessWorkspaceState } from '../../client/src/components/business/v2/live/businessWorkspaceState';
import { NEEDS_INPUT_HINT, RESULT_COPY } from '../../client/src/components/business/v2/newDeliveryModel';
import { BusinessPageView } from '../../client/src/components/business/v2/page/BusinessPageView';
import type { ParseRequestCall } from '../../client/src/components/business/v2/RequestTextBox';
import { REQUEST_COPY } from '../../client/src/components/business/v2/requestTextModel';
import { directPlan, view } from './business-v2-details-sample';
import { ACME, ATLAS, BAKERY, DASHBOARD, ready } from './business-v2-page-sample';
import { button, buttons, byLabel, click, deferred, flush, mount, press, textOf, typeInto } from './kitDom';

const T = 10_000;
const SENTENCE = 'Deliver an envelope from Acme Studio to Bakery Row by 10 a.m. tomorrow.';
const SENDER_NOTE = 'You are signed in as Acme Studio; this request will be sent from Acme Studio.';
const REJECTED = 'Stops must be businesses in the network. "12 Main Street" is not one of them.';

/** Everything filled: ready Day 1 16:00, deliver by Day 2 10:00. */
const FULL: ParseDraft = {
  originBusinessId: ACME.id, destinationBusinessId: BAKERY.id, label: 'Envelope', category: 'envelope',
  description: 'Signed contract', weightKg: 0.2, readyMin: 960, deadlineMin: 2040,
};
const parsed = (draft: Partial<ParseDraft> = {}, over: Partial<ParseRequestResponse> = {}): ParseRequestResponse => {
  const d = { ...FULL, ...draft };
  const missing = (Object.keys(d) as (keyof ParseDraft)[]).filter((k) => d[k] === null);
  return { draft: d, missing, rejected: null, source: 'gemini', ...over };
};
const GEMINI = parsed();
const OFFLINE = parsed({ originBusinessId: null, label: null, description: null, weightKg: null }, { source: 'offline' });

const arranged = (id: string): ShipmentResponse => ({
  ...view({ ...directPlan, id: `plan-${id}`, shipmentId: id }, 'scheduled', {}, { id, label: 'Envelope' }),
  matched: true,
});
const noMatch = (id: string): ShipmentResponse => ({
  ...view(null, 'unmatched', { unmatchedReason: 'No commute passes both businesses in time.' }, { id, label: 'Envelope' }),
  matched: false,
});

type Parse = (text: string) => Promise<ParseRequestResponse>;

function setup(parse: Parse = async () => GEMINI, state: BusinessWorkspaceState = ready(), send = arranged) {
  const parseRequest = vi.fn<ParseRequestCall>((text) => parse(text));
  const createShipment = vi.fn(async (_req: CreateShipmentRequest) => send('shp-51'));
  const el = (s: BusinessWorkspaceState) => (
    <BusinessPageView
      state={s} shipmentId={null}
      createShipment={createShipment}
      matchShipment={async () => { throw new Error('not called'); }}
      refetchNow={async () => {}} dismissRunChanged={() => {}}
      onOpenShipment={() => {}} onCloseShipment={() => {}}
      businessHref={(id) => `/business/${id}`}
      parseRequest={parseRequest}
    />
  );
  const m = mount(el(state));
  const c = m.container;
  const box = () => c.querySelector<HTMLFormElement>('form.nd-request');
  const form = () => c.querySelector<HTMLFormElement>('form.nd');
  const textarea = () => byLabel(c, REQUEST_COPY.label) as HTMLTextAreaElement;
  const readButton = () => box()!.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const p = {
    ...m, parseRequest, createShipment, box, form, textarea, readButton,
    poll: (s: BusinessWorkspaceState) => m.rerender(el(s)),
    opener: () => button(c, 'New delivery'),
    open: () => click(button(c, 'New delivery')),
    type: (text: string) => typeInto(textarea(), text),
    /** New delivery, the sentence, "Read my request", and the answer. */
    read: async (text = SENTENCE) => {
      if (!box()) p.open();
      p.type(text);
      click(readButton());
      await flush();
    },
    note: () => c.querySelector('.nd-parsed'),
    value: (label: string) => (byLabel(form()!, label) as HTMLInputElement | HTMLSelectElement).value,
    recipient: () => {
      const s = byLabel(form()!, 'Recipient') as HTMLSelectElement;
      return s.selectedOptions[0]?.text.trim() ?? '';
    },
    /** The labels of the fields that carry the "Check this" hint, in screen order. */
    checks: () => [...form()!.querySelectorAll('.nd-field--check')].map((f) => {
      expect(textOf(f.querySelector('.nd-check')!)).toBe(NEEDS_INPUT_HINT);
      return textOf(f.querySelector('label')!);
    }),
  };
  return p;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('New delivery opens on the request text box', () => {
  it('one labelled box with the 500-character limit, an example, and the three actions', () => {
    const p = setup();
    expect(p.box()).toBeNull();
    p.open();
    expect(p.form()).toBeNull(); // the form is not what opens
    const box = p.box()!;
    expect(textOf(box.querySelector('h2')!)).toBe('New delivery');
    expect(textOf(box)).toContain('From Acme Studio · Chelsea');
    const t = p.textarea();
    expect(t.tagName).toBe('TEXTAREA');
    expect(t.maxLength).toBe(500);
    expect(t.placeholder).toBe('Deliver an envelope from Acme Studio to Atlas Books by 10 a.m. tomorrow.');
    expect(t.value).toBe('');
    expect(document.activeElement).toBe(t); // typing starts right away
    expect([...box.querySelectorAll('button')].map(textOf)).toEqual(['Read my request', 'Fill in the form instead', 'Cancel']);
    expect(p.readButton().disabled).toBe(false);
    // The hint and the count describe the box.
    const described = t.getAttribute('aria-describedby')!.split(' ').map((id) => textOf(document.getElementById(id)!));
    expect(described).toEqual([REQUEST_COPY.hint, '0 / 500 characters']);
    p.type('Hello');
    expect(textOf(box.querySelector('.nd-request__count')!)).toBe('5 / 500 characters');
    expect(box.querySelector('.nd-request__count .nd-mono')!.textContent).toBe('5 / 500');
    expect(p.parseRequest).not.toHaveBeenCalled();
  }, T);

  it('static render: the box is the page\'s New delivery view', () => {
    const html = renderToStaticMarkup(
      <BusinessPageView
        state={ready()} shipmentId={null} createShipment={async () => arranged('shp-1')}
        matchShipment={async () => arranged('shp-1')} refetchNow={async () => {}} dismissRunChanged={() => {}}
        onOpenShipment={() => {}} onCloseShipment={() => {}} businessHref={(id) => `/business/${id}`}
        initialRequestOpen
      />,
    );
    expect(html).toContain('<form class="nd-request"');
    expect(html).toContain('maxLength="500"');
    expect(html).not.toContain('<form class="nd"');
  });

  it('Cancel and Esc close the box and give focus back to the button that opened it', () => {
    const p = setup();
    const opener = p.opener();
    p.open();
    p.type('Half a sentence');
    click(button(p.box()!, 'Cancel'));
    expect(p.box()).toBeNull();
    expect(document.activeElement).toBe(opener);
    // It opens empty again; Esc in the box does what Cancel does.
    p.open();
    expect(p.textarea().value).toBe('');
    press('Escape', p.textarea());
    expect(p.box()).toBeNull();
    expect(p.form()).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(p.parseRequest).not.toHaveBeenCalled();
  }, T);

  it('pressing New delivery again while the box or the form is open keeps what is typed there', () => {
    const p = setup();
    p.open();
    p.type('Half a sentence');
    click(p.opener());
    expect(p.textarea().value).toBe('Half a sentence');
    click(button(p.box()!, 'Fill in the form instead'));
    typeInto(byLabel(p.form()!, 'Package name'), 'Keys');
    click(p.opener());
    expect(p.box()).toBeNull();
    expect(p.value('Package name')).toBe('Keys');
  }, T);
});

describe('"Read my request": the answer opens the form as the confirmation card', () => {
  it('a Gemini draft: every field prefilled, "Parsed by Gemini", nothing to check, nothing sent', async () => {
    const p = setup();
    await p.read(`  ${SENTENCE}  `);
    expect(p.parseRequest).toHaveBeenCalledTimes(1);
    expect(p.parseRequest.mock.calls[0][0]).toBe(SENTENCE); // trimmed, as the contract reads it
    expect(p.box()).toBeNull();
    const form = p.form()!;
    expect(textOf(form)).toContain('From Acme Studio');
    expect(p.recipient()).toBe('Bakery Row · Williamsburg');
    expect(p.value('Package name')).toBe('Envelope');
    expect(p.value('Type')).toBe('envelope');
    expect(p.value('Weight (kg)')).toBe('0.2');
    expect(p.value('Contents')).toBe('Signed contract');
    expect(p.value('Ready for pickup (Day 1)')).toBe('16:00');
    expect(p.value('Deliver by: day')).toBe('2');
    expect(p.value('Deliver by: time')).toBe('10:00');
    expect(p.checks()).toEqual([]);
    // The lines above the form: the label, the sentence, and that nothing has been sent.
    const note = p.note()!;
    expect(note.nextElementSibling).toBe(form);
    expect(textOf(note.querySelector('.nd-parsed__source')!)).toBe('Parsed by Gemini');
    expect(textOf(note.querySelector('.nd-parsed__text')!)).toBe(`“${SENTENCE}”`);
    expect(textOf(note)).toContain(REQUEST_COPY.confirm);
    expect(textOf(note)).not.toContain('You are signed in as');
    expect(note.querySelectorAll('.nd-parsed__note')).toHaveLength(0);
    expect(form.contains(document.activeElement)).toBe(true); // the pressed button is gone; focus is in the card
    expect(p.createShipment).not.toHaveBeenCalled();
  }, T);

  it('Send goes through the form\'s own path, once, from the signed-in business', async () => {
    const p = setup();
    await p.read();
    expect(p.createShipment).not.toHaveBeenCalled();
    click(button(p.form()!, 'Find a delivery match'));
    await flush();
    expect(p.createShipment).toHaveBeenCalledTimes(1);
    expect(p.createShipment.mock.calls[0][0]).toMatchObject({
      originBusinessId: ACME.id, destinationBusinessId: BAKERY.id, label: 'Envelope', category: 'envelope',
      description: 'Signed contract', weightKg: 0.2, readyMin: 960, deadlineMin: 2040,
    });
    expect(textOf(p.form()!.querySelector('.nd-result')!)).toContain(RESULT_COPY.matched);
    // The form starts a fresh package, so the lines about the request just sent are gone with its fields.
    expect(p.note()).toBeNull();
    expect(p.value('Package name')).toBe('');
    expect(p.parseRequest).toHaveBeenCalledTimes(1);
  }, T);

  it('a request that finds no match keeps the card as it is, lines and fields', async () => {
    const p = setup(async () => GEMINI, ready(), noMatch);
    await p.read();
    click(button(p.form()!, 'Find a delivery match'));
    await flush();
    expect(textOf(p.form()!.querySelector('.nd-result')!)).toContain(RESULT_COPY.unmatched);
    expect(textOf(p.note()!.querySelector('.nd-parsed__source')!)).toBe('Parsed by Gemini');
    expect(p.value('Package name')).toBe('Envelope');
  }, T);

  it('an offline draft with missing fields: "Parsed offline", defaults with "Check this", focus on the first', async () => {
    const p = setup(async () => OFFLINE);
    await p.read();
    expect(textOf(p.note()!.querySelector('.nd-parsed__source')!)).toBe('Parsed offline');
    expect(textOf(p.note()!)).not.toContain('Gemini');
    expect(p.checks()).toEqual(['Package name', 'Weight (kg)', 'Contents']);
    expect(p.recipient()).toBe('Bakery Row · Williamsburg');
    expect(p.value('Package name')).toBe('');
    expect(p.value('Weight (kg)')).toBe('0.5'); // the form's default
    expect(p.value('Deliver by: time')).toBe('10:00');
    expect(document.activeElement).toBe(byLabel(p.form()!, 'Package name'));
    expect(textOf(p.note()!)).not.toContain('You are signed in as'); // no sender named: nothing to say
    // Send with a field still empty: the form's own validation answers, and nothing is sent.
    click(button(p.form()!, 'Find a delivery match'));
    await flush();
    expect(p.createShipment).not.toHaveBeenCalled();
    expect(p.form()!.querySelectorAll('.nd-error').length).toBeGreaterThan(0);
  }, T);

  it('a field the server lists in `missing` gets "Check this" even when the draft holds a value', async () => {
    const p = setup(async () => ({ ...GEMINI, missing: ['weightKg'] }));
    await p.read();
    expect(p.checks()).toEqual(['Weight (kg)']);
    expect(p.value('Weight (kg)')).toBe('0.5');
  }, T);

  it('a draft from another sender: the plain note, and the request is still sent from the signed-in business', async () => {
    const p = setup(async () => parsed({ originBusinessId: ATLAS.id }));
    await p.read('Deliver an envelope from Atlas Books to Bakery Row by 10 a.m. tomorrow.');
    const notes = [...p.note()!.querySelectorAll('.nd-parsed__note')].map(textOf);
    expect(notes).toEqual([SENDER_NOTE]);
    expect(textOf(p.form()!.querySelector('.nd-from')!)).toBe('From Acme Studio · Chelsea');
    expect(p.recipient()).toBe('Bakery Row · Williamsburg');
    click(button(p.form()!, 'Find a delivery match'));
    await flush();
    expect(p.createShipment).toHaveBeenCalledTimes(1);
    expect(p.createShipment.mock.calls[0][0]).toMatchObject({ originBusinessId: ACME.id, destinationBusinessId: BAKERY.id });
  }, T);

  it('a rejected stop: the server\'s sentence above the form; the stop stays empty with "Check this"', async () => {
    const p = setup(async () => parsed({ destinationBusinessId: null }, { rejected: REJECTED, source: 'offline' }));
    await p.read('Deliver an envelope to 12 Main Street by 10 a.m. tomorrow.');
    const note = p.note()!;
    expect([...note.querySelectorAll('.nd-parsed__note')].map(textOf)).toEqual([REJECTED]);
    expect(note.compareDocumentPosition(p.form()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(p.value('Recipient')).toBe('');
    expect(p.recipient()).toBe('Choose a business');
    expect(p.checks()).toEqual(['Recipient']);
    expect(document.activeElement).toBe(byLabel(p.form()!, 'Recipient'));
    // Nothing is sent without a network business as the stop.
    click(button(p.form()!, 'Find a delivery match'));
    await flush();
    expect(p.createShipment).not.toHaveBeenCalled();
    expect(textOf(p.form()!)).toContain('Choose a recipient business');
  }, T);

  it('a rejected stop and another sender: both lines, the rejected one first', async () => {
    const p = setup(async () => parsed({ originBusinessId: ATLAS.id, destinationBusinessId: null }, { rejected: REJECTED }));
    await p.read();
    expect([...p.note()!.querySelectorAll('.nd-parsed__note')].map(textOf)).toEqual([REJECTED, SENDER_NOTE]);
  }, T);

  it('"Edit request" goes back to the box with the sentence; reading again opens a new card', async () => {
    const answers = [OFFLINE, GEMINI];
    const p = setup(async () => answers.shift()!);
    await p.read();
    typeInto(byLabel(p.form()!, 'Package name'), 'Typed in the first card');
    click(button(p.note()!, 'Edit request'));
    expect(p.form()).toBeNull();
    expect(p.textarea().value).toBe(SENTENCE);
    expect(document.activeElement).toBe(p.textarea());
    await p.read(`${SENTENCE} It is a signed contract.`);
    expect(p.parseRequest).toHaveBeenCalledTimes(2);
    // The second card is the second answer, not the first card's fields or hints.
    expect(textOf(p.note()!.querySelector('.nd-parsed__source')!)).toBe('Parsed by Gemini');
    expect(p.value('Package name')).toBe('Envelope');
    expect(p.checks()).toEqual([]);
    expect(p.createShipment).not.toHaveBeenCalled();
  }, T);

  it('Enter in the box reads the request; Shift+Enter does not', async () => {
    const p = setup();
    p.open();
    p.type(SENTENCE);
    const shift = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
    p.textarea().dispatchEvent(shift);
    expect(shift.defaultPrevented).toBe(false); // a new line, as in any text box
    expect(p.parseRequest).not.toHaveBeenCalled();
    press('Enter', p.textarea());
    await flush();
    expect(p.parseRequest).toHaveBeenCalledTimes(1);
    expect(p.form()).not.toBeNull();
  }, T);
});

describe('while the request is being read', () => {
  it('the button shows the pending state and cannot be pressed twice', async () => {
    const pending = deferred<ParseRequestResponse>();
    const p = setup(() => pending.promise);
    p.open();
    p.type(SENTENCE);
    click(p.readButton());
    const b = p.readButton();
    expect(b.disabled).toBe(true);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(textOf(b)).toContain(REQUEST_COPY.reading);
    expect(textOf(b)).not.toContain(REQUEST_COPY.read);
    expect(b.querySelector('.ui-spinner')).not.toBeNull();
    expect(p.textarea().readOnly).toBe(true);
    // Focus is not left on the disabled button (a browser would drop it to the page): the box holds it.
    expect(document.activeElement).toBe(p.textarea());
    // A second press, Enter in the box and a scripted submit all find the read already under way.
    click(b);
    press('Enter', p.textarea());
    p.box()!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(p.parseRequest).toHaveBeenCalledTimes(1);
    expect(p.form()).toBeNull();
    // The other two actions stay available.
    expect(button(p.box()!, 'Fill in the form instead').disabled).toBe(false);
    expect(button(p.box()!, 'Cancel').disabled).toBe(false);

    pending.resolve(GEMINI);
    await flush();
    expect(p.box()).toBeNull();
    expect(p.value('Package name')).toBe('Envelope');
  }, T);

  it('the call gets a signal and a timeout above the server\'s 6 s fallback', async () => {
    const p = setup();
    await p.read();
    const opts = p.parseRequest.mock.calls[0][1]!;
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(opts.timeoutMs).toBeGreaterThan(6000);
  }, T);

  it('"Fill in the form instead" while waiting: the read is aborted and its late answer changes nothing', async () => {
    const pending = deferred<ParseRequestResponse>();
    const p = setup(() => pending.promise);
    p.open();
    p.type(SENTENCE);
    click(p.readButton());
    click(button(p.box()!, 'Fill in the form instead'));
    expect(p.parseRequest.mock.calls[0][1]!.signal!.aborted).toBe(true);
    typeInto(byLabel(p.form()!, 'Package name'), 'Typed by hand');
    pending.resolve(GEMINI);
    await flush();
    expect(p.note()).toBeNull();
    expect(p.value('Package name')).toBe('Typed by hand');
    expect(p.checks()).toEqual([]);
  }, T);

  it('Cancel while waiting: a late answer does not open anything', async () => {
    const pending = deferred<ParseRequestResponse>();
    const p = setup(() => pending.promise);
    p.open();
    p.type(SENTENCE);
    click(p.readButton());
    click(button(p.box()!, 'Cancel'));
    pending.resolve(GEMINI);
    await flush();
    expect(p.box()).toBeNull();
    expect(p.form()).toBeNull();
  }, T);
});

describe('a request that could not be read', () => {
  it('a 400 shows its fieldErrors.text beside the box, which keeps the sentence', async () => {
    const p = setup(async () => { throw new ApiRequestError(400, 'Invalid request', { text: 'Max 500 characters' }); });
    await p.read();
    expect(p.form()).toBeNull();
    const t = p.textarea();
    expect(t.value).toBe(SENTENCE);
    expect(t.getAttribute('aria-invalid')).toBe('true');
    const error = p.box()!.querySelector('.nd-field .nd-error')!;
    expect(textOf(error)).toBe('Max 500 characters');
    expect(t.getAttribute('aria-describedby')!.split(' ')).toContain(error.id);
    expect(textOf(p.box()!.querySelector('.nd-alert')!)).toBe(''); // beside the box, not as the failure line
    expect(p.readButton().disabled).toBe(false);
    // Editing the sentence takes the message away, and it can be read again.
    p.type(`${SENTENCE} `);
    expect(p.box()!.querySelector('.nd-error')).toBeNull();
    expect(t.hasAttribute('aria-invalid')).toBe(false);
  }, T);

  it('an empty box: the contract\'s message beside it, and no call', async () => {
    const p = setup();
    p.open();
    click(p.readButton());
    await flush();
    expect(textOf(p.box()!.querySelector('.nd-error')!)).toBe('Describe the delivery in one sentence');
    p.type('   ');
    click(p.readButton());
    await flush();
    expect(textOf(p.box()!.querySelector('.nd-error')!)).toBe('Describe the delivery in one sentence');
    expect(p.parseRequest).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(p.textarea());
  }, T);

  it('any other failure says so plainly and the empty form is one press away', async () => {
    const failures: Array<[unknown, string]> = [
      [new ApiRequestError(500, 'Internal Server Error'), REQUEST_COPY.failed],
      [new ApiRequestError(0, 'Failed to fetch'), REQUEST_COPY.noAnswer],
      [new ApiRequestError(0, 'Request timed out after 10000 ms', undefined, 'timeout'), REQUEST_COPY.noAnswer],
      [new TypeError('x is undefined'), REQUEST_COPY.failed],
    ];
    for (const [error, text] of failures) {
      const p = setup(async () => { throw error; });
      await p.read();
      expect(p.form()).toBeNull();
      const alert = p.box()!.querySelector('[role="alert"].nd-alert')!;
      expect(textOf(alert)).toBe(text);
      expect(textOf(alert)).toMatch(/fill in the form instead\.$/);
      expect(p.box()!.querySelector('.nd-error')).toBeNull();
      expect(p.textarea().value).toBe(SENTENCE); // nothing typed is lost
      expect(p.readButton().disabled).toBe(false); // and it can be tried again
      expect(document.activeElement).toBe(p.textarea());
      click(button(p.box()!, 'Fill in the form instead'));
      expect(p.note()).toBeNull();
      expect(p.value('Package name')).toBe('');
      p.unmount();
    }
  }, T);

  it('an answer without a draft is a failed read, not a crash', async () => {
    const p = setup(async () => ({ error: 'nope' }) as unknown as ParseRequestResponse);
    await p.read();
    expect(textOf(p.box()!.querySelector('.nd-alert')!)).toBe(REQUEST_COPY.failed);
    expect(p.form()).toBeNull();
  }, T);

  it('trying again after a failure reads the request', async () => {
    let fail = true;
    const p = setup(async () => { if (fail) throw new ApiRequestError(500, 'boom'); return OFFLINE; });
    await p.read();
    expect(textOf(p.box()!.querySelector('.nd-alert')!)).toBe(REQUEST_COPY.failed);
    fail = false;
    click(p.readButton());
    await flush();
    expect(p.parseRequest).toHaveBeenCalledTimes(2);
    expect(textOf(p.note()!.querySelector('.nd-parsed__source')!)).toBe('Parsed offline');
  }, T);
});

describe('"Fill in the form instead"', () => {
  it('opens the same form empty, with no lines above it and no hints, without asking the server', () => {
    const p = setup();
    p.open();
    p.type('Something half typed');
    click(button(p.box()!, 'Fill in the form instead'));
    expect(p.box()).toBeNull();
    const form = p.form()!;
    expect(p.note()).toBeNull();
    expect(p.checks()).toEqual([]);
    expect(p.value('Recipient')).toBe('');
    expect(p.value('Package name')).toBe('');
    expect(p.value('Weight (kg)')).toBe('0.5');
    expect(p.value('Deliver by: time')).toBe('10:00');
    expect(document.activeElement).toBe(byLabel(form, 'Recipient')); // the pressed button is gone
    expect(p.parseRequest).not.toHaveBeenCalled();
    expect(p.createShipment).not.toHaveBeenCalled();
  }, T);

  it('the form\'s Cancel closes New delivery and gives focus back to the button that opened it', () => {
    const p = setup();
    const opener = p.opener();
    p.open();
    click(button(p.box()!, 'Fill in the form instead'));
    click(button(p.form()!, 'Cancel'));
    expect(p.form()).toBeNull();
    expect(p.box()).toBeNull();
    expect(document.activeElement).toBe(opener);
  }, T);
});

describe('the locked run', () => {
  const LOCKED = ready({ ...DASHBOARD, phase: 'locked', version: DASHBOARD.version + 1 });
  const closedLines = (p: ReturnType<typeof setup>) => textOf(p.container).split(RESULT_COPY.locked).length - 1;

  it('a lock that arrives with the box open: it says why, once, and the request cannot be read', async () => {
    const p = setup();
    p.open();
    p.type(SENTENCE);
    p.poll(LOCKED);
    expect(p.textarea().value).toBe(SENTENCE); // the poll does not touch what is typed
    expect(p.readButton().disabled).toBe(true);
    expect(textOf(p.box()!.querySelector('.nd-alert')!)).toBe(RESULT_COPY.locked);
    expect(closedLines(p)).toBe(1);
    press('Enter', p.textarea());
    await flush();
    expect(p.parseRequest).not.toHaveBeenCalled();
    // Back to planning (Back to start in the simulator): the next poll opens it again.
    p.poll(ready({ ...DASHBOARD, version: DASHBOARD.version + 2 }));
    expect(p.readButton().disabled).toBe(false);
    expect(closedLines(p)).toBe(0);
  }, T);

  it('a lock that arrives with the card open: the form says why and cannot send, as before', async () => {
    const p = setup();
    await p.read();
    p.poll(LOCKED);
    expect(button(p.form()!, 'Find a delivery match').disabled).toBe(true);
    expect(textOf(p.form()!.querySelector('[role="alert"]')!)).toBe(RESULT_COPY.locked);
    expect(closedLines(p)).toBe(1);
    expect(p.value('Package name')).toBe('Envelope');
  }, T);

  it('a 409 on Send locks the card with the server\'s sentence, and nothing else changes', async () => {
    const p = setup();
    p.createShipment.mockRejectedValueOnce(new ApiRequestError(409, 'The simulation is playing. Press Back to start.'));
    await p.read();
    click(button(p.form()!, 'Find a delivery match'));
    await flush();
    expect(textOf(p.form()!.querySelector('[role="alert"]')!)).toBe('The simulation is playing. Press Back to start.');
    expect(button(p.form()!, 'Find a delivery match').disabled).toBe(true);
    expect(textOf(p.note()!.querySelector('.nd-parsed__source')!)).toBe('Parsed by Gemini');
    expect(p.value('Package name')).toBe('Envelope');
  }, T);

  it('a locked run keeps New delivery closed: no box opens', () => {
    const p = setup(async () => GEMINI, LOCKED);
    for (const b of buttons(p.container, 'New delivery')) expect(b.disabled).toBe(true);
    click(p.opener());
    expect(p.box()).toBeNull();
    expect(p.form()).toBeNull();
  }, T);
});

describe('without a stub the page asks the server', () => {
  it('POST /api/v2/parse-request with the sentence, and the answer opens the card', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(OFFLINE), { status: 200, headers: { 'Content-Type': 'application/json' } }));
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
    for (let i = 0; i < 20 && !m.container.querySelector('form.nd'); i++) await flush();
    await flush();
    // One read. The call after it asks for the Options card (#863, business-v2-dom-advice.test.tsx); this
    // fake answers it with the draft again, which is no advise answer: the card holds no option and says so
    // in one sentence (#880; before it the card was not drawn).
    expect(fetchMock.mock.calls.map(([called]) => called)).toEqual(['/api/v2/parse-request', '/api/v2/advise']);
    expect(m.container.querySelector('.nd-option')).toBeNull();
    expect(textOf(m.container.querySelector('.nd-options')!)).toBe(
      'OptionsOptions could not be loaded. You can still send your request: press Find a delivery match.',
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v2/parse-request');
    expect(init!.method).toBe('POST');
    expect(JSON.parse(String(init!.body))).toEqual({ text: SENTENCE });
    expect(textOf(m.container.querySelector('.nd-parsed__source')!)).toBe('Parsed offline');
    expect(m.container.querySelector('form.nd')).not.toBeNull();
  }, T);
});
