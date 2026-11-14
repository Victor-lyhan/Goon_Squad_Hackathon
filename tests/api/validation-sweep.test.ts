import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';

let server: Server;
let base: string;
let store: ReturnType<typeof createStore>;
let file: string;

beforeAll(async () => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vsweep-')), 'state.json');
  store = createStore({ filePath: file, initial: () => createInitialRun(loadDefaultScenario()) });
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

type Raw = string | undefined;
const j = (x: unknown): Raw => JSON.stringify(x);
const HUGE = JSON.stringify({ pad: 'x'.repeat(6 * 1024 * 1024) }); // over the 5mb limit

const fileText = async () => {
  await store.flush();
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '<none>';
};

async function expectRejected(method: string, url: string, raw: Raw, statuses = [400]) {
  const before = { run: store.get(), file: await fileText() };
  const r = await fetch(`${base}${url}`, {
    method, headers: raw === undefined ? {} : { 'content-type': 'application/json' }, body: raw,
  });
  const text = await r.text();
  expect(statuses, `${method} ${url} -> ${r.status}: ${text.slice(0, 120)}`).toContain(r.status);
  expect(r.headers.get('content-type') ?? '').toMatch(/application\/json/);
  const body = JSON.parse(text) as { error: unknown };
  expect(typeof body.error).toBe('string');
  const after = store.get();
  expect(after.version).toBe(before.run.version);
  expect(after.runId).toBe(before.run.runId);
  expect(after).toEqual(before.run);
  expect(await fileText()).toBe(before.file);
}

const run0 = () => store.get();
const biz = () => run0().scenario.businesses;
const node = () => run0().scenario.graph.nodes[0].id;
const shipmentOk = () => ({
  clientRequestId: 'sweep-1', originBusinessId: biz()[0].id, destinationBusinessId: biz()[1].id,
  label: 'Docs', category: 'envelope', description: 'Papers', weightKg: 0.5,
  readyMin: run0().scenario.settings.simStartMin, deadlineMin: run0().scenario.settings.simEndMin,
  pickupInstructions: '', dropoffInstructions: '',
});
const commuteOk = () => ({
  businessId: biz()[0].id, homeNodeId: node(), eveningDepartureMin: 1000, morningDepartureMin: 1900,
  availableEvening: true, availableMorning: true, maxExtraMin: 5, eveningViaNodeIds: [], morningViaNodeIds: [],
});

/** Bodies every JSON-parsing route must reject (type-level garbage + transport-level garbage). */
const transport: [string, Raw][] = [
  ['malformed JSON', '{"a":'],
  ['truncated array', '['],
  ['plain text', 'hello'],
  ['over the size limit', HUGE],
];
const shapeless: [string, Raw][] = [
  ['empty body', undefined],
  ['empty string', ''],
  ['null', 'null'],
  ['array', '[]'],
  ['number', '42'],
  ['string', '"x"'],
  ['empty object', '{}'],
];

const sizeOk = [400, 413];
function sweepTransport(method: string, url: () => string) {
  for (const [name, raw] of transport) {
    it(`transport: ${name}`, () => expectRejected(method, url(), raw, name === 'over the size limit' ? sizeOk : [400]));
  }
}
function sweepTable(method: string, url: () => string, table: [string, () => unknown][], withShapeless = true) {
  sweepTransport(method, url);
  if (withShapeless) {
    for (const [name, raw] of shapeless) it(`shape: ${name}`, () => expectRejected(method, url(), raw));
  }
  for (const [name, make] of table) it(`bad body: ${name}`, () => expectRejected(method, url(), j(make())));
}

const bad = <T extends object>(ok: () => T, over: Partial<Record<keyof T, unknown>>) => () => ({ ...ok(), ...over });
const without = <T extends object>(ok: () => T, k: keyof T) => () => {
  const { [k]: _omit, ...rest } = ok();
  return rest;
};

describe('POST /api/shipments', () => {
  const ok = shipmentOk;
  sweepTable('POST', () => '/api/shipments', [
    ['missing label', without(ok, 'label')],
    ['missing clientRequestId', without(ok, 'clientRequestId')],
    ['label is number', bad(ok, { label: 5 })],
    ['blank label', bad(ok, { label: '   ' })],
    ['unknown category', bad(ok, { category: 'pallet' })],
    ['weight string', bad(ok, { weightKg: '1' })],
    ['weight negative', bad(ok, { weightKg: -1 })],
    ['weight huge', bad(ok, { weightKg: 1e9 })],
    ['weight null', bad(ok, { weightKg: null })],
    ['readyMin negative', bad(ok, { readyMin: -5 })],
    ['readyMin huge', bad(ok, { readyMin: 1e12 })],
    ['readyMin fractional', bad(ok, { readyMin: 1000.5 })],
    ['deadline before ready', bad(ok, { deadlineMin: 1 })],
    ['unknown origin', bad(ok, { originBusinessId: 'nope' })],
    ['unknown destination', bad(ok, { destinationBusinessId: 'nope' })],
    ['same origin and destination', () => ({ ...ok(), destinationBusinessId: ok().originBusinessId })],
    ['instructions number', bad(ok, { pickupInstructions: 7 })],
  ]);
});

describe('PATCH /api/shipments/:id', () => {
  // An unmatched shipment (heavy envelope nobody can carry is not guaranteed), so find or force one.
  let patchId = '';
  beforeAll(async () => {
    const unmatched = run0().assignments.unmatched[0]?.shipmentId;
    if (unmatched) { patchId = unmatched; return; }
    const r = await fetch(`${base}/api/shipments`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...shipmentOk(), clientRequestId: 'sweep-patch', readyMin: run0().scenario.settings.simEndMin - 2, deadlineMin: run0().scenario.settings.simEndMin }),
    });
    patchId = ((await r.json()) as { shipment: { id: string } }).shipment.id;
  });
  const id = () => patchId;
  sweepTransport('PATCH', () => `/api/shipments/${id()}`);
  for (const [name, raw] of shapeless.filter(([n]) => ['null', 'array', 'number', 'string'].includes(n))) {
    it(`shape: ${name}`, () => expectRejected('PATCH', `/api/shipments/${id()}`, raw));
  }
  const cases: [string, unknown][] = [
    ['label number', { label: 5 }], ['unknown category', { category: 'x' }], ['weight negative', { weightKg: -2 }],
    ['weight huge', { weightKg: 1e9 }], ['weight string', { weightKg: 'a' }], ['readyMin negative', { readyMin: -1 }],
    ['deadlineMin huge', { deadlineMin: 1e9 }], ['unknown destination', { destinationBusinessId: 'nope' }],
    ['deadline before ready', { readyMin: 2000, deadlineMin: 1999 }],
  ];
  for (const [name, body] of cases) it(`bad body: ${name}`, () => expectRejected('PATCH', `/api/shipments/${id()}`, j(body)));
});

describe('POST /api/shipments/:id/match', () => {
  it.each(transport)('transport: %s', (name, raw) =>
    expectRejected('POST', `/api/shipments/${run0().scenario.shipments[0].id}/match`, raw, name === 'over the size limit' ? sizeOk : [400]));
  it('unknown shipment is a JSON 404', () => expectRejected('POST', '/api/shipments/nope/match', '{}', [404]));
});

describe('PUT /api/employees/:id/commute', () => {
  const ok = commuteOk;
  const id = () => run0().scenario.employees[0].id;
  sweepTable('PUT', () => `/api/employees/${id()}/commute`, [
    ['missing businessId', without(ok, 'businessId')],
    ['businessId number', bad(ok, { businessId: 3 })],
    ['unknown business', bad(ok, { businessId: 'nope' })],
    ['unknown home node', bad(ok, { homeNodeId: 'nope' })],
    ['evening departure negative', bad(ok, { eveningDepartureMin: -1 })],
    ['evening departure on day 2', bad(ok, { eveningDepartureMin: 1500 })],
    ['morning departure huge', bad(ok, { morningDepartureMin: 1e9 })],
    ['morning departure string', bad(ok, { morningDepartureMin: '1900' })],
    ['availability string', bad(ok, { availableEvening: 'yes' })],
    ['maxExtraMin negative', bad(ok, { maxExtraMin: -1 })],
    ['maxExtraMin huge', bad(ok, { maxExtraMin: 999 })],
    ['via not array', bad(ok, { eveningViaNodeIds: 'a' })],
    ['too many via', bad(ok, { morningViaNodeIds: ['a', 'b', 'c', 'd'] })],
    ['unknown via node', bad(ok, { eveningViaNodeIds: ['nope'] })],
  ]);
  it('unknown employee is a JSON 404', () => expectRejected('PUT', '/api/employees/nope/commute', j(ok()), [404]));
});

describe('POST /api/simulator/control', () => {
  sweepTable('POST', () => '/api/simulator/control', [
    ['unknown action', () => ({ action: 'explode' })],
    ['action number', () => ({ action: 1 })],
    ['speed missing', () => ({ action: 'speed' })],
    ['speed unsupported', () => ({ action: 'speed', speed: 7 })],
    ['speed string', () => ({ action: 'speed', speed: '600' })],
    ['speed negative', () => ({ action: 'speed', speed: -600 })],
    ['seek missing time', () => ({ action: 'seek' })],
    ['seek negative', () => ({ action: 'seek', timeMin: -10 })],
    ['seek huge', () => ({ action: 'seek', timeMin: 1e9 })],
    ['seek outside window', () => ({ action: 'seek', timeMin: 2 * 1440 })],
    ['seek string', () => ({ action: 'seek', timeMin: '900' })],
    ['seek NaN-like null', () => ({ action: 'seek', timeMin: null })],
  ]);
});

describe('POST /api/matches/recompute, /api/matches/compare and /api/planning/reset', () => {
  for (const url of ['/api/matches/recompute', '/api/planning/reset']) {
    describe(url, () => sweepTransport('POST', () => url));
  }
  describe('/api/matches/compare', () => sweepTransport('POST', () => '/api/matches/compare'));
});

describe('POST /api/scenario/generate', () => {
  const ok = () => ({ preset: 'random', seed: 1, employees: 20, packages: 10, hubs: 2, maxExtraMin: 5 });
  sweepTable('POST', () => '/api/scenario/generate', [
    ['unknown preset', () => ({ preset: 'huge' })],
    ['preset number', () => ({ preset: 1 })],
    ['missing preset', () => ({ seed: 1 })],
    ['seed string', bad(ok, { seed: 'abc' })],
    ['seed fractional', bad(ok, { seed: 1.5 })],
    ['employees too few', bad(ok, { employees: 0 })],
    ['employees negative', bad(ok, { employees: -5 })],
    ['employees huge', bad(ok, { employees: 1e9 })],
    ['packages huge', bad(ok, { packages: 1e6 })],
    ['hubs negative', bad(ok, { hubs: -1 })],
    ['hubs huge', bad(ok, { hubs: 500 })],
    ['maxExtraMin huge', bad(ok, { maxExtraMin: 1e6 })],
  ], false);
  // An empty body has no `preset`, so it must be rejected too.
  it.each(shapeless)('shape: %s', (_n, raw) => expectRejected('POST', '/api/scenario/generate', raw));
});

describe('POST /api/scenario/import', () => {
  const good = () => structuredClone(run0()) as unknown as Record<string, any>;
  const mutate = (fn: (r: Record<string, any>) => void) => () => { const r = good(); fn(r); return r; };
  sweepTable('POST', () => '/api/scenario/import', [
    ['no scenario', mutate((r) => { delete r.scenario; })],
    ['scenario is string', mutate((r) => { r.scenario = 'x'; })],
    ['no graph nodes', mutate((r) => { delete r.scenario.graph.nodes; })],
    ['businesses not array', mutate((r) => { r.scenario.businesses = {}; })],
    ['employees not array', mutate((r) => { r.scenario.employees = 'x'; })],
    ['no trips', mutate((r) => { delete r.trips; })],
    ['no assignments', mutate((r) => { delete r.assignments; })],
    ['no clock', mutate((r) => { delete r.clock; })],
    ['no settings', mutate((r) => { delete r.scenario.settings; })],
    ['no hubs', mutate((r) => { delete r.scenario.hubs; })],
    ['no jobs', mutate((r) => { delete r.jobs; })],
    ['no events', mutate((r) => { delete r.events; })],
    ['no notifications', mutate((r) => { delete r.notifications; })],
    ['clock timeMin string', mutate((r) => { r.clock.timeMin = 'noon'; })],
    ['clock phase unknown', mutate((r) => { r.clock.phase = 'exploded'; })],
    ['shipment entries are numbers', mutate((r) => { r.scenario.shipments = [1, 2]; })],
    ['graph nodes entries are null', mutate((r) => { r.scenario.graph.nodes = [null]; })],
  ]);
});

describe('non-JSON errors never leak HTML', () => {
  it('malformed JSON on a GET-less unknown route stays JSON', async () => {
    const r = await fetch(`${base}/api/nope`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":' });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: expect.any(String) });
  });
  it('malformed JSON body gets the middleware message', async () => {
    const r = await fetch(`${base}/api/simulator/control`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":' });
    expect(r.status).toBe(400);
    expect(r.headers.get('content-type')).toMatch(/json/);
    expect(((await r.json()) as { error: string }).error).toMatch(/JSON/);
  });
});
