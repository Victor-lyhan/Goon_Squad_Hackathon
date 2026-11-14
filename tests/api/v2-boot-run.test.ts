import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { pairKey } from '../../shared/v2/types';
import { bootV2Run, v2DepsFrom, type V2Boot } from '../../server/api/v2/bootRun';
import { createV2Router, V2_DEPS_NOT_LOADED, type V2Deps } from '../../server/api/v2/router';
import { bootSample, FIXTURES_DIR, runJson } from './v2-boot-sample';

let dir: string;
let statePath: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-boot-run-'));
  statePath = path.join(dir, 'data', 'state-v2.json');
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const boot = (sample = bootSample(), at = statePath): V2Boot =>
  bootV2Run({ travel: sample.travel, places: sample.places, fixturesDir: FIXTURES_DIR, statePath: at });

function ready(result: V2Boot): Extract<V2Boot, { status: 'ready' }> {
  if (result.status !== 'ready') throw new Error(`expected a ready boot, got: ${result.reason}`);
  return result;
}
function notLoaded(result: V2Boot): string {
  if (result.status !== 'not_loaded') throw new Error('expected not_loaded');
  return result.reason;
}

/** One request to /api/v2 on a router built from `deps`. */
async function request(deps: V2Deps, url: string): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use('/api/v2', createV2Router(deps));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2${url}`);
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const probe = (deps: V2Deps): V2Deps => ({
  ...deps,
  extraRoutes: (router) => {
    router.get('/probe', (_req, res) => {
      const run = deps.store!.get();
      res.json({ runId: run.runId, employees: run.scenario.employees.length, plans: run.assignments.plans.length });
    });
  },
});

describe('bootV2Run on the complete test cache', () => {
  it('is ready with the default NYC run, fully matched', () => {
    const sample = bootSample();
    const result = ready(boot(sample));
    expect(result.travel).toBe(sample.travel);
    const run = result.store.get();
    expect(run.scenario.businesses).toHaveLength(18);
    expect(run.scenario.employees).toHaveLength(60);
    expect(run.scenario.shipments).toHaveLength(24);
    expect(run.assignments.plans.some((plan) => plan.kind === 'direct')).toBe(true);
    expect(run.assignments.plans.some((plan) => plan.kind === 'relay')).toBe(true);
    expect(run.assignments.plans.length + run.assignments.unmatched.length).toBe(24);
    expect(run.events.length).toBeGreaterThan(0);
    expect(run.clock.playing).toBe(false);
    expect(fs.existsSync(statePath)).toBe(false); // like MVP 1: nothing is written until the first change
  });

  it('two boots in fresh folders give byte-identical run JSON (computeMs, the measured time, aside)', async () => {
    const a = ready(boot(bootSample(), path.join(dir, 'a', 'state-v2.json')));
    const b = ready(boot(bootSample(), path.join(dir, 'b', 'state-v2.json')));
    expect(runJson(a.store.get())).toBe(runJson(b.store.get()));

    // and the same change gives the same file
    for (const { store } of [a, b]) {
      await store.mutate((run) => {
        run.assignments.computeMs = 0;
        run.clock.timeMin = 1000;
      });
    }
    const fileA = fs.readFileSync(path.join(dir, 'a', 'state-v2.json'));
    expect(fileA.equals(fs.readFileSync(path.join(dir, 'b', 'state-v2.json')))).toBe(true);
    expect(JSON.parse(fileA.toString()).run.scenario.schemaVersion).toBe(2);
  });

  it('the ready boot gives the router its store and travel: a probe route answers 200', async () => {
    const result = boot();
    const deps = v2DepsFrom(result);
    expect(deps.store).toBe(ready(result).store);
    expect(deps.travel).toBe(ready(result).travel);
    expect(await request(probe(deps), '/probe')).toEqual({
      status: 200,
      body: { runId: 'run-1', employees: 60, plans: ready(result).store.get().assignments.plans.length },
    });
  });
});

describe('bootV2Run without usable travel data', () => {
  const NOT_LOADED_BODY = {
    error: 'NYC travel data is not loaded. Run npm run fetch:routes and commit fixtures/nyc/.',
    code: 'travel_data_missing',
  };

  it('travel: null is not_loaded, and the router answers 503 travel_data_missing on every path', async () => {
    const sample = bootSample();
    const result = bootV2Run({ travel: null, places: sample.places, fixturesDir: FIXTURES_DIR, statePath });
    expect(result).toEqual({ status: 'not_loaded', reason: NOT_LOADED_BODY.error });
    expect(v2DepsFrom(result)).toBe(V2_DEPS_NOT_LOADED);
    expect(await request(probe(v2DepsFrom(result)), '/probe')).toEqual({ status: 503, body: NOT_LOADED_BODY });
    expect(await request(v2DepsFrom(result), '/simulator')).toEqual({ status: 503, body: NOT_LOADED_BODY });
  });

  it('no matrix (places: null) is not_loaded too', () => {
    const result = bootV2Run({ travel: bootSample().travel, places: null, fixturesDir: FIXTURES_DIR, statePath });
    expect(notLoaded(result)).toBe(NOT_LOADED_BODY.error);
  });

  it('a cache with one needed pair removed is not_loaded, the reason names the pair, nothing is thrown', async () => {
    const sample = bootSample();
    delete sample.files.matrix.pairs[pairKey('biz-etsy', 'home-story-astoria-1')];
    let result: V2Boot | undefined;
    expect(() => {
      result = boot(sample);
    }).not.toThrow();
    const reason = notLoaded(result!);
    expect(reason).toContain('biz-etsy');
    expect(reason).toContain('home-story-astoria-1');
    expect(reason).toBe('No travel time is cached for biz-etsy to home-story-astoria-1. Run npm run fetch:routes and commit fixtures/nyc/.');
    expect((await request(v2DepsFrom(result!), '/businesses')).status).toBe(503);
  });

  it('a pair only the matcher needs (business to business) is found too', () => {
    const sample = bootSample();
    delete sample.files.matrix.pairs[pairKey('biz-etsy', 'biz-sweetleaf')];
    const reason = notLoaded(boot(sample));
    expect(reason).toContain('biz-etsy');
    expect(reason).toContain('biz-sweetleaf');
  });

  it('a business without coordinates in places is not_loaded and names the business', () => {
    const sample = bootSample();
    delete sample.places['biz-zabars'];
    expect(notLoaded(boot(sample))).toContain('biz-zabars');
  });

  it('a missing fixture file is not_loaded and names the file', () => {
    const sample = bootSample();
    const result = bootV2Run({ travel: sample.travel, places: sample.places, fixturesDir: path.join(dir, 'no-fixtures'), statePath });
    expect(notLoaded(result)).toContain(path.join(dir, 'no-fixtures', 'businesses.json'));
  });

  it('while not loaded, the state file is left exactly as it is', () => {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, '{not json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sample = bootSample();
    delete sample.files.matrix.pairs[pairKey('biz-etsy', 'home-story-astoria-1')];
    notLoaded(boot(sample));
    notLoaded(bootV2Run({ travel: null, places: null, fixturesDir: FIXTURES_DIR, statePath }));
    expect(fs.readdirSync(path.dirname(statePath))).toEqual(['state-v2.json']);
    expect(fs.readFileSync(statePath, 'utf8')).toBe('{not json');
    expect(warn).not.toHaveBeenCalled();
  });
});
