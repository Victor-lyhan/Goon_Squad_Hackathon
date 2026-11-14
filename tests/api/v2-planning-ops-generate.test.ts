// planGenerate on the real fixtures/nyc files (DECISIONS pass 44, 45): demo and seeded random scenarios,
// request validation, and "a business with no geocoded point is travel_data_missing, never a guess".
import { describe, expect, it } from 'vitest';
import { INVALID_GENERATE, planGenerate } from '../../server/api/v2/planningOps';
import type { Scenario } from '../../shared/v2/types';
import {
  businessesFile, expectDeterministic, generateInputs, inputsWithPlaces, sharesObjects, storyFile, testPlaces,
} from './v2-planning-ops-sample';

function scenarioOf(body: unknown, inputs = generateInputs): Scenario {
  const plan = planGenerate(body, inputs);
  if (plan.kind !== 'scenario') throw new Error(`expected a scenario, got ${plan.kind}: ${plan.error.error}`);
  return plan.scenario;
}

/** Every employee has a listed workplace and a listed home, and no home is listed without an employee. */
function expectConsistent(scenario: Scenario) {
  const businessIds = new Set(scenario.businesses.map((b) => b.id));
  const homeIds = scenario.homes.map((h) => h.id);
  expect(new Set(homeIds).size).toBe(homeIds.length);
  expect(new Set(scenario.employees.map((e) => e.id)).size).toBe(scenario.employees.length);
  for (const employee of scenario.employees) {
    expect(businessIds.has(employee.businessId)).toBe(true);
    expect(homeIds).toContain(employee.homeId);
  }
  expect(new Set(scenario.employees.map((e) => e.homeId))).toStrictEqual(new Set(homeIds));
  for (const shipment of scenario.shipments) {
    expect(businessIds.has(shipment.originBusinessId)).toBe(true);
    expect(businessIds.has(shipment.destinationBusinessId)).toBe(true);
  }
}

describe('planGenerate: demo preset', () => {
  const demo = scenarioOf({ preset: 'demo' });

  it('returns 60 employees and the 24 story packages', () => {
    expect(demo.schemaVersion).toBe(2);
    expect(demo.preset).toBe('demo');
    expect(demo.employees).toHaveLength(60);
    expect(demo.homes).toHaveLength(60);
    expect(demo.shipments).toHaveLength(24);
    expect(storyFile.shipments).toHaveLength(24);
    expect(demo.shipments.map((s) => s.id)).toStrictEqual(Array.from({ length: 24 }, (_, i) => `shp-${i + 1}`));
    for (const [index, shipment] of demo.shipments.entries()) {
      const story = storyFile.shipments[index];
      expect(shipment).toMatchObject({
        label: story.label, originBusinessId: story.originBusinessId, destinationBusinessId: story.destinationBusinessId,
        readyMin: story.readyMin, deadlineMin: story.deadlineMin, createdSeq: index + 1,
      });
      expect(shipment).not.toHaveProperty('expect');
      expect(shipment).not.toHaveProperty('note');
    }
    expectConsistent(demo);
  });

  it('starts with the featured employees and takes every business point from `places`', () => {
    const featured = storyFile.featuredEmployees;
    expect(demo.employees.slice(0, featured.length).map((e) => e.id)).toStrictEqual(featured.map((e) => e.id));
    expect(demo.employees.slice(0, featured.length).map((e) => e.homeId)).toStrictEqual(featured.map((e) => e.home.id));
    expect(demo.businesses.map((b) => b.id)).toStrictEqual(businessesFile.businesses.map((b) => b.id));
    for (const business of demo.businesses) {
      expect({ lat: business.lat, lng: business.lng }).toStrictEqual(generateInputs.places[business.id]);
    }
  });

  it('ignores `packages` and follows `employees` and `maxExtraMin`', () => {
    const custom = scenarioOf({ preset: 'demo', packages: 5, employees: 30, maxExtraMin: 12 });
    expect(custom.shipments).toHaveLength(24);
    expect(custom.employees).toHaveLength(30);
    expect(custom.settings.defaultMaxExtraMin).toBe(12);
    expectConsistent(custom);
  });

  it('is the same scenario every time and does not share objects with the fixture files', () => {
    const before = structuredClone(generateInputs);
    const again = expectDeterministic(() => scenarioOf({ preset: 'demo' }));
    expect(again).toStrictEqual(demo);
    expect(generateInputs).toStrictEqual(before); // and frozen: a write would have thrown
    expect(sharesObjects(again, generateInputs)).toBe(false);
  });
});

describe('planGenerate: random preset', () => {
  it('is deep-equal for the same seed and different for another seed', () => {
    const body = { preset: 'random', seed: 7, employees: 40, packages: 12 };
    const first = expectDeterministic(() => scenarioOf(body));
    expect(scenarioOf({ ...body })).toStrictEqual(first);
    expect(first.preset).toBe('random');
    expect(first.seed).toBe(7);
    expect(first.employees).toHaveLength(40);
    expect(first.shipments).toHaveLength(12);
    expectConsistent(first);

    const other = scenarioOf({ ...body, seed: 8 });
    expect(other.employees).toHaveLength(40);
    expect(other).not.toStrictEqual(first);
  });

  it('fills in the defaults: seed 42, 60 employees, 24 packages, 8 extra minutes', () => {
    const scenario = scenarioOf({ preset: 'random' });
    expect(scenario.seed).toBe(42);
    expect(scenario.employees).toHaveLength(60);
    expect(scenario.shipments).toHaveLength(24);
    expect(scenario.settings.defaultMaxExtraMin).toBe(8);
    expect(scenario.employees.every((e) => e.maxExtraMin === 8)).toBe(true);
  });

  it('can use the whole 120-home pool, and only pool homes', () => {
    const full = scenarioOf({ preset: 'random', seed: 3, employees: 120, packages: 60 });
    expect(full.employees).toHaveLength(120);
    expect(full.homes).toHaveLength(120);
    expect(full.shipments).toHaveLength(60);
    expect(full.homes.every((home) => /^home-\d{3}$/.test(home.id))).toBe(true);
    expectConsistent(full);
  });

  it('ignores an MVP 1 `hubs` field (every business is a relay point)', () => {
    expect(scenarioOf({ preset: 'random', seed: 5, hubs: 3 })).toStrictEqual(scenarioOf({ preset: 'random', seed: 5 }));
  });
});

describe('planGenerate: invalid requests', () => {
  const fieldErrorsOf = (body: unknown) => {
    const plan = planGenerate(body, generateInputs);
    if (plan.kind !== 'invalid') throw new Error(`expected invalid, got ${plan.kind}`);
    expect(plan.status).toBe(400);
    expect(plan.error.error).toBe(INVALID_GENERATE);
    return plan.error.fieldErrors;
  };

  it('refuses employees: 121 with a 400', () => {
    expect(fieldErrorsOf({ preset: 'random', employees: 121 })).toStrictEqual({
      employees: 'Employees must be a whole number from 10 to 120',
    });
    expect(fieldErrorsOf({ preset: 'demo', employees: 121 })).toHaveProperty('employees');
  });

  it('names every field that is wrong, in words', () => {
    expect(fieldErrorsOf({ preset: 'fixture', seed: 1.5, employees: 9, packages: 61, maxExtraMin: 31 })).toStrictEqual({
      preset: 'Choose demo or random',
      seed: 'Seed must be a whole number',
      employees: 'Employees must be a whole number from 10 to 120',
      packages: 'Packages must be a whole number from 5 to 60',
      maxExtraMin: 'Max added time must be a whole number from 0 to 30 minutes',
    });
    expect(fieldErrorsOf({ preset: 'random', employees: '60' })).toHaveProperty('employees');
  });

  it('refuses a missing preset and a body that is not an object', () => {
    for (const body of [{}, undefined, null]) expect(fieldErrorsOf(body)).toStrictEqual({ preset: 'Choose demo or random' });
    for (const body of ['demo', 42, ['demo']]) {
      expect(fieldErrorsOf(body)).toStrictEqual({ body: 'Send the scenario options as a JSON object' });
    }
  });

  it('does not repeat request text in a message', () => {
    const plan = planGenerate({ preset: 'tokyo-secret', employees: 987654 }, generateInputs);
    expect(JSON.stringify(plan)).not.toMatch(/tokyo-secret|987654/);
  });
});

describe('planGenerate: missing travel data', () => {
  const [firstBusiness, secondBusiness] = businessesFile.businesses;

  it('answers travel_data_missing when a business is not in `places`', () => {
    const places = testPlaces();
    delete places[firstBusiness.id];
    for (const preset of ['demo', 'random']) {
      const plan = expectDeterministic(() => planGenerate({ preset }, inputsWithPlaces(places)));
      expect(plan).toStrictEqual({
        kind: 'unavailable', status: 503, code: 'travel_data_missing', missingPlaces: 1,
        error: {
          code: 'travel_data_missing',
          error: '1 of 18 businesses has no geocoded location. Run npm run fetch:routes and commit fixtures/nyc/.',
        },
      });
      expect(plan).not.toHaveProperty('scenario');
    }
  });

  it('counts every business without a usable point, and all of them when `places` is empty', () => {
    const places = testPlaces();
    delete places[firstBusiness.id];
    places[secondBusiness.id] = { lat: Number.NaN, lng: -73.99 };
    const two = planGenerate({ preset: 'demo' }, inputsWithPlaces(places));
    expect(two).toMatchObject({ kind: 'unavailable', missingPlaces: 2 });
    expect(two.kind === 'unavailable' && two.error.error).toMatch(/^2 of 18 businesses have no geocoded location\./);

    expect(planGenerate({ preset: 'demo' }, inputsWithPlaces({}))).toMatchObject({
      kind: 'unavailable', code: 'travel_data_missing', missingPlaces: 18,
    });
  });

  it('is not fooled by an inherited key, and extra places do no harm', () => {
    const inherited = Object.create({ [firstBusiness.id]: { lat: 40.7, lng: -74 } }) as ReturnType<typeof testPlaces>;
    const places = testPlaces();
    delete places[firstBusiness.id];
    Object.assign(inherited, places);
    expect(planGenerate({ preset: 'demo' }, { ...generateInputs, places: inherited }).kind).toBe('unavailable');

    const extra = { ...testPlaces(), 'home-001': { lat: 40.75, lng: -73.9 } };
    expect(scenarioOf({ preset: 'demo' }, inputsWithPlaces(extra))).toStrictEqual(scenarioOf({ preset: 'demo' }));
  });

  it('reports an invalid request before the missing data', () => {
    expect(planGenerate({ preset: 'random', employees: 121 }, inputsWithPlaces({})).kind).toBe('invalid');
  });
});
