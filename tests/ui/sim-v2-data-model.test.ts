import { describe, expect, it } from 'vitest';
import {
  CONNECTION_LOST_MESSAGE, INITIAL_SIM_DATA, TRAVEL_DATA_MISSING_MESSAGE, mapKey, simDataReducer,
  type SimDataAction, type SimDataState,
} from '../../client/src/components/sim/v2/live/simDataModel';
import { abortError, httpError, mapOf, networkError, simAt, travel503 } from './sim-v2-data-fixtures';

const run = (...actions: SimDataAction[]): SimDataState => actions.reduce(simDataReducer, INITIAL_SIM_DATA);
const ready = () => run({ type: 'sim', sim: simAt('run-a', 5) }, { type: 'map', map: mapOf('run-a') });

describe('mapKey', () => {
  it('is the runId plus the sorted plan IDs', () => {
    expect(mapKey(simAt('run-a', 1, ['p-2', 'p-1']))).toBe('run-a|p-1|p-2');
    expect(mapKey(simAt('run-a', 9, ['p-1', 'p-2']))).toBe(mapKey(simAt('run-a', 1, ['p-2', 'p-1'])));
    expect(mapKey(simAt('run-a', 1, ['p-1', 'p-2', 'p-3']))).not.toBe(mapKey(simAt('run-a', 1, ['p-1', 'p-2'])));
    expect(mapKey(simAt('run-b', 1, ['p-1']))).not.toBe(mapKey(simAt('run-a', 1, ['p-1'])));
  });
});

describe('simDataReducer: polls', () => {
  it('starts loading and becomes ready on the first load', () => {
    expect(INITIAL_SIM_DATA.view).toBe('loading');
    const s = run({ type: 'sim', sim: simAt('run-a', 1) });
    expect(s.view).toBe('ready');
    expect(s.sim?.version).toBe(1);
    expect(s.map).toBeNull();
    expect(s.reconnecting).toBe(false);
  });

  it('keeps the state object identical for an equal poll', () => {
    const s = ready();
    const again = simDataReducer(s, { type: 'sim', sim: simAt('run-a', 5) });
    expect(again).toBe(s);
  });

  it('takes a newer version and keeps the map of the same run', () => {
    const s = ready();
    const next = simDataReducer(s, { type: 'sim', sim: simAt('run-a', 6) });
    expect(next.sim?.version).toBe(6);
    expect(next.map).toBe(s.map);
  });

  it('ignores a stale version, so a slow poll never moves the clock back after a control action', () => {
    const afterControl = simDataReducer(ready(), { type: 'sim', sim: simAt('run-a', 8, ['plan-1'], 1500) });
    const slowPoll = simDataReducer(afterControl, { type: 'sim', sim: simAt('run-a', 7, ['plan-1'], 1200) });
    expect(slowPoll).toBe(afterControl);
    expect(slowPoll.sim?.clock.timeMin).toBe(1500);
  });

  it('clears the map on a new runId until the refetch lands', () => {
    const s = simDataReducer(ready(), { type: 'sim', sim: simAt('run-b', 1) });
    expect(s.sim?.runId).toBe('run-b');
    expect(s.map).toBeNull();
    // A late map of the old run is dropped; the new run's map is taken.
    expect(simDataReducer(s, { type: 'map', map: mapOf('run-a') })).toBe(s);
    expect(simDataReducer(s, { type: 'map', map: mapOf('run-b') }).map?.runId).toBe('run-b');
  });

  it('takes a new run even when its version is lower', () => {
    const s = simDataReducer(run({ type: 'sim', sim: simAt('run-a', 50) }), { type: 'sim', sim: simAt('run-b', 2) });
    expect(s.sim?.runId).toBe('run-b');
  });
});

describe('simDataReducer: 503 TravelUnavailable', () => {
  it('travel_data_missing shows the fetch:routes instruction', () => {
    const s = run({ type: 'pollFailed', error: travel503('travel_data_missing', 'Travel data missing') });
    expect(s.view).toBe('unavailable');
    expect(s.unavailable).toEqual({ code: 'travel_data_missing', message: TRAVEL_DATA_MISSING_MESSAGE });
    expect(TRAVEL_DATA_MISSING_MESSAGE).toBe(
      'NYC travel data is not loaded on this server yet. Run npm run fetch:routes and restart.');
  });

  it.each(['google_key_missing', 'google_unavailable'] as const)('%s shows the server text', (code) => {
    const s = run({ type: 'pollFailed', error: travel503(code, `Server says ${code}`) });
    expect(s.view).toBe('unavailable');
    expect(s.unavailable).toEqual({ code, message: `Server says ${code}` });
  });

  it('a repeated 503 keeps the state identical', () => {
    const s = run({ type: 'pollFailed', error: travel503('travel_data_missing', 'x') });
    expect(simDataReducer(s, { type: 'pollFailed', error: travel503('travel_data_missing', 'x') })).toBe(s);
  });

  it('a 503 without a TravelUnavailable code is an ordinary error', () => {
    const s = run({ type: 'pollFailed', error: httpError(503, 'Service Unavailable') });
    expect(s.view).toBe('error');
    expect(s.unavailable).toBeNull();
  });

  it('recovers from unavailable to ready on the next good poll', () => {
    const s = run(
      { type: 'pollFailed', error: travel503('travel_data_missing', 'x') },
      { type: 'sim', sim: simAt('run-a', 1) },
    );
    expect(s.view).toBe('ready');
    expect(s.unavailable).toBeNull();
    expect(s.sim?.version).toBe(1);
  });

  it('recovers to ready even when the data after the 503 has the same version', () => {
    const s = simDataReducer(ready(), { type: 'pollFailed', error: travel503('google_unavailable', 'down') });
    expect(s.view).toBe('unavailable');
    expect(s.sim?.version).toBe(5);
    const back = simDataReducer(s, { type: 'sim', sim: simAt('run-a', 5) });
    expect(back.view).toBe('ready');
    expect(back.unavailable).toBeNull();
  });
});

describe('simDataReducer: connection errors', () => {
  it('before the first success: error view with a readable message, still retrying', () => {
    const s = run({ type: 'pollFailed', error: networkError() });
    expect(s.view).toBe('error');
    expect(s.error).toBe(CONNECTION_LOST_MESSAGE);
    expect(s.reconnecting).toBe(true);
    expect(simDataReducer(s, { type: 'pollFailed', error: networkError() })).toBe(s);
    const ok = simDataReducer(s, { type: 'sim', sim: simAt('run-a', 1) });
    expect(ok.view).toBe('ready');
    expect(ok.error).toBeNull();
    expect(ok.reconnecting).toBe(false);
  });

  it('before the first success, an HTTP error shows its message', () => {
    const s = run({ type: 'pollFailed', error: httpError(500, 'Internal error') });
    expect(s.view).toBe('error');
    expect(s.error).toBe('Internal error');
    expect(s.reconnecting).toBe(false);
  });

  it('after the first success: keeps the last data and sets reconnecting', () => {
    const s0 = ready();
    const s = simDataReducer(s0, { type: 'pollFailed', error: networkError() });
    expect(s.view).toBe('ready');
    expect(s.sim).toBe(s0.sim);
    expect(s.map).toBe(s0.map);
    expect(s.reconnecting).toBe(true);
    expect(simDataReducer(s, { type: 'pollFailed', error: httpError(500, 'x') })).toBe(s);
    const back = simDataReducer(s, { type: 'sim', sim: simAt('run-a', 5) });
    expect(back.reconnecting).toBe(false);
    expect(back.sim).toBe(s0.sim);
  });

  it('ignores aborts', () => {
    const s = ready();
    expect(simDataReducer(s, { type: 'pollFailed', error: abortError() })).toBe(s);
    expect(simDataReducer(INITIAL_SIM_DATA, { type: 'pollFailed', error: abortError() })).toBe(INITIAL_SIM_DATA);
  });
});

describe('simDataReducer: actions', () => {
  it('busy and actionError never change the page view', () => {
    let s = simDataReducer(ready(), { type: 'busy', busy: true });
    expect(s.busy).toBe(true);
    s = simDataReducer(s, { type: 'actionFailed', message: 'Planning is locked' });
    s = simDataReducer(s, { type: 'busy', busy: false });
    expect(s).toMatchObject({ view: 'ready', busy: false, actionError: 'Planning is locked' });
    // The next action clears the old error; dismiss clears it too.
    expect(simDataReducer(s, { type: 'busy', busy: true }).actionError).toBeNull();
    expect(simDataReducer(s, { type: 'dismissActionError' }).actionError).toBeNull();
  });
});
