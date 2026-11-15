// #916: the Employee page says everything in plain words (human polish backlog, QUESTIONS 23:01, item 6;
// the Employee rows of PR #913's "not on the word list" table).
//
// Every case goes through the page's models, the way the page does it, with the error the HTTP client
// (client/src/api) really throws and the sentence the server really sends for it. The text that comes
// out must hold none of: "leg", "server", "key", "Google", "API", "ms", a 3-digit status number.
//   1. a relay job says who carries the package where, in the row and in the job view; a direct job too;
//   2. address search: no key, a rejected key, a slow search, no answer;
//   3. a commute save that fails, in the form and in the page's notice;
//   4. a first load that fails, a poll that fails, a job that cannot be loaded.
// The status codes and `code` fields the models read are the contract's: each case is told apart by them.
import { describe, expect, it } from 'vitest';
import type { JobResponse } from '../../shared/v2/api';
import { ApiRequestError } from '../../client/src/api/v2';
import {
  EMPTY_TEXT as SEARCH_EMPTY_TEXT, NOT_ANSWERING_TEXT, SEARCHING_TEXT, SHORT_QUERY_TEXT, UNAVAILABLE_TEXT,
  addressSearchReducer, describeSearchError, initialSearchState, statusText,
} from '../../client/src/components/employee/v2/addressSearchModel';
import {
  LOCKED_MESSAGE, NEW_HOME_UNAVAILABLE_TEXT, SAVE_FAILED_TEXT, TRAVEL_TIMES_FAILED_TEXT, classifySaveError, saveMessage,
  saveReducer, unavailableMessage,
} from '../../client/src/components/employee/v2/commuteFormModel';
import { deliveryRows } from '../../client/src/components/employee/v2/employeeWorkspaceModel';
import { ownSentence } from '../../client/src/components/employee/v2/errorWording';
import {
  JOB_FAILED_TEXT, JOB_FAILED_TITLE, RELAY_POINT_FALLBACK, jobDetail, legKindLabel,
} from '../../client/src/components/employee/v2/jobDetailV2Model';
import {
  CANT_REACH_TEXT, SERVER_ERROR_TEXT, TOO_SLOW_TEXT, TRAVEL_DATA_MISSING_TEXT, TRAVEL_UNAVAILABLE_TEXT,
  employeeWorkspaceReducer, initialWorkspaceState, loadErrorText, unavailableText,
} from '../../client/src/components/employee/v2/live/employeeWorkspaceState';
import {
  ERROR_TITLE, FAILED_TEXT, NETWORK_TEXT, TIMEOUT_TEXT, outcomeFromError, pageScreen, saveNotice, unavailableSaveText,
} from '../../client/src/components/employee/v2/page/employeePageModel';
import { businesses as rowBusinesses, dashboard, directView, relayView } from './employee-v2-workspace-sample';
import { businesses as jobBusinesses, eveningDirect, morningDirect, relayLeg1, relayLeg2 } from './employeeV2JobSample';

// ---------- the word list of the issue ----------

const FORBIDDEN: ReadonlyArray<{ word: string; re: RegExp }> = [
  { word: 'leg', re: /\blegs?\b/i },
  { word: 'server', re: /\bservers?\b/i },
  { word: 'key', re: /\bkeys?\b/i },
  { word: 'Google', re: /google/i },
  { word: 'API', re: /\bapis?\b/i },
  { word: 'ms', re: /\bms\b|\d\s?ms\b|millisecond/i },
  { word: 'a 3-digit status', re: /\b[1-5]\d\d\b/ },
];
const forbiddenIn = (text: string) => FORBIDDEN.filter((f) => f.re.test(text)).map((f) => f.word);

/** `text` is one or two short sentences a person can read: not empty, ends like a sentence, no forbidden word. */
function expectPlain(text: string | null | undefined, what: string) {
  expect(typeof text, what).toBe('string');
  expect(text!.trim().length, what).toBeGreaterThan(0);
  expect(forbiddenIn(text!), `${what}: ${JSON.stringify(text)}`).toEqual([]);
}
/** An error sentence: plain, and it says what the person can do (a verb for them, or that Relay retries). */
function expectPlainError(text: string | null | undefined, what: string) {
  expectPlain(text, what);
  expect(text!, what).toMatch(/[.…]$/);
  expect(text!, `${what} says what to do: ${JSON.stringify(text)}`)
    .toMatch(/\b(try again|press Retry|keep your saved home|trying again|go back|press Back to start)\b/i);
  expect(text!.length, what).toBeLessThanOrEqual(130);
}

// ---------- the errors the HTTP client throws, with the server's real sentences ----------

// server/api/v2/errors.ts and server/api/geo.ts, as on main: written for whoever runs Relay.
const SERVER_KEY_TEXT = 'The Google Maps server key is not set. Add GOOGLE_MAPS_SERVER_KEY to .env and restart the server.';
const SERVER_GOOGLE_TEXT = 'Google Maps is not answering right now, so try again in a moment.';
const SERVER_DATA_TEXT = 'NYC travel data is not loaded. Run npm run fetch:routes and commit fixtures/nyc/.';
const GEO_KEY_TEXT = 'Address search needs GOOGLE_MAPS_SERVER_KEY on the server.';

const http = (status: number, message = `Request failed (${status})`, code?: string) =>
  new ApiRequestError(status, message, undefined, undefined, code);
const timeout = (ms: number) => new ApiRequestError(0, `Request timed out after ${ms} ms`, undefined, 'timeout');
const network = () => new ApiRequestError(0, 'Failed to fetch', undefined, 'network');

// The sentences the API layer writes itself since #909 (client/src/api/http.ts, not exported), for the same
// four cases. They are plain but name "the Relay server", so the Employee page says its own sentence.
const API_TEXT = {
  network: "Can't reach the Relay server, so check it's running and try again.",
  timeout: 'The Relay server took too long to answer, so try again in a moment.',
  badReply: "The Relay server's answer couldn't be read, so reload the page and try again.",
  noErrorText: "The Relay server had a problem, so check it's running and try again.",
};
const http909 = (status: number) => new ApiRequestError(status, API_TEXT.noErrorText);
const timeout909 = () => new ApiRequestError(0, API_TEXT.timeout, undefined, 'timeout');
const network909 = () => new ApiRequestError(0, API_TEXT.network, undefined, 'network');
const badReply909 = () => new ApiRequestError(0, API_TEXT.badReply, undefined, 'network');

describe('the word list itself', () => {
  it('finds each forbidden word, and leaves ordinary words alone', () => {
    expect(forbiddenIn('Relay leg 1 of 2: drop at the relay point')).toEqual(['leg']);
    expect(forbiddenIn('Address search needs the Google key on the server.')).toEqual(['server', 'key', 'Google']);
    expect(forbiddenIn('The API answered 503 after 8000 ms')).toEqual(['API', 'ms', 'a 3-digit status']);
    expect(forbiddenIn('Request failed (500)')).toEqual(['a 3-digit status']);
    for (const fine of [
      'Keep your saved home, or try again later.', 'Day 2, 8:45 AM', '$4.80', '+2.3 km', '50 min', 'Up to 15 min extra per trip',
      'Evening commute, leaves Day 1, 5:30 PM', 'Collect the package', 'A delegate, a legend and a monkey',
    ]) expect(forbiddenIn(fine), fine).toEqual([]);
  });
});

// ---------- 1. relay and direct jobs ----------

/** Every piece of text the job view prints for one job. */
function jobTexts(job: JobResponse): string[] {
  const m = jobDetail(job, jobBusinesses, 'Astoria');
  return [
    m.legKind, m.title, m.trip, m.statusLabel, m.statusNote, m.relay ?? '',
    ...m.route.flatMap((r) => [r.time, r.place, r.address, r.action, r.instructions]),
    ...m.numbers.flatMap((n) => [n.label, n.value]),
  ].filter((t) => t !== '');
}

describe('#916 a relay job says who carries the package where', () => {
  it('job view, first carrier: you take it to the relay point, another carrier takes it from there', () => {
    const m = jobDetail(relayLeg1(), jobBusinesses, 'Astoria');
    expect(m.legKind).toBe('Relay: you take it to River Cafe Roasters; another carrier takes it from there');
    for (const t of jobTexts(relayLeg1())) expectPlain(t, 'relay job, first carrier');
  });

  it('job view, second carrier: another carrier brings it to the relay point, you take it from there', () => {
    const m = jobDetail(relayLeg2(), jobBusinesses, 'Park Slope');
    expect(m.legKind).toBe('Relay: another carrier brings it to River Cafe Roasters; you take it from there');
    for (const t of jobTexts(relayLeg2())) expectPlain(t, 'relay job, second carrier');
  });

  it('job view: the two labels name the same relay point and both carriers, in the order they carry', () => {
    const [first, second] = [relayLeg1(), relayLeg2()].map((j) => legKindLabel(j, jobBusinesses));
    for (const label of [first, second]) {
      expect(label).toContain('River Cafe Roasters');
      expect(label).toMatch(/\byou\b/);
      expect(label).toMatch(/\banother carrier\b/);
      expect(label).not.toMatch(/\d/); // no "1 of 2"
    }
    expect(first.indexOf('you')).toBeLessThan(first.indexOf('another carrier'));
    expect(second.indexOf('another carrier')).toBeLessThan(second.indexOf('you'));
  });

  it('job view: a relay point that does not resolve is "the relay point", never an ID or "Unknown place"', () => {
    for (const job of [relayLeg1(), relayLeg2()]) {
      const label = legKindLabel(job, []);
      expect(label).toContain(RELAY_POINT_FALLBACK);
      expect(label).not.toMatch(/biz-|Unknown/);
      expectPlain(label, 'relay label with no business list');
    }
    expect(legKindLabel(relayLeg1())).toBe('Relay: you take it to the relay point; another carrier takes it from there');
  });

  it('job view, direct job: "Direct delivery", and nothing about a relay', () => {
    for (const job of [eveningDirect(), morningDirect()]) {
      const m = jobDetail(job, jobBusinesses, 'Astoria');
      expect(m.legKind).toBe('Direct delivery');
      expect(m.relay).toBeNull();
      for (const t of jobTexts(job)) expectPlain(t, 'direct job');
    }
  });

  it('delivery list: a row says the same in fewer words, for the first and the second carrier', () => {
    const l1 = relayView.plan.legs[0];
    const firstJob = { ...relayView.job, id: 'plan-shp-002-L0', legIndex: 0, tripId: 'emp-001-eve', pickup: l1.stops[0], dropoff: l1.stops[1] };
    const [direct, second, first] = deliveryRows([directView, relayView, { ...relayView, job: firstJob }], rowBusinesses, 'Astoria');
    expect(direct.legKind).toBe('Direct');
    expect(first.legKind).toBe('Relay: you take it to Corner Books');
    expect(second.legKind).toBe('Relay: you take it from Corner Books');
    // The line says where the stops line says "Relay point: Corner Books": one name for one place.
    expect(first.dropoff).toContain('Relay point: Corner Books');
    expect(second.pickup).toContain('Relay point: Corner Books');
    for (const row of [direct, first, second]) {
      for (const t of [
        row.legKind, row.commute, row.packageLabel, row.statusLabel, row.pickup, row.dropoff, row.extraMin, row.reward,
        row.jobLinkLabel, row.simulatorLinkLabel,
      ]) expectPlain(t, `delivery row ${row.jobId}`);
    }
    const [unknown] = deliveryRows([relayView], [], 'Astoria');
    expect(unknown.legKind).toBe('Relay: you take it from the relay point');
  });
});

// ---------- 2. address search ----------

describe('#916 address search failures', () => {
  const searching = [
    { type: 'input', query: '31-10 steinway' } as const, { type: 'searchStart', query: '31-10 steinway' } as const,
  ].reduce(addressSearchReducer, initialSearchState);
  /** The status line after a search that rejected with `err`, and whether Retry is offered. */
  const after = (err: unknown) => {
    const s = addressSearchReducer(searching, { type: 'searchFailure', query: '31-10 steinway', failure: describeSearchError(err) });
    return { text: statusText(s), retry: s.status === 'error', status: s.status };
  };

  it('no key (503 google_key_missing): not available, keep the saved home; no Retry that cannot work', () => {
    const r = after(http(503, GEO_KEY_TEXT, 'google_key_missing'));
    expect(r).toEqual({ text: UNAVAILABLE_TEXT, retry: false, status: 'unavailable' });
    expect(UNAVAILABLE_TEXT).toBe('Address search is not available right now. Keep your saved home, or try again later.');
    expectPlainError(r.text, 'address search, no key');
    // A 503 with no code at all reads the same.
    expect(after(http(503)).text).toBe(UNAVAILABLE_TEXT);
  });

  it.each([
    ['a rejected key (503 google_unavailable)', () => http(503, SERVER_GOOGLE_TEXT, 'google_unavailable')],
    ['a slow search (the client gave up waiting)', () => timeout(8000)],
    ['a slow search (the server gave up waiting)', () => http(503, 'Address search is unavailable right now. Try again in a moment.', 'google_unavailable')],
    ['no answer (no network)', () => network()],
    ['an answer that is an error (500, no body)', () => http(500)],
    ['a slow search, in the API layer\'s words', () => timeout909()],
    ['no answer, in the API layer\'s words', () => network909()],
    ['an answer that cannot be read, in the API layer\'s words', () => badReply909()],
    ['an answer that is an error, in the API layer\'s words', () => http909(500)],
    ['an error that is not from the HTTP client', () => new TypeError('fetch failed')],
  ])('%s: one plain sentence with Retry', (name, make) => {
    const r = after(make());
    expect(r).toEqual({ text: NOT_ANSWERING_TEXT, retry: true, status: 'error' });
    expectPlainError(r.text, `address search, ${name}`);
  });

  it('the other lines of the search are plain too', () => {
    for (const t of [NOT_ANSWERING_TEXT, UNAVAILABLE_TEXT, SEARCH_EMPTY_TEXT, SEARCHING_TEXT, SHORT_QUERY_TEXT]) expectPlain(t, 'address search line');
  });
});

// ---------- 3. commute save ----------

describe('#916 a commute save that fails', () => {
  const failures: [string, () => unknown, string][] = [
    ['no key for a new home (503 google_key_missing)', () => http(503, SERVER_KEY_TEXT, 'google_key_missing'), NEW_HOME_UNAVAILABLE_TEXT],
    ['a rejected key or a slow lookup (503 google_unavailable)', () => http(503, SERVER_GOOGLE_TEXT, 'google_unavailable'), TRAVEL_TIMES_FAILED_TEXT],
    ['travel times not loaded (503 travel_data_missing)', () => http(503, SERVER_DATA_TEXT, 'travel_data_missing'), TRAVEL_DATA_MISSING_TEXT],
    ['the save took too long', () => timeout(20000), TIMEOUT_TEXT],
    ['no answer (no network)', () => network(), NETWORK_TEXT],
    ['an answer that is an error (500, no body)', () => http(500), FAILED_TEXT],
    ['an answer that is an error (502, no body)', () => http(502), FAILED_TEXT],
    ['the save took too long, in the API layer\'s words', () => timeout909(), TIMEOUT_TEXT],
    ['no answer, in the API layer\'s words', () => network909(), NETWORK_TEXT],
    ['an answer that cannot be read, in the API layer\'s words', () => badReply909(), NETWORK_TEXT],
    ['an answer that is an error, in the API layer\'s words', () => http909(500), FAILED_TEXT],
    ['a refusal with no sentence of the server\'s, in the API layer\'s words', () => http909(400), FAILED_TEXT],
    ['a server sentence written for whoever runs Relay (500)', () => http(500, SERVER_KEY_TEXT), FAILED_TEXT],
    ['an error that is not from the HTTP client', () => new TypeError('fetch failed'), FAILED_TEXT],
    ['something that is not an error', () => 'weird', FAILED_TEXT],
  ];

  it.each(failures)('page notice, %s', (name, make, expected) => {
    const n = saveNotice(outcomeFromError(make()));
    expect(n.text).toBe(expected);
    expect(n).toMatchObject({ role: 'alert', formOpen: true }); // what was typed stays
    expectPlainError(n.text, `commute save, ${name}`);
  });

  // The form reads errors by shape (it also takes a thrown string as the text), so the last case is the page's only.
  it.each(failures.filter(([, make]) => typeof make() !== 'string'))('the form\'s own message, %s', (name, make) => {
    const state = saveReducer({ status: 'saving' }, { type: 'failure', error: make() });
    const m = saveMessage(state, 'planning');
    expect(m?.role).toBe('alert');
    expectPlainError(m?.text, `commute form, ${name}`);
    expect(state).toEqual(classifySaveError(make()));
  });

  it('the exact sentences', () => {
    expect(unavailableMessage('google_key_missing'))
      .toBe('A new home address cannot be saved right now, so your commute is unchanged. Keep your saved home, or try again later.');
    expect(unavailableMessage('google_unavailable'))
      .toBe('Travel times for this address could not be loaded. Your saved commute is unchanged. Try again.');
    expect(unavailableSaveText('travel_data_missing')).toBe('Travel times for New York are not loaded yet. Try again in a moment.');
    expect(TIMEOUT_TEXT).toBe('Saving took too long. Your changes are still in the form, so try again.');
    expect(NETWORK_TEXT).toBe("Can't reach Relay. Your changes are still in the form, so try again.");
    expect(FAILED_TEXT).toBe('The commute could not be saved. Try again.');
    expect(SAVE_FAILED_TEXT).toBe(FAILED_TEXT);
  });

  it('a sentence the server wrote for the person is still shown as it is (400, 409, 500 with a body)', () => {
    expect(saveNotice(outcomeFromError(http(400, 'Morning departure must be on Day 2.'))).text).toBe('Morning departure must be on Day 2.');
    expect(saveNotice(outcomeFromError(http(409, 'The run is playing, so the commute cannot be changed now.'))).text)
      .toBe('The run is playing, so the commute cannot be changed now.');
    expect(saveNotice(outcomeFromError(http(500, 'The commute could not be saved, so try again.'))).text)
      .toBe('The commute could not be saved, so try again.');
    // A refusal with no sentence of the server's own falls back to the page's.
    for (const status of [400, 409]) expectPlain(saveNotice(outcomeFromError(http(status))).text, `a bare ${status}`);
    expectPlainError(LOCKED_MESSAGE, 'the locked sentence');
  });

  it('the status codes and `code` fields the models read are unchanged', () => {
    expect(outcomeFromError(http(503, 'x', 'google_key_missing'))).toEqual({ kind: 'unavailable', code: 'google_key_missing' });
    expect(outcomeFromError(http(503, 'x', 'google_unavailable'))).toEqual({ kind: 'unavailable', code: 'google_unavailable' });
    expect(outcomeFromError(http(503, 'x', 'travel_data_missing'))).toEqual({ kind: 'unavailable', code: 'travel_data_missing' });
    expect(outcomeFromError(http(409, 'x')).kind).toBe('locked');
    expect(outcomeFromError(http(400, 'x')).kind).toBe('invalid');
    expect(outcomeFromError(timeout(20000)).kind).toBe('timeout');
    expect(outcomeFromError(network()).kind).toBe('network');
    expect(classifySaveError({ status: 409 })).toEqual({ status: 'locked' });
    for (const code of ['google_key_missing', 'travel_data_missing', 'google_unavailable'] as const) {
      expect(classifySaveError({ status: 503, code })).toEqual({ status: 'unavailable', code });
      expect(classifySaveError({ status: 503, body: { code } })).toEqual({ status: 'unavailable', code });
    }
  });
});

// ---------- 4. loading ----------

describe('#916 a load that fails', () => {
  const firstLoad = (e: unknown) => {
    const s = employeeWorkspaceReducer(initialWorkspaceState, { type: 'dashboardFailed', error: e });
    return pageScreen(s, null);
  };

  it.each([
    ['no answer (no network)', () => network(), CANT_REACH_TEXT],
    ['a slow answer', () => timeout(8000), TOO_SLOW_TEXT],
    ['an answer that is an error (500, no body)', () => http(500), SERVER_ERROR_TEXT],
    ['an answer that is an error (502, no body)', () => http(502), SERVER_ERROR_TEXT],
    ['no answer, in the API layer\'s words', () => network909(), CANT_REACH_TEXT],
    ['a slow answer, in the API layer\'s words', () => timeout909(), TOO_SLOW_TEXT],
    ['an answer that cannot be read, in the API layer\'s words', () => badReply909(), CANT_REACH_TEXT],
    ['an answer that is an error, in the API layer\'s words', () => http909(500), SERVER_ERROR_TEXT],
    ['a server sentence written for whoever runs Relay (500)', () => http(500, SERVER_KEY_TEXT), SERVER_ERROR_TEXT],
    ['an error that is not from the HTTP client', () => new TypeError('fetch failed'), SERVER_ERROR_TEXT],
  ])('first load, %s: the error screen', (name, make, expected) => {
    const screen = firstLoad(make());
    expect(screen).toEqual({ kind: 'error', text: expected });
    expect(loadErrorText(make())).toBe(expected);
    expectPlainError(expected, `first load, ${name}`);
  });

  it.each([
    ['travel times not loaded', 'travel_data_missing', SERVER_DATA_TEXT, TRAVEL_DATA_MISSING_TEXT],
    ['no key', 'google_key_missing', SERVER_KEY_TEXT, TRAVEL_UNAVAILABLE_TEXT],
    ['a rejected key or a slow lookup', 'google_unavailable', SERVER_GOOGLE_TEXT, TRAVEL_UNAVAILABLE_TEXT],
  ] as const)('first load, %s (503 %s): the page\'s own sentence, not the server\'s', (name, code, serverText, expected) => {
    const screen = firstLoad(http(503, serverText, code));
    expect(screen).toEqual({ kind: 'unavailable', text: expected });
    expect(unavailableText(code)).toBe(expected);
    expectPlainError(expected, `first load, ${name}`);
  });

  it('a poll that fails after the first load keeps the page and says a plain sentence next to "Reconnecting…"', () => {
    let s = employeeWorkspaceReducer(initialWorkspaceState, { type: 'businesses', businesses: rowBusinesses });
    s = employeeWorkspaceReducer(s, { type: 'dashboard', dashboard, runId: 'run-1' });
    expect(s.view).toBe('ready');
    for (const [code, serverText] of [
      ['google_key_missing', SERVER_KEY_TEXT], ['google_unavailable', SERVER_GOOGLE_TEXT], ['travel_data_missing', SERVER_DATA_TEXT],
    ] as const) {
      const failed = employeeWorkspaceReducer(s, { type: 'dashboardFailed', error: http(503, serverText, code) });
      expect(failed.view).toBe('ready');
      expect(failed.reconnecting).toBe(true);
      expect(failed.unavailable?.code).toBe(code);
      expectPlainError(failed.unavailable?.message, `poll, ${code}`);
    }
  });

  it('the exact sentences, and the screen\'s title', () => {
    expect(CANT_REACH_TEXT).toBe("Can't reach Relay. Check your connection, then press Retry.");
    expect(TOO_SLOW_TEXT).toBe('Relay took too long to answer. Press Retry.');
    expect(SERVER_ERROR_TEXT).toBe('Relay ran into a problem while loading. Press Retry.');
    expect(TRAVEL_DATA_MISSING_TEXT).toBe('Travel times for New York are not loaded yet. Try again in a moment.');
    expect(TRAVEL_UNAVAILABLE_TEXT).toBe('Travel times are not available right now. Try again in a moment.');
    expectPlain(ERROR_TITLE, 'error title');
  });

  it('a job that cannot be loaded: plain title and text', () => {
    expect(JOB_FAILED_TEXT).toBe('Relay is trying again every second. You can also go back to your deliveries.');
    expectPlain(JOB_FAILED_TITLE, 'job failed title');
    expectPlainError(JOB_FAILED_TEXT, 'job failed text');
  });
});

describe('#916 which error text the page prints as it is', () => {
  it('a sentence written for the person is kept, word for word', () => {
    for (const fine of [
      'Morning departure must be on Day 2.', 'Unknown business', 'The run is being rebuilt. Try again in a few seconds.',
      'The run is playing, so the commute is read-only until you press Back to start in the simulator.',
      'Maximum detour must be a whole number from 0 to 30 minutes.', 'Keep your saved home.', 'Ms Chen is not in this run.',
      'Evening departure must be before 1439.',
    ]) expect(ownSentence(fine), fine).toBe(fine);
    expect(ownSentence('  Unknown business  ')).toBe('Unknown business');
  });

  it('the HTTP client\'s and the browser\'s own wording is dropped', () => {
    for (const raw of [
      'Request failed (500)', 'Request timed out after 20000 ms', 'Request aborted', 'Failed to fetch', 'fetch failed',
      'Network error', 'Load failed', 'NetworkError when attempting to fetch resource.', '', '   ', null, undefined, 42,
    ]) expect(ownSentence(raw), String(raw)).toBe('');
  });

  it('a text with a word the page does not say is dropped: the API layer\'s sentences and the server\'s hints', () => {
    for (const raw of [
      ...Object.values(API_TEXT), SERVER_KEY_TEXT, SERVER_GOOGLE_TEXT, GEO_KEY_TEXT, 'Internal Server Error',
      'The API did not answer.', 'No answer after 8000 ms.', 'Upstream said 502.', 'The key was rejected.',
    ]) {
      expect(forbiddenIn(raw).length, raw).toBeGreaterThan(0);
      expect(ownSentence(raw), raw).toBe('');
    }
  });

  it('whatever text an error carries, what the page shows for it has no forbidden word', () => {
    const texts = [...Object.values(API_TEXT), SERVER_KEY_TEXT, SERVER_GOOGLE_TEXT, SERVER_DATA_TEXT, GEO_KEY_TEXT, 'Request failed (500)', ''];
    for (const status of [0, 400, 404, 409, 500, 502, 503]) {
      for (const message of texts) {
        for (const code of [undefined, 'google_key_missing', 'google_unavailable', 'travel_data_missing']) {
          const e = new ApiRequestError(status, message, undefined, undefined, code);
          const what = `${status} ${code ?? 'no code'} ${JSON.stringify(message)}`;
          expectPlain(saveNotice(outcomeFromError(e)).text, `save notice, ${what}`);
          expectPlain(saveMessage(classifySaveError(e), 'planning')?.text, `form message, ${what}`);
          expectPlain(loadErrorText(e), `load text, ${what}`);
          const s = employeeWorkspaceReducer(initialWorkspaceState, { type: 'dashboardFailed', error: e });
          const screen = pageScreen(s, null);
          if (screen.kind === 'error' || screen.kind === 'unavailable') expectPlain(screen.text, `first load, ${what}`);
          else expect(screen.kind, what).toBe('not_found');
        }
      }
    }
  });
});
