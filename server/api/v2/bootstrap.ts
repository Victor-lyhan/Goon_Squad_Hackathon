// The MVP II bootstrap (DECISIONS pass 45, 47, 48, 49, 50, 51): the one place that turns the travel cache
// into a running /api/v2. server/index.ts calls `createV2Runtime` once at start and passes `deps` to
// `createApp`.
//   travel cache (fixtures/nyc/matrix.json, polylines.json) -> createTravelService
//   + businesses.json, neighborhoods.json, demoStory.json   -> bootV2Run -> the v2 store (data/state-v2.json)
//   + the five route groups, GET /geocode and
//     POST /parse-request (parseRequestRoutes.ts)           -> `deps.extraRoutes` for createV2Router
// - Every group gets the same snapshot function and the same travel provider: the service's provider, which
//   reads the cache object the service writes to. So the pairs of a newly saved home and the route lines of
//   a new delivery are visible to the next request without a restart.
// - No travel cache, a corrupt one, or one that lacks something the default run needs: `not_loaded`.
//   Nothing here throws at server start, nothing is estimated, the state file is not touched, and
//   createV2Router answers 503 `travel_data_missing` on every /api/v2 path.
// - A saved run from other story files is set aside by bootV2Run (DECISIONS pass 55); its `notice` sentence
//   is passed on as `runtime.notice` for server/index.ts to log once.
// - The key goes to the travel service and to the address search only. This file logs nothing.
import type express from 'express';
import type { Run as RunV2, Snapshot } from '../../../shared/v2/types';
import { DEFAULT_GEMINI_MODEL } from '../../ai/env';
import { snapshotAt } from '../../domain/v2/simulation';
import { buildTimeline } from '../../domain/v2/timeline';
import type { FetchLike } from '../../geo/googleClient';
import { createTravelService, type TravelService } from '../../geo/travelService';
import type { Store } from '../../store';
import { getGeocode, nycNeighborhoodLookup } from '../geo';
import { bootV2Run, readNycFixtures, type NycFixtures } from './bootRun';
import { registerCommuteRoutes } from './commuteRoutes';
import { registerControlRoutes } from './controlRoutes';
import { registerParseRequestRoutes } from './parseRequestRoutes';
import { registerPlanningRoutes } from './planningRoutes';
import { registerReadRoutes } from './readRoutes';
import { V2_DEPS_NOT_LOADED, type V2Deps } from './router';
import { registerShipmentRoutes } from './shipmentRoutes';
import { startV2ClockTicker } from './ticker';

export type V2RuntimeOptions = {
  /** Folder with the travel cache and the three NYC fixture files (`NYC_FIXTURES_DIR` in the app). */
  fixturesDir: string;
  /** The v2 state file (`DEFAULT_V2_STATE_PATH` in the app). Created by the first change, never while not loaded. */
  statePath: string;
  /** The Google server key (`serverKey()` from server/geo/env.ts). Null, undefined or blank: cached data only. */
  key: string | null | undefined;
  /** Passed to the Google clients instead of the global `fetch`. Tests give a fake, so nothing touches the network. */
  fetch?: FetchLike;
  /**
   * Gemini for POST /parse-request (docs/mvp4.md F1): `geminiKey(env)` and `geminiModel(env)` of
   * server/ai/env.ts. Left out, or with a null or blank key: every sentence is parsed offline and nothing is
   * sent. `fetch` defaults to the `fetch` above; `log` (default `console.warn`) gets one fixed line per
   * request that fell back although a key is set, never the key or Gemini's text.
   */
  gemini?: {
    apiKey: string | null | undefined;
    model?: string;
    timeoutMs?: number;
    fetch?: FetchLike;
    log?: (line: string) => void;
  };
};

export type V2Runtime = {
  status: 'ready' | 'not_loaded';
  /** Why /api/v2 answers 503, in one sentence. Only when `not_loaded`. It never holds the key. */
  reason?: string;
  /**
   * One sentence for the start log, only when `ready` and a saved run was set aside as stale (the story files
   * or the default limit changed) and the default run was built in its place. Paths only, never the key.
   */
  notice?: string;
  /** For `createApp(store, { v2: deps })`. */
  deps: V2Deps;
  /** Starts the v2 clock ticker. Does nothing when not loaded, when it is already running, or after `shutdown`. */
  startTicker(opts?: { intervalMs?: number; now?: () => number }): void;
  /**
   * Stops the ticker, pauses the v2 clock and writes the state file once (DECISIONS pass 13), so a restart
   * resumes paused at the same minute. When not loaded it does nothing and creates no file.
   * A second call returns the first call's promise.
   */
  shutdown(): Promise<void>;
};

function notLoaded(reason: string): V2Runtime {
  return {
    status: 'not_loaded',
    reason,
    deps: V2_DEPS_NOT_LOADED,
    startTicker: () => undefined,
    shutdown: async () => undefined,
  };
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createV2Runtime(options: V2RuntimeOptions): V2Runtime {
  const { fixturesDir, statePath } = options;
  const key = typeof options.key === 'string' ? options.key.trim() : '';

  let service: TravelService;
  try {
    service = createTravelService({ dir: fixturesDir, key, fetch: options.fetch });
  } catch (e) {
    return notLoaded(messageOf(e)); // a corrupt cache file: the message names the file
  }

  // With no cache (`ready: false`) the provider is null, and bootV2Run answers the "not loaded" sentence.
  const boot = bootV2Run({
    travel: service.provider,
    places: service.ready ? service.files.matrix.places : null,
    fixturesDir,
    statePath,
  });
  if (boot.status === 'not_loaded' || !service.provider) {
    return notLoaded(boot.status === 'not_loaded' ? boot.reason : 'The travel service has no provider.');
  }

  let fixtures: NycFixtures;
  try {
    fixtures = readNycFixtures(fixturesDir); // bootV2Run has just read the same three files
  } catch (e) {
    return notLoaded(messageOf(e));
  }

  const store: Store<RunV2> = boot.store;
  // The service's provider, not a copy: it looks things up in `service.files` on every call.
  const travel = service.provider;
  // The one snapshot function of every route group.
  const snapshot = (run: RunV2, timeMin: number): Snapshot => snapshotAt(run, timeMin, travel);
  const buildEvents = buildTimeline;

  const extraRoutes = (router: express.Router): void => {
    registerReadRoutes(router, {
      store, travel, snapshotAt: snapshot,
      // Only with a key: the map then fetches the route lines it lacks after it answers (DECISIONS pass 57).
      ensureLegPolylines: key === '' ? undefined : (legs) => service.ensureLegPolylines(legs),
    });
    registerControlRoutes(router, { store, snapshotAt: snapshot });
    registerCommuteRoutes(router, { store, travel, buildEvents, places: service });
    registerShipmentRoutes(router, {
      store, travel, buildEvents, snapshotAt: snapshot,
      ensureLegPolylines: (legs) => service.ensureLegPolylines(legs),
    });
    registerPlanningRoutes(router, {
      store, travel, buildEvents, snapshotAt: snapshot,
      // `places` is the cache's own table, so a home added by a commute save is known to generate at once.
      generateInputs: { ...fixtures, places: service.files.matrix.places },
      travelPairs: travel,
    });
    // Reads the run's businesses and clock; it never changes the run (docs/mvp4.md F1).
    // Gemini first when a key was given, else (and on any failure) the offline parser.
    const { gemini } = options;
    registerParseRequestRoutes(router, {
      store,
      gemini: gemini && {
        apiKey: gemini.apiKey,
        model: gemini.model ?? DEFAULT_GEMINI_MODEL,
        timeoutMs: gemini.timeoutMs,
        fetchImpl: gemini.fetch ?? options.fetch,
      },
      log: gemini?.log ?? ((line) => console.warn(line)),
    });
    router.get('/geocode', getGeocode({
      key: () => (key === '' ? null : key),
      fetchImpl: options.fetch,
      neighborhoodFor: nycNeighborhoodLookup(fixtures.neighborhoodsFile.neighborhoods),
    }));
  };

  let ticker: { stop(): void } | null = null;
  let stopped: Promise<void> | null = null;

  return {
    status: 'ready',
    ...(boot.notice === undefined ? {} : { notice: boot.notice }),
    deps: { travel, store, extraRoutes },

    startTicker(opts) {
      if (ticker || stopped) return;
      ticker = startV2ClockTicker(store, opts);
    },

    shutdown() {
      stopped ??= (async () => {
        ticker?.stop();
        ticker = null;
        await store.flush(); // let an in-flight tick or request finish first
        await store.mutate((run) => {
          run.clock.playing = false;
        });
        await store.flush();
      })();
      return stopped;
    },
  };
}
