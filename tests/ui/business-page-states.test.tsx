import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { businessDashboard } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';
import { BusinessNotFound } from '../../client/src/components/business/BusinessNotFound';
import { SummaryCards } from '../../client/src/components/business/SummaryCards';
import {
  RECONNECTING_TEXT, bizReducer, bizView, createPollGuard, friendlyError, initialBizState, isReconnecting, runDidChange, statusOf,
  type BizState,
} from '../../client/src/components/business/businessDashboardState';
import { lookupShipment } from '../../client/src/components/business/trackingModel';
import { newMatchedNotifications } from '../../client/src/components/business/businessPortalModel';

const run = createInitialRun(loadDefaultScenario());
const { businesses, settings } = run.scenario;
const snap = snapshotAt(run, settings.simStartMin);
const d1 = businessDashboard(run, snap, businesses[0].id)!;
const d2 = { ...d1, version: d1.version + 1 };
const fail = (status: number) => ({ type: 'failure' as const, message: 'boom', status });
const ok = (dashboard = d1, runId = 'run-1') => ({ type: 'success' as const, dashboard, runId });

describe('bizReducer', () => {
  it('first load is loading, not reconnecting', () => {
    expect(bizView(initialBizState)).toBe('loading');
    expect(isReconnecting(initialBizState)).toBe(false);
  });
  it('success -> network error -> recovery keeps data and toggles Reconnecting', () => {
    let s: BizState = bizReducer(initialBizState, ok());
    expect(bizView(s)).toBe('ready');
    s = bizReducer(s, fail(0));
    expect(s.dashboard).toBe(d1);
    expect(bizView(s)).toBe('ready');
    expect(isReconnecting(s)).toBe(true);
    s = bizReducer(s, ok(d2));
    expect(s.dashboard).toBe(d2);
    expect(isReconnecting(s)).toBe(false);
  });
  it('network error with no data is a friendly error with no raw text', () => {
    const s = bizReducer(initialBizState, fail(0));
    expect(bizView(s)).toBe('error');
    expect(isReconnecting(s)).toBe(false);
    expect(friendlyError(s)).toMatch(/connection/i);
    expect(friendlyError(s)).not.toMatch(/NaN|undefined/);
  });
  it('a 404 drops the data and shows not-found, never Reconnecting', () => {
    const s = bizReducer(bizReducer(initialBizState, ok()), fail(404));
    expect(s.dashboard).toBeNull();
    expect(bizView(s)).toBe('not_found');
    expect(isReconnecting(s)).toBe(false);
  });
  it('a run change drops stale data; reset returns to loading', () => {
    let s = bizReducer(bizReducer(initialBizState, ok()), { type: 'runChanged', runId: 'run-2' });
    expect(s.dashboard).toBeNull();
    expect(s.runId).toBe('run-2');
    expect(bizView(s)).toBe('loading');
    s = bizReducer(s, { type: 'reset' });
    expect(s).toEqual(initialBizState);
  });
  it('statusOf treats a missing status as a network error', () => {
    expect(statusOf(new Error('x'))).toBe(0);
    expect(statusOf({ status: 503 })).toBe(503);
  });
});

describe('run change effects', () => {
  it('runDidChange ignores the first sighting', () => {
    expect(runDidChange(null, 'a')).toBe(false);
    expect(runDidChange('a', 'a')).toBe(false);
    expect(runDidChange('a', 'b')).toBe(true);
  });
  it('an open shipment missing from the new run is "missing" (drawer closes); the baseline reset flags nothing', () => {
    const any = [...d1.outgoing, ...d1.incoming][0];
    expect(lookupShipment(any.shipment.id, d1).kind).toBe('found');
    expect(lookupShipment(any.shipment.id, { outgoing: [], incoming: [] }).kind).toBe('missing');
    expect(newMatchedNotifications(null, d1.notifications)).toEqual([]);
  });
});

describe('poll guard', () => {
  it('does not start a second poll while one is in flight', async () => {
    const g = createPollGuard();
    let release!: () => void;
    let started = 0;
    const first = g.run(() => { started++; return new Promise<void>((r) => { release = r; }); });
    expect(g.busy).toBe(true);
    expect(await g.run(async () => { started++; })).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(g.busy).toBe(false);
    expect(await g.run(async () => { started++; })).toBe(true);
    expect(started).toBe(2);
  });
  it('frees the guard when a poll throws', async () => {
    const g = createPollGuard();
    await expect(g.run(async () => { throw new Error('x'); })).rejects.toThrow();
    expect(g.busy).toBe(false);
  });
});

describe('rendered states with Demo-city data', () => {
  it('reconnecting note sits over real data with no NaN/undefined', () => {
    const s = bizReducer(bizReducer(initialBizState, ok()), fail(0));
    const html = renderToStaticMarkup(
      <div>{isReconnecting(s) && <p role="status">{RECONNECTING_TEXT}</p>}<SummaryCards totals={s.dashboard!.totals} /></div>,
    );
    expect(html).toContain(RECONNECTING_TEXT);
    expect(html).not.toMatch(/NaN|undefined/);
  });
  it('404 state renders the not-found page with no NaN/undefined', () => {
    const html = renderToStaticMarkup(<MemoryRouter><BusinessNotFound businesses={businesses} /></MemoryRouter>);
    expect(html).toContain(`href="/business/${businesses[0].id}"`);
    expect(html).not.toMatch(/NaN|undefined/);
  });
});
