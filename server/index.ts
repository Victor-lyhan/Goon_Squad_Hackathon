import express from 'express';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, type Store } from './store';
import { createInitialRun, loadDefaultScenario } from './api/initialRun';
import { getBusinesses } from './api/businesses';
import { getEmployees } from './api/employees';
import { getMap } from './api/map';
import { putCommute } from './api/commute';
import { getSimulator, postSimulatorControl } from './api/simulator';
import { getBusinessDashboard, getEmployeeDashboard, getJob, getShipment } from './api/portals';
import { postShipment, patchShipment, postShipmentMatch } from './api/shipments';
import { postCompare, postRecompute, postPlanningReset } from './api/planning';
import { postGenerateScenario, getExportScenario, postImportScenario } from './api/scenario';
import { startClockTicker } from './api/ticker';
import { createV2Router, V2_DEPS_NOT_LOADED, type V2Deps } from './api/v2/router';
import { createV2Runtime } from './api/v2/bootstrap';
import { DEFAULT_V2_STATE_PATH, NYC_FIXTURES_DIR } from './api/v2/bootRun';
import { loadDotEnv, serverKey } from './geo/env';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, '../client/dist');

export function createApp(store: Store, opts: { clientDist?: string; v2?: V2Deps } = {}) {
  const dist = opts.clientDist ?? clientDist;
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/api/businesses', getBusinesses(store));
  app.get('/api/employees', getEmployees(store));
  app.get('/api/map', getMap(store));
  app.put('/api/employees/:id/commute', putCommute(store));
  app.get('/api/simulator', getSimulator(store));
  app.post('/api/simulator/control', postSimulatorControl(store));
  app.get('/api/businesses/:id/dashboard', getBusinessDashboard(store));
  app.get('/api/employees/:id/dashboard', getEmployeeDashboard(store));
  app.post('/api/shipments', postShipment(store));
  app.patch('/api/shipments/:id', patchShipment(store));
  app.post('/api/shipments/:id/match', postShipmentMatch(store));
  app.get('/api/shipments/:id', getShipment(store));
  app.get('/api/jobs/:id', getJob(store));

  app.post('/api/matches/compare', postCompare(store));
  app.post('/api/matches/recompute', postRecompute(store));
  app.post('/api/planning/reset', postPlanningReset(store));

  app.post('/api/scenario/generate', postGenerateScenario(store));
  app.get('/api/scenario/export', getExportScenario(store));
  app.post('/api/scenario/import', postImportScenario(store));

  // MVP II lives next to MVP 1 under /api/v2. Its routes are registered in server/api/v2/router.ts, not here.
  app.use('/api/v2', createV2Router(opts.v2 ?? V2_DEPS_NOT_LOADED));

  // Unknown API paths never fall through to the SPA.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // `npm start`: serve the built client from the same origin (run `npm run build` first).
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  // Body-parser failures (malformed JSON, oversize) and anything uncaught: always a JSON body, never HTML.
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    const e = err as { status?: number; statusCode?: number; type?: string };
    const status = e.status ?? e.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      const message =
        e.type === 'entity.parse.failed' ? 'Request body is not valid JSON'
        : e.type === 'entity.too.large' ? 'Request body is too large'
        : 'Bad request';
      res.status(status).json({ error: message });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

const isEntry = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

export function portInUseMessage(port: number): string {
  return `Port ${port} is already in use. Stop the other Relay server or set PORT=${port + 1}.`;
}

// Stop the ticker, pause the clock, and wait until the final state write has landed.
// `v2` is the MVP II runtime (server/api/v2/bootstrap.ts): it does the same for the v2 run and its own
// state file. Both are always tried, so a failed save of one never skips the other.
export async function shutdown(store: Store, ticker: { stop(): void }, v2?: { shutdown(): Promise<void> }): Promise<void> {
  ticker.stop();
  const v2Saved = v2 ? v2.shutdown() : Promise.resolve();
  v2Saved.catch(() => undefined); // awaited below; this only keeps an early failure from being "unhandled"
  try {
    await store.flush(); // let an in-flight tick finish first
    await store.mutate((run) => {
      run.clock.playing = false;
    });
    await store.flush();
  } finally {
    await v2Saved;
  }
}

/**
 * What the server prints about MVP II at start: one line with the status, and after it the notice when a
 * saved NYC run was set aside as stale (DECISIONS pass 55). Paths and reasons only, never a key.
 */
export function v2StartLines(v2: { status: 'ready' | 'not_loaded'; reason?: string; notice?: string }): string[] {
  if (v2.status !== 'ready') return [`Relay MVP II API (/api/v2) is not loaded and answers 503: ${v2.reason}`];
  const ready = 'Relay MVP II API ready at /api/v2 (NYC travel cache loaded)';
  return v2.notice ? [ready, v2.notice] : [ready];
}

if (isEntry) {
  const PORT = Number(process.env.PORT ?? 3001);
  const store = createStore({
    filePath: path.resolve(here, '../data/state.json'),
    initial: () => createInitialRun(loadDefaultScenario()),
  });
  const ticker = startClockTicker(store);

  // MVP II: fixtures/nyc/ (travel cache + NYC files) -> the v2 run in data/state-v2.json -> /api/v2.
  // The key is read from the environment (.env at the repo root) and is never logged.
  loadDotEnv();
  const v2 = createV2Runtime({ fixturesDir: NYC_FIXTURES_DIR, statePath: DEFAULT_V2_STATE_PATH, key: serverKey() });
  if (v2.status === 'ready') v2.startTicker();
  for (const line of v2StartLines(v2)) console.log(line);

  const server = createApp(store, { v2: v2.deps }).listen(PORT, (err?: Error) => {
    if (err) return; // Express 5 also passes listen errors here; the 'error' handler below reports them
    console.log(`Relay API listening on http://localhost:${PORT}`);
  });
  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      ticker.stop();
      console.error(portInUseMessage(PORT));
      process.exit(1);
    }
    throw e;
  });

  let stopping = false;
  const onSignal = (sig: string) => {
    if (stopping) process.exit(0); // second signal: leave right away
    stopping = true;
    console.log(`${sig} received, saving state and shutting down (press Ctrl-C again to force)`);
    server.close();
    server.closeAllConnections?.();
    shutdown(store, ticker, v2).then(
      () => process.exit(0),
      (e) => {
        console.error('Shutdown failed to save state:', e);
        process.exit(1);
      },
    );
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));
}
