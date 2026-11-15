import { describe, expect, it } from 'vitest';
import type { ShipmentProgress } from '../../shared/v2/types';
import {
  deliveryDetails, detailSteps, requestActions, tripText, LOCKED_NOTE,
} from '../../client/src/components/business/v2/deliveryDetailsModel';
import {
  ACME, ATLAS, BAKERY, BUSINESSES, EMPLOYEES, UNMATCHED_REASON, directPlan, relayPlan, unmatchedView, view,
} from './business-v2-details-sample';

const asSender = { businesses: BUSINESSES, employees: EMPLOYEES, viewerBusinessId: ACME.id };
const asRecipient = { ...asSender, viewerBusinessId: BAKERY.id };
const states = (v: Parameters<typeof detailSteps>[0]) => detailSteps(v).map((s) => `${s.label}:${s.state}`);

describe('deliveryDetails: direct plan', () => {
  const m = deliveryDetails(view(directPlan, 'scheduled'), asSender);

  it('builds the header for the sender', () => {
    expect(m.header).toEqual({
      label: 'Sample boxes', shipmentId: 'shp-7', direction: 'outgoing', directionLabel: 'Outgoing',
      sender: { name: 'Acme Studio', neighborhood: 'Chelsea' },
      recipient: { name: 'Bakery Row', neighborhood: 'Williamsburg' },
    });
  });

  it('shows Delivery arranged, Direct, the ETA and the price', () => {
    expect(m.result).toEqual({
      kind: 'matched', title: 'Delivery arranged', planKind: 'direct', planText: 'Direct', relayPointName: null,
      timeLabel: 'ETA', timeText: 'Day 1, 6:30 PM', priceText: '$12.50',
    });
  });

  it('has the direct steps without a relay step', () => {
    expect(states(view(directPlan, 'scheduled'))).toEqual([
      'Scheduled:current', 'Picked up:upcoming', 'Out for delivery:upcoming', 'Delivered:upcoming',
    ]);
  });

  it('lists one leg with carrier, trip, stops and extra minutes', () => {
    expect(m.legs).toEqual([{
      key: 'emp-1-eve-0', carrierName: 'Maya Chen', carrierHref: '/employee/emp-1?job=plan-shp-7-L0',
      tripText: 'Evening commute, Day 1', extraText: '+9 min',
      stops: [
        { key: '0-0', timeText: 'Day 1, 5:30 PM', actionLabel: 'Pick up', placeText: 'Acme Studio', isRelay: false },
        { key: '0-1', timeText: 'Day 1, 6:30 PM', actionLabel: 'Deliver', placeText: 'Bakery Row', isRelay: false },
      ],
    }]);
  });

  it('links to the journey and formats the package facts', () => {
    expect(m.journeyHref).toBe('/simulator?package=shp-7&play=1');
    expect(m.journeyLabel).toBe('View journey');
    expect(m.facts).toEqual({
      category: 'Small box', weight: '1.5 kg', description: 'Fabric swatches',
      pickupInstructions: 'Front desk', dropoffInstructions: null,
      ready: 'Day 1, 5:00 PM', deadline: 'Day 2, 10:00 AM',
    });
  });
});

describe('deliveryDetails: relay plan', () => {
  it('names the relay point in the result and the relay stops', () => {
    const m = deliveryDetails(view(relayPlan, 'at_hub'), asSender);
    expect(m.result).toMatchObject({ planKind: 'relay', planText: 'Relay via Atlas Books (relay point)', relayPointName: 'Atlas Books', priceText: '$16.00', timeText: 'Day 2, 9:05 AM' });
    expect(m.legs.map((l) => l.tripText)).toEqual(['Evening commute, Day 1', 'Morning commute, Day 2']);
    expect(m.legs[0].stops[1]).toMatchObject({ placeText: 'Relay point: Atlas Books', actionLabel: 'Drop off', isRelay: true });
    expect(m.legs[1].stops[0]).toMatchObject({ placeText: 'Relay point: Atlas Books', actionLabel: 'Collect', isRelay: true });
    expect(m.legs[1]).toMatchObject({ carrierName: 'Luis Ortega', carrierHref: '/employee/emp-2?job=plan-shp-7-L1', extraText: '+11 min' });
  });

  const expected: Record<Exclude<ShipmentProgress, 'unmatched'>, string[]> = {
    scheduled: ['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming'],
    picked_up: ['done', 'current', 'upcoming', 'upcoming', 'upcoming'],
    at_hub: ['done', 'done', 'current', 'upcoming', 'upcoming'],
    out_for_delivery: ['done', 'done', 'done', 'current', 'upcoming'],
    delivered: ['done', 'done', 'done', 'done', 'done'],
  };
  for (const [status, want] of Object.entries(expected)) {
    it(`step states at ${status}`, () => {
      const steps = detailSteps(view(relayPlan, status as ShipmentProgress));
      expect(steps.map((s) => s.label)).toEqual(['Scheduled', 'Picked up', 'At relay point', 'Out for delivery', 'Delivered']);
      expect(steps.map((s) => s.state)).toEqual(want);
    });
  }

  it('shows the delivered time from the API once delivered', () => {
    const m = deliveryDetails(view(relayPlan, 'delivered', { deliveredAtMin: 1990 }), asSender);
    expect(m.result).toMatchObject({ title: 'Delivery arranged', timeLabel: 'Delivered', timeText: 'Day 2, 9:10 AM' });
  });

  it('reads Unknown place for an unresolved placeId and relay business', () => {
    const plan = {
      ...relayPlan, relayBusinessId: 'biz-gone',
      legs: [{ ...relayPlan.legs[0], stops: [relayPlan.legs[0].stops[0], { ...relayPlan.legs[0].stops[1], placeId: 'biz-gone' }] }, relayPlan.legs[1]],
    };
    const m = deliveryDetails(view(plan, 'scheduled'), asSender);
    expect(m.result).toMatchObject({ planText: 'Relay via Unknown place (relay point)' });
    expect(m.legs[0].stops[1].placeText).toBe('Relay point: Unknown place');
    expect(JSON.stringify(m)).not.toContain('biz-gone');
  });
});

describe('deliveryDetails: unmatched and incoming', () => {
  it('shows No matching commute yet with the API reason and no steps or legs', () => {
    const m = deliveryDetails(unmatchedView(), asSender);
    expect(m.result).toEqual({ kind: 'unmatched', title: 'No matching commute yet', reason: UNMATCHED_REASON });
    expect(m.steps).toEqual([]);
    expect(m.legs).toEqual([]);
    expect(m.journeyHref).toBe('/simulator?package=shp-7&play=1');
  });

  it('is Incoming for the recipient and hides the price', () => {
    const m = deliveryDetails(view(directPlan, 'picked_up'), asRecipient);
    expect(m.header.direction).toBe('incoming');
    expect(m.header.directionLabel).toBe('Incoming');
    expect(m.result).toMatchObject({ kind: 'matched', priceText: null });
    expect(JSON.stringify(m)).not.toContain('$');
  });

  it('reads Unknown place for an unresolved sender', () => {
    const m = deliveryDetails(view(directPlan, 'scheduled', {}, { originBusinessId: 'biz-gone' }), asRecipient);
    expect(m.header.sender).toEqual({ name: 'Unknown place', neighborhood: null });
  });
});

describe('requestActions', () => {
  it('offers retry/edit only for an unmatched outgoing request in planning', () => {
    const unmatched = deliveryDetails(unmatchedView(), asSender);
    expect(requestActions(unmatched, 'planning')).toEqual({ show: true, lockedNote: null });
    expect(requestActions(unmatched, 'locked')).toEqual({ show: false, lockedNote: LOCKED_NOTE });
    // The way out is the simulator's "Back to start" (DECISIONS pass 74); the old control is gone (#700).
    expect(LOCKED_NOTE).toBe('Playback has started, so this request can’t be changed. Press Back to start in the simulator to reopen requests.');
    expect(LOCKED_NOTE).not.toMatch(/planning cycle/i);
    expect(requestActions(deliveryDetails(unmatchedView(), asRecipient), 'planning')).toEqual({ show: false, lockedNote: null });
    expect(requestActions(deliveryDetails(view(directPlan, 'scheduled'), asSender), 'planning')).toEqual({ show: false, lockedNote: null });
  });
});

describe('tripText', () => {
  it('falls back to the commute direction when there are no stops', () => {
    expect(tripText({ tripId: 'emp-1-morn', stops: [] })).toBe('Morning commute, Day 2');
    expect(tripText({ tripId: 'odd', stops: [] })).toBe('Commute');
  });
});

// #581: the relay business opens a package it neither sends nor receives.
describe('deliveryDetails: the viewer is the plan\'s relay point', () => {
  const asRelay = { ...asSender, viewerBusinessId: ATLAS.id };

  it('is labelled Relay point, shows both parties and carriers, and never the sender\'s price or actions', () => {
    const m = deliveryDetails(view(relayPlan, 'at_hub'), asRelay);
    expect(m.header).toMatchObject({
      direction: 'relay', directionLabel: 'Relay point',
      sender: { name: 'Acme Studio', neighborhood: 'Chelsea' },
      recipient: { name: 'Bakery Row', neighborhood: 'Williamsburg' },
    });
    expect(m.legs.map((l) => l.carrierName)).toEqual(['Maya Chen', 'Luis Ortega']);
    expect(m.result).toMatchObject({ kind: 'matched', planText: 'Relay via Atlas Books (relay point)', priceText: null });
    expect(requestActions(m, 'planning')).toEqual({ show: false, lockedNote: null });
  });

  it('only the plan\'s own relay point gets the label; sender and recipient keep theirs', () => {
    // A third business that is not the relay point of this plan (the page does not open it; the label stays as before).
    expect(deliveryDetails(view(directPlan, 'scheduled'), asRelay).header.directionLabel).toBe('Incoming');
    expect(deliveryDetails(view(null, 'unmatched'), asRelay).header.directionLabel).toBe('Incoming');
    expect(deliveryDetails(view(relayPlan, 'at_hub'), asSender).header.directionLabel).toBe('Outgoing');
    expect(deliveryDetails(view(relayPlan, 'at_hub'), asRecipient).header.directionLabel).toBe('Incoming');
    // A relay through the recipient's own ID never happens (R is neither A nor B), and would stay Incoming.
    const odd = view({ ...relayPlan, relayBusinessId: BAKERY.id }, 'at_hub');
    expect(deliveryDetails(odd, asRecipient).header.directionLabel).toBe('Incoming');
  });
});
