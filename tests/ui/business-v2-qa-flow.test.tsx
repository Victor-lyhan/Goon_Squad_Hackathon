// @vitest-environment jsdom
// The four behaviour fixes of the Business demo flow QA in headless Chrome (#719), in a real DOM:
//   1. a double press on "Find a delivery match" is one press (isRepeatPress, pressOf and the rendered form);
//   2. the answer to a press is brought on screen (revealAnswer);
//   3. the opened delivery's header, with its Close button, is brought on screen (DeliveryDetails);
//   4. a request without an HTTP answer says so in the form's own words (statusForError, status 0).
// jsdom has no layout and no scrollIntoView, so a stub records which element asked to be shown. The browser
// computes no status, price or ETA: these tests assert only what the fake answers contain.
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentResponse } from '../../shared/v2/api';
import type { CreateShipmentRequest } from '../../shared/v2/schemas';
import { ApiRequestError } from '../../client/src/api/v2';
import {
  NewDeliveryForm, REPEAT_PRESS_MS, REPEAT_PRESS_PX, isRepeatPress, pressOf, revealAnswer, type Press,
} from '../../client/src/components/business/v2/NewDeliveryForm';
import {
  RESULT_COPY, statusForError, submitReducer, initialSubmitState, type SubmitStatus,
} from '../../client/src/components/business/v2/newDeliveryModel';
import { BusinessPageView } from '../../client/src/components/business/v2/page/BusinessPageView';
import type { BusinessWorkspaceState } from '../../client/src/components/business/v2/live/businessWorkspaceState';
import { ACME, BUSINESSES, directPlan, view } from './business-v2-details-sample';
import { DASHBOARD, ready } from './business-v2-page-sample';
import { button, byLabel, click, deferred, flush, link, mount, select, textOf, typeInto } from './kitDom';

const T = 10_000;
const REASON = 'No employee commute passes Bakery Row before the deadline.';
const NEAREST = { block: 'nearest' };

const matchedAnswer = (id = 'shp-41'): ShipmentResponse => ({
  ...view({ ...directPlan, id: `plan-${id}`, shipmentId: id }, 'scheduled', {}, { id, label: 'Lab samples' }),
  matched: true,
});
const unmatchedAnswer = (id = 'shp-42'): ShipmentResponse => ({
  ...view(null, 'unmatched', { unmatchedReason: REASON }, { id, label: 'Lab samples' }),
  matched: false,
});

// ---------- scrollIntoView stub ----------

type Shown = { el: Element; arg: unknown };
let shown: Shown[] = [];
const original = Element.prototype.scrollIntoView;

beforeEach(() => {
  shown = [];
  Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
    shown.push({ el: this, arg });
  } as Element['scrollIntoView'];
});
afterEach(() => {
  Element.prototype.scrollIntoView = original;
});

/** As if the browser had no scrollIntoView (plain jsdom). */
const withoutScrollIntoView = () => {
  // @ts-expect-error the property is not optional in lib.dom
  Element.prototype.scrollIntoView = undefined;
};

// ---------- pointer presses ----------

/** Where the pointer is in these tests, and when the first press happens (ms, as Event.timeStamp). */
const AT = { x: 700, y: 850, time: 1000 };

type PressInit = { detail?: number; after?: number; dx?: number; dy?: number };

/**
 * A click as the browser reports a pointer press: `detail` 1 for a first click or a tap, 2 for the second
 * click of a mouse double click, 0 for a key press. `after` is the time since the first press.
 */
function pointerPress(el: Element, o: PressInit = {}): MouseEvent {
  const e = new MouseEvent('click', {
    bubbles: true, cancelable: true, button: 0, detail: o.detail ?? 1,
    clientX: AT.x + (o.dx ?? 0), clientY: AT.y + (o.dy ?? 0),
  });
  Object.defineProperty(e, 'timeStamp', { value: AT.time + (o.after ?? 0) });
  act(() => { el.dispatchEvent(e); });
  return e;
}

// ---------- the form ----------

type FormProps = {
  onSubmit?: (req: CreateShipmentRequest) => Promise<ShipmentResponse>;
  onMatch?: (shipmentId: string) => Promise<ShipmentResponse>;
};

function setup(p: FormProps = {}) {
  const onSubmit = vi.fn(p.onSubmit ?? (async () => matchedAnswer()));
  const onMatch = vi.fn(p.onMatch ?? (async () => unmatchedAnswer()));
  const onOpenDelivery = vi.fn();
  const onCancel = vi.fn();
  const el = () => (
    <NewDeliveryForm
      origin={{ ...ACME }} businesses={BUSINESSES.map((b) => ({ ...b }))} phase="planning"
      onSubmit={onSubmit} onMatch={onMatch} onOpenDelivery={onOpenDelivery} onCancel={onCancel}
    />
  );
  const m = mount(el());
  const c = m.container;
  const f = {
    ...m, onSubmit, onMatch, onOpenDelivery, onCancel,
    /** A 1 s poll: equal props in new objects. */
    poll: () => m.rerender(el()),
    form: () => c.querySelector('form.nd')!,
    field: (label: string) => byLabel(c, label),
    send: () => c.querySelector<HTMLButtonElement>('.nd-actions button[type="submit"]')!,
    result: () => c.querySelector('.nd-result')!,
    alertBox: () => c.querySelector('.nd-alert')!,
    status: () => textOf(c.querySelector('[role="status"]')!),
    alert: () => textOf(c.querySelector('[role="alert"]')!),
    errors: () => [...c.querySelectorAll('.nd-error')].map(textOf),
    fill: () => {
      select(f.field('Recipient'), 'Bakery Row · Williamsburg');
      typeInto(f.field('Package name'), 'Lab samples');
      typeInto(f.field('Contents'), 'Two sealed vials');
    },
  };
  return f;
}

describe('pressOf and isRepeatPress (#719)', () => {
  /** A form with the same kinds of controls as the New delivery form. */
  function controls() {
    document.body.innerHTML = `
      <form>
        <p id="text">Delivery arranged. <strong id="strong">shp-1</strong></p>
        <input id="input" />
        <button type="button" id="view">View delivery</button>
        <a href="/simulator?package=shp-1&play=1" id="watch"><span id="inner">Watch in simulator</span></a>
        <button type="submit" id="submit">Find a delivery match</button>
        <button type="button" id="cancel">Cancel</button>
      </form>`;
    const el = (id: string) => document.getElementById(id)!;
    return { el };
  }
  const ev = (target: Element, o: PressInit = {}) => ({
    detail: o.detail ?? 1, target, timeStamp: AT.time + (o.after ?? 0), clientX: AT.x + (o.dx ?? 0), clientY: AT.y + (o.dy ?? 0),
  });
  const FIRST: Press = { time: AT.time, x: AT.x, y: AT.y };

  it('pressOf remembers a pointer press on the submit button: when and where', () => {
    const { el } = controls();
    expect(pressOf(ev(el('submit')))).toEqual(FIRST);
    expect(pressOf(ev(el('submit'), { detail: 2, after: 40, dx: 3, dy: -2 }))).toEqual({ time: AT.time + 40, x: AT.x + 3, y: AT.y - 2 });
  });

  it('pressOf is null for a key press, for another button or link and for a click on no control', () => {
    const { el } = controls();
    expect(pressOf(ev(el('submit'), { detail: 0 }))).toBeNull(); // Enter or Space on the button
    expect(pressOf(ev(el('cancel')))).toBeNull();
    expect(pressOf(ev(el('view')))).toBeNull();
    expect(pressOf(ev(el('watch')))).toBeNull();
    expect(pressOf(ev(el('text')))).toBeNull();
    expect(pressOf(ev(el('input')))).toBeNull();
    expect(pressOf({ ...ev(el('submit')), target: null as unknown as EventTarget })).toBeNull();
  });

  it('the second click of a mouse double click (detail 2) is dropped on every button and link', () => {
    const { el } = controls();
    for (const id of ['submit', 'view', 'watch', 'inner', 'cancel']) {
      expect(isRepeatPress(ev(el(id), { detail: 2, after: 120 }), FIRST), id).toBe(true);
    }
    // The mouse counts the clicks itself, so a slow double click is still one.
    expect(isRepeatPress(ev(el('submit'), { detail: 2, after: REPEAT_PRESS_MS + 400 }), FIRST)).toBe(true);
    expect(isRepeatPress(ev(el('submit'), { detail: 3, after: 300 }), FIRST)).toBe(true);
  });

  it('a tap (detail 1) within 500 ms and 10 px of the press on the submit button is dropped', () => {
    const { el } = controls();
    expect(REPEAT_PRESS_MS).toBe(500);
    expect(REPEAT_PRESS_PX).toBe(10);
    expect(isRepeatPress(ev(el('submit'), { after: 150 }), FIRST)).toBe(true);
    expect(isRepeatPress(ev(el('view'), { after: 150 }), FIRST)).toBe(true);
    expect(isRepeatPress(ev(el('watch'), { after: 150 }), FIRST)).toBe(true);
    expect(isRepeatPress(ev(el('cancel'), { after: 150 }), FIRST)).toBe(true);
    // The edges: just inside the time and the distance.
    expect(isRepeatPress(ev(el('submit'), { after: REPEAT_PRESS_MS - 1, dx: REPEAT_PRESS_PX, dy: -REPEAT_PRESS_PX }), FIRST)).toBe(true);
  });

  it('a later tap, or one somewhere else, is a new press', () => {
    const { el } = controls();
    expect(isRepeatPress(ev(el('submit'), { after: REPEAT_PRESS_MS }), FIRST)).toBe(false);
    expect(isRepeatPress(ev(el('submit'), { after: 150, dx: REPEAT_PRESS_PX + 1 }), FIRST)).toBe(false);
    expect(isRepeatPress(ev(el('submit'), { after: 150, dy: -(REPEAT_PRESS_PX + 1) }), FIRST)).toBe(false);
    // Also for a mouse: a click somewhere else is not the second click of this double click.
    expect(isRepeatPress(ev(el('view'), { detail: 2, after: 150, dy: -60 }), FIRST)).toBe(false);
  });

  it('a key press (detail 0) is never dropped', () => {
    const { el } = controls();
    for (const id of ['submit', 'view', 'watch', 'cancel']) {
      expect(isRepeatPress(ev(el(id), { detail: 0, after: 1 }), FIRST), id).toBe(false);
    }
  });

  it('a click that is not on a button or link is ignored', () => {
    const { el } = controls();
    for (const id of ['text', 'strong', 'input']) {
      expect(isRepeatPress(ev(el(id), { detail: 2, after: 100 }), FIRST), id).toBe(false);
      expect(isRepeatPress(ev(el(id), { after: 100 }), FIRST), id).toBe(false);
    }
    expect(isRepeatPress({ ...ev(el('submit'), { detail: 2 }), target: document as unknown as EventTarget }, FIRST)).toBe(false);
  });

  it('nothing is dropped when no press on the submit button came before', () => {
    const { el } = controls();
    for (const id of ['submit', 'view', 'watch', 'cancel']) {
      expect(isRepeatPress(ev(el(id), { detail: 2 }), null), id).toBe(false);
      expect(isRepeatPress(ev(el(id)), null), id).toBe(false);
    }
  });
});

describe('a double press on "Find a delivery match" in the rendered form (#719)', () => {
  it('mouse double click: one request, one delivery stored, and the emptied draft is not sent again', async () => {
    // The server's rule (DECISIONS pass 62): one delivery per clientRequestId.
    const stored = new Map<string, ShipmentResponse>();
    const f = setup({
      onSubmit: async (req) => {
        if (!stored.has(req.clientRequestId)) stored.set(req.clientRequestId, matchedAnswer(`shp-${41 + stored.size}`));
        return stored.get(req.clientRequestId)!;
      },
    });
    f.fill();
    pointerPress(f.send());
    await flush();
    expect(f.status()).toContain(RESULT_COPY.matched);
    // The answer moved the form and revealAnswer brought the button back under the pointer: the second click
    // of the double click lands on it again, now with the emptied draft.
    expect((f.field('Package name') as HTMLInputElement).value).toBe('');
    const second = pointerPress(f.send(), { detail: 2, after: 120 });
    await flush();

    expect(second.defaultPrevented).toBe(true);
    expect(f.onSubmit).toHaveBeenCalledTimes(1);
    expect(stored.size).toBe(1);
    expect(f.errors()).toEqual([]); // no "Package name is required" under "Delivery arranged"
    expect(f.status()).toContain(RESULT_COPY.matched);
    expect(f.status()).toContain('shp-41');
    expect(document.activeElement).not.toBe(f.field('Package name'));
  }, T);

  it('touch double tap (every tap is detail 1): the second tap is dropped whatever is under the finger now', async () => {
    const f = setup();
    f.fill();
    pointerPress(f.send());
    await flush();
    expect(f.status()).toContain(RESULT_COPY.matched);

    const onButton = pointerPress(f.send(), { after: 150 });
    const onView = pointerPress(button(f.container, 'View delivery'), { after: 150 });
    const onWatch = pointerPress(link(f.container, 'Watch in simulator'), { after: 150, dx: 4 });
    const onCancel = pointerPress(button(f.container, 'Cancel'), { after: 150, dy: -6 });
    await flush();
    for (const e of [onButton, onView, onWatch, onCancel]) expect(e.defaultPrevented).toBe(true); // also: the link is not followed
    expect(f.onSubmit).toHaveBeenCalledTimes(1);
    expect(f.errors()).toEqual([]);
    expect(f.onOpenDelivery).not.toHaveBeenCalled();
    expect(f.onCancel).not.toHaveBeenCalled();
    expect(f.status()).toContain(RESULT_COPY.matched);
  }, T);

  it('both presses before the answer: the second finds the button disabled or the request pending', async () => {
    const answer = deferred<ShipmentResponse>();
    const f = setup({ onSubmit: () => answer.promise });
    f.fill();
    const send = f.send();
    // Before React has drawn the disabled button.
    act(() => {
      for (const detail of [1, 2]) {
        const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail, clientX: AT.x, clientY: AT.y });
        Object.defineProperty(e, 'timeStamp', { value: AT.time + detail });
        send.dispatchEvent(e);
      }
    });
    expect(f.onSubmit).toHaveBeenCalledTimes(1);
    answer.resolve(matchedAnswer());
    await flush();
    expect(f.onSubmit).toHaveBeenCalledTimes(1);
    expect(f.errors()).toEqual([]);
    expect(f.status()).toContain(RESULT_COPY.matched);
  }, T);

  it('no match: the second press does not re-match the delivery ("Try matching again" is under the pointer)', async () => {
    const f = setup({ onSubmit: async () => unmatchedAnswer('shp-42') });
    f.fill();
    pointerPress(f.send());
    await flush();
    expect(textOf(f.send())).toBe('Try matching again');
    pointerPress(f.send(), { detail: 2, after: 90 });
    pointerPress(f.send(), { after: 200 });
    await flush();
    expect(f.onSubmit).toHaveBeenCalledTimes(1);
    expect(f.onMatch).not.toHaveBeenCalled();
    expect(f.status()).toContain(REASON);

    // A press of its own, later, does re-match it.
    pointerPress(f.send(), { after: REPEAT_PRESS_MS + 300 });
    await flush();
    expect(f.onMatch).toHaveBeenCalledTimes(1);
    expect(f.onMatch).toHaveBeenCalledWith('shp-42');
    expect(f.onSubmit).toHaveBeenCalledTimes(1);
  }, T);

  it('a second press of its own (later than 500 ms) is a press: the empty draft is validated, nothing is sent', async () => {
    const f = setup();
    f.fill();
    pointerPress(f.send());
    await flush();
    pointerPress(f.send(), { after: REPEAT_PRESS_MS + 200 });
    await flush();
    expect(f.onSubmit).toHaveBeenCalledTimes(1);
    expect(f.errors()).toEqual(['Package name is required', 'Describe the contents']);
  }, T);

  it('presses that do not follow a press on the submit button are never dropped', async () => {
    // The form is submitted from the keyboard, so no pointer press on the button was seen.
    const f = setup();
    f.fill();
    click(f.send()); // kitDom's click has detail 0, as Enter or Space on the button
    await flush();
    expect(f.status()).toContain(RESULT_COPY.matched);

    // Two quick taps on "View delivery", then a mouse double click on it: each one opens the delivery.
    const view = button(f.container, 'View delivery');
    pointerPress(view);
    pointerPress(view, { after: 100 });
    pointerPress(view, { detail: 2, after: 180 });
    expect(f.onOpenDelivery).toHaveBeenCalledTimes(3);
    expect(f.onOpenDelivery).toHaveBeenLastCalledWith('shp-41');
    // And a quick tap on Cancel right after it is a press too.
    pointerPress(button(f.container, 'Cancel'), { after: 250 });
    expect(f.onCancel).toHaveBeenCalledTimes(1);
  }, T);

  it('key presses right after the press on the button are never dropped', async () => {
    const f = setup();
    f.fill();
    pointerPress(f.send());
    await flush();
    // Enter on "View delivery" 50 ms later (a click with detail 0), at the same coordinates.
    pointerPress(button(f.container, 'View delivery'), { detail: 0, after: 50 });
    expect(f.onOpenDelivery).toHaveBeenCalledTimes(1);
    pointerPress(button(f.container, 'Cancel'), { detail: 0, after: 60 });
    expect(f.onCancel).toHaveBeenCalledTimes(1);
  }, T);

  it('a tap on the answer text between the two presses changes nothing: the third tap is still dropped', async () => {
    const f = setup();
    f.fill();
    pointerPress(f.send());
    await flush();
    pointerPress(f.result().querySelector('strong')!, { after: 120 }); // not a control: ignored
    pointerPress(f.send(), { after: 260 });
    await flush();
    expect(f.onSubmit).toHaveBeenCalledTimes(1);
    expect(f.errors()).toEqual([]);
  }, T);
});

describe('revealAnswer: the answer to a press is brought on screen (#719)', () => {
  /** The elements that were asked to be shown since the last call, as names. */
  const names = (f: ReturnType<typeof setup>) => {
    const out = shown.map(({ el, arg }) => {
      expect(arg).toEqual(NEAREST); // `nearest` moves nothing when the element is in view already
      return el === f.send() ? 'button' : el === f.result() ? 'result' : el === f.alertBox() ? 'alert' : el.tagName;
    });
    shown = [];
    return out;
  };

  it('idle and submitting show nothing; a matched answer shows the pressed button, then the result', async () => {
    const answer = deferred<ShipmentResponse>();
    const f = setup({ onSubmit: () => answer.promise });
    expect(names(f)).toEqual([]);
    f.fill();
    expect(names(f)).toEqual([]);
    click(f.send());
    expect(f.status()).toContain('Sending request');
    expect(names(f)).toEqual([]);

    answer.resolve(matchedAnswer());
    await flush();
    expect(f.status()).toContain(RESULT_COPY.matched);
    expect(names(f)).toEqual(['button', 'result']);
  }, T);

  it('a 1 s poll and typing after the answer do not scroll again', async () => {
    const f = setup();
    f.fill();
    click(f.send());
    await flush();
    expect(names(f)).toEqual(['button', 'result']);
    f.poll();
    f.poll();
    typeInto(f.field('Package name'), 'Second parcel');
    expect(names(f)).toEqual([]);
  }, T);

  it('a no-match answer shows the result; the same answer again (a second no-match) is shown again', async () => {
    const f = setup({ onSubmit: async () => unmatchedAnswer('shp-42'), onMatch: async () => unmatchedAnswer('shp-42') });
    f.fill();
    click(f.send());
    await flush();
    expect(f.status()).toContain(REASON);
    expect(names(f)).toEqual(['button', 'result']);

    click(button(f.container, 'Try matching again'));
    expect(names(f)).toEqual([]); // "Looking for a matching commute again…" is not an answer
    await flush();
    expect(f.onMatch).toHaveBeenCalledTimes(1);
    expect(f.status()).toContain(REASON);
    expect(names(f)).toEqual(['button', 'result']);
  }, T);

  it('every answer of the reducer is a new status object, also when it says the same', () => {
    // The effect in the form runs when the status object changes, so the same answer twice must be two objects.
    const start = initialSubmitState('req-1');
    const twice = (answer: Parameters<typeof submitReducer>[1]) => {
      const first = submitReducer(submitReducer(start, { type: 'submit' }), answer);
      const second = submitReducer(submitReducer(first, { type: 'retry' }), answer);
      expect(second.status).toEqual(first.status);
      expect(second.status).not.toBe(first.status);
    };
    twice({ type: 'success', response: unmatchedAnswer(), draft: undefined });
    twice({ type: 'failure', error: new ApiRequestError(0, 'Failed to fetch', undefined, 'network') });
    twice({ type: 'failure', error: new ApiRequestError(500, 'Internal server error') });
  });

  it('an error, a locked run and missing travel data show the alert, each time', async () => {
    const errors: unknown[] = [
      new ApiRequestError(500, 'Internal server error'),
      new ApiRequestError(0, 'Failed to fetch', undefined, 'network'),
      new ApiRequestError(503, 'x', undefined, 'http', 'travel_data_missing'),
      new ApiRequestError(409, 'Run is locked'),
    ];
    const texts = ['Internal server error', RESULT_COPY.noAnswer, RESULT_COPY.unavailable, 'Run is locked'];
    let call = 0;
    const f = setup({ onSubmit: async () => { throw errors[call++]; } });
    f.fill();
    for (const text of texts) {
      click(f.send());
      await flush();
      expect(f.alert()).toContain(text);
      expect(names(f)).toEqual(['button', 'alert']);
    }
    expect(f.onSubmit).toHaveBeenCalledTimes(4);
  }, T);

  it('a submit that validation stops shows no answer (focus goes to the first invalid field instead)', async () => {
    const f = setup();
    click(f.send());
    await flush();
    expect(f.onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(f.field('Recipient'));
    expect(names(f)).toEqual([]);
  }, T);

  it('called directly: only for an answer, button first, then .nd-result or .nd-alert', () => {
    const f = setup();
    const kinds: Record<SubmitStatus['kind'], string[]> = {
      idle: [], submitting: [],
      matched: ['button', 'result'], unmatched: ['button', 'result'],
      locked: ['button', 'alert'], unavailable: ['button', 'alert'], error: ['button', 'alert'],
    };
    for (const [kind, expected] of Object.entries(kinds)) {
      revealAnswer(f.form(), kind as SubmitStatus['kind']);
      expect(names(f), kind).toEqual(expected);
    }
    // No form yet (before the first commit), or a form without these parts: nothing to do, no error.
    expect(() => revealAnswer(null, 'matched')).not.toThrow();
    expect(() => revealAnswer(document.createElement('form'), 'matched')).not.toThrow();
    expect(shown).toEqual([]);
  }, T);

  it('works where the DOM has no scrollIntoView', async () => {
    withoutScrollIntoView();
    const f = setup();
    f.fill();
    click(f.send());
    await flush();
    expect(f.status()).toContain(RESULT_COPY.matched);
    expect(() => revealAnswer(f.form(), 'matched')).not.toThrow();
  }, T);
});

describe('a request without an HTTP answer (#719)', () => {
  it('statusForError with status 0 is the form\'s own sentence and no field errors', () => {
    const expected = { kind: 'error', message: RESULT_COPY.noAnswer, fieldErrors: {} };
    expect(statusForError(new ApiRequestError(0, 'Failed to fetch', undefined, 'network'))).toEqual(expected);
    expect(statusForError(new ApiRequestError(0, 'The request timed out', undefined, 'timeout'))).toEqual(expected);
    expect(statusForError(new ApiRequestError(0, ''))).toEqual(expected);
    // Even if such an error carried field errors, none is shown: the server never saw the request.
    expect(statusForError({ status: 0, message: 'Load failed', fieldErrors: { label: 'x' } })).toEqual(expected);
    expect(RESULT_COPY.noAnswer).toBe('The server did not answer. Your request is still in the form. Try again.');
    expect(RESULT_COPY.noAnswer).not.toMatch(/fetch/i);
  });

  it('an HTTP answer keeps the server\'s own message', () => {
    expect(statusForError(new ApiRequestError(500, 'Internal server error'))).toEqual({
      kind: 'error', message: 'Internal server error', fieldErrors: {},
    });
    expect(statusForError(new ApiRequestError(400, 'Invalid request', { label: 'Label is required' }))).toEqual({
      kind: 'error', message: 'Invalid request', fieldErrors: { label: 'Label is required' },
    });
  });

  it('in the form: the sentence is shown, the draft stays, and the next press sends the same clientRequestId', async () => {
    let fail = true;
    const f = setup({
      onSubmit: async () => {
        if (fail) throw new ApiRequestError(0, 'Failed to fetch', undefined, 'network');
        return matchedAnswer('shp-44');
      },
    });
    f.fill();
    click(f.send());
    await flush();
    expect(f.alert()).toBe(RESULT_COPY.noAnswer);
    expect(textOf(f.container)).not.toContain('Failed to fetch');
    expect(f.errors()).toEqual([]);
    expect((f.field('Package name') as HTMLInputElement).value).toBe('Lab samples');
    expect(f.send().disabled).toBe(false);
    expect(textOf(f.send())).toBe('Find a delivery match');

    fail = false;
    click(f.send());
    await flush();
    expect(f.onSubmit).toHaveBeenCalledTimes(2);
    const [first, second] = f.onSubmit.mock.calls.map((c) => c[0]);
    expect(second).toEqual(first); // same clientRequestId: the server stores the delivery once
    expect(f.alert()).toBe('');
    expect(f.status()).toContain('shp-44');
  }, T);
});

describe('delivery details: the header with Close is brought on screen (#719)', () => {
  const RELAY_ID = 'shp-8';
  const UNMATCHED_ID = 'shp-9';

  function Page({ initialId = null, state }: { initialId?: string | null; state: BusinessWorkspaceState }) {
    const [id, setId] = useState<string | null>(initialId);
    return (
      <BusinessPageView
        state={state} shipmentId={id}
        createShipment={async () => matchedAnswer(RELAY_ID)}
        matchShipment={async () => { throw new Error('not called'); }}
        refetchNow={async () => {}} dismissRunChanged={() => {}}
        onOpenShipment={setId} onCloseShipment={() => setId(null)}
        businessHref={(b) => `/business/${b}`}
      />
    );
  }

  function setupPage(initialId: string | null = null) {
    const m = mount(<Page initialId={initialId} state={ready()} />);
    const c = m.container;
    return {
      ...m,
      poll: () => m.rerender(<Page initialId={initialId} state={ready({ ...DASHBOARD, business: { ...DASHBOARD.business } })} />),
      row: (id: string) => {
        const found = [...c.querySelectorAll<HTMLTableRowElement>('tr.bw-row')]
          .filter((r) => textOf(r.querySelector('td[data-label="Shipment ID"]')!) === id);
        if (found.length !== 1) throw new Error(`row(): ${found.length} rows for ${id}`);
        return found[0];
      },
      head: () => c.querySelector<HTMLElement>('.bd-panel .bd-head'),
      heading: () => c.querySelector<HTMLElement>('.bd-panel .bd-title'),
    };
  }
  /** The elements asked to be shown since the last call. */
  const take = () => { const out = shown; shown = []; return out; };

  it('opening a delivery focuses its title and shows its header, which holds the Close button', () => {
    const p = setupPage();
    expect(take()).toEqual([]);
    click(p.row(RELAY_ID));
    const head = p.head()!;
    expect(head).not.toBeNull();
    expect(button(head, 'Close')).toBeTruthy();
    expect(head.contains(p.heading())).toBe(true);
    expect(document.activeElement).toBe(p.heading());
    expect(take()).toEqual([{ el: head, arg: NEAREST }]);
  }, T);

  it('a poll of the open delivery does not scroll again; another delivery does, once', () => {
    const p = setupPage(RELAY_ID);
    expect(take()).toEqual([{ el: p.head()!, arg: NEAREST }]);
    p.poll();
    p.poll();
    expect(take()).toEqual([]);

    click(p.row(UNMATCHED_ID));
    expect(textOf(p.heading()!)).toBe(textOf(p.row(UNMATCHED_ID).querySelector('td[data-label="Package"]')!));
    expect(take()).toEqual([{ el: p.head()!, arg: NEAREST }]);
  }, T);

  it('"View delivery" in the New delivery form opens the details and shows their header', async () => {
    const p = setupPage();
    click(button(p.container, 'New delivery'));
    const form = p.container.querySelector('form.nd')!;
    select(byLabel(form, 'Recipient'), 'Bakery Row · Williamsburg');
    typeInto(byLabel(form, 'Package name'), 'Lab samples');
    typeInto(byLabel(form, 'Contents'), 'Two sealed vials');
    click(button(form, 'Find a delivery match'));
    await flush();
    // The answer was shown: the pressed button, then the result.
    expect(take().map((s) => s.el)).toEqual([form.querySelector('.nd-actions button[type="submit"]'), form.querySelector('.nd-result')]);

    click(button(form, 'View delivery'));
    expect(p.head()).not.toBeNull();
    expect(take()).toEqual([{ el: p.head()!, arg: NEAREST }]);
    expect(document.activeElement).toBe(p.heading());
  }, T);

  it('works where the DOM has no scrollIntoView', () => {
    withoutScrollIntoView();
    const p = setupPage();
    click(p.row(RELAY_ID));
    expect(document.activeElement).toBe(p.heading());
  }, T);
});
