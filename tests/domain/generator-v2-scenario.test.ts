import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  NycBusinessesFile,
  NycDemoStoryFile,
  NycNeighborhoodsFile,
  TravelMatrixFile,
} from '../../shared/v2/types.js';
import { buildNycScenario } from '../../server/domain/v2/generator.js';

const businessesFile: NycBusinessesFile = {
  businesses: [
    { id: 'biz-a', name: 'Alpha Office', address: '1 A St', neighborhood: 'Chelsea', borough: 'Manhattan', kind: 'office' },
    { id: 'biz-b', name: 'Bravo Cafe', address: '2 B St', neighborhood: 'DUMBO', borough: 'Brooklyn', kind: 'cafe' },
    { id: 'biz-c', name: 'Charlie Shop', address: '3 C St', neighborhood: 'Astoria', borough: 'Queens', kind: 'shop' },
    { id: 'biz-d', name: 'Delta Office', address: '4 D St', neighborhood: 'FiDi', borough: 'Manhattan', kind: 'office' },
  ],
};
const neighborhoodsFile: NycNeighborhoodsFile = {
  neighborhoods: [
    { id: 'nbh-astoria', name: 'Astoria', borough: 'Queens', bbox: { south: 40.75, west: -73.93, north: 40.77, east: -73.90 } },
    { id: 'nbh-harlem', name: 'Harlem', borough: 'Manhattan', bbox: { south: 40.80, west: -73.96, north: 40.82, east: -73.93 } },
    { id: 'nbh-slope', name: 'Park Slope', borough: 'Brooklyn', bbox: { south: 40.65, west: -73.99, north: 40.68, east: -73.96 } },
  ],
};
const storyFile: NycDemoStoryFile = {
  featuredEmployees: [
    {
      id: 'emp-1', name: 'Story One', businessId: 'biz-a', eveningDepartureMin: 1020, morningDepartureMin: 1920,
      maxExtraMin: 8, availableEvening: true, availableMorning: true, note: 'Direct story',
      home: { id: 'home-story-one', neighborhood: 'Astoria', lat: 40.76, lng: -73.91 },
    },
    {
      id: 'emp-2', name: 'Story Two', businessId: 'biz-b', eveningDepartureMin: 1050, morningDepartureMin: 1950,
      maxExtraMin: 8, availableEvening: true, availableMorning: true, note: 'Relay story',
      home: { id: 'home-story-two', neighborhood: 'Park Slope', lat: 40.66, lng: -73.97 },
    },
  ],
  shipments: [
    {
      label: 'Proofs', originBusinessId: 'biz-a', destinationBusinessId: 'biz-b', readyMin: 960, deadlineMin: 2040,
      category: 'envelope', description: 'Print proofs', weightGrams: 250,
      pickupInstructions: 'Reception', dropoffInstructions: 'Front desk', expect: 'direct', note: 'Story package',
    },
    {
      label: 'Samples', originBusinessId: 'biz-b', destinationBusinessId: 'biz-c', readyMin: 970, deadlineMin: 2050,
      category: 'small_box', description: 'Sample box', weightGrams: 800,
      pickupInstructions: 'Counter', dropoffInstructions: 'Mailroom', expect: 'relay',
    },
    {
      label: 'Contract', originBusinessId: 'biz-d', destinationBusinessId: 'biz-a', readyMin: 980, deadlineMin: 2060,
      category: 'envelope', description: 'Signed contract', weightGrams: 120,
      pickupInstructions: 'Reception', dropoffInstructions: 'Reception', expect: 'any',
    },
  ],
};
const places: TravelMatrixFile['places'] = {
  'biz-a': { lat: 40.75, lng: -73.99 }, 'biz-b': { lat: 40.70, lng: -73.99 },
  'biz-c': { lat: 40.76, lng: -73.92 }, 'biz-d': { lat: 40.71, lng: -74.00 },
};

function input(seed = 42, preset: 'demo' | 'random' = 'demo') {
  return {
    businessesFile, neighborhoodsFile, storyFile, places,
    request: { preset, seed, employees: 10, packages: 5, maxExtraMin: 11 },
  };
}

describe('buildNycScenario', () => {
  it('builds a deterministic demo with resolved references and ordered story shipments', () => {
    const scenario = buildNycScenario(input());
    const same = buildNycScenario(input());
    const businessIds = new Set(scenario.businesses.map(business => business.id));
    const homeIds = new Set(scenario.homes.map(home => home.id));

    expect(scenario).toEqual(same);
    expect(scenario).toMatchObject({ schemaVersion: 2, preset: 'demo', seed: 42, settings: { defaultMaxExtraMin: 11 } });
    expect(scenario.employees).toHaveLength(10);
    expect(scenario.shipments).toHaveLength(3);
    expect(scenario.employees.slice(0, 2).map(employee => employee.name)).toEqual(['Story One', 'Story Two']);
    expect(scenario.shipments.map(shipment => [shipment.id, shipment.clientRequestId, shipment.createdSeq]))
      .toEqual([['shp-1', 'seed-42-1', 1], ['shp-2', 'seed-42-2', 2], ['shp-3', 'seed-42-3', 3]]);
    expect(scenario.shipments.every(shipment => !('expect' in shipment) && !('note' in shipment))).toBe(true);
    expect(scenario.employees.every(employee => businessIds.has(employee.businessId) && homeIds.has(employee.homeId))).toBe(true);
    expect(scenario.shipments.every(shipment => businessIds.has(shipment.originBusinessId)
      && businessIds.has(shipment.destinationBusinessId) && shipment.originBusinessId !== shipment.destinationBusinessId)).toBe(true);
    expect(new Set(scenario.employees.map(employee => employee.id)).size).toBe(scenario.employees.length);
    expect(new Set(scenario.shipments.map(shipment => shipment.id)).size).toBe(scenario.shipments.length);
    expect(scenario.businesses.every(business => scenario.employees.filter(employee => employee.businessId === business.id).length >= 2)).toBe(true);
  });

  it('changes only seeded background commuters when a demo seed changes', () => {
    const first = buildNycScenario(input(42));
    const second = buildNycScenario(input(99));

    expect(first.employees.slice(0, 2)).toEqual(second.employees.slice(0, 2));
    expect(first.employees.slice(2)).not.toEqual(second.employees.slice(2));
    expect(first.homes.slice(0, 2)).toEqual(second.homes.slice(0, 2));
  });

  it('builds random data from the pool, not story commuters, with requested bounds', () => {
    const scenario = buildNycScenario(input(7, 'random'));

    expect(scenario.employees).toHaveLength(10);
    expect(scenario.shipments).toHaveLength(5);
    expect(scenario.employees.some(employee => employee.name === 'Story One')).toBe(false);
    expect(new Set(scenario.employees.map(employee => employee.homeId)).size).toBe(10);
    expect(scenario.shipments.every(shipment => shipment.originBusinessId !== shipment.destinationBusinessId
      && shipment.readyMin === 960 && shipment.deadlineMin === 2040)).toBe(true);
  });

  it('requires cache coordinates for every business', () => {
    const missing = { ...places };
    delete missing['biz-c'];
    expect(() => buildNycScenario({ ...input(), places: missing })).toThrow(
      'Missing geocoded coordinates for business biz-c; run npm run fetch:routes.',
    );
  });

  it('keeps the generator source free of impure randomness, clocks, and file access', () => {
    const source = readFileSync(new URL('../../server/domain/v2/generator.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('Math.random');
    expect(source).not.toContain('Date');
    expect(source).not.toContain("node:fs");
  });
});
