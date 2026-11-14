import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TravelDataMissingError, pairKey } from '../../shared/v2/types';
import {
  buildDefaultRun, DEFAULT_RUN_REQUEST, DEFAULT_V2_STATE_PATH, NYC_FIXTURES_DIR, NycFixtureError, readNycFixtures,
} from '../../server/api/v2/bootRun';
import { checkPlans } from '../../server/domain/v2/planCheck';
import { deepFreeze, undefinedPaths } from './v2-sample';
import { bootSample, FIXTURES_DIR, runJson } from './v2-boot-sample';

const repoRoot = path.resolve(FIXTURES_DIR, '../..');

describe('v2 boot constants', () => {
  it('the default state file is data/state-v2.json at the repo root, next to the MVP 1 state file', () => {
    expect(path.relative(repoRoot, DEFAULT_V2_STATE_PATH)).toBe(path.join('data', 'state-v2.json'));
    expect(path.relative(repoRoot, NYC_FIXTURES_DIR)).toBe(path.join('fixtures', 'nyc'));
  });

  it('the default run is the demo preset with the contract defaults', () => {
    expect(DEFAULT_RUN_REQUEST).toEqual({ preset: 'demo', seed: 42, employees: 60, packages: 24, maxExtraMin: 8 });
  });
});

describe('readNycFixtures', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-boot-fixtures-'));
    for (const name of ['businesses.json', 'neighborhoods.json', 'demoStory.json']) {
      fs.copyFileSync(path.join(FIXTURES_DIR, name), path.join(dir, name));
    }
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const failure = (from: string): NycFixtureError => {
    try {
      readNycFixtures(from);
    } catch (e) {
      if (e instanceof NycFixtureError) return e;
      throw e;
    }
    throw new Error('readNycFixtures did not throw');
  };

  it('reads the three committed files as they are written', () => {
    const fixtures = readNycFixtures(NYC_FIXTURES_DIR);
    expect(fixtures.businessesFile.businesses).toHaveLength(18);
    expect(fixtures.neighborhoodsFile.neighborhoods.length).toBeGreaterThanOrEqual(8);
    expect(fixtures.storyFile.featuredEmployees.length).toBeGreaterThan(0);
    expect(fixtures.storyFile.shipments).toHaveLength(24);
    for (const [key, name] of [['businessesFile', 'businesses.json'], ['neighborhoodsFile', 'neighborhoods.json'], ['storyFile', 'demoStory.json']] as const) {
      expect(fixtures[key]).toEqual(JSON.parse(fs.readFileSync(path.join(NYC_FIXTURES_DIR, name), 'utf8')));
    }
  });

  it.each(['businesses.json', 'neighborhoods.json', 'demoStory.json'])('a missing %s is an error that names the file', (name) => {
    fs.rmSync(path.join(dir, name));
    const error = failure(dir);
    expect(error.file).toBe(path.join(dir, name));
    expect(error.message).toContain(name);
    expect(error.message).toContain('missing');
  });

  it('a missing folder names the first file', () => {
    expect(failure(path.join(dir, 'nope')).file).toBe(path.join(dir, 'nope', 'businesses.json'));
  });

  it('a file that is not JSON names the file', () => {
    fs.writeFileSync(path.join(dir, 'neighborhoods.json'), '{"neighborhoods": [');
    const error = failure(dir);
    expect(error.file).toBe(path.join(dir, 'neighborhoods.json'));
    expect(error.message).toContain('not valid JSON');
  });

  it('a file with the wrong shape names the file and the field', () => {
    fs.writeFileSync(path.join(dir, 'businesses.json'), JSON.stringify({ businesses: 'none' }));
    expect(failure(dir).message).toMatch(/businesses\.json: unexpected shape at businesses /);

    fs.copyFileSync(path.join(FIXTURES_DIR, 'businesses.json'), path.join(dir, 'businesses.json'));
    const story = JSON.parse(fs.readFileSync(path.join(dir, 'demoStory.json'), 'utf8'));
    delete story.featuredEmployees[1].home.lat;
    fs.writeFileSync(path.join(dir, 'demoStory.json'), JSON.stringify(story));
    expect(failure(dir).message).toMatch(/demoStory\.json: unexpected shape at featuredEmployees\.1\.home\.lat /);

    fs.copyFileSync(path.join(FIXTURES_DIR, 'demoStory.json'), path.join(dir, 'demoStory.json'));
    fs.writeFileSync(path.join(dir, 'neighborhoods.json'), '[]');
    expect(failure(dir).file).toBe(path.join(dir, 'neighborhoods.json'));
  });
});

describe('buildDefaultRun on the complete test cache', () => {
  const sample = bootSample();
  const run = buildDefaultRun(sample);

  it('is the NYC demo: 18 businesses, 60 employees, 24 packages, every employee with a home', () => {
    expect(run.scenario.schemaVersion).toBe(2);
    expect(run.scenario.preset).toBe('demo');
    expect(run.scenario.seed).toBe(42);
    expect(run.scenario.businesses).toHaveLength(18);
    expect(run.scenario.employees).toHaveLength(60);
    expect(run.scenario.shipments).toHaveLength(24);
    const homeIds = new Set(run.scenario.homes.map((home) => home.id));
    expect(run.scenario.employees.every((employee) => homeIds.has(employee.homeId))).toBe(true);
    for (const business of run.scenario.businesses) {
      expect({ lat: business.lat, lng: business.lng }).toEqual(sample.places[business.id]);
    }
  });

  it('starts run-1 paused in planning, with every package matched or given a reason', () => {
    expect(run.runId).toBe('run-1');
    expect(run.version).toBe(0);
    expect(run.clock).toEqual({ phase: 'planning', playing: false, timeMin: run.scenario.settings.simStartMin, speed: 120 });
    expect(run.trips).toHaveLength(120);

    const { plans, unmatched } = run.assignments;
    expect(plans.length + unmatched.length).toBe(24);
    expect(plans.filter((plan) => plan.kind === 'direct').length).toBeGreaterThanOrEqual(1);
    expect(plans.filter((plan) => plan.kind === 'relay').length).toBeGreaterThanOrEqual(1);
    const businessIds = new Set(run.scenario.businesses.map((business) => business.id));
    for (const plan of plans.filter((p) => p.kind === 'relay')) expect(businessIds.has(plan.relayBusinessId!)).toBe(true);
    expect(run.assignments.computeMs).toBeGreaterThanOrEqual(0);
  });

  it('has jobs, notifications and the timeline of its plans (buildTimeline was passed in)', () => {
    const legs = run.assignments.plans.reduce((sum, plan) => sum + plan.legs.length, 0);
    expect(run.jobs).toHaveLength(legs);
    expect(run.events).toHaveLength(legs * 2); // one event per stop
    expect(run.events.map((event) => event.timeMin)).toEqual([...run.events.map((event) => event.timeMin)].sort((a, b) => a - b));
    expect(run.notifications.length).toBeGreaterThan(0);
    expect(undefinedPaths(JSON.parse(JSON.stringify(run)))).toEqual([]);
  });

  it('passes the independent plan checker on the same travel data', () => {
    expect(checkPlans({
      plans: run.assignments.plans, shipments: run.scenario.shipments, employees: run.scenario.employees,
      trips: run.trips, businesses: run.scenario.businesses, settings: run.scenario.settings, travel: sample.travel,
    })).toEqual([]);
  });

  it('reads only its arguments and does not change them: two builds give the same JSON', () => {
    const frozen = bootSample();
    deepFreeze(frozen.fixtures);
    deepFreeze(frozen.files);
    expect(runJson(buildDefaultRun(frozen))).toBe(runJson(run));
  });

  it('lets a missing pair through as TravelDataMissingError, never as a guessed time', () => {
    const broken = bootSample();
    delete broken.files.matrix.pairs[pairKey('biz-etsy', 'home-story-astoria-1')];
    expect(() => buildDefaultRun(broken)).toThrow(TravelDataMissingError);
  });
});
