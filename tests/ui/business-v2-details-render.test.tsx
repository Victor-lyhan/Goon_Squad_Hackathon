import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DeliveryDetails } from '../../client/src/components/business/v2/DeliveryDetails';
import { LOCKED_NOTE } from '../../client/src/components/business/v2/deliveryDetailsModel';
import {
  ACME, BAKERY, BUSINESSES, EMPLOYEES, UNMATCHED_REASON, directPlan, relayPlan, unmatchedView, view,
} from './business-v2-details-sample';

const noop = () => {};
type Props = Parameters<typeof DeliveryDetails>[0];

const render = (over: Partial<Props> & Pick<Props, 'view'>) => renderToStaticMarkup(
  <DeliveryDetails businesses={BUSINESSES} employees={EMPLOYEES} viewerBusinessId={ACME.id}
    phase="planning" onClose={noop} onRetryMatch={noop} onEdit={noop} {...over} />,
);

/** Visible text, without tags (class names like bd-step--current are ours, not data). */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ');

function expectClean(html: string) {
  expect(html).not.toMatch(/NaN|undefined/);
  expect(html).not.toMatch(/\b(biz|home)-[a-z0-9]/i);
  expect(html.toLowerCase()).not.toContain('hub');
}

describe('DeliveryDetails render', () => {
  it('matched direct: result card, steps, carrier link, journey link', () => {
    const html = render({ view: view(directPlan, 'picked_up') });
    expect(html).toMatch(/<section[^>]*aria-labelledby="bd-title-shp-7"/);
    expect(html).toMatch(/<h2 id="bd-title-shp-7"[^>]*tabindex="-1"[^>]*>Sample boxes<\/h2>/);
    const t = text(html);
    expect(t).toContain('Outgoing');
    expect(t).toContain('shp-7');
    expect(t).toContain('Delivery arranged');
    expect(t).toContain('Direct');
    expect(t).toContain('Day 1, 6:30 PM');
    expect(t).toContain('$12.50');
    expect(t).toContain('Chelsea');
    expect(t).toContain('Williamsburg');
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="step"[^>]*>.*?Picked up/);
    expect(html).toContain('href="/employee/emp-1?job=plan-shp-7-L0"');
    expect(html).toMatch(/href="\/simulator\?package=shp-7"[^>]*>View journey/);
    expect(t).toContain('Evening commute, Day 1');
    expect(html).toContain('<table');
    expect(t).not.toContain('Try matching again');
    expectClean(html);
  });

  it('matched relay overnight: At relay point is current, relay stops named', () => {
    const html = render({ view: view(relayPlan, 'at_hub') });
    const t = text(html);
    expect(t).toContain('Relay via Atlas Books (relay point)');
    expect(t).toContain('Relay point: Atlas Books');
    expect(t).toContain('Morning commute, Day 2');
    expect(html).toMatch(/aria-current="step"[^>]*>.*?At relay point/);
    expect(html).toContain('href="/employee/emp-2?job=plan-shp-7-L1"');
    expectClean(html);
  });

  it('delivered: shows the delivered time and no current step', () => {
    const html = render({ view: view(relayPlan, 'delivered', { deliveredAtMin: 1990 }) });
    expect(text(html)).toMatch(/Delivered\s+Day 2, 9:10 AM/);
    expect(html).not.toContain('aria-current');
    expectClean(html);
  });

  it('incoming: no price', () => {
    const html = render({ view: view(directPlan, 'scheduled'), viewerBusinessId: BAKERY.id });
    expect(text(html)).toContain('Incoming');
    expect(html).not.toContain('$');
    expectClean(html);
  });

  it('unmatched in planning: reason and both actions', () => {
    const html = render({ view: unmatchedView() });
    const t = text(html);
    expect(t).toContain('No matching commute yet');
    expect(t).toContain(UNMATCHED_REASON);
    expect(html).toMatch(/<button[^>]*>Try matching again<\/button>/);
    expect(html).toMatch(/<button[^>]*>Edit request<\/button>/);
    expect(t).not.toContain(LOCKED_NOTE);
    expect(html).not.toContain('<table');
    expectClean(html);
  });

  it('unmatched while busy: buttons disabled', () => {
    const html = render({ view: unmatchedView(), busy: true });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Matching…<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Edit request<\/button>/);
  });

  it('unmatched while locked: no actions, one line saying why', () => {
    const html = render({ view: unmatchedView(), phase: 'locked' });
    expect(html).not.toContain('Try matching again');
    expect(html).not.toContain('Edit request');
    expect(text(html)).toContain(LOCKED_NOTE);
    expectClean(html);
  });

  it('never shows a raw ID for an unresolved place', () => {
    const plan = { ...directPlan, legs: [{ ...directPlan.legs[0], stops: [{ ...directPlan.legs[0].stops[0], placeId: 'biz-gone' }, directPlan.legs[0].stops[1]] }] };
    const html = render({ view: view(plan, 'scheduled'), employees: [] });
    expect(text(html)).toContain('Unknown place');
    expect(text(html)).toContain('Carrier');
    expectClean(html);
  });
});
