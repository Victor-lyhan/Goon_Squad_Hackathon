// Google access check (server/geo/keyCheck.ts): the terminal lines, the pass/fail verdict, and that no key reaches
// a row or a line. No network, no real key, no .env.
import { describe, expect, it } from 'vitest';
import { checkGoogleAccess, formatKeyCheck, keyCheckPassed } from '../../server/geo/keyCheck';
import type { KeyCheckRow } from '../../server/geo/keyCheck';
import { ADDRESS, FROM, TO, fakeClient, googleError } from './key-check-helpers';

const run = (answers: Parameters<typeof fakeClient>[0] = {}) => checkGoogleAccess({ client: fakeClient(answers).client, address: ADDRESS, from: FROM, to: TO });

describe('key check: formatKeyCheck and keyCheckPassed', () => {
  it('prints one ok line per API and "All three Google APIs answered."', async () => {
    const rows = await run();

    expect(formatKeyCheck(rows)).toEqual([
      'Geocoding API (geocode): ok (found 40.7484, -73.9857)',
      'Routes API (route matrix): ok (734 s, 6120 m)',
      'Routes API (route line): ok (route line of 27 characters, 734 s, 6120 m)',
      'All three Google APIs answered.',
    ]);
    expect(keyCheckPassed(rows)).toBe(true);
  });

  it('prints the problem, the remedy and the detail on the failed row, and asks for a second run', async () => {
    const rows = await run({
      route_matrix: () => {
        throw googleError('route_matrix', 403, 'PERMISSION_DENIED', 'Routes API has not been used in project 42 before or it is disabled.');
      },
    });

    expect(formatKeyCheck(rows)).toEqual([
      'Geocoding API (geocode): ok (found 40.7484, -73.9857)',
      'Routes API (route matrix): api_not_enabled. Enable the Routes API for this project in the Google Cloud console. ' +
        'Detail: HTTP 403 PERMISSION_DENIED: Routes API has not been used in project 42 before or it is disabled.',
      'Routes API (route line): ok (route line of 27 characters, 734 s, 6120 m)',
      'Fix the rows above, then run the check again.',
    ]);
    expect(keyCheckPassed(rows)).toBe(false);
  });

  it('gives one line per API plus the last line, whatever failed', async () => {
    const down = () => {
      throw googleError('geocoding', 0, 'NETWORK_ERROR', 'TypeError: fetch failed\n  at node:internal');
    };
    const lines = formatKeyCheck(await run({ geocoding: down, route_matrix: down, routes: down }));

    expect(lines).toHaveLength(4);
    expect(lines.every((line) => !line.includes('\n'))).toBe(true);
    expect(lines.slice(0, 3).every((line) => line.includes(': network. No answer came back from the '))).toBe(true);
    expect(lines[3]).toBe('Fix the rows above, then run the check again.');
  });

  it('keyCheckPassed is false for a no_result row and for no rows at all', async () => {
    expect(keyCheckPassed(await run({ geocoding: [] }))).toBe(false);
    expect(keyCheckPassed([])).toBe(false);
    expect(formatKeyCheck([])).toEqual(['Fix the rows above, then run the check again.']);
  });

  it('does not change the rows it formats', async () => {
    const rows = await run({ routes: { encoded: '', durationS: 1, distanceM: 1 } });
    const before = JSON.stringify(rows);
    formatKeyCheck(rows);
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe('key check: a key never reaches a row or a line', () => {
  // Not real keys. The first has the shape of a Google key; the second has characters that change when URL-encoded.
  const GOOGLE_SHAPED = 'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE12';
  const KEY = 'FAKE_key-123+/=';
  const KEY_ENCODED = 'FAKE_key-123%2B%2F%3D';

  function expectNoKey(text: string) {
    expect(text).not.toContain(GOOGLE_SHAPED);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(KEY_ENCODED);
  }

  it('from error messages that carry the key raw, URL-encoded in a request URL, or in a header dump', async () => {
    const rows = await run({
      geocoding: () => {
        throw new Error(`GET https://maps.googleapis.com/maps/api/geocode/json?address=x&key=${KEY_ENCODED} failed`);
      },
      route_matrix: () => {
        throw googleError('route_matrix', 400, 'INVALID_ARGUMENT', `API key not valid. Please pass a valid API key. (${GOOGLE_SHAPED})`);
      },
      routes: () => {
        throw googleError('routes', 403, 'PERMISSION_DENIED', `Requests from referer <empty> are blocked. headers: {"X-Goog-Api-Key": "${KEY}"} url: ?key=${KEY}`);
      },
    });

    expect(rows.map((row) => row.problem)).toEqual(['unknown', 'key_invalid', 'key_restricted']);
    for (const row of rows) {
      expectNoKey(row.detail);
      expectNoKey(row.remedy);
    }
    expect(rows.every((row) => row.detail.includes('[redacted]'))).toBe(true);
    for (const line of formatKeyCheck(rows)) expectNoKey(line);
  });

  it('from a matrix failure message and a geocode result', async () => {
    const rows = await run({
      route_matrix: { elements: [], failures: [{ originIndex: 0, destinationIndex: 0, condition: null, message: `no route (request ?key=${KEY_ENCODED} / ${GOOGLE_SHAPED})` }] },
    });

    expect(rows[1].problem).toBe('no_result');
    expectNoKey(JSON.stringify(rows));
    expectNoKey(formatKeyCheck(rows).join('\n'));
  });

  it('formatKeyCheck scrubs rows that were not built by the check', () => {
    const rows: KeyCheckRow[] = [
      { api: 'geocoding', ok: true, problem: 'none', detail: `found it with ${GOOGLE_SHAPED}`, remedy: '' },
      { api: 'route_matrix', ok: false, problem: 'unknown', detail: `POST failed, x-goog-api-key: ${KEY}`, remedy: `Look at https://example.test/?key=${KEY_ENCODED}` },
      { api: 'routes', ok: false, problem: 'unknown', detail: `two\nlines ${GOOGLE_SHAPED}`, remedy: 'Read the detail.' },
    ];
    const lines = formatKeyCheck(rows);

    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expectNoKey(line);
      expect(line).not.toContain('\n');
    }
  });
});
