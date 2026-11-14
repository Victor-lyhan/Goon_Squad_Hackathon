import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore, type Store } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import type { Run as RunV1 } from '../../shared/types';
import type { Run as RunV2 } from '../../shared/v2/types';

// A small, fully typed v2 run: places by ID, homes, no hubs, playing clock.
const mkRunV2 = (): RunV2 => ({
  runId: 'run-1',
  version: 0,
  scenario: {
    schemaVersion: 2, name: 'Store test city', preset: 'custom', seed: 7,
    businesses: [
      { id: 'biz-studio', name: 'Studio', address: '1 Bedford Ave, Brooklyn, NY', neighborhood: 'Williamsburg', borough: 'Brooklyn', kind: 'office', lat: 40.7195, lng: -73.9565 },
      { id: 'biz-agency', name: 'Agency', address: '1 W 42nd St, New York, NY', neighborhood: 'Midtown', borough: 'Manhattan', kind: 'office', lat: 40.7536, lng: -73.9822 },
    ],
    homes: [{ id: 'home-001', neighborhood: 'Park Slope', lat: 40.6722, lng: -73.9772 }],
    employees: [{
      id: 'emp-1', name: 'Sam', businessId: 'biz-studio', homeId: 'home-001',
      eveningDepartureMin: 1050, morningDepartureMin: 1920, maxExtraMin: 8, availableEvening: true, availableMorning: true,
    }],
    shipments: [],
    settings: {
      handlingMin: 2, defaultMaxExtraMin: 8, priceCents: 1000, legRewardCents: 300, hubCostCents: 50,
      platformVariableCostCents: 50, courierPriceCents: 1400, simStartMin: 930, simEndMin: 2160, allowRelay: true,
    },
  },
  trips: [{
    id: 'trip-emp-1-eve', employeeId: 'emp-1', direction: 'evening', originPlaceId: 'biz-studio', destinationPlaceId: 'home-001',
    departureMin: 1050, baselineDurationMin: 25, baselineDistanceM: 7400,
  }],
  assignments: { plans: [], unmatched: [], computeMs: 1 },
  jobs: [],
  notifications: [],
  events: [],
  clock: { phase: 'locked', playing: true, timeMin: 1000, speed: 120 },
});

const noInitial = (): RunV2 => {
  throw new Error('should load the file');
};

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-store-'));
  file = path.join(dir, 'nested', 'state-v2.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('store with the v2 run', () => {
  it('starts from initial, typed as the v2 run', () => {
    const store: Store<RunV2> = createStore({ filePath: file, initial: mkRunV2 }); // R is inferred
    expect(store.get()).toEqual(mkRunV2());
    expect(store.get().scenario.homes[0].neighborhood).toBe('Park Slope');
    expect(fs.existsSync(file)).toBe(false); // nothing is written until the first mutation
  });

  it('persists a v2 run and reloads it paused', async () => {
    const a = createStore<RunV2>({ filePath: file, initial: mkRunV2 });
    const saved = await a.mutate((run) => {
      run.clock.timeMin = 1100;
      run.scenario.homes.push({ id: 'home-c-40.76420_-73.92350', neighborhood: 'Astoria', lat: 40.7642, lng: -73.9235 });
    });
    expect(saved.version).toBe(1);
    expect(saved.clock.playing).toBe(true); // the live run keeps playing; only a reload pauses

    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(Object.keys(onDisk).sort()).toEqual(['run', 'schemaVersion']); // same file format as MVP 1
    expect(onDisk.schemaVersion).toBe(1);
    expect(onDisk.run).toEqual(saved);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);

    const b = createStore<RunV2>({ filePath: file, initial: noInitial });
    expect(b.get().clock.playing).toBe(false);
    expect(b.get()).toEqual({ ...saved, clock: { ...saved.clock, playing: false } });
    expect(b.get().scenario.homes.map((h) => h.id)).toEqual(['home-001', 'home-c-40.76420_-73.92350']);
    expect(b.get().trips[0].originPlaceId).toBe('biz-studio');
  });

  it('serializes concurrent mutations and survives a throwing mutator', async () => {
    const store = createStore<RunV2>({ filePath: file, initial: mkRunV2 });
    await Promise.all(Array.from({ length: 10 }, () => store.mutate((run) => {
      run.clock.timeMin += 1;
    })));
    await expect(store.mutate((run) => {
      run.scenario.homes = [];
      throw new Error('boom');
    })).rejects.toThrow('boom');
    await store.flush();
    expect(store.get().version).toBe(10);
    expect(store.get().clock.timeMin).toBe(1010);
    expect(store.get().scenario.homes).toHaveLength(1);
    expect(createStore<RunV2>({ filePath: file, initial: noInitial }).get().version).toBe(10);
  });

  it('a mutator may return a whole new v2 run', async () => {
    const store = createStore<RunV2>({ filePath: file, initial: mkRunV2 });
    const next = await store.mutate(() => ({ ...mkRunV2(), runId: 'run-2', version: 99 }));
    expect(next.runId).toBe('run-2');
    expect(next.version).toBe(1); // the store owns the version
    expect(createStore<RunV2>({ filePath: file, initial: noInitial }).get().runId).toBe('run-2');
  });

  it('an unusable v2 state file is kept as .bad-1 and the store starts from initial', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{not json');
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(createStore<RunV2>({ filePath: file, initial: mkRunV2 }).get().runId).toBe('run-1');
    } finally {
      console.warn = warn;
    }
    expect(fs.readFileSync(`${file}.bad-1`, 'utf8')).toBe('{not json');
  });

  it('the v2 state file and the MVP 1 state file live side by side', async () => {
    const v1File = path.join(dir, 'state.json');
    const v1: Store<RunV1> = createStore({ filePath: v1File, initial: () => createInitialRun(loadDefaultScenario()) });
    const v2 = createStore<RunV2>({ filePath: file, initial: mkRunV2 });
    await v1.mutate((run) => {
      run.clock.playing = true;
    });
    await v2.mutate((run) => {
      run.clock.timeMin = 1200;
    });
    const v1Again = createStore({ filePath: v1File, initial: () => { throw new Error('should load the file'); } });
    expect(v1Again.get().scenario.hubs.length).toBeGreaterThan(0); // still the MVP 1 shape, typed as the MVP 1 Run
    expect(v1Again.get().clock.playing).toBe(false);
    expect(createStore<RunV2>({ filePath: file, initial: noInitial }).get().clock.timeMin).toBe(1200);
  });
});
