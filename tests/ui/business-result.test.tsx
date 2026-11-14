import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/relayFixture.json';
import type { ShipmentResponse } from '../../shared/api';
import type { Business, DeliveryPlan, Employee, Hub, Leg, Shipment, Stop } from '../../shared/types';
import { MatchResultCard } from '../../client/src/components/business/MatchResultCard';
import { ShipmentForm } from '../../client/src/components/ShipmentForm';

const businesses = fixture.businesses as Business[];
const hubs = fixture.hubs as Hub[];
const employees: Employee[] = [
  { id: 'emp-1', name: 'Ana Evening', businessId: 'biz-a' },
  { id: 'emp-2', name: 'Ben Morning', businessId: 'biz-b' },
].map((e) => ({
  ...e, homeNodeId: 'X', eveningDepartureMin: 1020, morningDepartureMin: 1935, maxExtraMin: 8,
  availableEvening: true, availableMorning: true, eveningViaNodeIds: [], morningViaNodeIds: [],
}));

const shipment: Shipment = {
  id: 'shp-1', clientRequestId: 'c1', label: 'Contracts', originBusinessId: 'biz-a', destinationBusinessId: 'biz-b',
  readyMin: fixture.shipment.readyMin, deadlineMin: fixture.shipment.deadlineMin, category: 'envelope',
  description: 'Docs', weightGrams: 300, pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
};

const legs: Leg[] = fixture.expected.legs.map((l, i) => ({
  tripId: l.tripId, employeeId: i === 0 ? 'emp-1' : 'emp-2', routeNodeIds: [],
  stops: l.stops.map((s) => ({ arrivalMin: s.serviceStartMin, ...s }) as unknown as Stop),
  finishMin: l.finishMin, extraMin: l.extraMin, extraDistanceM: l.extraDistanceM, rewardCents: l.rewardCents,
}));
const relayPlan: DeliveryPlan = {
  id: 'plan-shp-1', shipmentId: 'shp-1', kind: 'relay', legs, hubId: 'hub-h',
  deliveryMin: fixture.expected.deliveryMin, customerPriceCents: 1000, platformContributionCents: 300,
};
const directPlan: DeliveryPlan = { ...relayPlan, kind: 'direct', hubId: undefined, legs: [legs[0]!], deliveryMin: 1100 };

const base = { jobIds: [], status: 'scheduled' as const, deliveredAtMin: null, unmatchedReason: null };
const noop = () => {};
const render = (response: ShipmentResponse) => renderToStaticMarkup(
  <MemoryRouter><MatchResultCard response={response} businesses={businesses} hubs={hubs} employees={employees}
    onViewTracking={noop} onEdit={noop} onRetry={noop} /></MemoryRouter>,
);

describe('MatchResultCard', () => {
  it('renders a matched direct delivery without a hub', () => {
    const html = render({ ...base, shipment, plan: directPlan, matched: true });
    expect(html).toContain('Delivery arranged');
    expect(html).toContain('shp-1');
    expect(html).toContain('Business B');
    expect(html).toContain('Ana Evening');
    expect(html).toContain('$10.00');
    expect(html).toContain('Estimated arrival');
    expect(html).toContain('Requested deadline');
    expect(html).not.toContain('Hub H');
    expect(html.replace(/<[^>]*>/g, ' ')).not.toContain('emp-1');
  });

  it('renders a matched relay with the hub and both carriers', () => {
    const html = render({ ...base, shipment, plan: relayPlan, matched: true });
    expect(html).toContain('Delivery arranged');
    expect(html).toContain('Hub H');
    expect(html).toContain('Ana Evening');
    expect(html).toContain('Ben Morning');
    expect(html).toContain('Day 2, 8:41 AM'); // deliveryMin 1961 shown as the estimate
    expect(html).toContain('Day 2, 9:00 AM'); // requested deadline 1980
  });

  it('renders an unmatched request with the backend reason and actions', () => {
    const html = render({ ...base, shipment, plan: null, matched: false, status: 'unmatched', unmatchedReason: 'No relay fits within 5 min detour' });
    expect(html).toContain('No matching commute yet');
    expect(html).toContain('No relay fits within 5 min detour');
    expect(html).toContain('Edit request');
    expect(html).toContain('Try again');
    expect(html).not.toContain('Delivery arranged');
  });
});

describe('ShipmentForm', () => {
  const props = { origin: businesses[0]!, businesses, locked: false, submitting: false, onSubmit: noop };
  it('lists only other businesses and shows the submit label and price', () => {
    const html = renderToStaticMarkup(<ShipmentForm {...props} />);
    expect(html).toContain('Find a delivery match');
    expect(html).toContain('Business B · Test');
    expect(html).not.toContain('>Business A · Test');
    expect(html).toContain('$10.00');
  });
  it('shows the matching state and disables while submitting', () => {
    const html = renderToStaticMarkup(<ShipmentForm {...props} submitting />);
    expect(html).toContain('Matching your package…');
    expect(html).toMatch(/<button[^>]*disabled/);
  });
  it('renders server field errors inline', () => {
    const html = renderToStaticMarkup(<ShipmentForm {...props} fieldErrors={{ weightKg: 'Max 2 kg' }} />);
    expect(html).toContain('Max 2 kg');
  });
});
