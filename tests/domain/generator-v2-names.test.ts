// Issue #603: every generated employee has a distinct, plain name ("First Last", no number), and the change that
// made it so moved nothing else. The scenarios are built from the committed fixtures/nyc (businesses,
// neighborhoods, the demo story and the places of the committed travel cache, matrix.json); no travel time is read.
//
// The name tests assert rules only and pin no name (DECISIONS pass 54). The digests were computed on the code
// before #603 (the generator that wrote "Reese Irwin 2") and are the same after it: a taken name is resolved
// without another draw from the PRNG, so every ID, employer, home, departure time and package is as it was.
// A digest changes when its input changes on purpose: a story retune (demoStory.json), a new business or
// neighborhood, or a new default of GenerateScenarioRequest. Then print `digestWithoutNames` and pin the new value.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  NycBusinessesFile, NycDemoStoryFile, NycNeighborhoodsFile, Scenario, TravelMatrixFile,
} from '../../shared/v2/types';
import { GenerateScenarioRequest } from '../../shared/v2/schemas';
import { buildNycScenario } from '../../server/domain/v2/generator';

/** Explicit per-test limit (DECISIONS pass 19 and 52): one scenario builds in a few milliseconds locally. */
const TIMEOUT_MS = 10_000;

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/nyc');
function readFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8')) as T;
}

// Read once per file.
const businessesFile = readFixture<NycBusinessesFile>('businesses.json');
const neighborhoodsFile = readFixture<NycNeighborhoodsFile>('neighborhoods.json');
const storyFile = readFixture<NycDemoStoryFile>('demoStory.json');
const places = readFixture<TravelMatrixFile>('matrix.json').places;
const storyNames = new Set(storyFile.featuredEmployees.map(employee => employee.name));
const storyIds = new Set(storyFile.featuredEmployees.map(employee => employee.id));

function build(request: Partial<GenerateScenarioRequest> & Pick<GenerateScenarioRequest, 'preset'>): Scenario {
  return buildNycScenario({
    businessesFile, neighborhoodsFile, storyFile, places, request: GenerateScenarioRequest.parse(request),
  });
}

/** SHA-256 of every employee without `name` (in order) and of every shipment. */
function digestWithoutNames(scenario: Scenario): string {
  const employees = scenario.employees.map(({ name: _name, ...rest }) => rest);
  return createHash('sha256').update(JSON.stringify({ employees, shipments: scenario.shipments })).digest('hex');
}

/** The three name rules of #603, as a list of plain sentences; empty when the run is fine. */
function nameProblems(scenario: Scenario): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const employee of scenario.employees) {
    if (/\d/.test(employee.name)) problems.push(`${employee.id} has a digit in its name: "${employee.name}"`);
    if (!/^\p{L}+ \p{L}+$/u.test(employee.name)) problems.push(`${employee.id} is not "First Last": "${employee.name}"`);
    const earlier = seen.get(employee.name);
    if (earlier) problems.push(`${employee.id} and ${earlier} share the name "${employee.name}"`);
    seen.set(employee.name, employee.id);
    const isStoryEmployee = scenario.preset === 'demo' && storyIds.has(employee.id);
    if (!isStoryEmployee && storyNames.has(employee.name)) {
      problems.push(`${employee.id} is generated but has a story employee's name: "${employee.name}"`);
    }
  }
  return problems;
}

describe('generated employee names (#603)', () => {
  it('the story file has featured employees with distinct names, so the story-name rule checks something', () => {
    expect(storyNames.size).toBeGreaterThan(0);
    expect(storyNames.size).toBe(storyFile.featuredEmployees.length);
  }, TIMEOUT_MS);

  it('default scenario: no digit, no shared name, no generated employee with a story name', () => {
    const scenario = build({ preset: 'demo' });
    expect(scenario.employees.length).toBeGreaterThan(storyFile.featuredEmployees.length);
    expect(nameProblems(scenario)).toEqual([]);
  }, TIMEOUT_MS);

  it('default scenario: the story employees keep the names of the story file', () => {
    const scenario = build({ preset: 'demo' });
    const nameById = new Map(scenario.employees.map(employee => [employee.id, employee.name]));
    for (const featured of storyFile.featuredEmployees) expect(nameById.get(featured.id), featured.id).toBe(featured.name);
  }, TIMEOUT_MS);

  it('default scenario at 120 employees: the same three rules', () => {
    const scenario = build({ preset: 'demo', employees: 120 });
    expect(scenario.employees).toHaveLength(120);
    expect(nameProblems(scenario)).toEqual([]);
  }, TIMEOUT_MS);

  // Before #603 each of these runs held 11 to 19 numbered names, and seed 1 gave a generated "Avery Brooks".
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`Random city, 120 employees, seed ${seed}: no digit, no shared name, no story name`, () => {
      const scenario = build({ preset: 'random', seed, employees: 120 });
      expect(scenario.employees).toHaveLength(120);
      expect(nameProblems(scenario)).toEqual([]);
    }, TIMEOUT_MS);
  }

  it('the same request gives the same names twice', () => {
    const names = (scenario: Scenario) => scenario.employees.map(employee => employee.name);
    expect(names(build({ preset: 'demo' }))).toEqual(names(build({ preset: 'demo' })));
    expect(names(build({ preset: 'random', seed: 4, employees: 120 })))
      .toEqual(names(build({ preset: 'random', seed: 4, employees: 120 })));
  }, TIMEOUT_MS);
});

describe('nothing but names moved (#603): digests taken before the change', () => {
  it('default scenario: every employee without its name and every shipment', () => {
    expect(digestWithoutNames(build({ preset: 'demo' })))
      .toBe('12e4df0125279ee29173e005d5f65ac411a29b59c3c1952c25936f89f9f4b0c9');
  }, TIMEOUT_MS);

  const randomDigests: Array<[seed: number, digest: string]> = [
    [1, 'b6331c5d4db30e78e5070605d8b199742a7efbf62c2f5d66076588d3f297fe22'],
    [2, '98389030882714f2147a5cdffeeb395dab5b3a2ead8cc426b0bd5dc3308bc87c'],
    [3, '16c31e88808507624d7a5d145a8a0b471c40f4a5bb57c8a1fb00e03e2848e08e'],
  ];
  for (const [seed, digest] of randomDigests) {
    it(`Random city at the default counts, seed ${seed}: every employee without its name and every shipment`, () => {
      expect(digestWithoutNames(build({ preset: 'random', seed }))).toBe(digest);
    }, TIMEOUT_MS);
  }
});
