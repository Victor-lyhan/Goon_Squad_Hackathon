import { describe, expect, it } from 'vitest';
import {
  EMPTY_TEXT, NOT_ANSWERING_TEXT, UNAVAILABLE_TEXT, addressSearchReducer as reduce, describeSearchError, initialSearchState, isOpen,
  pickHome, statusText, toHomeChoice, type AddressResult, type AddressSearchAction, type AddressSearchState,
} from '../../client/src/components/employee/v2/addressSearchModel';

const R: AddressResult[] = [
  { label: '31-10 Steinway St, Queens, NY 11103', neighborhood: 'Astoria', lat: 40.7605, lng: -73.9174 },
  { label: '310 Grand St, Brooklyn, NY 11211', neighborhood: 'Williamsburg', lat: 40.7128, lng: -73.9573 },
  { label: '31 W 31st St, New York, NY 10001', neighborhood: 'Midtown', lat: 40.7480, lng: -73.9880 },
];
const run = (actions: AddressSearchAction[], from: AddressSearchState = initialSearchState) => actions.reduce(reduce, from);
const withResults = (results = R) => run([
  { type: 'input', query: '31 st' }, { type: 'searchStart', query: '31 st' }, { type: 'searchSuccess', query: '31 st', results },
]);

describe('address search model: queries', () => {
  it('never searches under 3 characters', () => {
    for (const q of ['', 'a', 'ab', '  ab  ']) {
      const s = run([{ type: 'input', query: q }]);
      expect(s.status).toBe('idle');
      expect(run([{ type: 'searchStart', query: q }], s).status).toBe('idle');
    }
    expect(run([{ type: 'input', query: 'abc' }]).status).toBe('typing');
  });

  it('asks for more characters only once something is typed', () => {
    expect(statusText(initialSearchState)).toBeNull();
    expect(statusText(run([{ type: 'input', query: 'ab' }]))).toMatch(/at least 3/);
  });

  it('ignores a search start for a query that is no longer typed', () => {
    const s = run([{ type: 'input', query: 'steinway' }, { type: 'searchStart', query: 'stein' }]);
    expect(s.status).toBe('typing');
  });

  it('ignores a stale response from an older query', () => {
    const s = run([
      { type: 'input', query: 'stein' }, { type: 'searchStart', query: 'stein' },
      { type: 'input', query: 'steinway' }, { type: 'searchStart', query: 'steinway' },
      { type: 'searchSuccess', query: 'stein', results: R },
    ]);
    expect(s.status).toBe('searching');
    expect(s.results).toEqual([]);
    const late = run([{ type: 'searchFailure', query: 'stein', failure: { kind: 'error', message: 'boom' } }], s);
    expect(late).toBe(s);
    const fresh = run([{ type: 'searchSuccess', query: 'steinway', results: R.slice(0, 1) }], s);
    expect(fresh.status).toBe('results');
    expect(fresh.results).toHaveLength(1);
  });

  it('ignores a response that arrives after the user kept typing (no new search started yet)', () => {
    const s = run([
      { type: 'input', query: 'stein' }, { type: 'searchStart', query: 'stein' }, { type: 'input', query: 'steinw' },
      { type: 'searchSuccess', query: 'stein', results: R },
    ]);
    expect(s.status).toBe('typing');
    expect(s.results).toEqual([]);
  });

  it('shows the empty message for no results', () => {
    const s = withResults([]);
    expect(s.status).toBe('empty');
    expect(statusText(s)).toBe(EMPTY_TEXT);
    expect(isOpen(s)).toBe(false);
  });
});

describe('address search model: failures', () => {
  const searching = run([{ type: 'input', query: 'steinway' }, { type: 'searchStart', query: 'steinway' }]);
  const fail = (err: unknown, signal?: AbortSignal) =>
    reduce(searching, { type: 'searchFailure', query: 'steinway', failure: describeSearchError(err, signal) });

  it('maps HTTP 503 to unavailable', () => {
    const s = fail(Object.assign(new Error('travel_data_missing'), { status: 503 }));
    expect(s.status).toBe('unavailable');
    expect(statusText(s)).toBe(UNAVAILABLE_TEXT);
  });

  it('keeps the key sentence for google_key_missing only (#598)', () => {
    const keyMissing = fail(Object.assign(new Error('No Google key'), { status: 503, code: 'google_key_missing' }));
    expect(keyMissing.status).toBe('unavailable');
    expect(statusText(keyMissing)).toBe(UNAVAILABLE_TEXT);
    // The code may also sit in the error's body (the shape the commute form reads too).
    expect(fail({ status: 503, body: { code: 'google_key_missing' } }).status).toBe('unavailable');
    for (const code of ['google_unavailable', 'travel_data_missing', 'something_new']) {
      const s = fail(Object.assign(new Error('Google did not answer'), { status: 503, code }));
      expect(s.status, code).toBe('error');
      expect(statusText(s), code).toBe(NOT_ANSWERING_TEXT);
    }
  });

  it('says one plain sentence for every other failure, never the raw message (#598)', () => {
    const raw: unknown[] = [
      Object.assign(new Error('Request timed out after 8000 ms'), { name: 'ApiRequestError', status: 0, kind: 'timeout' }),
      Object.assign(new Error('Failed to fetch'), { name: 'ApiRequestError', status: 0, kind: 'network' }),
      Object.assign(new Error('Geocoding failed (500).'), { status: 500 }),
      Object.assign(new Error('Request failed (502)'), { status: 502 }),
      new TypeError('fetch failed'),
      'weird', null, undefined, 42,
    ];
    for (const err of raw) {
      const s = fail(err);
      expect(s.status).toBe('error');
      expect(statusText(s)).toBe(NOT_ANSWERING_TEXT);
    }
    expect(NOT_ANSWERING_TEXT).toBe('Address search is not answering. Try again.');
  });

  it('leaves the state unchanged on abort', () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect(fail(new Error('whatever'), ctrl.signal)).toBe(searching);
    expect(fail(new DOMException('aborted', 'AbortError'))).toBe(searching);
    expect(fail(Object.assign(new Error('x'), { status: 0, kind: 'abort' }))).toBe(searching);
  });

  it('retries the same query', () => {
    const s = fail(new Error('boom'));
    const r = reduce(s, { type: 'retry' });
    expect(r.status).toBe('typing');
    expect(r.query).toBe('steinway');
    expect(r.attempt).toBe(s.attempt + 1);
  });
});

describe('address search model: highlight and choose', () => {
  it('wraps the highlight at both ends', () => {
    const s = withResults();
    expect(s.highlight).toBe(-1);
    const down = (st: AddressSearchState) => reduce(st, { type: 'highlight', delta: 1 });
    const up = (st: AddressSearchState) => reduce(st, { type: 'highlight', delta: -1 });
    expect(down(s).highlight).toBe(0);
    expect(down(down(down(s))).highlight).toBe(2);
    expect(down(down(down(down(s)))).highlight).toBe(0);
    expect(up(s).highlight).toBe(2);
    expect(up(down(s)).highlight).toBe(2);
  });

  it('does not move the highlight when the list is closed', () => {
    const s = run([{ type: 'input', query: 'abc' }]);
    expect(reduce(s, { type: 'highlight', delta: 1 })).toBe(s);
  });

  it('choosing yields neighborhood and coordinates only, never the label', () => {
    const s = run([{ type: 'highlight', delta: 1 }, { type: 'highlight', delta: 1 }], withResults());
    const home = pickHome(s)!;
    expect(home).toEqual({ neighborhood: 'Williamsburg', lat: 40.7128, lng: -73.9573 });
    expect(Object.keys(home).sort()).toEqual(['lat', 'lng', 'neighborhood']);
    expect(JSON.stringify(home)).not.toContain('Grand St');
    expect(toHomeChoice(R[0])).not.toHaveProperty('label');
    expect(pickHome(s, 0)!.neighborhood).toBe('Astoria');
  });

  it('nothing to pick without a highlight or open list', () => {
    expect(pickHome(withResults())).toBeNull();
    expect(pickHome(initialSearchState, 0)).toBeNull();
  });

  it('choose and clear drop the typed address', () => {
    for (const type of ['choose', 'clear'] as const) {
      const s = reduce(withResults(), { type });
      expect(s.query).toBe('');
      expect(s.results).toEqual([]);
      expect(s.status).toBe('idle');
      expect(JSON.stringify(s)).not.toContain('Steinway');
    }
  });

  it('Esc closes the list but keeps the typed text', () => {
    const s = reduce(withResults(), { type: 'close' });
    expect(s.status).toBe('idle');
    expect(s.query).toBe('31 st');
    expect(isOpen(s)).toBe(false);
    const searching = run([{ type: 'input', query: 'abcd' }, { type: 'searchStart', query: 'abcd' }]);
    expect(reduce(searching, { type: 'close' }).status).toBe('idle');
  });
});
