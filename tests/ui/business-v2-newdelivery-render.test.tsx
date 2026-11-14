import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NewDeliveryForm, NewDeliveryFormView } from '../../client/src/components/business/v2/NewDeliveryForm';
import {
  RESULT_COPY, emptyDraft, validate, type NewDeliveryDraft, type SubmitStatus, type FieldErrors,
} from '../../client/src/components/business/v2/newDeliveryModel';
import type { ShipmentResponse } from '../../shared/v2/api';
import { BUSINESSES, ME } from './business-v2-table-sample';

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
    expect(html).toContain('Day 1 15:30 to Day 2 12:00');
    expect(html).toMatch(/<button type="submit"[^>]*>Send request</);
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
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Sending…</);
    expect(html.match(/<fieldset[^>]*disabled=""/g)).toHaveLength(2);
    expect(regionText(html, 'status')).toContain('Sending request');
    expectLabelled(html);
    expectClean(html);
  });

  it('matched: "Delivery arranged." with View delivery in the status region', () => {
    const html = view({ kind: 'matched', shipmentId: 'shp-9' });
    const status = regionText(html, 'status');
    expect(status).toContain(RESULT_COPY.matched);
    expect(status).toMatch(/<button[^>]*>View delivery<\/button>/);
    expectClean(html);
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
  });

  it('error: the server message in an alert, field errors inline', () => {
    const html = view({ kind: 'error', message: 'Invalid shipment', fieldErrors: { deadlineTime: 'Too late' } },
      { errors: { deadlineTime: 'Too late' } });
    expect(regionText(html, 'alert')).toContain('Invalid shipment');
    expect(html).toMatch(/<p class="nd-error" id="[^"]+">Too late<\/p>/);
    expectClean(html);
  });
});
