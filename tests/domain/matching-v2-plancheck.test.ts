import { expect, it } from 'vitest';
import { createRng } from '../../server/domain/v2/rng';
import { assignShipments } from '../../server/domain/v2/matching';
import { buildTrips } from '../../server/domain/v2/trips';
import { checkPlans, checkStory, formatCheckReport, type PlanCheckInput, type PlanIssueCode } from '../../server/domain/v2/planCheck';
import { pairKey, TravelDataMissingError } from '../../shared/v2/types';
import { business, context, employee, relayContext, shipment, TableTravel } from './matching-v2-helpers';
import { relayFixtureTravel } from './matching-v2-grid-helper';

function valid(relay = false): PlanCheckInput {
  const ctx = relay ? relayContext() : context([employee('emp-1', 'biz-a')],
    { 'biz-a': 0, 'biz-b': 5, 'home-emp-1': 10 });
  const shipments = [shipment()];
  return { ...ctx, shipments, plans: assignShipments(shipments, ctx).plans };
}

it.each([false, true])('accepts valid plans (relay=%s) without mutating inputs', relay => {
  const input = valid(relay);
  expect(input.plans).toHaveLength(1);
  const before = JSON.stringify(input);
  expect(checkPlans(input)).toEqual([]);
  expect(JSON.stringify(input)).toBe(before);
});

it('accepts morning direct, origin waiting and recipient handling', () => {
  const ctx = context([employee('emp-1', 'biz-b', { availableEvening: false, maxExtraMin: 20 })],
    { 'biz-a': 5, 'biz-b': 10, 'home-emp-1': 0 });
  const shipments = [shipment({ readyMin: 1943 })];
  const { plans } = assignShipments(shipments, ctx);
  expect(plans).toHaveLength(1);
  expect(plans[0].legs[0].stops[0].serviceStartMin).toBe(1943);
  expect(checkPlans({ ...ctx, shipments, plans })).toEqual([]);
});

const mutations: [PlanIssueCode, boolean, (input: PlanCheckInput) => void][] = [
  ['plan_id', false, i => { i.plans[0].id = 'wrong'; }],
  ['duplicate_shipment', false, i => { i.plans = [...i.plans, structuredClone(i.plans[0])]; }],
  ['duplicate_trip', false, i => { i.plans = [...i.plans, structuredClone(i.plans[0])]; }],
  ['missing_reference', false, i => { i.employees = []; }],
  ['leg_count', false, i => { i.plans[0].legs = []; }],
  ['stop_business', false, i => { i.plans[0].legs[0].stops[1].placeId = 'home-emp-1'; }],
  ['relay_business', true, i => { i.plans[0].relayBusinessId = 'biz-a'; }],
  ['route_shape', false, i => { i.plans[0].legs[0].placeIds = ['biz-a', 'home-emp-1', 'biz-b']; }],
  ['stop_shape', false, i => { i.plans[0].legs[0].stops[0].kind = 'delivery'; }],
  ['trip_employee', false, i => { i.trips[0].employeeId = 'other'; }],
  ['relay_employees', true, i => { i.plans[0].legs[1].employeeId = i.plans[0].legs[0].employeeId; }],
  ['relay_direction', true, i => { i.trips[0].direction = 'morning'; }],
  ['availability', false, i => { i.employees[0].availableEvening = false; }],
  ['stop_time', false, i => { i.plans[0].legs[0].stops[1].arrivalMin++; }],
  ['finish_time', false, i => { i.plans[0].legs[0].finishMin++; }],
  ['delivery_time', false, i => { i.plans[0].deliveryMin++; }],
  ['extra_time', false, i => { i.plans[0].legs[0].extraMin--; }],
  ['extra_limit', false, i => { i.employees[0].maxExtraMin = 3; }],
  ['pickup_ready', false, i => { i.plans[0].legs[0].stops[0].serviceStartMin = 959; }],
  ['delivery_deadline', false, i => { i.shipments[0].deadlineMin = 1020; }],
  ['relay_order', true, i => { i.plans[0].legs[1].stops[0].serviceStartMin = 1020; }],
];
it.each(mutations)('reports %s exactly once per broken plan', (code, relay, mutate) => {
  const input = valid(relay);
  mutate(input);
  const issues = checkPlans(input);
  expect(issues.filter(issue => issue.code === code)).toHaveLength(1);
  expect(issues.every(issue => issue.planId && issue.shipmentId && issue.message)).toBe(true);
});
it('reports only stop_time for an isolated incorrect arrival', () => {
  const input = valid();
  input.plans[0].legs[0].stops[1].arrivalMin++;
  expect(checkPlans(input).map(i => i.code)).toEqual(['stop_time']);
});
it('detects a forged extraMin above the limit', () => {
  const input = valid();
  input.plans[0].legs[0].extraMin = 100;
  expect(checkPlans(input).map(i => i.code)).toEqual(['extra_time', 'extra_limit']);
});
it('re-derives times from changed travel and propagates missing pairs', () => {
  const input = valid();
  (input.travel as TableTravel).pairs[pairKey('biz-a', 'biz-b')].durationMin++;
  expect(checkPlans(input).map(i => i.code)).toContain('stop_time');
  delete (input.travel as TableTravel).pairs[pairKey('biz-a', 'biz-b')];
  expect(() => checkPlans(input)).toThrow(TravelDataMissingError);
});
it('accepts the §9 fixture', () => {
  const travel = relayFixtureTravel();
  const employees = [employee('emp-1', 'biz-a', { homeId: 'home-x', availableMorning: false }),
    employee('emp-2', 'biz-b', { homeId: 'home-y', availableEvening: false })];
  const ctx = { travel, employees, trips: employees.flatMap(e => buildTrips(e, travel)),
    businesses: ['biz-a', 'biz-b', 'biz-h'].map(business), settings: valid().settings };
  const shipments = [shipment()];
  const { plans } = assignShipments(shipments, ctx);
  expect(plans[0].deliveryMin).toBe(1961);
  expect(checkPlans({ ...ctx, shipments, plans })).toEqual([]);
});

for (let seed = 0; seed < 24; seed++) {
  const rng = createRng(seed);
  const positions: Record<string, number> = { 'biz-a': 0, 'biz-b': 20, 'biz-r': 10 };
  const employees = Array.from({ length: 8 }, (_, i) => employee(`emp-${i}`, i % 2 ? 'biz-a' : 'biz-b', {
    maxExtraMin: rng.int(4, 20), eveningDepartureMin: rng.int(1000, 1050), morningDepartureMin: rng.int(1900, 1950),
  }));
  employees.forEach(e => { positions[e.homeId] = rng.int(0, 30); });
  const ctx = context(employees, positions);
  const shipments = Array.from({ length: 6 }, (_, i) => shipment({ id: `shp-${i}`, createdSeq: i,
    readyMin: rng.int(990, 1050), deadlineMin: rng.int(1950, 2000) }));
  it(`independently validates deterministic workload ${seed}`, () => {
    const { plans } = assignShipments(shipments, ctx);
    expect(plans.length).toBeGreaterThan(0);
    expect(checkPlans({ ...ctx, shipments, plans })).toEqual([]);
  }, 10_000);
}

it('reports story mismatches, any matched kind, and the exact unmatched reason', () => {
  const input = valid();
  const result = { plans: [...input.plans, ...valid(true).plans.map(p => ({ ...p, shipmentId: 'relay' }))],
    unmatched: [{ shipmentId: 'missing', reason: 'No suitable commute.' }] };
  const rows = checkStory([
    { shipmentId: 'shp-1', label: 'Coffee', expect: 'relay' },
    { shipmentId: 'shp-1', label: 'Coffee', expect: 'any' },
    { shipmentId: 'relay', label: 'Proofs', expect: 'any' },
    { shipmentId: 'missing', label: 'Gift', expect: 'any' },
  ], result);
  expect(rows.map(r => r.ok)).toEqual([false, true, true, false]);
  expect(rows[3]).toMatchObject({ actual: 'unmatched', reason: 'No suitable commute.' });
  expect(formatCheckReport([], rows, 24)).toEqual([
    '24 plans checked, 0 problems', 'FAIL shp-1 Coffee: expected relay, got direct',
    'OK shp-1 Coffee: expected any, got direct', 'OK relay Proofs: expected any, got relay',
    'FAIL missing Gift: expected any, got unmatched — No suitable commute.',
  ]);
  input.plans[0].id = 'wrong';
  expect(formatCheckReport(checkPlans(input), [])).toEqual([
    '1 problems', 'wrong (shp-1) [plan_id] Plan ID must be planIdFor(shipmentId).',
  ]);
  expect(checkStory([{ shipmentId: 'absent', label: 'Absent', expect: 'direct' }], result)[0])
    .toEqual({ shipmentId: 'absent', label: 'Absent', expect: 'direct', actual: 'unmatched', ok: false });
});

it.each(['arrivalMin', 'serviceStartMin', 'serviceEndMin'] as const)('checks every stored stop timing field: %s', field => {
  const input = valid();
  input.plans[0].legs[0].stops[0][field]++;
  expect(checkPlans(input).map(i => i.code)).toEqual(['stop_time']);
});

it('re-derives relay waiting from deposit completion rather than stored stop times', () => {
  const ctx = relayContext();
  ctx.trips[1].departureMin = 1025;
  const shipments = [shipment()];
  const { plans } = assignShipments(shipments, ctx);
  expect(plans[0].kind).toBe('relay');
  expect(plans[0].legs[1].stops[0].serviceStartMin).toBe(plans[0].legs[0].stops[1].serviceEndMin);
  expect(plans[0].legs[1].stops[0].arrivalMin).toBeLessThan(plans[0].legs[1].stops[0].serviceStartMin);
  expect(checkPlans({ ...ctx, shipments, plans })).toEqual([]);
});
