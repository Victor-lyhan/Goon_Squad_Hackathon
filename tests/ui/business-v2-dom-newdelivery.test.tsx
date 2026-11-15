// @vitest-environment jsdom
// The MVP II New delivery form in a real DOM (#505): events, effects and focus actually run here.
// The browser computes no status, price or ETA, so these tests assert only what the fake answer contains.
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ShipmentResponse } from '../../shared/v2/api';
import type { CreateShipmentRequest } from '../../shared/v2/schemas';
import type { NetworkBusiness, Phase } from '../../shared/v2/types';
import { ApiRequestError } from '../../client/src/api/v2';
import { NewDeliveryForm } from '../../client/src/components/business/v2/NewDeliveryForm';
import { RESULT_COPY, emptyDraft, toRequest } from '../../client/src/components/business/v2/newDeliveryModel';
import { ACME, BAKERY, BUSINESSES, directPlan, view } from './business-v2-details-sample';
import { button, byLabel, click, deferred, flush, mount, press, select, textOf, typeInto } from './kitDom';

const T = 10_000;
const REASON = 'No employee commute passes Bakery Row before the deadline.';

const matchedAnswer = (id = 'shp-41'): ShipmentResponse => ({
  ...view({ ...directPlan, id: `plan-${id}`, shipmentId: id }, 'scheduled', {}, { id, label: 'Lab samples' }),
  matched: true,
});
const unmatchedAnswer = (id = 'shp-42'): ShipmentResponse => ({
  ...view(null, 'unmatched', { unmatchedReason: REASON }, { id, label: 'Lab samples' }),
  matched: false,
});

type Props = {
  origin?: NetworkBusiness;
  businesses?: NetworkBusiness[];
  phase?: Phase;
  dashboardVersion?: number;
  onSubmit?: (req: CreateShipmentRequest) => Promise<ShipmentResponse>;
  onOpenDelivery?: (id: string) => void;
};

function setup(p: Props = {}) {
  const onSubmit = vi.fn(p.onSubmit ?? (async () => matchedAnswer()));
  const onOpenDelivery = vi.fn(p.onOpenDelivery ?? (() => {}));
  const onCancel = vi.fn();
  const el = (over: Props = {}) => (
    <NewDeliveryForm
      origin={over.origin ?? p.origin ?? ACME}
      businesses={over.businesses ?? p.businesses ?? BUSINESSES}
      phase={over.phase ?? p.phase ?? 'planning'}
      dashboardVersion={over.dashboardVersion ?? p.dashboardVersion}
      onSubmit={onSubmit}
      onOpenDelivery={onOpenDelivery}
      onCancel={onCancel}
    />
  );
  const m = mount(el());
  const c = m.container;
  return {
    ...m, onSubmit, onOpenDelivery, onCancel,
    rerenderWith: (over: Props) => m.rerender(el(over)),
    field: (label: string) => byLabel(c, label),
    send: () => button(c, /^(Find a delivery match|Finding a match…)$/),
    status: () => textOf(c.querySelector('[role="status"]')!),
    alert: () => textOf(c.querySelector('[role="alert"]')!),
  };
}

/** The values typed by fill(), as the form's own draft type. */
const TYPED = {
  ...emptyDraft(), recipientId: BAKERY.id, label: 'Lab samples', description: 'Two sealed vials',
  weightKg: '1.2', pickupInstructions: 'Front desk',
};

function fill(f: ReturnType<typeof setup>) {
  select(f.field('Recipient'), 'Bakery Row · Williamsburg');
  typeInto(f.field('Package name'), 'Lab samples');
  typeInto(f.field('Weight (kg)'), '1.2');
  typeInto(f.field('Contents'), 'Two sealed vials');
  typeInto(f.field('Pickup instructions (optional)'), 'Front desk');
}

describe('New delivery form in a real DOM', () => {
  it('sends one request equal to toRequest of the typed values, with a clientRequestId; pending disables the button', async () => {
    const answer = deferred<ShipmentResponse>();
    const f = setup({ onSubmit: () => answer.promise });
    fill(f);
    click(f.send());

    expect(f.onSubmit).toHaveBeenCalledTimes(1);
    const req = f.onSubmit.mock.calls[0][0];
    expect(req.clientRequestId).toMatch(/\S/);
    expect(req).toEqual(toRequest(TYPED, ACME.id, req.clientRequestId));
    // Pending: the button is disabled and says so; the status region says what is happening.
    expect(f.send().disabled).toBe(true);
    expect(textOf(f.send())).toBe('Finding a match…'); // one verb from the button to the wait (#880)
    expect(f.status()).toBe('Finding a delivery match for your request…');

    answer.resolve(matchedAnswer('shp-41'));
    await flush();
    expect(f.send().disabled).toBe(false);
    expect(textOf(f.send())).toBe('Find a delivery match');
  }, T);

  it('matched: shows Delivery arranged with the shipment ID; View delivery opens that ID', async () => {
    const f = setup({ onSubmit: async () => matchedAnswer('shp-41') });
    fill(f);
    click(f.send());
    await flush();

    expect(f.status()).toContain(RESULT_COPY.matched);
    expect(f.status()).toContain('shp-41');
    click(button(f.container, 'View delivery'));
    expect(f.onOpenDelivery).toHaveBeenCalledTimes(1);
    expect(f.onOpenDelivery).toHaveBeenCalledWith('shp-41');
    // A matched result starts a fresh package for the same recipient.
    expect((f.field('Package name') as HTMLInputElement).value).toBe('');
    expect((f.field('Recipient') as HTMLSelectElement).selectedOptions[0].text).toBe('Bakery Row · Williamsburg');
  }, T);

  it('matched: true never shows the no-match copy, and the next request gets a new clientRequestId', async () => {
    const f = setup();
    fill(f);
    click(f.send());
    await flush();
    expect(f.status()).not.toContain(RESULT_COPY.unmatched);
    typeInto(f.field('Package name'), 'Second parcel');
    typeInto(f.field('Contents'), 'Paper');
    click(f.send());
    await flush();
    expect(f.onSubmit).toHaveBeenCalledTimes(2);
    expect(f.onSubmit.mock.calls[1][0].clientRequestId).not.toBe(f.onSubmit.mock.calls[0][0].clientRequestId);
  }, T);

  it('matched: false shows the no-match result with the server reason and keeps the typed draft', async () => {
    const f = setup({ onSubmit: async () => unmatchedAnswer('shp-42') });
    fill(f);
    click(f.send());
    await flush();

    expect(f.status()).toContain(RESULT_COPY.unmatched);
    expect(f.status()).toContain(REASON);
    expect(f.status()).not.toContain(RESULT_COPY.matched);
    expect(f.alert()).toBe('');
    expect((f.field('Package name') as HTMLInputElement).value).toBe('Lab samples');
    click(button(f.container, 'View delivery'));
    expect(f.onOpenDelivery).toHaveBeenCalledWith('shp-42');
  }, T);

  it('two fast clicks send one request', async () => {
    const answer = deferred<ShipmentResponse>();
    const f = setup({ onSubmit: () => answer.promise });
    fill(f);
    const send = f.send();
    // Both clicks land before React re-renders the disabled button (the busy guard has to stop the second).
    act(() => { send.click(); send.click(); });
    expect(f.onSubmit).toHaveBeenCalledTimes(1);
    // And once it is disabled, a third click does nothing either.
    click(send);
    expect(f.onSubmit).toHaveBeenCalledTimes(1);
    answer.resolve(matchedAnswer());
    await flush();
    expect(f.onSubmit).toHaveBeenCalledTimes(1);
  }, T);

  it('a rejected request shows the error; the retry sends the same clientRequestId', async () => {
    let calls = 0;
    const f = setup({
      onSubmit: async () => {
        calls += 1;
        if (calls === 1) throw new ApiRequestError(500, 'Internal server error');
        return unmatchedAnswer('shp-43');
      },
    });
    fill(f);
    click(f.send());
    await flush();
    expect(f.alert()).toContain('Internal server error');
    expect(f.send().disabled).toBe(false);
    expect((f.field('Package name') as HTMLInputElement).value).toBe('Lab samples');

    click(f.send());
    await flush();
    expect(f.onSubmit).toHaveBeenCalledTimes(2);
    const [first, second] = f.onSubmit.mock.calls.map((c) => c[0]);
    expect(second.clientRequestId).toBe(first.clientRequestId);
    expect(second).toEqual(first);
    expect(f.alert()).toBe('');
    expect(f.status()).toContain(RESULT_COPY.unmatched);
  }, T);

  it('an empty submit sends nothing, marks the fields invalid and focuses the first one', async () => {
    const f = setup();
    click(f.send());
    await flush();
    expect(f.onSubmit).not.toHaveBeenCalled();
    const recipient = f.field('Recipient');
    expect(recipient.getAttribute('aria-invalid')).toBe('true');
    expect(f.field('Package name').getAttribute('aria-invalid')).toBe('true');
    expect(f.field('Contents').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(recipient);
    // The error text is linked to the field.
    const describedBy = recipient.getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(' ').some((id) => document.getElementById(id)?.className === 'nd-error')).toBe(true);

    // Fixing the first field moves focus on the next submit to the next invalid one.
    select(recipient, 'Atlas Books · Long Island City');
    expect(recipient.hasAttribute('aria-invalid')).toBe(false);
    click(f.send());
    expect(document.activeElement).toBe(f.field('Package name'));
    expect(f.onSubmit).not.toHaveBeenCalled();
  }, T);

  it('a poll (equal props in new objects) keeps the typed text and the result; another origin starts fresh', async () => {
    const f = setup({ onSubmit: async () => unmatchedAnswer('shp-42') });
    const poll = () => f.rerenderWith({ origin: { ...ACME }, businesses: BUSINESSES.map((b) => ({ ...b })) });
    fill(f);
    poll();
    expect((f.field('Package name') as HTMLInputElement).value).toBe('Lab samples');
    expect((f.field('Contents') as HTMLInputElement).value).toBe('Two sealed vials');
    expect((f.field('Recipient') as HTMLSelectElement).selectedOptions[0].text).toBe('Bakery Row · Williamsburg');

    click(f.send());
    await flush();
    poll();
    poll();
    expect(f.status()).toContain(REASON);
    expect((f.field('Package name') as HTMLInputElement).value).toBe('Lab samples');

    // Same typing in progress, then the workspace switches business: a fresh draft and no old result.
    typeInto(f.field('Package name'), 'Half typed');
    f.rerenderWith({ origin: BAKERY });
    expect((f.field('Package name') as HTMLInputElement).value).toBe('');
    expect((f.field('Recipient') as HTMLSelectElement).value).toBe('');
    expect(f.status()).toBe('');
    expect(textOf(f.container)).toContain('From Bakery Row');
  }, T);

  it('phase "locked" sends nothing and shows the note that names Back to start', async () => {
    const f = setup({ phase: 'locked' });
    fill(f);
    expect(f.send().disabled).toBe(true);
    click(f.send());
    press('Enter', f.field('Package name'));
    // Even a submit event that gets past the disabled button is refused.
    act(() => { f.container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
    expect(f.onSubmit).not.toHaveBeenCalled();
    expect(f.alert()).toContain(RESULT_COPY.locked);
    expect(f.alert()).toMatch(/Press Back to start in the simulator to reopen them\.$/);
    expect(f.alert()).not.toMatch(/planning cycle/i);

    // A poll that brings the run back to planning re-opens the form with the typing intact.
    f.rerenderWith({ phase: 'planning' });
    expect(f.send().disabled).toBe(false);
    expect(f.alert()).toBe('');
    expect((f.field('Package name') as HTMLInputElement).value).toBe('Lab samples');
  }, T);

  it('a 409 answer (the run locked while sending) shows the locked note', async () => {
    const f = setup({ onSubmit: async () => { throw new ApiRequestError(409, 'Run is locked'); } });
    fill(f);
    click(f.send());
    await flush();
    expect(f.alert()).toContain('Run is locked');
    expect(f.send().disabled).toBe(true);
  }, T);

  // #755: the page is up to one poll behind, so a press right after Play is answered 409 while the form's
  // dashboard still says planning. The refusal locks the form; a later planning dashboard reopens it.
  it('a 409 stays until a later dashboard says planning: then the form is open again with the typing intact', async () => {
    const sent = 'The simulation is playing. Press Back to start in the simulator to reopen requests.';
    let refuse = true;
    const f = setup({
      dashboardVersion: 5,
      onSubmit: async () => { if (refuse) throw new ApiRequestError(409, sent); return matchedAnswer(); },
    });
    const fields = () => [...f.container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('form input, form select')];
    fill(f);
    click(f.send());
    await flush();
    expect(f.send().disabled).toBe(true);
    expect(f.alert()).toBe(sent);

    // The same dashboard again (a re-render, or a poll with the same version): still refused.
    f.rerenderWith({ phase: 'planning', dashboardVersion: 5 });
    expect(f.send().disabled).toBe(true);
    expect(f.alert()).toBe(sent);
    // The poll that brings the lock: still refused, with the server's text as sent.
    f.rerenderWith({ phase: 'locked', dashboardVersion: 6 });
    expect(f.send().disabled).toBe(true);
    expect(f.alert()).toBe(sent);
    f.rerenderWith({ phase: 'locked', dashboardVersion: 9 });
    expect(f.alert()).toBe(sent);

    // Back to start: the next dashboard says planning.
    f.rerenderWith({ phase: 'planning', dashboardVersion: 10 });
    expect(f.send().disabled).toBe(false);
    expect(f.alert()).toBe('');
    expect(fields().length).toBeGreaterThan(0);
    for (const field of fields()) expect(field.disabled, field.id).toBe(false);
    expect((f.field('Package name') as HTMLInputElement).value).toBe('Lab samples');
    expect((f.field('Weight (kg)') as HTMLInputElement).value).toBe('1.2');
    expect((f.field('Contents') as HTMLInputElement).value).toBe('Two sealed vials');
    expect((f.field('Pickup instructions (optional)') as HTMLInputElement).value).toBe('Front desk');

    // The same request goes out again (same ID, so it can never be stored twice) and is answered.
    refuse = false;
    click(f.send());
    await flush();
    expect(f.onSubmit).toHaveBeenCalledTimes(2);
    expect(f.onSubmit.mock.calls[1][0]).toEqual(f.onSubmit.mock.calls[0][0]);
    expect(f.onSubmit.mock.calls[0][0]).toEqual(toRequest(TYPED, ACME.id, f.onSubmit.mock.calls[0][0].clientRequestId));
    expect(f.status()).toContain(RESULT_COPY.matched);
  }, T);

  it('a 409 is dropped by a newer planning dashboard even when the page never saw the lock', async () => {
    // Play, the press and Back to start all inside one poll interval: the phase the form is given never changes.
    const f = setup({ dashboardVersion: 5, onSubmit: async () => { throw new ApiRequestError(409, 'Run is locked'); } });
    fill(f);
    click(f.send());
    await flush();
    expect(f.send().disabled).toBe(true);
    f.rerenderWith({ phase: 'planning', dashboardVersion: 7 });
    expect(f.send().disabled).toBe(false);
    expect(f.alert()).toBe('');
    expect((f.field('Package name') as HTMLInputElement).value).toBe('Lab samples');
  }, T);

  it('without a dashboard version, a 409 is dropped when the phase comes back to planning', async () => {
    const f = setup({ onSubmit: async () => { throw new ApiRequestError(409, 'Run is locked'); } });
    fill(f);
    click(f.send());
    await flush();
    f.rerenderWith({ phase: 'planning' });
    expect(f.send().disabled).toBe(true);
    f.rerenderWith({ phase: 'locked' });
    expect(f.alert()).toBe('Run is locked');
    f.rerenderWith({ phase: 'planning' });
    expect(f.send().disabled).toBe(false);
    expect(f.alert()).toBe('');
    expect((f.field('Package name') as HTMLInputElement).value).toBe('Lab samples');
  }, T);

  it('Esc in the form cancels it', () => {
    const f = setup();
    typeInto(f.field('Package name'), 'x');
    press('Escape');
    expect(f.onCancel).toHaveBeenCalledTimes(1);
    click(button(f.container, 'Cancel'));
    expect(f.onCancel).toHaveBeenCalledTimes(2);
  }, T);
});
