// The broken-request sweep of /api/v2, part 1: broken bodies (#521; MVP 1 had this sweep in #216).
// Every write route the router lists gets the same broken bodies, then each route gets its own fields
// broken one at a time. Every answer must be a JSON 4xx in the v2 error shape, never a 500, never HTML,
// with no stack trace and no file path, and the run must be untouched: the same version, an identical
// GET /scenario/export and a byte-identical state file (or still no state file). `refused` in
// v2-sweep-helper.ts checks all of that for every single request.
// The sweep runs twice: on a fresh run (no state file yet, DECISIONS pass 49) and on a changed one, whose
// state file is written. The field-by-field loops run on the fresh run only; they do not depend on the file.
// Sample cache, no key, no network; nothing is timed.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  BODY_KEY_NOT_ALLOWED, BODY_TEXT_TOO_LONG, BODY_TOO_DEEP, MAX_BODY_DEPTH, MAX_TEXT_LENGTH, TEXT_TOO_LONG, bodyProblem,
} from '../../server/api/v2/bodyGuard';
import {
  BAD_MINUTES, BROKEN_BODIES, HUGE_TEXT, MISSING, NO_BODY, T, WRITE_SPECS, fieldAt, json, rawJson, startSweepApi,
  validAdvise, validCommute, validDelivery, validGenerate, validImport, validParseRequest, withField, withProtoKey, wrongTypeOf,
  type Sent, type SweepApi, type SweepContext,
} from './v2-sweep-helper';

type Body = Record<string, unknown>;
/** One broken request: a name and the body, built from the run as it is when the test runs. */
type Case = [name: string, build: (ctx: SweepContext) => Body | Sent];

const isSent = (value: Body | Sent): value is Sent =>
  Object.keys(value).every((key) => key === 'body' || key === 'headers') && ('body' in value || 'headers' in value);
const asSent = (value: Body | Sent): Sent => (isSent(value) ? value : json(value));

/** `valid` with one field changed. */
const broken = (valid: (ctx: SweepContext) => Body, path: string, value: unknown) =>
  (ctx: SweepContext) => withField(valid(ctx), path, value);

/** The three bad minutes for each of `paths`. */
const badMinutes = (valid: (ctx: SweepContext) => Body, paths: string[]): Case[] =>
  paths.flatMap((path) => BAD_MINUTES.map(([name, minute]): Case => [`${path} is ${name}`, broken(valid, path, minute)]));

/** 200 kB of text in each of `paths`. */
const hugeTexts = (valid: (ctx: SweepContext) => Body, paths: string[]): Case[] =>
  paths.map((path): Case => [`a 200 kB text in ${path}`, broken(valid, path, HUGE_TEXT)]);

/** `valid` as JSON text with the number at `path` written as 1e999, which a JSON parser reads as Infinity. */
const infinite = (valid: (ctx: SweepContext) => Body, path: string) => (ctx: SweepContext): Sent =>
  rawJson(JSON.stringify(withField(valid(ctx), path, '@1e999@')).replace('"@1e999@"', '1e999'));

const LONG_ID = 'b'.repeat(300);
const LONDON = { lat: 51.5072, lng: -0.1276 };
const MIDTOWN = { lat: 40.7549, lng: -73.984 };

// ---------- the fields of each route ----------

const delivery = validDelivery;
const CREATE_CASES: Case[] = [
  ['an empty object', () => ({})],
  ['an unknown category', broken(delivery, 'category', 'pallet')],
  ['a category in the wrong case', broken(delivery, 'category', 'Envelope')],
  ['a blank package name', broken(delivery, 'label', '   ')],
  ['a blank description', broken(delivery, 'description', ' ')],
  ['an empty request ID', broken(delivery, 'clientRequestId', '')],
  ['a weight of 0', broken(delivery, 'weightKg', 0)],
  ['a negative weight', broken(delivery, 'weightKg', -1)],
  ['a weight over the limit', broken(delivery, 'weightKg', 2.5)],
  ['a huge weight', broken(delivery, 'weightKg', 1e300)],
  ...badMinutes(delivery, ['readyMin', 'deadlineMin']),
  ['a ready time of 1e999', infinite(delivery, 'readyMin')],
  ['a weight of 1e999', infinite(delivery, 'weightKg')],
  // Inside the two days but outside the planning window (DECISIONS pass 6).
  ['a ready time before the planning window', (c) => ({ ...delivery(c), readyMin: c.run.scenario.settings.simStartMin - 1 })],
  ['a deliver-by after the planning window', (c) => ({ ...delivery(c), deadlineMin: c.run.scenario.settings.simEndMin + 1 })],
  ['a deliver-by before the ready time', (c) => ({ ...delivery(c), readyMin: 1500, deadlineMin: 1499 })],
  ['a deliver-by equal to the ready time', (c) => ({ ...delivery(c), readyMin: 1500, deadlineMin: 1500 })],
  ['an unknown sender', broken(delivery, 'originBusinessId', 'biz-not-a-business')],
  ['an empty sender', broken(delivery, 'originBusinessId', '')],
  ['a 300-character sender', broken(delivery, 'originBusinessId', LONG_ID)],
  ['an unknown recipient', broken(delivery, 'destinationBusinessId', 'biz-not-a-business')],
  ['a 300-character recipient', broken(delivery, 'destinationBusinessId', LONG_ID)],
  ['the sender as the recipient', (c) => ({ ...delivery(c), destinationBusinessId: c.businesses[0].id })],
  ['an employee ID as the sender', (c) => ({ ...delivery(c), originBusinessId: c.employee.id })],
  ...hugeTexts(delivery, [
    'label', 'description', 'pickupInstructions', 'dropoffInstructions', 'clientRequestId', 'originBusinessId', 'category',
  ]),
  ['a __proto__ key next to valid fields', (c) => withProtoKey(delivery(c))],
  ['every field inside a __proto__ key', (c) => rawJson(`{"__proto__":${JSON.stringify(delivery(c))}}`)],
];

/** Every field an edit may hold, with a value the route accepts. */
const fullEdit = (c: SweepContext): Body => {
  const { label, category, description, weightKg, readyMin, deadlineMin, pickupInstructions, dropoffInstructions } = delivery(c);
  const current = c.run.scenario.shipments.find((s) => s.id === c.shipmentId);
  return { label, category, description, weightKg, destinationBusinessId: current?.destinationBusinessId, readyMin, deadlineMin, pickupInstructions, dropoffInstructions };
};
const edit = (path: string, value: unknown) => (): Body => ({ [path]: value });
const EDIT_CASES: Case[] = [
  ['an unknown category', edit('category', 'pallet')],
  ['a blank package name', edit('label', '   ')],
  ['a blank description', edit('description', '')],
  ['a weight of 0', edit('weightKg', 0)],
  ['a negative weight', edit('weightKg', -2)],
  ['a weight over the limit', edit('weightKg', 9)],
  ...BAD_MINUTES.flatMap(([name, minute]): Case[] => [
    [`readyMin is ${name}`, edit('readyMin', minute)],
    [`deadlineMin is ${name}`, edit('deadlineMin', minute)],
  ]),
  ['a deliver-by of 1e999', () => rawJson('{"deadlineMin": 1e999}')],
  ['a ready time before the planning window', (c) => ({ readyMin: c.run.scenario.settings.simStartMin - 1 })],
  ['a deliver-by after the planning window', (c) => ({ deadlineMin: c.run.scenario.settings.simEndMin + 1 })],
  ['a deliver-by before the ready time', () => ({ readyMin: 1500, deadlineMin: 1499 })],
  ['an unknown recipient', edit('destinationBusinessId', 'biz-not-a-business')],
  ['an empty recipient', edit('destinationBusinessId', '')],
  ['a 300-character recipient', edit('destinationBusinessId', LONG_ID)],
  ['its own sender as the recipient', (c) => ({
    destinationBusinessId: c.run.scenario.shipments.find((s) => s.id === c.shipmentId)?.originBusinessId,
  })],
  ...['label', 'description', 'pickupInstructions', 'dropoffInstructions', 'destinationBusinessId', 'category']
    .map((path): Case => [`a 200 kB text in ${path}`, edit(path, HUGE_TEXT)]),
  ['a __proto__ key next to a valid edit', () => withProtoKey({ label: 'Sweep edit' })],
  ['the edit inside a __proto__ key', () => rawJson('{"__proto__":{"label":"Sweep edit"},"label":7}')],
];

const commute = validCommute;
/** The same commute with a new address (the other form of `home`). The broken ones never reach Google. */
const newAddress = (c: SweepContext): Body => ({ ...commute(c), home: { ...MIDTOWN, neighborhood: 'Midtown' } });
const COMMUTE_CASES: Case[] = [
  ['an empty object', () => ({})],
  ['an unknown workplace', broken(commute, 'businessId', 'biz-not-a-business')],
  ['an empty workplace', broken(commute, 'businessId', '')],
  ['a 300-character workplace', broken(commute, 'businessId', LONG_ID)],
  ['an unknown home', broken(commute, 'home.homeId', 'home-not-a-home')],
  ['an empty home ID', broken(commute, 'home.homeId', '')],
  ['a 300-character home ID', broken(commute, 'home.homeId', LONG_ID)],
  ['a home that is neither form', broken(commute, 'home', {})],
  ['a home with only a latitude', broken(commute, 'home', { lat: MIDTOWN.lat })],
  ...badMinutes(commute, ['eveningDepartureMin', 'morningDepartureMin']),
  ['an evening departure of 1e999', infinite(commute, 'eveningDepartureMin')],
  ['an evening departure on day 2', broken(commute, 'eveningDepartureMin', 1500)],
  ['a morning departure on day 1', broken(commute, 'morningDepartureMin', 1000)],
  ['a negative detour limit', broken(commute, 'maxExtraMin', -1)],
  ['a fractional detour limit', broken(commute, 'maxExtraMin', 2.5)],
  ['a detour limit over 30', broken(commute, 'maxExtraMin', 31)],
  ['a huge detour limit', broken(commute, 'maxExtraMin', 1e9)],
  // The new-address form. A point outside the NYC box is a 400 (DECISIONS pass 46).
  ['a new address outside New York City', broken(newAddress, 'home', { ...LONDON, neighborhood: 'Soho' })],
  ['a new address just outside the box', broken(newAddress, 'home', { lat: 40.4, lng: -74.0, neighborhood: 'Sea' })],
  ['a latitude out of range', broken(newAddress, 'home.lat', 91)],
  ['a longitude out of range', broken(newAddress, 'home.lng', -181)],
  ['a latitude as text', broken(newAddress, 'home.lat', '40.7549')],
  ['a longitude that is null', broken(newAddress, 'home.lng', null)],
  ['a neighborhood that is a number', broken(newAddress, 'home.neighborhood', 7)],
  ['a blank neighborhood', broken(newAddress, 'home.neighborhood', '   ')],
  ['a new address without a neighborhood', broken(newAddress, 'home.neighborhood', MISSING)],
  ['a 200 kB text in home.neighborhood', broken(newAddress, 'home.neighborhood', HUGE_TEXT)],
  ...hugeTexts(commute, ['businessId', 'home.homeId']),
  ['a __proto__ key next to valid fields', (c) => withProtoKey(commute(c))],
  ['a __proto__ key inside home', (c) => withProtoKey(commute(c), 'home')],
];

const seek = (c: SweepContext): Body => ({ action: 'seek', timeMin: c.run.scenario.settings.simStartMin + 10 });
const speed = (): Body => ({ action: 'speed', speed: 30 });
const CONTROL_CASES: Case[] = [
  ['an empty object', () => ({})],
  ['an unknown action', () => ({ action: 'explode' })],
  ['an action in the wrong case', () => ({ action: 'PLAY' })],
  ['an empty action', () => ({ action: '' })],
  ['an unsupported speed', () => ({ action: 'speed', speed: 7 })],
  ['a negative speed', () => ({ action: 'speed', speed: -30 })],
  ['a speed of 0', () => ({ action: 'speed', speed: 0 })],
  ['a fractional speed', () => ({ action: 'speed', speed: 30.5 })],
  ['a huge speed', () => ({ action: 'speed', speed: 1e9 })],
  ...badMinutes(seek, ['timeMin']),
  ['a seek to 1e999', infinite(seek, 'timeMin')],
  // Inside the two days but outside the run: refused, not clamped (DECISIONS pass 46).
  ['a seek before the planning window', (c) => ({ action: 'seek', timeMin: c.run.scenario.settings.simStartMin - 1 })],
  ['a seek after the planning window', (c) => ({ action: 'seek', timeMin: c.run.scenario.settings.simEndMin + 1 })],
  ['a 200 kB text in action', () => ({ action: HUGE_TEXT })],
  ['a __proto__ key next to a valid action', () => withProtoKey({ action: 'pause' })],
  ['a __proto__ key next to a valid seek', (c) => withProtoKey(seek(c))],
];

const generate = validGenerate;
const sentence = validParseRequest;
/** A bad draft for POST /advise: `draft` with one field changed. */
const adviseWith = (field: string, value: unknown) => (ctx: SweepContext): Body => {
  const valid = validAdvise(ctx);
  return { draft: { ...(valid.draft as Body), [field]: value } };
};
const ADVISE_CASES: Case[] = [
  ['an empty object', () => ({})],
  ['a draft of null', () => ({ draft: null })],
  ['an unknown sender', adviseWith('originBusinessId', 'biz-sweep-unknown')],
  ['a ready time before the window', adviseWith('readyMin', 0)],
  ['a deliver-by after the window', adviseWith('deadlineMin', 99999)],
  ['a fraction of a minute', adviseWith('readyMin', 990.5)],
  ['a huge text as the sender', adviseWith('originBusinessId', HUGE_TEXT)],
];
const PARSE_CASES: Case[] = [
  ['an empty object', () => ({})],
  ['an empty text', broken(sentence, 'text', '')],
  ['a text of blanks only', broken(sentence, 'text', ' \n\t ')],
  ['a 501-character text', broken(sentence, 'text', 's'.repeat(501))],
  ['a 2,001-character text', broken(sentence, 'text', 's'.repeat(2001))],
  ...hugeTexts(sentence, ['text']),
  ['a text that is an object', broken(sentence, 'text', { text: 'Deliver an envelope' })],
  ['a __proto__ key beside the text', () => withProtoKey(sentence())],
];

const GENERATE_CASES: Case[] = [
  ['an empty object', () => ({})],
  ['an unknown preset', broken(generate, 'preset', 'huge')],
  ['a preset in the wrong case', broken(generate, 'preset', 'DEMO')],
  ['a fractional seed', broken(generate, 'seed', 1.5)],
  ['a seed beyond whole numbers', broken(generate, 'seed', 1e300)],
  ['a seed of 1e999', infinite(generate, 'seed')],
  ['too few employees', broken(generate, 'employees', 9)],
  ['too many employees', broken(generate, 'employees', 121)],
  ['a negative number of employees', broken(generate, 'employees', -5)],
  ['a fractional number of employees', broken(generate, 'employees', 20.5)],
  ['a huge number of employees', broken(generate, 'employees', 1e9)],
  ['too few packages', broken(generate, 'packages', 4)],
  ['too many packages', broken(generate, 'packages', 61)],
  ['a fractional number of packages', broken(generate, 'packages', 10.5)],
  ['a negative detour limit', broken(generate, 'maxExtraMin', -1)],
  ['a fractional detour limit', broken(generate, 'maxExtraMin', 2.5)],
  ['a detour limit over 30', broken(generate, 'maxExtraMin', 31)],
  ['a huge detour limit', broken(generate, 'maxExtraMin', 1e9)],
  ['a 200 kB text in preset', broken(generate, 'preset', HUGE_TEXT)],
  ['a __proto__ key next to valid options', () => withProtoKey(generate())],
];

const file = validImport;
const IMPORT_CASES: Case[] = [
  ['an empty object', () => ({})],
  ['a file with an empty scenario', () => ({ scenario: {} })],
  ['a file from the synthetic-city version', broken(file, 'scenario.schemaVersion', 1)],
  ['an unknown scenario version', broken(file, 'scenario.schemaVersion', 3)],
  ['an unknown clock phase', broken(file, 'clock.phase', 'exploded')],
  ['an unsupported clock speed', broken(file, 'clock.speed', 31)],
  ['an unknown preset', broken(file, 'scenario.preset', 'huge')],
  ['an unknown package type', broken(file, 'scenario.shipments.0.category', 'pallet')],
  ['an unknown business kind', broken(file, 'scenario.businesses.0.kind', 'bank')],
  ['an unknown borough', broken(file, 'scenario.businesses.0.borough', 'Jersey')],
  ['an unknown trip direction', broken(file, 'trips.0.direction', 'noon')],
  ['an unknown plan kind', broken(file, 'assignments.plans.0.kind', 'teleport')],
  ['an unknown stop kind', broken(file, 'assignments.plans.0.legs.0.stops.0.kind', 'nap')],
  ['an unknown event kind', broken(file, 'events.0.kind', 'lost')],
  ['an unknown notification kind', broken(file, 'notifications.0.kind', 'spam')],
  ['an unknown notification audience', broken(file, 'notifications.0.audience', 'everyone')],
  ['a latitude out of range', broken(file, 'scenario.businesses.0.lat', 91)],
  ['a longitude out of range', broken(file, 'scenario.homes.0.lng', -181)],
  ['the same delivery ID twice', (c) => {
    const run = file(c) as { scenario: { shipments: { id: string }[] } };
    run.scenario.shipments[1].id = run.scenario.shipments[0].id;
    return run as Body;
  }],
  ['an employee whose home is not in the file', broken(file, 'scenario.employees.0.homeId', 'home-not-in-the-file')],
  ['an employee whose workplace is not in the file', broken(file, 'scenario.employees.0.businessId', 'biz-not-in-the-file')],
  ['a delivery from a business that is not in the file', broken(file, 'scenario.shipments.0.originBusinessId', LONG_ID)],
  ['a job for a plan that is not in the file', broken(file, 'jobs.0.planId', 'plan-not-in-the-file')],
  // Every place ID must be a business or a home of the file (#570).
  ['a commute trip that starts at a place that is not in the file', broken(file, 'trips.0.originPlaceId', 'place-not-in-the-file')],
  ['a commute trip that ends at an employee ID', (c) => withField(file(c), 'trips.0.destinationPlaceId', c.employee.id)],
  ['a plan leg through a place that is not in the file', broken(file, 'assignments.plans.0.legs.0.placeIds.1', 'place-not-in-the-file')],
  ['a stop at a place that is not in the file', broken(file, 'assignments.plans.0.legs.0.stops.0.placeId', LONG_ID)],
  ['a job pickup at a place that is not in the file', broken(file, 'jobs.0.pickup.placeId', 'place-not-in-the-file')],
  ['a relay plan through a business that is not in the file', broken(file, 'assignments.plans.0.relayBusinessId', 'biz-not-in-the-file')],
  // A home of the file that this server has no travel time for, at the end of a commute trip.
  ['a commute trip to a home the travel cache does not know', (c) => {
    const run = file(c) as { scenario: { homes: object[] }; trips: { destinationPlaceId: string }[] };
    run.scenario.homes.push({ id: 'home-not-in-the-cache', neighborhood: 'Midtown', ...MIDTOWN });
    run.trips[0].destinationPlaceId = 'home-not-in-the-cache';
    return run as Body;
  }],
  ['an empty run ID', broken(file, 'runId', '')],
  ['a clock at 1e999', infinite(file, 'clock.timeMin')],
  ['a version of 1e999', infinite(file, 'version')],
  ...hugeTexts(file, ['runId', 'scenario.name', 'scenario.shipments.0.label', 'notifications.0.message']),
  ['a 200 kB key the file does not need', (c) => ({ ...file(c), [HUGE_TEXT]: 1 })],
  ['a __proto__ key at the top of the file', (c) => withProtoKey(file(c))],
  ['a __proto__ key inside the scenario', (c) => withProtoKey(file(c), 'scenario')],
  ['a __proto__ key inside a delivery', (c) => withProtoKey(file(c), 'scenario.shipments.0')],
  // Found by this sweep: such a file was stored, and from then on every change answered 500, because the
  // store could no longer copy the run (the run was fine again only after a restart from the old file).
  ['an extra key nested 10,000 levels deep', (c) =>
    rawJson(JSON.stringify(file(c)).replace(/^\{/, `{"extra":${'['.repeat(10_000)}${']'.repeat(10_000)},`))],
  [`an extra key nested ${MAX_BODY_DEPTH + 1} levels deep`, (c) =>
    rawJson(JSON.stringify(file(c)).replace(/^\{/, `{"extra":${'['.repeat(MAX_BODY_DEPTH)}${']'.repeat(MAX_BODY_DEPTH)},`))],
];

/** Where a run holds a point in time. Each must be a whole minute of the two days in an imported file. */
const IMPORT_MINUTES = [
  'clock.timeMin', 'scenario.settings.simStartMin', 'scenario.settings.simEndMin',
  'scenario.shipments.0.readyMin', 'scenario.shipments.0.deadlineMin',
  'scenario.employees.0.eveningDepartureMin', 'scenario.employees.0.morningDepartureMin',
  'trips.0.departureMin', 'events.0.timeMin', 'assignments.plans.0.deliveryMin', 'assignments.plans.0.legs.0.finishMin',
  'assignments.plans.0.legs.0.stops.0.arrivalMin', 'assignments.plans.0.legs.0.stops.0.serviceStartMin',
  'assignments.plans.0.legs.0.stops.0.serviceEndMin', 'jobs.0.pickup.arrivalMin', 'jobs.0.dropoff.serviceEndMin',
];

/** The objects of a run whose every field gets the wrong type, one at a time. '' is the run itself. */
const IMPORT_OBJECTS = [
  '', 'clock', 'scenario', 'scenario.settings', 'scenario.businesses.0', 'scenario.homes.0', 'scenario.employees.0',
  'scenario.shipments.0', 'trips.0', 'assignments', 'assignments.plans.0', 'assignments.plans.0.legs.0',
  'assignments.plans.0.legs.0.stops.0', 'jobs.0', 'jobs.0.pickup', 'jobs.0.dropoff', 'notifications.0', 'events.0',
];
/** The only fields of the Run contract (shared/v2/types.ts) that may be left out. */
const IMPORT_OPTIONAL = new Set(['assignments.plans.0.relayBusinessId', 'notifications.0.jobId', 'events.0.relayBusinessId']);

// ---------- the sweep ----------

describe.each([
  ['a fresh run: no state file yet', 'fresh'],
  ['a changed run: the state file is written', 'changed'],
] as const)('broken bodies on %s', (_name, variant) => {
  let sweep: SweepApi;

  beforeAll(async () => {
    sweep = await startSweepApi();
    if (variant === 'changed') await sweep.seedUnmatchedDelivery();
    expect(sweep.stateFileExists()).toBe(variant === 'changed');
  }, T);
  afterEach(async () => {
    await sweep.confirmExport();
  }, T);
  afterAll(async () => {
    await sweep?.close();
  }, T);

  // The field-by-field loops do not depend on the state file, so they are registered once, on the fresh run.
  const registerNothing = Object.assign(() => undefined, { each: () => () => undefined });
  const itOnFresh = variant === 'fresh' ? it : (registerNothing as unknown as typeof it);

  /** An edit reaches the body checks only for an unmatched delivery; a matched one is refused first (409). */
  const editStatuses = () => (sweep.ctx().editable ? [400] : [409]);

  /**
   * Each field of the object at `objectPath` in `valid`: the wrong type, null, a list around it and, for a
   * required field, left out. The fields are read from the valid body, so a field added later is swept too.
   * `brief` sends only the wrong type and the left-out field (the import has some 150 fields).
   */
  async function sweepFields(
    method: string, url: string, valid: Body, statuses: number[],
    opts: {
      objectPath?: string; optional?: (path: string) => boolean; wrap?: (path: string, value: unknown) => Body; brief?: boolean;
    } = {},
  ) {
    const { objectPath = '', optional = () => false, brief = false } = opts;
    const wrap = opts.wrap ?? ((path: string, value: unknown) => withField(valid, path, value));
    const object = objectPath === '' ? valid : fieldAt(valid, objectPath);
    expect(typeof object === 'object' && object !== null, `nothing at ${objectPath}`).toBe(true);
    const keys = Object.keys(object as object);
    expect(keys.length).toBeGreaterThan(0);

    for (const key of keys) {
      const path = objectPath === '' ? key : `${objectPath}.${key}`;
      const original = fieldAt(valid, path);
      const variants: [string, unknown][] = [['the wrong type', wrongTypeOf(original)]];
      if (!brief) variants.push(['null', null]);
      if (!brief && !Array.isArray(original)) variants.push(['a list', [original]]);
      if (!optional(path)) variants.push(['left out', MISSING]);
      for (const [name, value] of variants) {
        await sweep.refused(method, url, json(wrap(path, value)), statuses, `${path} ${name}`);
      }
    }
  }

  describe('every write route the router lists', () => {
    it('has an entry in WRITE_SPECS', () => {
      expect(sweep.writeRoutes.length).toBeGreaterThan(0);
      const unlisted = sweep.writeRoutes.map((route) => route.key).filter((key) => !(key in WRITE_SPECS));
      expect(unlisted, 'add these routes to WRITE_SPECS in tests/api/v2-sweep-helper.ts').toStrictEqual([]);
    }, T);

    it.each(BROKEN_BODIES)('refuses %s', async (name, sent) => {
      for (const route of sweep.writeRoutes) {
        await sweep.refused(route.method, sweep.urlFor(route), sent, [400], name);
      }
    }, T);

    // The routes that are skipped here take no options, so for them this is the valid request:
    // v2-sweep-routes.test.ts checks that it answers 200 and raises the version by exactly one.
    it('refuses a request with no body, unless the route takes no options', async () => {
      for (const route of sweep.writeRoutes) {
        if (sweep.specOf(route)?.withoutBody === 'runs') continue;
        const statuses = route.key === 'PATCH /shipments/:id' ? editStatuses() : [400];
        await sweep.refused(route.method, sweep.urlFor(route), NO_BODY, statuses, 'no body');
      }
    }, T);

    it('refuses an empty JSON body and {}, unless the route has no required field', async () => {
      for (const route of sweep.writeRoutes) {
        if (sweep.specOf(route)?.emptyObject === 'runs') continue;
        await sweep.refused(route.method, sweep.urlFor(route), rawJson(''), [400], 'an empty JSON body');
        await sweep.refused(route.method, sweep.urlFor(route), rawJson('{}'), [400], '{}');
      }
    }, T);
  });

  describe('POST /shipments', () => {
    itOnFresh('refuses each field with the wrong type, null, in a list or left out', async () => {
      await sweepFields('POST', '/shipments', delivery(sweep.ctx()), [400], {
        optional: (path) => path === 'pickupInstructions' || path === 'dropoffInstructions', // default ''
      });
    }, T);

    it.each(CREATE_CASES)('refuses %s', async (name, build) => {
      await sweep.refused('POST', '/shipments', asSent(build(sweep.ctx())), [400], name);
    }, T);
  });

  describe('PATCH /shipments/:id', () => {
    itOnFresh('refuses each field with the wrong type, null or in a list', async () => {
      const ctx = sweep.ctx();
      await sweepFields('PATCH', `/shipments/${ctx.shipmentId}`, fullEdit(ctx), editStatuses(), {
        optional: () => true, // an edit may hold any subset of the fields
        wrap: (path, value) => ({ [path]: value }),
      });
    }, T);

    it.each(EDIT_CASES)('refuses %s', async (name, build) => {
      const ctx = sweep.ctx();
      await sweep.refused('PATCH', `/shipments/${ctx.shipmentId}`, asSent(build(ctx)), editStatuses(), name);
    }, T);

    it('a matched delivery is refused with a 409 whatever the body', async () => {
      const matched = sweep.ctx().run.assignments.plans[0].shipmentId;
      for (const [name, sent] of [['a valid edit', json({ label: 'Sweep edit' })], ['a broken edit', json({ label: 5 })]] as const) {
        await sweep.refused('PATCH', `/shipments/${matched}`, sent, [409], name);
      }
    }, T);
  });

  describe('PUT /employees/:id/commute', () => {
    const url = () => `/employees/${sweep.ctx().employee.id}/commute`;

    itOnFresh('refuses each field with the wrong type, null, in a list or left out', async () => {
      const ctx = sweep.ctx();
      await sweepFields('PUT', url(), commute(ctx), [400]);
      await sweepFields('PUT', url(), commute(ctx), [400], { objectPath: 'home' });
      await sweepFields('PUT', url(), newAddress(ctx), [400], { objectPath: 'home' });
    }, T);

    it.each(COMMUTE_CASES)('refuses %s', async (name, build) => {
      await sweep.refused('PUT', url(), asSent(build(sweep.ctx())), [400], name);
    }, T);
  });

  describe('POST /simulator/control', () => {
    itOnFresh('refuses each field with the wrong type, null, in a list or left out', async () => {
      await sweepFields('POST', '/simulator/control', { action: 'pause' }, [400]);
      await sweepFields('POST', '/simulator/control', seek(sweep.ctx()), [400]);
      await sweepFields('POST', '/simulator/control', speed(), [400]);
    }, T);

    it.each(CONTROL_CASES)('refuses %s', async (name, build) => {
      await sweep.refused('POST', '/simulator/control', asSent(build(sweep.ctx())), [400], name);
    }, T);
  });

  describe('POST /scenario/generate', () => {
    itOnFresh('refuses each option with the wrong type, null, in a list, and a request without a preset', async () => {
      await sweepFields('POST', '/scenario/generate', generate(), [400], { optional: (path) => path !== 'preset' });
    }, T);

    it.each(GENERATE_CASES)('refuses %s', async (name, build) => {
      await sweep.refused('POST', '/scenario/generate', asSent(build(sweep.ctx())), [400], name);
    }, T);
  });

  describe('POST /parse-request', () => {
    itOnFresh('refuses the text with the wrong type, null, in a list or left out', async () => {
      await sweepFields('POST', '/parse-request', sentence(), [400]);
    }, T);

    it.each(PARSE_CASES)('refuses %s', async (name, build) => {
      await sweep.refused('POST', '/parse-request', asSent(build(sweep.ctx())), [400], name);
    }, T);
  });

  describe('POST /advise', () => {
    itOnFresh('refuses each draft field with the wrong type, null, in a list or left out', async () => {
      await sweepFields('POST', '/advise', validAdvise(sweep.ctx()), [400], { objectPath: 'draft' });
    }, T);

    it.each(ADVISE_CASES)('refuses %s', async (name, build) => {
      await sweep.refused('POST', '/advise', asSent(build(sweep.ctx())), [400], name);
    }, T);
  });

  describe('POST /scenario/import', () => {
    itOnFresh.each(IMPORT_OBJECTS)('refuses each field of "%s" with the wrong type or left out', async (objectPath) => {
      await sweepFields('POST', '/scenario/import', file(sweep.ctx()), [400], {
        objectPath, optional: (path) => IMPORT_OPTIONAL.has(path), brief: true,
      });
    }, T);

    it.each(BAD_MINUTES)('refuses a %s minute wherever the file holds a point in time', async (name, minute) => {
      const valid = file(sweep.ctx());
      for (const path of IMPORT_MINUTES) {
        expect(typeof fieldAt(valid, path), `the run has no ${path}`).toBe('number');
        await sweep.refused('POST', '/scenario/import', json(withField(valid, path, minute)), [400], `${path} ${name}`);
      }
    }, T);

    it.each(IMPORT_CASES)('refuses %s', async (name, build) => {
      await sweep.refused('POST', '/scenario/import', asSent(build(sweep.ctx())), [400], name);
    }, T);
  });

  describe('after the whole sweep', () => {
    it('nothing reached Object.prototype', () => {
      sweep.expectNoPollution();
    }, T);

    it(variant === 'fresh' ? 'there is still no state file' : 'the state file is still there', () => {
      expect(sweep.stateFileExists()).toBe(variant === 'changed');
    }, T);

    it('one valid delivery request still answers 201 and the version goes up by exactly one', async () => {
      await sweep.expectStillWorks();
      expect(sweep.stateFileExists()).toBe(true); // the first change writes it (DECISIONS pass 49)
    }, T);

    it('the server\'s own export is still a file the import accepts', async () => {
      const before = sweep.store.get();
      const exported = await sweep.send('GET', '/scenario/export');
      const reply = await sweep.send('POST', '/scenario/import', rawJson(exported.text));
      expect(reply.status, reply.text.slice(0, 200)).toBe(200);
      expect(sweep.store.get().version).toBe(before.version + 1);
      expect(sweep.store.get().runId).not.toBe(before.runId);
    }, T);
  });
});

// The pure check behind the router-wide refusals above (server/api/v2/bodyGuard.ts), at its limits.
describe('bodyProblem', () => {
  const nested = (levels: number): unknown => {
    let value: unknown = 1;
    for (let i = 0; i < levels; i++) value = i % 2 === 0 ? { a: value } : [value];
    return value;
  };

  it('lets ordinary bodies through, whatever their shape', () => {
    for (const body of [{}, [], { label: 'Docs', weightKg: 0.5, list: [1, 'a', null, { ok: true }] }, [{ a: 1 }], null, 'text', 7]) {
      expect(bodyProblem(body)).toBeNull();
    }
    // Looks like a trap, but these are ordinary keys in JSON.
    expect(bodyProblem({ constructor: 'x', prototype: 'y', toString: 'z' })).toBeNull();
  }, T);

  it('a text of exactly the limit passes; one character more is refused and named by its path', () => {
    const atLimit = 'x'.repeat(MAX_TEXT_LENGTH);
    expect(bodyProblem({ label: atLimit, [atLimit]: 1, deep: { list: [atLimit] } })).toBeNull();

    expect(bodyProblem({ label: `${atLimit}x` })).toStrictEqual({ error: BODY_TEXT_TOO_LONG, fieldErrors: { label: TEXT_TOO_LONG } });
    expect(bodyProblem({ home: { neighborhood: `${atLimit}x` } }))
      .toStrictEqual({ error: BODY_TEXT_TOO_LONG, fieldErrors: { 'home.neighborhood': TEXT_TOO_LONG } });
    expect(bodyProblem({ scenario: { shipments: [{ label: 'ok' }, { label: `${atLimit}x` }] } }))
      .toStrictEqual({ error: BODY_TEXT_TOO_LONG, fieldErrors: { 'scenario.shipments.1.label': TEXT_TOO_LONG } });
    expect(bodyProblem({ [`${atLimit}x`]: 1 })).toStrictEqual({ error: BODY_TEXT_TOO_LONG });
    expect(bodyProblem([`${atLimit}x`])).toStrictEqual({ error: BODY_TEXT_TOO_LONG, fieldErrors: { 0: TEXT_TOO_LONG } });
  }, T);

  it('nesting of exactly the limit passes; one level more is refused, and so are 100,000 levels', () => {
    expect(bodyProblem(nested(MAX_BODY_DEPTH))).toBeNull();
    expect(bodyProblem(nested(MAX_BODY_DEPTH + 1))).toStrictEqual({ error: BODY_TOO_DEEP });
    expect(bodyProblem(nested(100_000))).toStrictEqual({ error: BODY_TOO_DEEP });
  }, T);

  it('a __proto__ key is refused at any depth, and no answer repeats what was sent', () => {
    const top = JSON.parse('{"__proto__":{"polluted":true},"label":"secret-label"}');
    const deep = JSON.parse('{"a":[{"b":{"__proto__":{"polluted":true}}}]}');
    expect(bodyProblem(top)).toStrictEqual({ error: BODY_KEY_NOT_ALLOWED });
    expect(bodyProblem(deep)).toStrictEqual({ error: BODY_KEY_NOT_ALLOWED });
    expect(JSON.stringify(bodyProblem({ label: `secret-${'x'.repeat(MAX_TEXT_LENGTH)}` }))).not.toContain('secret');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  }, T);
});

// Found by the sweep (#521) and closed by #570: a file whose trip starts at a place that is not in the file
// was stored, and from then on POST /planning/reset and POST /matches/recompute answered 503
// `travel_data_missing` until a scenario was generated or another file was imported.
describe('POST /scenario/import: a place that is not in the file', () => {
  let sweep: SweepApi;
  beforeAll(async () => {
    sweep = await startSweepApi();
  }, T);
  afterEach(async () => {
    await sweep.confirmExport();
  }, T);
  afterAll(async () => {
    await sweep?.close();
  }, T);

  it('refuses a file whose commute trip starts at a place that is not in the file', async () => {
    const run = validImport(sweep.ctx());
    const error = await sweep.refused(
      'POST', '/scenario/import', json(withField(run, 'trips.0.originPlaceId', 'place-not-in-the-file')), [400], 'a trip from nowhere',
    );
    expect(error).toStrictEqual({
      error: 'This file names a place it does not list, so it was not loaded.',
      fieldErrors: { 'trips.0.originPlaceId': 'Not in this file' },
    });
  }, T);

  it('a new planning cycle and Recompute still answer 200 afterwards', async () => {
    for (const url of ['/planning/reset', '/matches/recompute']) {
      const before = sweep.store.get().version;
      const reply = await sweep.send('POST', url);
      expect(reply.status, `${url}: ${reply.text.slice(0, 200)}`).toBe(200);
      expect(sweep.store.get().version).toBe(before + 1);
    }
  }, T);
});
