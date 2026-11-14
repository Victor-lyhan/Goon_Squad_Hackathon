// @vitest-environment jsdom
// The MVP II Business page in a real DOM (#505): open New delivery, send it, see the server's answer,
// and close it again with focus back on the button that opened it.
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ShipmentResponse } from '../../shared/v2/api';
import type { CreateShipmentRequest } from '../../shared/v2/schemas';
import { RESULT_COPY } from '../../client/src/components/business/v2/newDeliveryModel';
import { BusinessPageView } from '../../client/src/components/business/v2/page/BusinessPageView';
import type { BusinessWorkspaceState } from '../../client/src/components/business/v2/live/businessWorkspaceState';
import { directPlan, view } from './business-v2-details-sample';
import { ACME, DASHBOARD, ready } from './business-v2-page-sample';
import { button, buttons, byLabel, click, flush, mount, press, select, textOf, typeInto } from './kitDom';

const T = 10_000;

const answer = (id: string): ShipmentResponse => ({
  ...view({ ...directPlan, id: `plan-${id}`, shipmentId: id }, 'scheduled', {}, { id, label: 'Lab samples' }),
  matched: true,
});

function setup(state: BusinessWorkspaceState = ready()) {
  const createShipment = vi.fn(async (_req: CreateShipmentRequest) => answer('shp-51'));
  const onOpenShipment = vi.fn();
  const el = (s: BusinessWorkspaceState) => (
    <BusinessPageView
      state={s} shipmentId={null}
      createShipment={createShipment}
      matchShipment={async () => { throw new Error('not called'); }}
      refetchNow={async () => {}} dismissRunChanged={() => {}}
      onOpenShipment={onOpenShipment} onCloseShipment={() => {}}
      businessHref={(id) => `/nyc/business/${id}`}
    />
  );
  const m = mount(el(state));
  const c = m.container;
  return {
    ...m, createShipment, onOpenShipment,
    poll: (s: BusinessWorkspaceState) => m.rerender(el(s)),
    form: () => c.querySelector('form.nd'),
    opener: () => button(c, 'New delivery'),
  };
}

describe('Business page New delivery in a real DOM', () => {
  it('opens the form from the page, submits it through createShipment and shows the result', async () => {
    const p = setup();
    expect(p.form()).toBeNull();
    click(p.opener());
    const form = p.form()!;
    expect(form).not.toBeNull();
    expect(textOf(form)).toContain(`From ${ACME.name}`);

    select(byLabel(form, 'Recipient'), 'Bakery Row · Williamsburg');
    typeInto(byLabel(form, 'Package name'), 'Lab samples');
    typeInto(byLabel(form, 'Contents'), 'Two sealed vials');
    // A poll lands mid-typing with a new (equal) dashboard: the typed text stays.
    p.poll(ready({ ...DASHBOARD, business: { ...ACME } }));
    expect((byLabel(p.form()!, 'Package name') as HTMLInputElement).value).toBe('Lab samples');

    click(button(p.form()!, 'Find a delivery match'));
    await flush();
    expect(p.createShipment).toHaveBeenCalledTimes(1);
    const req = p.createShipment.mock.calls[0][0];
    expect(req).toMatchObject({ originBusinessId: ACME.id, destinationBusinessId: 'biz-bakery', label: 'Lab samples' });
    const status = textOf(p.form()!.querySelector('[role="status"]')!);
    expect(status).toContain(RESULT_COPY.matched);
    expect(status).toContain('shp-51');

    click(button(p.form()!, 'View delivery'));
    expect(p.onOpenShipment).toHaveBeenCalledWith('shp-51');
  }, T);

  it('Cancel closes the form and returns focus to the button that opened it', () => {
    const p = setup();
    const opener = p.opener();
    click(opener);
    typeInto(byLabel(p.form()!, 'Package name'), 'Lab samples');
    click(button(p.form()!, 'Cancel'));
    expect(p.form()).toBeNull();
    expect(document.activeElement).toBe(opener);
  }, T);

  it('Esc closes the form and returns focus to the button that opened it', () => {
    const p = setup();
    const opener = p.opener();
    click(opener);
    typeInto(byLabel(p.form()!, 'Package name'), 'Lab samples');
    press('Escape');
    expect(p.form()).toBeNull();
    expect(document.activeElement).toBe(opener);
    // Esc with the form closed does nothing, and it opens again with a fresh draft.
    press('Escape');
    click(p.opener());
    expect((byLabel(p.form()!, 'Package name') as HTMLInputElement).value).toBe('');
  }, T);

  it('focus also comes back when the click did not focus the button (Safari)', () => {
    const p = setup();
    const opener = p.opener();
    act(() => { opener.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(document.body);
    click(button(p.form()!, 'Cancel'));
    expect(p.form()).toBeNull();
    expect(document.activeElement).toBe(opener);
  }, T);

  it('the empty table\'s New delivery button also gets focus back', () => {
    const p = setup(ready({ ...DASHBOARD, outgoing: [], incoming: [] }));
    const all = buttons(p.container, 'New delivery');
    expect(all.length).toBe(2);
    const fromTable = all[1];
    click(fromTable);
    press('Escape', byLabel(p.form()!, 'Recipient'));
    expect(p.form()).toBeNull();
    expect(document.activeElement).toBe(fromTable);
  }, T);
});
