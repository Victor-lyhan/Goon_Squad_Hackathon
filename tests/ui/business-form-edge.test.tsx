import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShipmentForm } from '../../client/src/components/ShipmentForm';
import { ApiRequestError } from '../../client/src/api';
import {
  classifySubmitFailure, createRequestIdHolder, createSubmitGuard, defaultForm, parseWeightKg, toRequest, validate,
} from '../../client/src/components/business/shipmentFormModel';

const valid = () => ({
  ...defaultForm(), originBusinessId: 'biz-a', destinationBusinessId: 'biz-b', label: 'Contracts', description: 'Signed',
});
const w = (weightKg: string) => validate({ ...valid(), weightKg });

describe('weight rules', () => {
  it('rejects 0, -1, 2.01, empty, comma decimals and sub-gram weights with specific messages', () => {
    expect(w('0').weightKg).toMatch(/above 0 kg/);
    expect(w('-1').weightKg).toMatch(/above 0 kg/);
    expect(w('2.01').weightKg).toMatch(/Max 2 kg/);
    expect(w('').weightKg).toMatch(/Enter a weight/);
    expect(w('1,5').weightKg).toMatch(/dot/);
    expect(w('0.0004').weightKg).toMatch(/minimum is 0.001 kg/);
    expect(w('abc').weightKg).toMatch(/number/);
  });
  it('accepts 2 and 0.001 and rounds to grams', () => {
    expect(w('2')).toEqual({});
    expect(w('0.001')).toEqual({});
    expect(parseWeightKg('1.2345')).toEqual({ kg: 1.235, grams: 1235 });
    expect(toRequest({ ...valid(), weightKg: '0.0006' }, 'r').weightKg).toBe(0.001);
  });
});

describe('time rules', () => {
  it('defaults are Day 1 16:00 and Day 2 10:00 and valid', () => {
    expect(validate(valid())).toEqual({});
  });
  it('flags deadline before or equal to ready', () => {
    expect(validate({ ...valid(), deadlineDay: 1, deadlineTime: '16:00' }).deadlineMin).toMatch(/after/);
    expect(validate({ ...valid(), deadlineDay: 1, deadlineTime: '15:45' }).deadlineMin).toMatch(/after/);
  });
  it('flags times outside Day 1 15:30 - Day 2 12:00', () => {
    const e1 = validate({ ...valid(), readyTime: '15:29' });
    expect(e1.readyMin).toMatch(/between Day 1 15:30 and Day 2 12:00/);
    expect(validate({ ...valid(), readyTime: '15:30' }).readyMin).toBeUndefined();
    const e2 = validate({ ...valid(), deadlineTime: '12:01' });
    expect(e2.deadlineMin).toMatch(/between Day 1 15:30 and Day 2 12:00/);
    expect(validate({ ...valid(), deadlineTime: '12:00' })).toEqual({});
    expect(validate({ ...valid(), readyDay: 2, readyTime: '12:30', deadlineTime: '13:00' }).readyMin).toBeTruthy();
  });
  it('flags a cleared time input', () => {
    expect(validate({ ...valid(), readyTime: '' }).readyMin).toMatch(/valid day and time/);
  });
});

describe('retry keeps the same clientRequestId', () => {
  it('reuses the id until reset (success or Duplicate)', () => {
    const h = createRequestIdHolder(() => 'biz-a');
    const a = h.current();
    expect(h.current()).toBe(a);
    h.reset();
    expect(h.current()).not.toBe(a);
  });
  it('classifies failures', () => {
    expect(classifySubmitFailure(new ApiRequestError(0, 'Failed to fetch')).kind).toBe('retry');
    expect(classifySubmitFailure(new ApiRequestError(503, 'x')).kind).toBe('retry');
    expect(classifySubmitFailure(new ApiRequestError(409, 'x')).kind).toBe('locked');
    const f = classifySubmitFailure(new ApiRequestError(400, 'Invalid', { weightKg: 'Max 2 kg' }));
    expect(f).toMatchObject({ kind: 'fields', fieldErrors: { weightKg: 'Max 2 kg' } });
    expect(classifySubmitFailure(new ApiRequestError(404, 'Nope')).kind).toBe('other');
  });
  it('a second call while pending sends nothing', async () => {
    const guard = createSubmitGuard();
    let calls = 0;
    let release!: () => void;
    const p1 = guard(() => { calls += 1; return new Promise<void>((r) => { release = r; }); });
    expect(await guard(async () => { calls += 1; })).toBeUndefined();
    release();
    await p1;
    expect(calls).toBe(1);
  });
});

const biz = (id: string, nodeId: string) => ({ id, name: id, district: 'D', nodeId } as never);
const render = (props: Record<string, unknown>) => renderToStaticMarkup(
  <MemoryRouter>
    <ShipmentForm origin={biz('biz-a', 'n1')} businesses={[biz('biz-a', 'n1'), biz('biz-b', 'n2')]}
      locked={false} submitting={false} onSubmit={() => {}} {...props} />
  </MemoryRouter>,
);

describe('form rendering', () => {
  it('shows the pending button disabled', () => {
    const html = render({ submitting: true });
    expect(html).toContain('Matching your package…');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Matching your package/);
  });
  it('shows the retry message and keeps the form enabled', () => {
    const html = render({ formError: { kind: 'retry', message: "We couldn't reach the server." } });
    expect(html).toContain("couldn&#x27;t reach the server");
    expect(html).toContain('Find a delivery match');
  });
  it('shows the 409 text with a /simulator link', () => {
    const html = render({ formError: { kind: 'locked', message: 'x' }, locked: true });
    expect(html).toContain('new requests are closed until the next planning cycle');
    expect(html).toContain('href="/simulator"');
  });
  it('maps 400 field errors inline and surfaces unknown keys', () => {
    const html = render({ fieldErrors: { weightKg: 'Max 2 kg', body: 'Bad body' } });
    expect(html).toContain('Max 2 kg');
    expect(html).toContain('Bad body');
  });
});
