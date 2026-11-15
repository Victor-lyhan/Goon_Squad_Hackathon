// @vitest-environment jsdom
// The New delivery form's match result and its retry rule in a real DOM with a fake API (#582, DECISIONS pass 60).
// - Matched: the "Delivery arranged" card shows the ID, Direct or Relay, the ETA, the price, each carrier with its
//   leg and the relay business, all formatted from the answer; "View delivery" and "Watch in simulator".
// - Unmatched: while the draft is unchanged the button is "Try matching again" and calls matchShipment for the
//   same delivery; it never posts a second createShipment. A changed field is a new request.
// The browser computes no ETA or price, so every expectation here is a value of the fake answer.
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ShipmentResponse } from '../../shared/v2/api';
import type { CreateShipmentRequest } from '../../shared/v2/schemas';
import type { DeliveryPlan } from '../../shared/v2/types';
import { ApiRequestError } from '../../client/src/api/v2';
import { deliveryDetails } from '../../client/src/components/business/v2/deliveryDetailsModel';
import { NewDeliveryForm, NewDeliveryServicesContext } from '../../client/src/components/business/v2/NewDeliveryForm';
import { RESULT_COPY, arrangedCard } from '../../client/src/components/business/v2/newDeliveryModel';
import { BusinessPageView } from '../../client/src/components/business/v2/page/BusinessPageView';
import { formatCents, formatMin } from '../../client/src/ui/format';
import { ACME, ATLAS, BAKERY, BUSINESSES, EMPLOYEES, directPlan, relayPlan, view } from './business-v2-details-sample';
import { ready } from './business-v2-page-sample';
import { button, buttons, byLabel, click, deferred, flush, link, mount, select, textOf, typeInto } from './kitDom';

const T = 10_000;
const REASON = 'No employee commute passes Bakery Row before the deadline.';
const [MAYA, LUIS] = EMPLOYEES;
const LOOKUPS = { businesses: BUSINESSES, employees: EMPLOYEES, viewerBusinessId: ACME.id };

const matched = (plan: DeliveryPlan, id: string): ShipmentResponse => ({
  ...view({ ...plan, id: `plan-${id}`, shipmentId: id }, 'scheduled', {}, { id, label: 'Lab samples' }),
  matched: true,
});
const unmatched = (id: string, reason = REASON): ShipmentResponse => ({
  ...view(null, 'unmatched', { unmatchedReason: reason }, { id, label: 'Lab samples' }),
  matched: false,
});

type Api = {
  createShipment?: (req: CreateShipmentRequest) => Promise<ShipmentResponse>;
  matchShipment?: (id: string) => Promise<ShipmentResponse>;
};

/** The form with a fake API: createShipment and matchShipment are spies that answer what the test says. */
function setup(api: Api = {}) {
  const createShipment = vi.fn(api.createShipment ?? (async () => unmatched('shp-42')));
  const matchShipment = vi.fn(api.matchShipment ?? (async (id: string) => unmatched(id)));
  const onOpenDelivery = vi.fn();
  const m = mount(
    <NewDeliveryForm origin={ACME} businesses={BUSINESSES} employees={EMPLOYEES} phase="planning"
      onSubmit={createShipment} onMatch={matchShipment} onOpenDelivery={onOpenDelivery} onCancel={() => {}} />,
  );
  const c = m.container;
  return {
    ...m, createShipment, matchShipment, onOpenDelivery,
    field: (label: string) => byLabel(c, label),
    primary: () => c.querySelector<HTMLButtonElement>('button[type="submit"]')!,
    status: () => textOf(c.querySelector('.nd-result')!),
    alert: () => textOf(c.querySelector('[role="alert"]')!),
    fill: () => {
      select(byLabel(c, 'Recipient'), 'Bakery Row · Williamsburg');
      typeInto(byLabel(c, 'Package name'), 'Lab samples');
      typeInto(byLabel(c, 'Contents'), 'Two sealed vials');
    },
  };
}

/** Nothing a user must not see: a missing value, an ID where a name belongs, raw minutes or cents of the plan. */
function expectNoRawValues(el: Element, plan: DeliveryPlan) {
  const attrs = [...el.querySelectorAll('*')].flatMap((e) => [...e.attributes].map((a) => a.value));
  for (const s of [textOf(el), ...attrs]) {
    expect(s).not.toMatch(/undefined|NaN|\bnull\b/);
    expect(s).not.toMatch(/\b(biz|emp|home|plan)-[a-z0-9]/i);
  }
  const raw = [plan.deliveryMin, plan.customerPriceCents, ...plan.legs.flatMap((l) => l.stops.map((s) => s.serviceStartMin))];
  for (const n of raw) expect(textOf(el)).not.toMatch(new RegExp(`\\b${n}\\b`));
}

describe('arrangedCard (the model of the result card)', () => {
  it('a relay answer: Relay, the ETA, the price, the relay business and both carriers with their stops', () => {
    const answer = matched(relayPlan, 'shp-41');
    const card = arrangedCard(answer, LOOKUPS);
    expect(card.shipmentId).toBe('shp-41');
    expect(card.facts).toEqual([
      { label: 'Plan', value: 'Relay', mono: false },
      { label: 'ETA', value: formatMin(relayPlan.deliveryMin), mono: true },
      { label: 'Price', value: formatCents(relayPlan.customerPriceCents), mono: true },
      { label: 'Relay point', value: ATLAS.name, mono: false },
    ]);
    expect(card.facts[1].value).toBe('Day 2, 9:05 AM');
    expect(card.facts[2].value).toBe('$16.00');
    expect(card.carriers.map((c) => [c.name, c.tripText])).toEqual([
      [MAYA.name, 'Evening commute, Day 1'], [LUIS.name, 'Morning commute, Day 2'],
    ]);
    expect(card.carriers.map((c) => c.stops.map((s) => `${s.timeText} ${s.actionLabel} ${s.placeText}`))).toEqual([
      ['Day 1, 5:30 PM Pick up Acme Studio', 'Day 1, 6:10 PM Drop off Relay point: Atlas Books'],
      ['Day 2, 8:10 AM Collect Relay point: Atlas Books', 'Day 2, 9:05 AM Deliver Bakery Row'],
    ]);
    // The same link and the same rows as the delivery details of this answer.
    const details = deliveryDetails(answer, LOOKUPS);
    expect(card.simulatorHref).toBe(details.journeyHref);
    expect(card.carriers.map((c) => c.stops)).toEqual(details.legs.map((l) => l.stops));
  });

  it('a direct answer: Direct, one carrier, no relay point', () => {
    const card = arrangedCard(matched(directPlan, 'shp-41'), LOOKUPS);
    expect(card.facts.map((f) => [f.label, f.value])).toEqual([
      ['Plan', 'Direct'], ['ETA', 'Day 1, 6:30 PM'], ['Price', '$12.50'],
    ]);
    expect(card.carriers.map((c) => c.name)).toEqual([MAYA.name]);
  });

  it('never shows an ID in place of a name: an unknown carrier or place gets a word', () => {
    const card = arrangedCard(matched(relayPlan, 'shp-41'), { businesses: [ACME], employees: [], viewerBusinessId: ACME.id });
    expect(card.carriers.map((c) => c.name)).toEqual(['Carrier', 'Carrier']);
    expect(card.facts.find((f) => f.label === 'Relay point')?.value).toBe('Unknown place');
    const shown = [
      ...card.facts.flatMap((f) => [f.label, f.value]),
      ...card.carriers.flatMap((c) => [c.name, c.tripText, ...c.stops.flatMap((s) => [s.timeText, s.actionLabel, s.placeText])]),
    ];
    expect(shown.join(' | ')).not.toMatch(/\b(biz|emp)-|undefined/);
  });

  it('an answer without a plan has no facts and no carriers (the card keeps the ID and both actions)', () => {
    const noPlan: ShipmentResponse = { ...unmatched('shp-41'), matched: true };
    const card = arrangedCard(noPlan, LOOKUPS);
    expect(card).toEqual({ shipmentId: 'shp-41', facts: [], carriers: [], simulatorHref: '/simulator?package=shp-41&play=1' });
  });
});

describe('the Delivery arranged card in a real DOM', () => {
  it('a relay answer shows both carrier names, the relay business name, the ETA and the price', async () => {
    const f = setup({ createShipment: async () => matched(relayPlan, 'shp-41') });
    f.fill();
    click(f.primary());
    await flush();

    const card = f.container.querySelector('.nd-arranged')!;
    expect(card.closest('[role="status"]')).not.toBeNull(); // announced
    const text = textOf(card);
    expect(text).toContain('Delivery arranged');
    expect(text).toContain('shp-41');
    const facts = Object.fromEntries([...card.querySelectorAll('.nd-fact')].map((d) =>
      [textOf(d.querySelector('dt')!), textOf(d.querySelector('dd')!)]));
    expect(facts).toEqual({ Plan: 'Relay', ETA: 'Day 2, 9:05 AM', Price: '$16.00', 'Relay point': ATLAS.name });
    const carriers = [...card.querySelectorAll('.nd-carrier')].map((li) => textOf(li));
    expect(carriers).toHaveLength(2);
    expect(carriers[0]).toContain(MAYA.name);
    expect(carriers[0]).toContain('Evening commute, Day 1');
    expect(carriers[0]).toContain(`Day 1, 5:30 PM · Pick up ${ACME.name}`);
    expect(carriers[0]).toContain(`Day 1, 6:10 PM · Drop off Relay point: ${ATLAS.name}`);
    expect(carriers[1]).toContain(LUIS.name);
    expect(carriers[1]).toContain('Morning commute, Day 2');
    expect(carriers[1]).toContain(`Day 2, 9:05 AM · Deliver ${BAKERY.name}`);
    expectNoRawValues(card, relayPlan);
    expect(f.alert()).toBe('');
  }, T);

  it('two actions: View delivery opens the ID, Watch in simulator is the delivery details\' journey link', async () => {
    const answer = matched(relayPlan, 'shp-41');
    const f = setup({ createShipment: async () => answer });
    f.fill();
    click(f.primary());
    await flush();

    const card = f.container.querySelector('.nd-arranged')!;
    expect([...card.querySelectorAll('button, a')].map((e) => textOf(e))).toEqual(['View delivery', 'Watch in simulator']);
    click(button(card, 'View delivery'));
    expect(f.onOpenDelivery).toHaveBeenCalledWith('shp-41');
    const href = link(card, 'Watch in simulator').getAttribute('href');
    expect(href).toBe(deliveryDetails(answer, LOOKUPS).journeyHref);
    expect(href).toBe('/simulator?package=shp-41&play=1');
  }, T);

  it('a direct answer reads Direct with one carrier and no relay point', async () => {
    const f = setup({ createShipment: async () => matched(directPlan, 'shp-41') });
    f.fill();
    click(f.primary());
    await flush();

    const card = f.container.querySelector('.nd-arranged')!;
    expect([...card.querySelectorAll('.nd-fact')].map((d) => textOf(d))).toEqual(['PlanDirect', 'ETADay 1, 6:30 PM', 'Price$12.50']);
    expect(card.querySelectorAll('.nd-carrier')).toHaveLength(1);
    expect(textOf(card)).toContain(MAYA.name);
    expect(textOf(card)).not.toContain('Relay');
    expectNoRawValues(card, directPlan);
    // The button is for the next package again.
    expect(textOf(f.primary())).toBe('Find a delivery match');
  }, T);

  it('the delivery window reads like the shipments table, not as a 24-hour clock', () => {
    const f = setup();
    expect(textOf(f.container)).toContain('Simulation window: Day 1, 3:30 PM to Day 2, 12:00 PM.');
    expect(textOf(f.container)).not.toContain('15:30');
    typeInto(f.field('Ready for pickup (Day 1)'), '09:00');
    f.fill();
    click(f.primary());
    expect(textOf(f.container)).toContain('Ready time must be between Day 1, 3:30 PM and Day 1, 11:59 PM');
    expect(f.createShipment).not.toHaveBeenCalled();
  }, T);
});

describe('retry after "No matching commute yet"', () => {
  it('two clicks after a no-match give one createShipment call and one matchShipment call', async () => {
    const f = setup();
    f.fill();
    expect(textOf(f.primary())).toBe('Find a delivery match');
    click(f.primary());
    await flush();

    // The server reason is shown as before, the typed values stay.
    expect(f.status()).toContain(RESULT_COPY.unmatched);
    expect(f.status()).toContain(REASON);
    expect(f.status()).toContain('shp-42');
    expect((f.field('Package name') as HTMLInputElement).value).toBe('Lab samples');
    expect(textOf(f.primary())).toBe('Try matching again');
    expect(f.primary().disabled).toBe(false);

    click(f.primary());
    await flush();
    expect(f.createShipment).toHaveBeenCalledTimes(1);
    expect(f.matchShipment).toHaveBeenCalledTimes(1);
    expect(f.matchShipment).toHaveBeenCalledWith('shp-42');
    // Still nothing: the same delivery, the same button, and further clicks stay retries.
    expect(f.status()).toContain(REASON);
    expect(textOf(f.primary())).toBe('Try matching again');
    click(f.primary());
    await flush();
    expect(f.createShipment).toHaveBeenCalledTimes(1);
    expect(f.matchShipment).toHaveBeenCalledTimes(2);
  }, T);

  it('a match after "Try matching again" shows the arranged result', async () => {
    const f = setup({ matchShipment: async (id) => matched(relayPlan, id) });
    f.fill();
    click(f.primary());
    await flush();
    click(button(f.container, 'Try matching again'));
    await flush();

    expect(f.createShipment).toHaveBeenCalledTimes(1);
    expect(f.matchShipment).toHaveBeenCalledTimes(1);
    const card = f.container.querySelector('.nd-arranged')!;
    expect(textOf(card)).toContain('Delivery arranged');
    expect(textOf(card)).toContain('shp-42'); // the delivery of the first request, not a new one
    expect(textOf(card)).toContain(MAYA.name);
    expect(textOf(card)).toContain(LUIS.name);
    expect(textOf(card)).toContain(ATLAS.name);
    expect(textOf(card)).toContain('Day 2, 9:05 AM');
    expect(textOf(card)).toContain('$16.00');
    expect(f.status()).not.toContain(RESULT_COPY.unmatched);
    // Like every match: a fresh package for the same recipient, and the button sends a new request.
    expect((f.field('Package name') as HTMLInputElement).value).toBe('');
    expect(textOf(f.primary())).toBe('Find a delivery match');
    click(button(card, 'View delivery'));
    expect(f.onOpenDelivery).toHaveBeenCalledWith('shp-42');
  }, T);

  it('while the retry runs the button is disabled and says so; two fast clicks send one call', async () => {
    const answer = deferred<ShipmentResponse>();
    const f = setup({ matchShipment: () => answer.promise });
    f.fill();
    click(f.primary());
    await flush();
    const retry = f.primary();
    act(() => { retry.click(); retry.click(); });
    expect(f.matchShipment).toHaveBeenCalledTimes(1);
    expect(f.primary().disabled).toBe(true);
    expect(textOf(f.primary())).toBe('Matching…');
    expect(f.status()).toContain('Finding a delivery match again');
    click(f.primary());
    answer.resolve(unmatched('shp-42', 'Still no commute.'));
    await flush();
    expect(f.matchShipment).toHaveBeenCalledTimes(1);
    expect(f.createShipment).toHaveBeenCalledTimes(1);
    expect(f.status()).toContain('Still no commute.');
    expect(textOf(f.primary())).toBe('Try matching again');
  }, T);

  it('once a field changes the button is "Find a delivery match" again and sends a new request', async () => {
    let n = 41;
    const f = setup({ createShipment: async () => unmatched(`shp-${n += 1}`) });
    f.fill();
    click(f.primary());
    await flush();
    expect(textOf(f.primary())).toBe('Try matching again');

    typeInto(f.field('Package name'), 'Lab samples, second box');
    expect(textOf(f.primary())).toBe('Find a delivery match');
    expect(buttons(f.container, 'Try matching again')).toHaveLength(0);
    // The old values again are the old request again.
    typeInto(f.field('Package name'), 'Lab samples');
    expect(textOf(f.primary())).toBe('Try matching again');

    typeInto(f.field('Deliver by: time'), '11:30');
    expect(textOf(f.primary())).toBe('Find a delivery match');
    click(f.primary());
    await flush();
    expect(f.matchShipment).not.toHaveBeenCalled();
    expect(f.createShipment).toHaveBeenCalledTimes(2);
    const [first, second] = f.createShipment.mock.calls.map((c) => c[0]);
    expect(second.clientRequestId).not.toBe(first.clientRequestId);
    expect(second.deadlineMin).not.toBe(first.deadlineMin);
    // The new request found nothing either: now the retry is for the new delivery.
    expect(f.status()).toContain('shp-43');
    click(button(f.container, 'Try matching again'));
    await flush();
    expect(f.matchShipment).toHaveBeenCalledTimes(1);
    expect(f.matchShipment).toHaveBeenCalledWith('shp-43');
    expect(f.createShipment).toHaveBeenCalledTimes(2);
  }, T);

  it('a failed retry shows the error and the next click is still a retry, not a second delivery', async () => {
    let calls = 0;
    const f = setup({
      matchShipment: async (id) => {
        calls += 1;
        if (calls === 1) throw new ApiRequestError(500, 'Internal server error');
        return matched(directPlan, id);
      },
    });
    f.fill();
    click(f.primary());
    await flush();
    click(f.primary());
    await flush();
    expect(f.alert()).toContain('Internal server error');
    expect(textOf(f.primary())).toBe('Try matching again');
    expect(f.primary().disabled).toBe(false);

    click(f.primary());
    await flush();
    expect(f.createShipment).toHaveBeenCalledTimes(1);
    expect(f.matchShipment).toHaveBeenCalledTimes(2);
    expect(f.alert()).toBe('');
    expect(f.status()).toContain('Delivery arranged');
  }, T);

  it('a 503 on the retry does not say "Nothing was saved"', async () => {
    const f = setup({
      matchShipment: async () => { throw new ApiRequestError(503, 'Travel data missing', undefined, 'http', 'travel_data_missing'); },
    });
    f.fill();
    click(f.primary());
    await flush();
    click(f.primary());
    await flush();
    expect(f.alert()).toBe(RESULT_COPY.unavailableRetry);
    expect(f.alert()).not.toContain('Nothing was saved');
    expect(textOf(f.primary())).toBe('Try matching again');
  }, T);

  it('a 404 on the retry (the delivery left with its run) lets the next click send a new request', async () => {
    const f = setup({ matchShipment: async () => { throw new ApiRequestError(404, 'Shipment not found'); } });
    f.fill();
    click(f.primary());
    await flush();
    click(f.primary());
    await flush();
    expect(f.alert()).toContain('Shipment not found');
    expect(textOf(f.primary())).toBe('Find a delivery match');
    click(f.primary());
    await flush();
    expect(f.createShipment).toHaveBeenCalledTimes(2);
    expect(f.createShipment.mock.calls[1][0].clientRequestId).not.toBe(f.createShipment.mock.calls[0][0].clientRequestId);
  }, T);
});

describe('the form inside the Business page', () => {
  // pages/v2/BusinessV2.tsx provides the workspace's employee directory and matchShipment through
  // NewDeliveryServicesContext; the page component itself passes neither.
  it('gets the carrier names and the re-match call from the services the route page provides', async () => {
    const state = ready();
    const createShipment = vi.fn(async (_req: CreateShipmentRequest) => unmatched('shp-51'));
    const matchShipment = vi.fn(async (id: string) => matched(relayPlan, id));
    const pageMatch = vi.fn(async (): Promise<ShipmentResponse> => { throw new Error('the page\'s own retry is not used by the form'); });
    const m = mount(
      <NewDeliveryServicesContext.Provider value={{ employees: state.employees, matchShipment }}>
        <BusinessPageView
          state={state} shipmentId={null} createShipment={createShipment} matchShipment={pageMatch}
          refetchNow={async () => {}} dismissRunChanged={() => {}} onOpenShipment={() => {}} onCloseShipment={() => {}}
          businessHref={(id) => `/business/${id}`}
        />
      </NewDeliveryServicesContext.Provider>,
    );
    click(button(m.container, 'New delivery'));
    click(button(m.container, 'Fill in the form instead')); // New delivery opens on the request text box (#786)
    const form = () => m.container.querySelector('form.nd')!;
    select(byLabel(form(), 'Recipient'), 'Bakery Row · Williamsburg');
    typeInto(byLabel(form(), 'Package name'), 'Lab samples');
    typeInto(byLabel(form(), 'Contents'), 'Two sealed vials');
    click(button(form(), 'Find a delivery match'));
    await flush();
    click(button(form(), 'Try matching again'));
    await flush();

    expect(createShipment).toHaveBeenCalledTimes(1);
    expect(matchShipment).toHaveBeenCalledTimes(1);
    expect(matchShipment).toHaveBeenCalledWith('shp-51');
    const card = textOf(form().querySelector('.nd-arranged')!);
    for (const part of [MAYA.name, LUIS.name, ATLAS.name, 'Day 2, 9:05 AM', '$16.00', 'shp-51']) expect(card).toContain(part);
  }, T);
});
