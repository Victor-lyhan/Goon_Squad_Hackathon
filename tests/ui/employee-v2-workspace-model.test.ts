import { describe, expect, it } from 'vitest';
import {
  UNKNOWN_PLACE, commuteSummary, deliveryRows, earnings, formatDistance,
} from '../../client/src/components/employee/v2/employeeWorkspaceModel';
import { businesses, completedView, dashboard, directView, noMorning, relayView } from './employee-v2-workspace-sample';

describe('commuteSummary', () => {
  const s = commuteSummary(dashboard, businesses);

  it('names the workplace with neighborhood and address, and the home by neighborhood only', () => {
    expect(s.workplaceName).toBe('Acme Studio');
    expect(s.workplaceNeighborhood).toBe('Flatiron');
    expect(s.workplaceAddress).toBe('12 W 21st St, New York, NY');
    expect(s.homeNeighborhood).toBe('Astoria');
    expect(JSON.stringify(s)).not.toMatch(/home-story|40\.76|-73\.92/);
  });

  it('formats both trips from the API values (evening first)', () => {
    expect(s.trips.map((t) => t.direction)).toEqual(['evening', 'morning']);
    expect(s.trips[0]).toMatchObject({
      label: 'Evening', from: 'Acme Studio', to: 'Astoria', available: true,
      departure: '5:30 PM', duration: '34 min', distance: '8.4 km', unavailableText: null,
    });
    expect(s.trips[1]).toMatchObject({
      label: 'Morning', from: 'Astoria', to: 'Acme Studio', available: true,
      departure: '8:30 AM', duration: '36 min', distance: '8.7 km',
    });
    expect(s.detourLimit).toBe('Up to 15 min extra per trip');
  });

  it('a missing morning trip reads "Not available in the morning"', () => {
    const m = commuteSummary(noMorning, businesses);
    expect(m.trips[0].available).toBe(true);
    expect(m.trips[1]).toMatchObject({
      available: false, departure: null, duration: null, distance: null,
      unavailableText: 'Not available in the morning',
    });
  });

  it('a missing evening trip reads "Not available in the evening"', () => {
    const m = commuteSummary({ ...dashboard, trips: [dashboard.trips[1]] }, businesses);
    expect(m.trips[0].unavailableText).toBe('Not available in the evening');
  });

  it('an unknown workplace reads "Unknown place"', () => {
    expect(commuteSummary(dashboard, []).workplaceName).toBe(UNKNOWN_PLACE);
  });

  it('formatDistance', () => {
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(8000)).toBe('8 km');
    expect(formatDistance(12345)).toBe('12.3 km');
  });
});

describe('deliveryRows', () => {
  const [direct, relay] = deliveryRows([directView, relayView], businesses, 'Astoria');

  it('a direct job row', () => {
    expect(direct).toMatchObject({
      jobId: 'plan-shp-001-L0', packageLabel: 'Fabric swatches', status: 'assigned', statusLabel: 'Assigned',
      pickup: 'Day 1, 5:30 PM · Acme Studio', dropoff: 'Day 1, 6:06 PM · Cafe Luna',
      pickupTime: 'Day 1, 5:30 PM', dropoffTime: 'Day 1, 6:06 PM',
      extraMin: '+7 min', reward: '$8.00', legKind: 'Direct', commute: 'Evening commute to Astoria',
      jobHref: '/employee/emp-001?job=plan-shp-001-L0', simulatorHref: '/simulator?package=shp-001',
    });
  });

  it('relay leg 2 picks up at the relay point and uses relay wording', () => {
    expect(relay).toMatchObject({
      pickup: 'Day 2, 8:40 AM · Relay point: Corner Books', dropoff: 'Day 2, 9:10 AM · Acme Studio',
      pickupTime: 'Day 2, 8:40 AM', dropoffTime: 'Day 2, 9:10 AM',
      extraMin: '+4 min', reward: '$7.00', legKind: 'Relay leg 2 of 2', commute: 'Morning commute from Astoria',
      jobHref: '/employee/emp-001?job=plan-shp-002-L1', simulatorHref: '/simulator?package=shp-002',
    });
  });

  it('relay leg 1 drops off at the relay point', () => {
    const l1 = relayView.plan.legs[0];
    const job = { ...relayView.job, id: 'plan-shp-002-L0', legIndex: 0, tripId: 'emp-001-eve', pickup: l1.stops[0], dropoff: l1.stops[1], rewardCents: 600 };
    const [row] = deliveryRows([{ ...relayView, job }], businesses, 'Astoria');
    expect(row.legKind).toBe('Relay leg 1 of 2');
    expect(row.dropoff).toBe('Day 1, 6:10 PM · Relay point: Corner Books');
    expect(row.extraMin).toBe('+5 min');
  });

  it('a completed job', () => {
    const [row] = deliveryRows([completedView], businesses, 'Astoria');
    expect(row.statusLabel).toBe('Completed');
    expect(row.reward).toBe('$5.00');
  });

  it('an unresolved placeId gives "Unknown place", never the raw ID', () => {
    const job = { ...directView.job, dropoff: { ...directView.job.dropoff, placeId: 'biz-gone' } };
    const [row] = deliveryRows([{ ...directView, job }], businesses, 'Astoria');
    expect(row.dropoff).toBe('Day 1, 6:06 PM · Unknown place');
    expect(JSON.stringify(row)).not.toContain('biz-gone');
  });

  it('never leaks raw place IDs or coordinates', () => {
    const text = JSON.stringify([direct, relay].map(({ jobHref, simulatorHref, jobId, ...rest }) => rest));
    expect(text).not.toMatch(/biz-|home-|NaN|undefined|40\.7|-73\.9/);
  });
});

describe('earnings', () => {
  it('formats earned and projected straight from the API', () => {
    expect(earnings(dashboard)).toEqual({ earned: '$5.00', projected: '$20.00' });
  });
});
