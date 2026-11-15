import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NewDeliveryForm, NewDeliveryFormView } from '../../client/src/components/business/v2/NewDeliveryForm';
import {
  RESULT_COPY, emptyDraft, validate, type NewDeliveryDraft, type SubmitStatus, type FieldErrors,
} from '../../client/src/components/business/v2/newDeliveryModel';
import type { ShipmentResponse } from '../../shared/v2/api';
import { BUSINESSES, ME, plan, shipment, view as shipmentView } from './business-v2-table-sample';

const noop = () => {};
const never = () => new Promise<ShipmentResponse>(() => {});
const filled: NewDeliveryDraft = { ...emptyDraft(), recipientId: 'biz-print', label: 'Contracts', description: 'Signed copies' };

const view = (status: SubmitStatus, over: { draft?: NewDeliveryDraft; errors?: FieldErrors; phase?: 'planning' | 'locked' } = {}) =>
  renderToStaticMarkup(
    <NewDeliveryFormView origin={ME} businesses={BUSINESSES} phase={over.phase ?? 'planning'}
      draft={over.draft ?? filled} errors={over.errors ?? {}} status={status}
      onChange={noop} onSubmit={noop} onOpenDelivery={noop} onCancel={noop} />,
  );

function expectClean(html: string) {
  expect(html).not.toMatch(/NaN|undefined/);
  expect(html).not.toMatch(/\b(biz|home)-[a-z0-9]/i);
  expect(html.toLowerCase()).not.toContain('hub');
}

/** Every input/select has a <label for> pointing at it. */
function expectLabelled(html: string) {
  const controls = [...html.matchAll(/<(input|select|textarea)\b[^>]*\bid="([^"]+)"/g)].map((m) => m[2]);
  expect(controls.length).toBeGreaterThanOrEqual(9);
  expect(html.match(/<(input|select|textarea)\b/g)).toHaveLength(controls.length);
  for (const id of controls) expect(html).toContain(`<label class="nd-label" for="${id}">`);
}

const regionText = (html: string, role: 'status' | 'alert') =>
  (html.match(new RegExp(`role="${role}"[^>]*>([\\s\\S]*?)</div>(?=<div class="nd-(alert|actions)")`)) ?? [])[1] ?? '';

describe('NewDeliveryForm (static renders)', () => {
  it('empty: both groups, labelled inputs, recipients without the sender, no result', () => {
    const html = renderToStaticMarkup(
      <NewDeliveryForm origin={ME} businesses={BUSINESSES} phase="planning" onSubmit={never}
        onOpenDelivery={noop} onCancel={noop} />,
    );
    expect(html).toContain('<legend class="nd-legend">Recipient and package</legend>');
    expect(html).toContain('<legend class="nd-legend">Timing</legend>');
    expect(html).toContain('From Acme Studio · Midtown');
    expect(html).toContain('Bakery Row · Midtown');
    expect(html).not.toContain('Acme Studio · Midtown</option>');
    expect(html).toContain('Choose a business');
    // The two times are mono spans (#742); the sentence itself is pinned in business-v2-mono-markup.test.tsx.
    expect(html).toContain('Simulation window: <span class="nd-mono">Day 1, 3:30 PM</span> to <span class="nd-mono">Day 2, 12:00 PM</span>.');
    expect(html).not.toContain('15:30');
    expect(html).toMatch(/<button type="submit"[^>]*>Find a delivery match</);
    expect(html).not.toMatch(/<button type="submit"[^>]*disabled/);
    expect(html).toContain('role="status"');
    expect(html).toContain('role="alert"');
    expectLabelled(html);
    expectClean(html);
  });

  it('invalid: inline messages next to their fields, aria-invalid and aria-describedby', () => {
    const errors = validate({ ...emptyDraft(), weightKg: '3' }, ME.id);
    const html = view({ kind: 'idle' }, { draft: { ...emptyDraft(), weightKg: '3' }, errors });
    for (const msg of ['Choose a recipient business', 'Package name is required', 'Max 2 kg', 'Describe the contents']) {
      expect(html).toContain(`<p class="nd-error" id="`);
      expect(html).toContain(msg);
    }
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(4);
    const [, errId] = html.match(/<p class="nd-error" id="([^"]+)">Max 2 kg/)!;
    expect(html).toMatch(new RegExp(`aria-describedby="[^"]*${errId.replace(/[:]/g, '\\$&')}"`));
    expectLabelled(html);
    expectClean(html);
  });

  it('submitting: submit disabled, inputs disabled, progress in the status region', () => {
    const html = view({ kind: 'submitting' });
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Finding a match…</);
    expect(html.match(/<fieldset[^>]*disabled=""/g)).toHaveLength(2);
    expect(regionText(html, 'status')).toContain('Finding a delivery match for your request');
    expectLabelled(html);
    expectClean(html);
  });

  it('matched: "Delivery arranged." with the plan, ETA, price and both actions in the status region', () => {
    const response: ShipmentResponse = {
      ...shipmentView(shipment('shp-9', {}), plan('shp-9', { deliveryMin: 1990, customerPriceCents: 1250 }), 'scheduled'),
      matched: true,
    };
    const html = view({ kind: 'matched', shipmentId: 'shp-9', response });
    const status = regionText(html, 'status');
    expect(status).toContain(RESULT_COPY.matched);
    expect(status).toContain('<dt>Plan</dt><dd>Direct</dd>');
    expect(status).toContain('<dt>ETA</dt><dd class="nd-mono">Day 2, 9:10 AM</dd>');
    expect(status).toContain('<dt>Price</dt><dd class="nd-mono">$12.50</dd>');
    expect(status).toMatch(/<button[^>]*>View delivery<\/button>/);
    expect(status).toMatch(/<a [^>]*href="\/simulator\?package=shp-9&amp;play=1"[^>]*>Watch in simulator<\/a>/);
    expectClean(html);
  });

  it('the primary button reads "Try matching again" for an unchanged no-match draft, "Matching…" while it runs', () => {
    const status: SubmitStatus = { kind: 'unmatched', shipmentId: 'shp-9', reason: 'No commute.' };
    const retry = (s: SubmitStatus, on: boolean) => renderToStaticMarkup(
      <NewDeliveryFormView origin={ME} businesses={BUSINESSES} phase="planning" draft={filled} errors={{}} status={s}
        retry={on} onChange={noop} onSubmit={noop} onOpenDelivery={noop} onCancel={noop} />,
    );
    expect(retry(status, true)).toMatch(/<button type="submit"[^>]*>Try matching again</);
    expect(retry(status, false)).toMatch(/<button type="submit"[^>]*>Find a delivery match</);
    const pending = retry({ kind: 'submitting', retry: true }, true);
    expect(pending).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Matching…</);
    expect(regionText(pending, 'status')).toContain('Finding a delivery match again');
  });

  it('unmatched: the server reason and the same action', () => {
    const html = view({ kind: 'unmatched', shipmentId: 'shp-9', reason: 'No commute passes Print Shop before the deadline.' });
    const status = regionText(html, 'status');
    expect(status).toContain(RESULT_COPY.unmatched);
    expect(status).toContain('No commute passes Print Shop before the deadline.');
    expect(status).toContain('View delivery');
    expectClean(html);
  });

  it('locked (409 or phase locked): the planning-cycle message in an alert, submit disabled', () => {
    for (const html of [view({ kind: 'locked' }), view({ kind: 'idle' }, { phase: 'locked' })]) {
      expect(regionText(html, 'alert')).toContain(RESULT_COPY.locked);
      expect(html).toMatch(/<button type="submit"[^>]*disabled=""/);
      expectClean(html);
    }
    expect(renderToStaticMarkup(
      <NewDeliveryForm origin={ME} businesses={BUSINESSES} phase="locked" onSubmit={never} onOpenDelivery={noop} onCancel={noop} />,
    )).toContain(RESULT_COPY.locked);
  });

  it.each(['google_key_missing', 'travel_data_missing', 'google_unavailable'] as const)('unavailable (%s): nothing saved', (code) => {
    const html = view({ kind: 'unavailable', code });
    expect(regionText(html, 'alert')).toContain(RESULT_COPY.unavailable);
    expect(html).not.toContain(code);
    expect(html).not.toMatch(/<button type="submit"[^>]*disabled/);
    expectClean(html);
    // The same 503 on "Try matching again": the delivery is already saved, so the text must not say otherwise.
    const retried = view({ kind: 'unavailable', code, saved: true });
    expect(regionText(retried, 'alert')).toContain(RESULT_COPY.unavailableRetry);
    expect(retried).not.toContain('Nothing was saved');
  });

  it('error: the server message in an alert, field errors inline', () => {
    const html = view({ kind: 'error', message: 'Invalid shipment', fieldErrors: { deadlineTime: 'Too late' } },
      { errors: { deadlineTime: 'Too late' } });
    expect(regionText(html, 'alert')).toContain('Invalid shipment');
    expect(html).toMatch(/<p class="nd-error" id="[^"]+">Too late<\/p>/);
    expectClean(html);
  });
});
