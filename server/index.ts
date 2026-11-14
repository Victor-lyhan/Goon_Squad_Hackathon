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

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, '../client/dist');

export function createApp(store: Store, opts: { clientDist?: string } = {}) {
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
export async function shutdown(store: Store, ticker: { stop(): void }): Promise<void> {
  ticker.stop();
  await store.flush(); // let an in-flight tick finish first
  await store.mutate((run) => {
    run.clock.playing = false;
  });
  await store.flush();
}

if (isEntry) {
  const PORT = Number(process.env.PORT ?? 3001);
  const store = createStore({
    filePath: path.resolve(here, '../data/state.json'),
    initial: () => createInitialRun(loadDefaultScenario()),
  });
  const ticker = startClockTicker(store);
  const server = createApp(store).listen(PORT, (err?: Error) => {
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
    shutdown(store, ticker).then(
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
