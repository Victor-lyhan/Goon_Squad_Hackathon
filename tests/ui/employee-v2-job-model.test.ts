import { describe, expect, it } from 'vitest';
import {
  DISTANCE_UNAVAILABLE, NO_EXTRA_DISTANCE, TIME_UNAVAILABLE, extraDistanceText, extraTimeText, jobDetail, momentText,
  UNKNOWN_PLACE,
} from '../../client/src/components/employee/v2/jobDetailV2Model';
import { businesses, eveningDirect, morningDirect, relayLeg1, relayLeg2, STATUSES } from './employeeV2JobSample';

const rows = (m: ReturnType<typeof jobDetail>) => m.route.map((r) => [r.kind, r.time, r.place, r.action]);

describe('jobDetail (v2 model)', () => {
  it('evening direct: workplace start, pickup, delivery, home by neighborhood', () => {
    const m = jobDetail(eveningDirect(), businesses, 'Astoria');
    expect(m.title).toBe('Brand proofs');
    expect(m.legKind).toBe('Direct delivery');
    expect(m.trip).toBe('Evening commute, leaves Day 1, 5:15 PM');
    expect(m.statusLabel).toBe('Assigned');
    expect(rows(m)).toEqual([
      ['start', 'Day 1, 5:15 PM', 'Ink Studio', 'Leave work'],
      ['pickup', 'Day 1, 5:15 PM', 'Ink Studio', 'Collect the package'],
      ['delivery', 'Day 1, 5:44 PM', 'Midtown Agency', 'Hand over the package'],
      ['end', 'Day 1, 6:01 PM', 'Home · Astoria', 'Arrive home'],
    ]);
    expect(m.route[1].address).toBe('55 Water St, Brooklyn');
    expect(m.route[3].address).toBe('');
    expect(m.relay).toBeNull();
    expect(m.watchHref).toBe('/simulator?package=shp-0001&play=1');
    expect(m.numbers).toEqual([
      { key: 'reward', label: 'Reward', value: '$4.50' },
      { key: 'extra-time', label: 'Extra time', value: '+8 min' },
      { key: 'extra-distance', label: 'Extra distance', value: '+3.4 km' },
      { key: 'usual-commute', label: 'Usual commute', value: '38 min' },
    ]);
  });

  it('morning direct: home start by neighborhood, workplace end with finish time', () => {
    const m = jobDetail(morningDirect(), businesses, 'Park Slope');
    expect(m.trip).toBe('Morning commute, leaves Day 2, 8:30 AM');
    expect(rows(m)).toEqual([
      ['start', 'Day 2, 8:30 AM', 'Home · Park Slope', 'Leave home'],
      ['pickup', 'Day 2, 8:48 AM', 'Ink Studio', 'Collect the package'],
      ['delivery', 'Day 2, 9:18 AM', 'Midtown Agency', 'Hand over the package'],
      ['end', 'Day 2, 9:20 AM', 'Midtown Agency', 'Arrive at work'],
    ]);
    expect(m.numbers[2].value).toBe('+1.3 km');
  });

  it('relay leg 1: drop at the relay point, sentence names the relay business', () => {
    const m = jobDetail(relayLeg1(), businesses, 'Astoria');
    expect(m.legKind).toBe('Relay leg 1 of 2: drop at the relay point');
    expect(rows(m).map((r) => r[3])).toEqual([
      'Leave work', 'Collect the package', 'Leave it at the relay point for the morning carrier', 'Arrive home',
    ]);
    expect(m.route[2].place).toBe('River Cafe Roasters');
    expect(m.relay).toBe('You leave the package at River Cafe Roasters, which keeps it overnight; another carrier collects it there on their morning commute and delivers it to Midtown Agency.');
  });

  it('relay leg 2: collect from the relay point, then hand over', () => {
    const m = jobDetail(relayLeg2(), businesses, 'Park Slope');
    expect(m.legKind).toBe('Relay leg 2 of 2: collect from the relay point');
    expect(rows(m)).toEqual([
      ['start', 'Day 2, 8:30 AM', 'Home · Park Slope', 'Leave home'],
      ['hub_pickup', 'Day 2, 8:45 AM', 'River Cafe Roasters', 'Collect it from the relay point'],
      ['delivery', 'Day 2, 9:28 AM', 'Midtown Agency', 'Hand over the package'],
      ['end', 'Day 2, 9:30 AM', 'Midtown Agency', 'Arrive at work'],
    ]);
    expect(m.relay).toBe('Another carrier brought the package from LIC Bakery to River Cafe Roasters on their evening commute; you collect it there and deliver it.');
    expect(m.numbers.map((n) => n.value)).toEqual(['$4.80', '+7 min', '+2.3 km', '50 min']);
  });

  it('instructions: pickup on the sender row, drop-off on the recipient row, none at the relay point', () => {
    const d = jobDetail(eveningDirect(), businesses, 'Astoria').route;
    expect(d.map((r) => r.instructions)).toEqual(['', 'Ask for Maya at reception', 'Leave with the front desk', '']);
    const r1 = jobDetail(relayLeg1(), businesses, 'Astoria').route;
    expect(r1.map((r) => r.instructions)).toEqual(['', 'Box is behind the counter', '', '']);
    const r2 = jobDetail(relayLeg2(), businesses, 'Astoria').route;
    expect(r2.map((r) => r.instructions)).toEqual(['', '', 'Hand to the office manager', '']);
  });

  it.each(STATUSES)('status %s: label and done marks come only from job.status', (status) => {
    for (const make of [eveningDirect, morningDirect, relayLeg1, relayLeg2]) {
      const m = jobDetail(make(status), businesses, 'Astoria');
      expect(m.status).toBe(status);
      expect(m.statusLabel).toBe({ assigned: 'Assigned', in_progress: 'In progress', completed: 'Completed' }[status]);
      expect(m.statusNote).not.toBe('');
      const done = m.route.map((r) => r.done);
      expect(done).toEqual({
        assigned: [false, false, false, false],
        in_progress: [true, true, false, false],
        completed: [true, true, true, true],
      }[status]);
      expect(m.route).toHaveLength(4);
    }
  });

  it('an unresolved placeId reads "Unknown place", never the raw ID', () => {
    const job = relayLeg1();
    job.plan.legs[0].stops[1] = { ...job.plan.legs[0].stops[1], placeId: 'biz-gone' };
    job.plan.relayBusinessId = 'biz-gone';
    job.trip.originPlaceId = 'biz-also-gone';
    const m = jobDetail(job, businesses, 'Astoria');
    expect(m.route[0].place).toBe(UNKNOWN_PLACE);
    expect(m.route[2].place).toBe(UNKNOWN_PLACE);
    expect(m.relay).toContain(`at ${UNKNOWN_PLACE},`);
    expect(JSON.stringify(m)).not.toMatch(/biz-|home-/);
  });

  it('a home without a neighborhood reads just "Home"', () => {
    const m = jobDetail(eveningDirect(), businesses, '');
    expect(m.route[3].place).toBe('Home');
  });

  it('a moment of the delivery is "Day N, h:mm AM/PM" (#583); a value that is no number is not a made-up time', () => {
    expect(momentText(1035)).toBe('Day 1, 5:15 PM');
    expect(momentText(1925)).toBe('Day 2, 8:05 AM');
    expect(momentText(720)).toBe('Day 1, 12:00 PM');
    expect(momentText(1440)).toBe('Day 2, 12:00 AM');
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, undefined, null]) expect(momentText(bad)).toBe(TIME_UNAVAILABLE);
    // A leg without a finish time falls back to the end of its last stop; with neither, the row says so.
    const job = eveningDirect();
    delete (job.plan.legs[0] as { finishMin?: number }).finishMin;
    expect(jobDetail(job, businesses, 'Astoria').route[3].time).toBe('Day 1, 5:46 PM');
    job.plan.legs[0].finishMin = Number.NaN;
    expect(jobDetail(job, businesses, 'Astoria').route[3].time).toBe(TIME_UNAVAILABLE);
  });

  it('extra distance in plain words (#551): longer, shorter, none, unavailable', () => {
    expect(extraDistanceText(3400)).toBe('+3.4 km');
    expect(extraDistanceText(12000)).toBe('+12 km');
    expect(extraDistanceText(-5496)).toBe('5.5 km shorter');
    expect(extraDistanceText(-2000)).toBe('2 km shorter');
    expect(extraDistanceText(0)).toBe(NO_EXTRA_DISTANCE);
    expect(extraDistanceText(-0)).toBe(NO_EXTRA_DISTANCE);
    // Rounds to 0.0 km either way: not "+0 km" nor "0 km shorter".
    expect(extraDistanceText(16)).toBe(NO_EXTRA_DISTANCE);
    expect(extraDistanceText(-16)).toBe(NO_EXTRA_DISTANCE);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined, null]) {
      expect(extraDistanceText(bad)).toBe(DISTANCE_UNAVAILABLE);
    }
  });

  it('extra time keeps the API minutes and never shows "+-"', () => {
    expect(extraTimeText(8)).toBe('+8 min');
    expect(extraTimeText(0)).toBe('+0 min');
    expect(extraTimeText(-3)).toBe('3 min shorter');
    expect(extraTimeText(Number.NaN)).toBe('Time unavailable');
  });

  it('a shorter detour in the job: reward first, then time, then "shorter" distance', () => {
    const job = eveningDirect();
    job.plan.legs[job.job.legIndex].extraDistanceM = -5496;
    const m = jobDetail(job, businesses, 'Astoria');
    expect(m.numbers.map((n) => n.label)).toEqual(['Reward', 'Extra time', 'Extra distance', 'Usual commute']);
    expect(m.numbers[2].value).toBe('5.5 km shorter');
    job.plan.legs[job.job.legIndex].extraDistanceM = 0;
    expect(jobDetail(job, businesses, 'Astoria').numbers[2].value).toBe(NO_EXTRA_DISTANCE);
    job.plan.legs[job.job.legIndex].extraDistanceM = Number.NaN;
    expect(jobDetail(job, businesses, 'Astoria').numbers[2].value).toBe(DISTANCE_UNAVAILABLE);
  });
});
