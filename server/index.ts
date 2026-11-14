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
import { startClockTicker } from './api/ticker';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, '../client/dist');

export function createApp(store: Store) {
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

  // Unknown API paths never fall through to the SPA.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // `npm start`: serve the built client from the same origin (run `npm run build` first).
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }
  return app;
}

const isEntry = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isEntry) {
  const PORT = Number(process.env.PORT ?? 3001);
  const store = createStore({
    filePath: path.resolve(here, '../data/state.json'),
    initial: () => createInitialRun(loadDefaultScenario()),
  });
  startClockTicker(store);
  createApp(store).listen(PORT, () => {
    console.log(`Relay API listening on http://localhost:${PORT}`);
  });
}
