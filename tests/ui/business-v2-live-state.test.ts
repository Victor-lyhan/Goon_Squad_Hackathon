// Reducer tests for the MVP II Business workspace data layer (#386).
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../client/src/api/v2';
import type { BusinessDashboard } from '../../shared/v2/api';
import {
  RUN_CHANGED_NOTE, TRAVEL_DATA_MISSING_TEXT, businessWorkspaceReducer as reduce, initialBusinessWorkspaceState as init,
  toDirectoryEmployees, type BusinessWorkspaceState,
} from '../../client/src/components/business/v2/live/businessWorkspaceState';
import { BUSINESSES, DASHBOARD, ME, plan, relayOut, shipment, view } from './business-v2-table-sample';

const dash = (version: number, over: Partial<BusinessDashboard> = {}): BusinessDashboard =>
  ({ ...DASHBOARD, ...over, version });
const ready = (version = 3, runId: string | null = 'run-1'): BusinessWorkspaceState =>
  reduce(init, { type: 'dashboard', dashboard: dash(version), runId });
const travel = (code: string, msg: string) => new ApiRequestError(503, msg, undefined, 'http', code);
const network = () => new ApiRequestError(0, 'Failed to fetch', undefined, 'network');

describe('business v2 workspace reducer', () => {
  it('first load: loading → ready with the dashboard', () => {
    expect(init.view).toBe('loading');
    const s = ready();
    expect(s.view).toBe('ready');
    expect(s.dashboard?.business.id).toBe(ME.id);
    expect(s.runId).toBe('run-1');
    expect(s.runChanged).toBe(false);
    expect(s.reconnecting).toBe(false);
  });

  it('an equal poll (same version, new object) returns the same state object', () => {
    const s = ready(3);
    const again = reduce(s, { type: 'dashboard', dashboard: structuredClone(dash(3)), runId: 'run-1' });
    expect(again).toBe(s);
    // Unknown run (map check failed) on the same version also keeps identity.
    expect(reduce(s, { type: 'dashboard', dashboard: dash(3), runId: null })).toBe(s);
  });

  it('a newer version replaces the dashboard', () => {
    const s = ready(3);
    const d4 = dash(4, { outgoing: [] });
    const next = reduce(s, { type: 'dashboard', dashboard: d4, runId: 'run-1' });
    expect(next).not.toBe(s);
    expect(next.dashboard).toBe(d4);
    expect(next.runChanged).toBe(false);
  });

  it('404 → not_found with the fallback business, keeping the directories', () => {
    const withDirs = reduce(ready(), { type: 'directories', businesses: BUSINESSES, employees: [] });
    const s = reduce(withDirs, { type: 'notFound', fallbackBusinessId: BUSINESSES[0]!.id });
    expect(s.view).toBe('not_found');
    expect(s.dashboard).toBeNull();
    expect(s.fallbackBusinessId).toBe(BUSINESSES[0]!.id);
    expect(s.businesses).toBe(BUSINESSES);
    expect(reduce(s, { type: 'notFound', fallbackBusinessId: BUSINESSES[0]!.id })).toBe(s);
    // A bare 404 error is friendly too: it links to the first known business.
    const bare = reduce(withDirs, { type: 'dashboardFailed', error: new ApiRequestError(404, 'Unknown business') });
    expect(bare.view).toBe('not_found');
    expect(bare.fallbackBusinessId).toBe(BUSINESSES[0]!.id);
  });

  it('not_found without a link target gets one when the directory arrives', () => {
    const s = reduce(init, { type: 'notFound', fallbackBusinessId: null });
    const next = reduce(s, { type: 'directories', businesses: BUSINESSES, employees: [] });
    expect(next.fallbackBusinessId).toBe(BUSINESSES[0]!.id);
  });

  it('503 travel_data_missing shows the fixed copy', () => {
    const s = reduce(init, { type: 'dashboardFailed', error: travel('travel_data_missing', 'matrix.json missing') });
    expect(s.view).toBe('unavailable');
    expect(s.unavailable).toEqual({ code: 'travel_data_missing', message: TRAVEL_DATA_MISSING_TEXT });
    expect(TRAVEL_DATA_MISSING_TEXT).toBe('NYC travel data is not loaded on this server yet.');
    // Same 503 again: same object.
    expect(reduce(s, { type: 'dashboardFailed', error: travel('travel_data_missing', 'matrix.json missing') })).toBe(s);
  });

  it.each(['google_key_missing', 'google_unavailable'] as const)('503 %s shows the server text', (code) => {
    const s = reduce(init, { type: 'dashboardFailed', error: travel(code, `Server says ${code}`) });
    expect(s.view).toBe('unavailable');
    expect(s.unavailable).toEqual({ code, message: `Server says ${code}` });
  });

  it('a 503 without a TravelUnavailable code is a plain error', () => {
    const s = reduce(init, { type: 'dashboardFailed', error: new ApiRequestError(503, 'Busy') });
    expect(s.view).toBe('error');
    expect(s.unavailable).toBeNull();
  });

  it('recovers from unavailable on the next good poll', () => {
    const u = reduce(init, { type: 'dashboardFailed', error: travel('travel_data_missing', 'x') });
    const s = reduce(u, { type: 'dashboard', dashboard: dash(1), runId: 'run-1' });
    expect(s.view).toBe('ready');
    expect(s.unavailable).toBeNull();
    expect(s.runChanged).toBe(false);
  });

  it('a 503 after the first success keeps the data and reconnects', () => {
    const r = ready();
    const s = reduce(r, { type: 'dashboardFailed', error: travel('google_unavailable', 'Google down') });
    expect(s.view).toBe('ready');
    expect(s.dashboard).toBe(r.dashboard);
    expect(s.reconnecting).toBe(true);
    expect(s.unavailable?.code).toBe('google_unavailable');
  });

  it('a network error before the first success → error view', () => {
    const s = reduce(init, { type: 'dashboardFailed', error: network() });
    expect(s.view).toBe('error');
    expect(s.error).toBe('Failed to fetch');
    expect(reduce(s, { type: 'dashboardFailed', error: network() })).toBe(s);
  });

  it('a network error after the first success keeps the data, sets reconnecting, then recovers', () => {
    const r = ready(3);
    const s = reduce(r, { type: 'dashboardFailed', error: network() });
    expect(s.view).toBe('ready');
    expect(s.dashboard).toBe(r.dashboard);
    expect(s.reconnecting).toBe(true);
    expect(reduce(s, { type: 'dashboardFailed', error: network() })).toBe(s);
    const back = reduce(s, { type: 'dashboard', dashboard: dash(3), runId: 'run-1' });
    expect(back.reconnecting).toBe(false);
    expect(back.dashboard).toBe(r.dashboard); // same version: the table keeps its object
  });

  it('aborts are never failures', () => {
    const r = ready();
    expect(reduce(r, { type: 'dashboardFailed', error: new ApiRequestError(0, 'aborted', undefined, 'abort') })).toBe(r);
  });

  it('a run change (new map run ID) sets runChanged once and replaces the dashboard', () => {
    const r = ready(3, 'run-1');
    const d = dash(9);
    const s = reduce(r, { type: 'dashboard', dashboard: d, runId: 'run-2' });
    expect(s.runChanged).toBe(true);
    expect(s.runId).toBe('run-2');
    expect(s.dashboard).toBe(d);
    const again = reduce(s, { type: 'dashboard', dashboard: dash(9), runId: 'run-2' });
    expect(again).toBe(s);
    const dismissed = reduce(again, { type: 'dismissRunChanged' });
    expect(dismissed.runChanged).toBe(false);
    expect(reduce(dismissed, { type: 'dashboard', dashboard: dash(9), runId: 'run-2' })).toBe(dismissed);
    expect(RUN_CHANGED_NOTE).toMatch(/city changed/);
  });

  it('a version going down (reset / import) counts as a run change even without a run ID', () => {
    const r = ready(7, null);
    const s = reduce(r, { type: 'dashboard', dashboard: dash(2), runId: null });
    expect(s.runChanged).toBe(true);
    expect(s.dashboard?.version).toBe(2);
  });

  it('the first run ID sighting is not a change', () => {
    const r = ready(3, null);
    const s = reduce(r, { type: 'dashboard', dashboard: dash(3), runId: 'run-1' });
    expect(s.runChanged).toBe(false);
    expect(s.runId).toBe('run-1');
  });

  // #581: the open delivery the dashboard does not list (read with GET /shipments/:id).
  describe('held delivery', () => {
    const v = view(
      shipment('shp-9', { originBusinessId: 'biz-print', destinationBusinessId: 'biz-cafe' }),
      plan('shp-9', { kind: 'relay', relayBusinessId: ME.id }), 'at_hub',
    );

    it('starts empty, stores the answer and keeps identity on an equal one', () => {
      expect(init.held).toBeNull();
      const s = reduce(ready(), { type: 'held', shipmentId: 'shp-9', view: v });
      expect(s.held).toEqual({ shipmentId: 'shp-9', view: v, status: 'ready' });
      expect(reduce(s, { type: 'held', shipmentId: 'shp-9', view: JSON.parse(JSON.stringify(v)) })).toBe(s);
      const moved = reduce(s, { type: 'held', shipmentId: 'shp-9', view: { ...v, status: 'out_for_delivery' } });
      expect(moved).not.toBe(s);
      expect(moved.held?.view?.status).toBe('out_for_delivery');
      // The dashboard and the rest of the state are untouched.
      expect(moved.dashboard).toBe(s.dashboard);
    });

    it('404 → missing; a failure before any answer → failed; a failed refresh keeps what is shown', () => {
      const missing = reduce(ready(), { type: 'heldMissing', shipmentId: 'shp-404' });
      expect(missing.held).toEqual({ shipmentId: 'shp-404', view: null, status: 'missing' });
      expect(reduce(missing, { type: 'heldMissing', shipmentId: 'shp-404' })).toBe(missing);
      expect(reduce(missing, { type: 'heldFailed', shipmentId: 'shp-404' })).toBe(missing);

      const failed = reduce(missing, { type: 'heldFailed', shipmentId: 'shp-9' });
      expect(failed.held).toEqual({ shipmentId: 'shp-9', view: null, status: 'failed' });
      expect(reduce(failed, { type: 'heldFailed', shipmentId: 'shp-9' })).toBe(failed);
      const ok = reduce(failed, { type: 'held', shipmentId: 'shp-9', view: v });
      expect(reduce(ok, { type: 'heldFailed', shipmentId: 'shp-9' })).toBe(ok);
      // The package is gone from the server (re-matched away or a new city): the view goes too.
      expect(reduce(ok, { type: 'heldMissing', shipmentId: 'shp-9' }).held?.view).toBeNull();
    });

    it('another delivery replaces it', () => {
      const s = reduce(reduce(ready(), { type: 'held', shipmentId: 'shp-9', view: v }), { type: 'held', shipmentId: 'shp-2', view: relayOut });
      expect(s.held).toEqual({ shipmentId: 'shp-2', view: relayOut, status: 'ready' });
    });

    it('is dropped on a run change, a stale business and a reset; kept on an ordinary new version', () => {
      const s = reduce(ready(3), { type: 'held', shipmentId: 'shp-9', view: v });
      expect(reduce(s, { type: 'dashboard', dashboard: dash(4), runId: 'run-1' }).held).toBe(s.held);
      expect(reduce(s, { type: 'dashboardFailed', error: network() }).held).toBe(s.held);
      expect(reduce(s, { type: 'dashboard', dashboard: dash(4), runId: 'run-2' }).held).toBeNull();
      expect(reduce(s, { type: 'dashboard', dashboard: dash(1), runId: 'run-1' }).held).toBeNull();
      expect(reduce(s, { type: 'notFound', fallbackBusinessId: null }).held).toBeNull();
      expect(reduce(s, { type: 'reset' }).held).toBeNull();
    });
  });

  it('directories: stored, trimmed to id + name, equal ones keep identity', () => {
    const emps = toDirectoryEmployees([{
      id: 'emp-01', name: 'Ana', businessId: 'biz-a', homeId: 'home-1', eveningDepartureMin: 1050,
      morningDepartureMin: 1950, maxExtraMin: 8, availableEvening: true, availableMorning: true,
    }]);
    expect(emps).toEqual([{ id: 'emp-01', name: 'Ana' }]);
    const s = reduce(ready(), { type: 'directories', businesses: BUSINESSES, employees: emps });
    expect(s.businesses).toBe(BUSINESSES);
    expect(s.employees).toBe(emps);
    expect(reduce(s, { type: 'directories', businesses: [...BUSINESSES], employees: [...emps] })).toBe(s);
  });
});
