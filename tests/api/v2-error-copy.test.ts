// #888: every error a page can show from the /api/v2 write routes (send a delivery, save a commute,
// Play / Back to start, planning) is one short sentence in plain words, with no jargon.
// Each refusal is triggered over HTTP on the demo run: the real server with no key, booted from a temp
// copy of `fixtures/nyc` (v2-nyc-controls-helper.ts, DECISIONS pass 56). Three travel errors cannot be
// triggered on the committed cache, so their bodies are built from the error classes the routes catch.
// What is checked for every text an answer holds (`error` and each value of `fieldErrors`):
//   - it is one sentence of at most 14 words (a form hint has no period);
//   - none of the words in JARGON is in it;
//   - a 503 for the person running the server may go on with the command or the .env key, after one
//     plain sentence that passes the same rules.
// Status codes, `code` fields and the keys of `fieldErrors` are asserted as they were before #888.
// The exact sentences are pinned here too: this file is the table in the PR, as a test.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SimulatorResponse } from '../../shared/v2/api';
import { TravelDataMissingError, type Run as RunV2 } from '../../shared/v2/types';
import { GoogleApiError, GoogleKeyMissingError } from '../../server/geo/googleClient';
import {
  COMMUTE_FIELD_COPY, COMMUTE_LOCKED, EMPLOYEE_NOT_FOUND, HOME_OUTSIDE_NYC, INVALID_COMMUTE, UNKNOWN_HOME,
  UNKNOWN_BUSINESS as UNKNOWN_WORKPLACE,
} from '../../server/api/v2/commutePlan';
import { INVALID_CONTROL, SEEK_OUTSIDE_RUN } from '../../server/api/v2/controlOps';
import {
  GOOGLE_KEY_MISSING_MESSAGE, GOOGLE_UNAVAILABLE_MESSAGE, TRAVEL_NOT_LOADED_MESSAGE, travelErrorBody,
} from '../../server/api/v2/errors';
import {
  INCOMPLETE_FILE, INVALID_GENERATE, MVP1_FILE, NOT_A_RELAY_FILE, RECOMPUTE_LOCKED, UNKNOWN_FILE_VERSION, planGenerate,
} from '../../server/api/v2/planningOps';
import {
  DEADLINE_BEFORE_READY, DEADLINE_OUTSIDE_WINDOW, INVALID_SHIPMENT, READY_OUTSIDE_WINDOW, SAME_BUSINESS,
  SHIPMENTS_LOCKED, SHIPMENT_MATCHED, SHIPMENT_NOT_FOUND, SHIPMENT_NOT_READABLE, UNKNOWN_BUSINESS,
} from '../../server/api/v2/shipmentOps';
import { commuteOf, deliveryRequest, readCity, recordFetch, type City } from './v2-e2e-nyc-helper';
import { startControlsApi, T, type ControlsApi } from './v2-nyc-controls-helper';
import { inputsWithPlaces, testPlaces } from './v2-planning-ops-sample';

// ---------- the rules ----------

const MAX_WORDS = 14;

/** Words a page never uses: contract names, status numbers, JavaScript types, what Zod says by default. */
const JARGON: [string, RegExp][] = [
  ['hub', /\bhubs?\b/i],
  ['trip', /\btrips?\b/i],
  ['ID', /\bids?\b/i],
  ['an ID value', /\b(biz|emp|shp|home|plan|run|job)-\w/],
  ['a status number', /\b(400|404|409|500|503)\b/],
  ['HTTP', /\bhttp\b/i],
  ['phase', /\bphase\b/i],
  ['locked', /\block(ed|s)?\b/i],
  ['run, the stored thing', /\b(the|this|a|locked|stored) run\b/i],
  ['shipment', /\bshipments?\b/i],
  ['JSON', /\bjson\b/i],
  ['a programming word', /\b(object|array|string|boolean|integer|null|undefined|nan|enum|schema|payload|body|endpoint|zod)\b/i],
  ['Zod\'s default text', /\b(expected|received)\b|invalid (input|option)/i],
  ['a label, not a sentence', /^(invalid|unknown)\b|\bnot found\b/i],
  ['a contract field (camelCase)', /[a-z][A-Z]/],
  ['a contract value (snake_case)', /[a-z]_[a-z]/],
  ['lat / lng', /\b(lat|lng)\b/i],
  ['cache', /\bcach(e|ed|es)\b/i],
  ['geocoded', /geocod/i],
  ['recompute', /recompute/i],
  ['planning cycle / window', /planning (cycle|window)/i],
  ['MVP', /\bmvp\b/i],
  ['synthetic city', /synthetic/i],
];

const wordsOf = (text: string) => text.trim().split(/\s+/).filter(Boolean);

/** What is wrong with a text as plain copy; empty when nothing is. `sentence`: it must end with a period. */
function problemsOf(text: string, sentence: boolean): string[] {
  const problems: string[] = [];
  if (text.trim() === '' || text !== text.trim()) problems.push('empty or padded');
  if (!/^[A-Z0-9]/.test(text)) problems.push('does not start with a capital letter or a number');
  if (sentence && !text.endsWith('.')) problems.push('does not end with a period');
  if (!sentence && /[.!?]$/.test(text)) problems.push('a form hint ends with a period');
  // One sentence: no sentence end inside the text, and no line break.
  if (/[.!?]\s|\n/.test(text)) problems.push('more than one sentence');
  if (wordsOf(text).length > MAX_WORDS) problems.push(`${wordsOf(text).length} words, more than ${MAX_WORDS}`);
  for (const [name, pattern] of JARGON) if (pattern.test(text)) problems.push(`jargon: ${name}`);
  return problems;
}

/** A setup text (503 with a `code`): one plain sentence, then the command or the .env key. */
const SETUP_TAIL = /^(Run npm run fetch:routes and commit fixtures\/nyc\/( \(\S+ to \S+\))?\.|Add GOOGLE_MAPS_SERVER_KEY to \.env and restart the server\.)$/;

function setupProblemsOf(text: string): string[] {
  const cut = text.indexOf('. ');
  if (cut < 0) return problemsOf(text, true);
  const tail = text.slice(cut + 2);
  return [
    ...problemsOf(text.slice(0, cut + 1), true),
    ...(SETUP_TAIL.test(tail) ? [] : [`after the first sentence comes something that is not a setup step: ${tail}`]),
  ];
}

type ErrorBody = { error: string; code?: string; fieldErrors?: Record<string, string> };

/** Every text of every refusal this file saw, so the last test can say which sentences were never triggered. */
const seen = new Set<string>();

/** Checks the whole answer as copy and returns it. */
function expectPlain(body: ErrorBody, what: string): ErrorBody {
  expect(typeof body.error, `${what}: error`).toBe('string');
  seen.add(body.error);
  const setup = body.code !== undefined;
  expect(setup ? setupProblemsOf(body.error) : problemsOf(body.error, true), `${what}: "${body.error}"`).toStrictEqual([]);
  for (const [field, text] of Object.entries(body.fieldErrors ?? {})) {
    seen.add(text);
    expect(problemsOf(text, false), `${what}: fieldErrors.${field} "${text}"`).toStrictEqual([]);
  }
  return body;
}

// ---------- the server ----------

const net = recordFetch();
let api: ControlsApi;
let city: City;
let first: SimulatorResponse;

beforeAll(async () => {
  api = await startControlsApi(net);
  city = await readCity(api);
  first = await api.simulator();
  expect(first.clock.phase).toBe('planning');
}, T);
afterEach(() => net.expectNoOutgoing());
afterAll(async () => {
  await api?.close();
  net.restore();
}, T);

type Sent = { method: 'POST' | 'PUT' | 'PATCH'; url: string; body?: unknown };

/** Sends a request that must be refused with `status`, checks the answer as copy and returns it. */
async function refused(sent: Sent, status: number, what: string): Promise<ErrorBody> {
  const res = sent.method === 'PATCH' ? await api.patch<ErrorBody>(sent.url, sent.body)
    : sent.method === 'PUT' ? await api.put<ErrorBody>(sent.url, sent.body)
      : await api.post<ErrorBody>(sent.url, sent.body);
  expect(`${res.status} ${JSON.stringify(res.body)}`, what).toMatch(new RegExp(`^${status} `));
  return expectPlain(res.body, what);
}

const twoBusinesses = () => city.businesses.map((b) => b.id).sort().slice(0, 2);
const validDelivery = (tag: string) => {
  const [from, to] = twoBusinesses();
  return deliveryRequest(`copy-${tag}`, from, to, city.settings);
};
const matchedId = () => {
  const plan = first.plans[0];
  if (!plan) throw new Error('The demo run has no matched delivery');
  return plan.shipmentId;
};
const sendDelivery = (body: unknown): Sent => ({ method: 'POST', url: '/shipments', body });
const saveCommute = (id: string, body: unknown): Sent => ({ method: 'PUT', url: `/employees/${id}/commute`, body });
const control = (body: unknown): Sent => ({ method: 'POST', url: '/simulator/control', body });
const generate = (body: unknown): Sent => ({ method: 'POST', url: '/scenario/generate', body });
const importFile = (body: unknown): Sent => ({ method: 'POST', url: '/scenario/import', body });

// ---------- the list itself ----------

describe('the no-jargon list', () => {
  it('refuses the words the issue names and the texts the routes sent before', () => {
    for (const old of [
      'The hub is closed.', 'The trip id is missing.', 'The server answered 409.', 'The phase is wrong.',
      'This is a locked run.',
      'Invalid shipment', 'Shipment not found', 'Unknown business', 'Employee not found',
      'Send the delivery details as a JSON object', 'A request ID is required',
      'Ready time is outside the planning window',
      'Choose a home: an existing homeId, or lat, lng and neighborhood',
      'Invalid input: expected string, received undefined',
      'Google Maps is unavailable right now (HTTP 403).',
      'No travel time is cached for biz-etsy to home-story-astoria-1.',
      'This file is from the synthetic-city version of Relay and cannot be loaded into the NYC version.',
    ]) {
      expect(problemsOf(old, old.endsWith('.')).filter((p) => p.startsWith('jargon')), old).not.toStrictEqual([]);
    }
  });

  it('refuses two sentences, a long sentence and a setup text that does not start plainly', () => {
    expect(problemsOf('The simulation is playing. Press Back to start in the simulator.', true)).toContain('more than one sentence');
    expect(problemsOf(`Word ${'word '.repeat(MAX_WORDS - 1)}more.`, true)).toStrictEqual([`${MAX_WORDS + 1} words, more than ${MAX_WORDS}`]);
    expect(setupProblemsOf('No travel time is cached for biz-a to biz-b. Run npm run fetch:routes and commit fixtures/nyc/.'))
      .not.toStrictEqual([]);
    expect(setupProblemsOf('A travel time is missing on this server. Call the developer.')).not.toStrictEqual([]);
  });
});

// ---------- send a delivery ----------

describe('send a delivery (planning)', () => {
  it('a weight that is too heavy, zero or not a number', async () => {
    const heavy = await refused(sendDelivery({ ...validDelivery('heavy'), weightKg: 5 }), 400, 'weight 5 kg');
    expect(heavy).toStrictEqual({ error: INVALID_SHIPMENT, fieldErrors: { weightKg: 'Max 2 kg' } });
    const zero = await refused(sendDelivery({ ...validDelivery('zero'), weightKg: 0 }), 400, 'weight 0 kg');
    expect(zero.fieldErrors).toStrictEqual({ weightKg: 'Weight must be above 0 kg' });
    const text = await refused(sendDelivery({ ...validDelivery('text'), weightKg: 'heavy' }), 400, 'weight as text');
    expect(text.fieldErrors).toStrictEqual({ weightKg: 'Weight must be a number of kg' });
    expect(INVALID_SHIPMENT).toBe('Fix the missing or wrong delivery details, then try again.');
  }, T);

  it('an unknown business, as sender and as recipient, and the sender as recipient', async () => {
    const [from] = twoBusinesses();
    const unknown = await refused(
      sendDelivery({ ...validDelivery('unknown'), originBusinessId: 'biz-nowhere', destinationBusinessId: 'biz-nobody' }), 400, 'unknown businesses',
    );
    expect(unknown.fieldErrors).toStrictEqual({ originBusinessId: UNKNOWN_BUSINESS, destinationBusinessId: UNKNOWN_BUSINESS });
    expect(UNKNOWN_BUSINESS).toBe('Choose a business from the list');
    const same = await refused(sendDelivery({ ...validDelivery('same'), destinationBusinessId: from }), 400, 'sender as recipient');
    expect(same.fieldErrors).toStrictEqual({ destinationBusinessId: SAME_BUSINESS });
  }, T);

  it('times outside the simulation, and a deliver-by before the ready time', async () => {
    const { simStartMin, simEndMin } = city.settings;
    const outside = await refused(
      sendDelivery({ ...validDelivery('outside'), readyMin: simStartMin - 1, deadlineMin: simEndMin + 1 }), 400, 'times outside',
    );
    expect(outside.fieldErrors).toStrictEqual({ readyMin: READY_OUTSIDE_WINDOW, deadlineMin: DEADLINE_OUTSIDE_WINDOW });
    expect(READY_OUTSIDE_WINDOW).toBe('Choose a ready time inside the simulation hours');
    expect(DEADLINE_OUTSIDE_WINDOW).toBe('Choose a deliver-by time inside the simulation hours');
    const backwards = await refused(
      sendDelivery({ ...validDelivery('backwards'), readyMin: simStartMin + 60, deadlineMin: simStartMin + 30 }), 400, 'deliver-by before ready',
    );
    expect(backwards.fieldErrors).toStrictEqual({ deadlineMin: DEADLINE_BEFORE_READY });
  }, T);

  it('an empty form, a form with every field of the wrong kind, and no form at all', async () => {
    const empty = await refused(sendDelivery({}), 400, 'an empty form');
    expect(Object.keys(empty.fieldErrors ?? {}).sort()).toStrictEqual([
      'category', 'clientRequestId', 'deadlineMin', 'description', 'destinationBusinessId', 'label', 'originBusinessId',
      'readyMin', 'weightKg',
    ]);
    expect(empty.fieldErrors?.clientRequestId).toBe(SHIPMENT_NOT_READABLE);
    const wrong = await refused(sendDelivery({
      clientRequestId: 7, originBusinessId: 7, destinationBusinessId: 7, label: 7, category: 'crate', description: 7,
      weightKg: 'x', readyMin: 1000.5, deadlineMin: 'noon', pickupInstructions: 7, dropoffInstructions: 7,
    }), 400, 'every field of the wrong kind');
    expect(Object.keys(wrong.fieldErrors ?? {})).toHaveLength(11);
    for (const [name, body] of [['a list', [validDelivery('list')]], ['no body', undefined]] as const) {
      const none = await refused(sendDelivery(body), 400, name);
      expect(none).toStrictEqual({ error: INVALID_SHIPMENT, fieldErrors: { body: SHIPMENT_NOT_READABLE } });
    }
    expect(SHIPMENT_NOT_READABLE).toBe('The delivery details did not arrive, so reload the page and send again');
  }, T);

  it('an edit or a retry of a delivery that is not there, and an edit of a matched delivery', async () => {
    const gone = await refused({ method: 'PATCH', url: '/shipments/shp-nowhere', body: { label: 'New name' } }, 404, 'edit of an unknown delivery');
    expect(gone).toStrictEqual({ error: SHIPMENT_NOT_FOUND });
    expect(SHIPMENT_NOT_FOUND).toBe('This delivery no longer exists, so refresh the page to see the current list.');
    expect(await refused({ method: 'POST', url: '/shipments/shp-nowhere/match' }, 404, 'retry of an unknown delivery'))
      .toStrictEqual({ error: SHIPMENT_NOT_FOUND });
    const matched = await refused({ method: 'PATCH', url: `/shipments/${matchedId()}`, body: { label: 'New name' } }, 409, 'edit of a matched delivery');
    expect(matched).toStrictEqual({ error: SHIPMENT_MATCHED });
    expect(SHIPMENT_MATCHED).toBe('This delivery is already matched, so it can no longer be edited.');
  }, T);
});

// ---------- save a commute ----------

describe('save a commute (planning)', () => {
  it('an employee that is not there', async () => {
    const body = commuteOf(city.employees[0]);
    expect(await refused(saveCommute('emp-nowhere', body), 404, 'unknown employee')).toStrictEqual({ error: EMPLOYEE_NOT_FOUND });
    expect(EMPLOYEE_NOT_FOUND).toBe('This employee is no longer listed, so refresh the page and choose again.');
  }, T);

  it('an unknown workplace, an unknown home and a home outside New York City', async () => {
    const employee = city.employees[0];
    const unknown = await refused(
      saveCommute(employee.id, { ...commuteOf(employee), businessId: 'biz-nowhere', home: { homeId: 'home-nowhere' } }), 400, 'unknown workplace and home',
    );
    expect(unknown).toStrictEqual({ error: INVALID_COMMUTE, fieldErrors: { businessId: UNKNOWN_WORKPLACE, home: UNKNOWN_HOME } });
    expect(INVALID_COMMUTE).toBe('Fix the missing or wrong commute details, then save again.');
    expect(UNKNOWN_WORKPLACE).toBe('Choose a workplace from the list');
    expect(UNKNOWN_HOME).toBe('Choose a home from the list, or search for an address');
    const far = await refused(
      saveCommute(employee.id, commuteOf(employee, { home: { lat: 41.5, lng: -73.9, neighborhood: 'Upstate' } })), 400, 'home outside NYC',
    );
    expect(far.fieldErrors).toStrictEqual({ home: HOME_OUTSIDE_NYC });
  }, T);

  it('an empty form, a form with every field of the wrong kind, and no form at all', async () => {
    const { id } = city.employees[0];
    const empty = await refused(saveCommute(id, {}), 400, 'an empty form');
    // Each field has its own hint, in the words of the commute editor; the keys are the contract's.
    const { body: noBody, ...fields } = COMMUTE_FIELD_COPY;
    expect(empty).toStrictEqual({ error: INVALID_COMMUTE, fieldErrors: fields });
    const wrong = await refused(saveCommute(id, {
      businessId: 7, home: { homeId: 7 }, eveningDepartureMin: 2000, morningDepartureMin: 10, availableEvening: 'yes',
      availableMorning: 'no', maxExtraMin: 99,
    }), 400, 'every field of the wrong kind');
    expect(wrong.fieldErrors).toStrictEqual(fields);
    const half = await refused(saveCommute(id, { ...commuteOf(city.employees[0]), home: { lat: 40.7 } }), 400, 'half a home');
    expect(half.fieldErrors).toStrictEqual({ home: UNKNOWN_HOME });
    for (const [name, body] of [['a list', [commuteOf(city.employees[0])]], ['no body', undefined]] as const) {
      expect(await refused(saveCommute(id, body), 400, name)).toStrictEqual({ error: INVALID_COMMUTE, fieldErrors: { body: noBody } });
    }
  }, T);

  it('a new address with no Google key on the server', async () => {
    const employee = city.employees[0];
    // A made-up point in Manhattan, in no run and in no travel data.
    const res = await refused(
      saveCommute(employee.id, commuteOf(employee, { home: { lat: 40.75123, lng: -73.98765, neighborhood: 'Midtown' } })), 503, 'a new address',
    );
    expect(res).toStrictEqual({ error: GOOGLE_KEY_MISSING_MESSAGE, code: 'google_key_missing' });
    expect(GOOGLE_KEY_MISSING_MESSAGE)
      .toBe('The Google Maps server key is not set. Add GOOGLE_MAPS_SERVER_KEY to .env and restart the server.');
    net.expectNoOutgoing();
  }, T);
});

// ---------- Play / Back to start ----------

describe('the playback controls', () => {
  it('a control the server does not know, a speed it does not offer and a seek outside the simulation', async () => {
    const { simStartMin, simEndMin } = city.settings;
    const cases: [string, unknown, Record<string, string>][] = [
      ['no control', {}, { action: 'Choose a playback control' }],
      ['an unknown control', { action: 'rewind' }, { action: 'Choose a playback control' }],
      ['a list', [{ action: 'play' }], { body: 'Choose a playback control' }],
      ['a speed that is not offered', { action: 'speed', speed: 60 }, { speed: 'Choose one of the listed speeds' }],
      ['a seek before the start', { action: 'seek', timeMin: simStartMin - 1 }, { timeMin: SEEK_OUTSIDE_RUN }],
      ['a seek after the end', { action: 'seek', timeMin: simEndMin + 1 }, { timeMin: SEEK_OUTSIDE_RUN }],
      ['a seek to half a minute', { action: 'seek', timeMin: simStartMin + 0.5 }, { timeMin: SEEK_OUTSIDE_RUN }],
      ['a seek with no time', { action: 'seek' }, { timeMin: SEEK_OUTSIDE_RUN }],
    ];
    for (const [name, body, fieldErrors] of cases) {
      expect(await refused(control(body), 400, name), name).toStrictEqual({ error: INVALID_CONTROL, fieldErrors });
    }
    expect(INVALID_CONTROL).toBe('The simulator did not understand that control, so reload the page and try again.');
    expect(SEEK_OUTSIDE_RUN).toBe('Choose a time inside the simulation hours');
    // Nothing above moved the clock or started playback.
    expect((await api.simulator()).clock).toStrictEqual(first.clock);
  }, T);
});

// ---------- planning ----------

describe('planning: generate a scenario and load a file', () => {
  it('scenario options that are missing, out of range or not a form', async () => {
    const wrong = await refused(generate({ preset: 'tokyo', seed: 1.5, employees: 5, packages: 500, maxExtraMin: 99 }), 400, 'wrong options');
    expect(wrong).toStrictEqual({
      error: INVALID_GENERATE,
      fieldErrors: {
        preset: 'Choose demo or random',
        seed: 'Seed must be a whole number',
        employees: 'Employees must be a whole number from 10 to 120',
        packages: 'Packages must be a whole number from 5 to 60',
        maxExtraMin: 'Max added time must be a whole number from 0 to 30 minutes',
      },
    });
    expect(INVALID_GENERATE).toBe('Fix the missing or wrong scenario options, then try again.');
    const list = await refused(generate([{ preset: 'demo' }]), 400, 'a list');
    expect(list.fieldErrors).toStrictEqual({ body: 'The scenario options did not arrive, so choose them and try again' });
  }, T);

  it('a file that is not a Relay file, from another version, incomplete or inconsistent', async () => {
    const file = (edit: (run: RunV2) => void) => api.exportRun().then((run) => {
      edit(run);
      return run;
    });
    const load = async (what: string, body: unknown) => refused(importFile(body), 400, what);

    expect(await load('not a Relay file', { hello: 'world' })).toStrictEqual({ error: NOT_A_RELAY_FILE });
    expect(await load('an older file', await file((run) => { (run.scenario as { schemaVersion: number }).schemaVersion = 1; })))
      .toStrictEqual({ error: MVP1_FILE });
    expect(await load('a newer file', await file((run) => { (run.scenario as { schemaVersion: number }).schemaVersion = 3; })))
      .toStrictEqual({ error: UNKNOWN_FILE_VERSION });
    expect(NOT_A_RELAY_FILE).toBe('This file is not a Relay scenario export, so it was not loaded.');
    expect(MVP1_FILE).toBe('This file is from an older version of Relay, so it was not loaded.');
    expect(UNKNOWN_FILE_VERSION).toBe('This file is from another version of Relay, so it was not loaded.');

    const incomplete = await load('an incomplete file', await file((run) => {
      delete (run as Partial<RunV2>).jobs;
      (run.clock as { speed: number }).speed = 7;
    }));
    expect(incomplete).toStrictEqual({ error: INCOMPLETE_FILE, fieldErrors: { jobs: 'Missing', 'clock.speed': 'Not a valid value' } });
    expect(INCOMPLETE_FILE).toBe('This file is not a complete Relay scenario export, so it was not loaded.');

    const twice = await load('the same employee twice', await file((run) => { run.scenario.employees.push({ ...run.scenario.employees[0] }); }));
    expect(twice.error).toBe('This file lists the same employee twice, so it was not loaded.');
    expect(Object.values(twice.fieldErrors ?? {})).toStrictEqual(['Listed twice']);
    const twicePlan = await load('the same plan twice', await file((run) => { run.assignments.plans.push({ ...run.assignments.plans[0] }); }));
    expect(twicePlan.error).toBe('This file lists the same plan twice, so it was not loaded.');

    const dangling = await load('a workplace that is not in the file', await file((run) => { run.scenario.employees[0].businessId = 'biz-nowhere'; }));
    expect(dangling).toStrictEqual({
      error: 'This file names a business it does not list, so it was not loaded.',
      fieldErrors: { 'scenario.employees.0.businessId': 'Not in this file' },
    });
    const noPlan = await load('a job of a plan that is not in the file', await file((run) => { run.jobs[0].planId = 'plan-nowhere'; }));
    expect(noPlan.error).toBe('This file names a plan it does not list, so it was not loaded.');
  }, T);

  it('a file with a place, a commute or a delivery this server has no travel time for', async () => {
    const file = (edit: (run: RunV2) => void) => api.exportRun().then((run) => {
      edit(run);
      return run;
    });
    const newHome = await refused(importFile(await file((run) => {
      const home = { ...run.scenario.homes[0], id: 'home-copy-test' };
      run.scenario.homes.push(home);
      run.scenario.employees[0].homeId = home.id;
    })), 400, 'a home with no travel times');
    expect(newHome).toStrictEqual({ error: 'This file has 1 place without travel times, so it was not loaded.' });

    const newBusiness = await refused(importFile(await file((run) => {
      run.scenario.businesses.push({ ...run.scenario.businesses[0], id: 'biz-copy-test', name: 'Copy Test' });
    })), 400, 'a business no commute has a travel time to');
    expect(newBusiness.error).toBe('A commute in this file has no travel time, so it was not loaded.');
    expect(Object.values(newBusiness.fieldErrors ?? {})).toStrictEqual(['No travel time']);

    const detour = await refused(importFile(await file((run) => {
      const [a, b] = run.scenario.homes;
      run.assignments.plans[0].legs[0].placeIds = [a.id, b.id];
    })), 400, 'a delivery that drives from one home to another');
    expect(detour.error).toBe('A delivery in this file has no travel time, so it was not loaded.');
    expect(Object.values(detour.fieldErrors ?? {})).toStrictEqual(['No travel time']);
    // No refused file replaced the run.
    expect((await api.simulator()).runId).toBe(first.runId);
  }, T);
});

// ---------- after Play ----------

describe('after Play', () => {
  it('a delivery, an edit, a retry, a commute save and a new match are refused in one sentence each', async () => {
    const employee = city.employees[0];
    // An unmatched delivery to edit and to retry, stored while the run still takes changes.
    const [from, to] = twoBusinesses();
    const stored = await api.post<{ shipment: { id: string } }>('/shipments', {
      ...deliveryRequest('copy-before-play', from, to, city.settings), readyMin: city.settings.simEndMin - 2, deadlineMin: city.settings.simEndMin - 1,
    });
    expect(stored.status).toBe(201);
    const { id } = stored.body.shipment;

    expect((await api.control({ action: 'play' })).clock.phase).toBe('locked');
    await api.control({ action: 'pause' });

    expect(await refused(sendDelivery(validDelivery('after-play')), 409, 'send after Play')).toStrictEqual({ error: SHIPMENTS_LOCKED });
    expect(await refused({ method: 'PATCH', url: `/shipments/${id}`, body: { label: 'New name' } }, 409, 'edit after Play'))
      .toStrictEqual({ error: SHIPMENTS_LOCKED });
    expect(await refused({ method: 'POST', url: `/shipments/${id}/match` }, 409, 'retry after Play')).toStrictEqual({ error: SHIPMENTS_LOCKED });
    expect(await refused(saveCommute(employee.id, commuteOf(employee)), 409, 'commute save after Play')).toStrictEqual({ error: COMMUTE_LOCKED });
    expect(await refused({ method: 'POST', url: '/matches/recompute' }, 409, 'match again after Play')).toStrictEqual({ error: RECOMPUTE_LOCKED });

    expect(SHIPMENTS_LOCKED).toBe('Playback has started, so press Back to start in the simulator to change deliveries.');
    expect(COMMUTE_LOCKED).toBe('Playback has started, so press Back to start in the simulator to edit commutes.');
    expect(RECOMPUTE_LOCKED).toBe('Playback has started, so press Back to start in the simulator to match again.');

    // The sentence is true: Back to start takes changes again.
    expect((await api.control({ action: 'reset_playback' })).clock.phase).toBe('planning');
    expect((await api.post('/shipments', validDelivery('after-back-to-start'))).status).toBe(201);
  }, T);
});

// ---------- travel errors that the committed travel data cannot trigger ----------

describe('travel errors (503)', () => {
  it('missing travel data starts with one plain sentence, then the command and the two places', () => {
    const time = expectPlain(travelErrorBody(new TravelDataMissingError('biz-etsy', 'home-story-astoria-1'))!, 'a missing travel time');
    expect(time).toStrictEqual({
      error: 'A travel time is missing on this server. Run npm run fetch:routes and commit fixtures/nyc/ (biz-etsy to home-story-astoria-1).',
      code: 'travel_data_missing',
    });
    const line = expectPlain(travelErrorBody(new TravelDataMissingError('biz-etsy', 'biz-cafe', 'polyline'))!, 'a missing route line');
    expect(line.error).toBe('A route line is missing on this server. Run npm run fetch:routes and commit fixtures/nyc/ (biz-etsy to biz-cafe).');
    expectPlain({ error: TRAVEL_NOT_LOADED_MESSAGE, code: 'travel_data_missing' }, 'no travel data at all');
    expect(TRAVEL_NOT_LOADED_MESSAGE).toBe('NYC travel data is not loaded. Run npm run fetch:routes and commit fixtures/nyc/.');
  });

  it('a business with no point on the map', () => {
    const places = testPlaces();
    delete places[Object.keys(places)[0]];
    const plan = planGenerate({ preset: 'demo' }, inputsWithPlaces(places));
    if (plan.kind !== 'unavailable') throw new Error(`expected a refusal, got ${plan.kind}`);
    expectPlain(plan.error, 'a business with no location');
    expect(plan.error.error).toMatch(/^1 of \d+ businesses has no map location yet\. Run npm run fetch:routes and commit fixtures\/nyc\/\.$/);
  });

  it('Google not answering is one sentence without Google\'s status', () => {
    for (const status of [0, 403, 500]) {
      const body = travelErrorBody(new GoogleApiError({
        status, googleStatus: 'PERMISSION_DENIED', endpoint: 'https://example.invalid/x', message: 'upstream text with key=SECRET',
      }))!;
      // No setup step follows, so the whole text is the one sentence.
      expect(problemsOf(body.error, true), body.error).toStrictEqual([]);
      expect(body).toStrictEqual({ error: GOOGLE_UNAVAILABLE_MESSAGE, code: 'google_unavailable' });
    }
    expect(GOOGLE_UNAVAILABLE_MESSAGE).toBe('Google Maps is not answering right now, so try again in a moment.');
    expect(travelErrorBody(new GoogleKeyMissingError())).toStrictEqual({ error: GOOGLE_KEY_MISSING_MESSAGE, code: 'google_key_missing' });
  });
});

// ---------- nothing was left out ----------

describe('every sentence of the write routes was triggered above', () => {
  it('each exported text was in an answer', () => {
    const { body: _noBody, ...commuteFields } = COMMUTE_FIELD_COPY;
    const texts = [
      INVALID_SHIPMENT, SHIPMENT_NOT_FOUND, SHIPMENTS_LOCKED, SHIPMENT_MATCHED, UNKNOWN_BUSINESS, SAME_BUSINESS,
      READY_OUTSIDE_WINDOW, DEADLINE_OUTSIDE_WINDOW, DEADLINE_BEFORE_READY, SHIPMENT_NOT_READABLE,
      EMPLOYEE_NOT_FOUND, COMMUTE_LOCKED, INVALID_COMMUTE, UNKNOWN_WORKPLACE, UNKNOWN_HOME, HOME_OUTSIDE_NYC,
      ...Object.values(COMMUTE_FIELD_COPY), ...Object.values(commuteFields),
      INVALID_CONTROL, SEEK_OUTSIDE_RUN,
      RECOMPUTE_LOCKED, INVALID_GENERATE, NOT_A_RELAY_FILE, MVP1_FILE, UNKNOWN_FILE_VERSION, INCOMPLETE_FILE,
      GOOGLE_KEY_MISSING_MESSAGE, TRAVEL_NOT_LOADED_MESSAGE,
    ];
    expect(texts.filter((text) => !seen.has(text))).toStrictEqual([]);
  });
});
