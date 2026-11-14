import express from 'express';
import { existsSync, realpathSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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
import { DEFAULT_ENV_PATH, loadDotEnv, serverKey } from './geo/env';
import type { FetchLike } from './geo/googleClient';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, '../client/dist');

// What the server says at start about the built client and the Google server key (one line each).
export const CLIENT_SERVED_LINE = 'Serving the built client from client/dist';
export const CLIENT_MISSING_LINE = 'client/dist not found: run npm run build, or use npm run dev';
export const KEY_SET_LINE = 'Google server key: set';
export const KEY_NOT_SET_LINE = 'Google server key: not set (address search and a commute save with a new address answer 503)';

/** True when `dist` holds a built client (`npm run build` wrote its index.html). */
export function hasBuiltClient(dist: string): boolean {
  return existsSync(path.join(dist, 'index.html'));
}

/** The one start line about the built client. It names `client/dist`, never the full path. */
export function clientStartLine(dist: string): string {
  return hasBuiltClient(dist) ? CLIENT_SERVED_LINE : CLIENT_MISSING_LINE;
}

/** The one start line about the Google server key: set or not set, never the value or its length. */
export function keyStartLine(key: string | null | undefined): string {
  return typeof key === 'string' && key.trim() !== '' ? KEY_SET_LINE : KEY_NOT_SET_LINE;
}

// A V8 stack frame: "at fn (file:12:3)", "at file:12:3", "at new Promise (<anonymous>)", "at async Promise.all (index 0)".
const STACK_FRAME = /^at .*(?::\d+:\d+\)?|\(<anonymous>\)|\(native\)|\(index \d+\)|<anonymous>)$/;

/** The class of a thrown value, from code only: the constructor's name, or the type of a value that is no object. */
function errorClassName(err: unknown): string {
  if (typeof err !== 'object' || err === null) return `non-error (${err === null ? 'null' : typeof err})`;
  const ctor = (err as { constructor?: unknown }).constructor;
  const name = typeof ctor === 'function' ? ctor.name : '';
  return /^[A-Za-z_$][\w$]{0,80}$/.test(name) ? name : 'Error';
}

/**
 * The frames of `err.stack` and nothing else. A stack starts with "<name>: <message>", and a message can run
 * over several lines and even look like a frame. So everything up to the end of the message is cut off first,
 * and then only the unbroken run of frame lines at the end is kept.
 */
function stackFrames(err: unknown): string[] {
  if (typeof err !== 'object' || err === null) return [];
  const { stack, message } = err as { stack?: unknown; message?: unknown };
  if (typeof stack !== 'string') return [];
  const said = typeof message === 'string' ? message : '';
  const at = said === '' ? -1 : stack.indexOf(said);
  const text = at < 0 ? stack : stack.slice(at + said.length);
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  let first = lines.length;
  while (first > 0 && STACK_FRAME.test(lines[first - 1])) first -= 1;
  return lines.slice(first);
}

/**
 * The one log line of a failed request: what was asked (method, path without the query string), the error's
 * class and where it was thrown. Never the error's message or any of its fields: a message can hold an
 * entered home's coordinates (DECISIONS pass 56), and a query string can hold an address.
 */
export function errorLogLine(what: string, req: { method: string; originalUrl: string }, err: unknown): string {
  const head = `${what} ${req.method} ${req.originalUrl.split('?')[0]}`;
  try {
    return [`${head} ${errorClassName(err)}`, ...stackFrames(err)].join(' | ');
  } catch {
    return `${head} (the error could not be read)`; // e.g. a getter that throws: still one line, still no message
  }
}

export function createApp(store: Store, opts: { clientDist?: string; v2?: V2Deps } = {}) {
  const dist = opts.clientDist ?? clientDist;
  const app = express();

  // Every 500 leaves exactly one console.error line. The error handler at the end writes it for an error it
  // answers; a route that answers 500 on its own (it caught the error and passed nothing on) gets the short
  // line here, so it does not go unseen either.
  const logged = new WeakSet<express.Response>();
  app.use((req, res, next) => {
    res.once('finish', () => {
      if (res.statusCode !== 500 || logged.has(res)) return;
      console.error(`500 ${req.method} ${req.originalUrl.split('?')[0]} (answered by the route, which passed on no error)`);
    });
    next();
  });

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
  if (hasBuiltClient(dist)) {
    app.use(express.static(dist));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(dist, 'index.html'));
    });
  } else {
    // No build: a page request still answers 404, with what to do instead of Express's "Cannot GET /".
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.status(404).type('text/plain').send(CLIENT_MISSING_LINE);
    });
  }

  // Body-parser failures (malformed JSON, oversize) and anything uncaught: always a JSON body, never HTML.
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) {
      // The answer has started, so no status can follow. Express's own last handler would end the connection
      // and print err.stack, message included; this does the same with the one safe line.
      logged.add(res);
      console.error(errorLogLine('Failed after the answer started:', req, err));
      res.destroy();
      return;
    }
    const e = (typeof err === 'object' && err !== null ? err : {}) as { status?: number; statusCode?: number; type?: string };
    const status = e.status ?? e.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      const message =
        e.type === 'entity.parse.failed' ? 'Request body is not valid JSON'
        : e.type === 'entity.too.large' ? 'Request body is too large'
        : 'Bad request';
      res.status(status).json({ error: message });
      return;
    }
    logged.add(res);
    console.error(errorLogLine('500', req, err));
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

export type StartServerOptions = {
  /** Read for `PORT` and the Google server key, after `.env` was loaded into it (`process.env` in the app). */
  env: Record<string, string | undefined>;
  /** The `.env` file (`DEFAULT_ENV_PATH` in the app). A variable already in `env` wins over the file. */
  envPath: string;
  /** Gets every start line, one call per line (`console.log` in the app). */
  log: (line: string) => void;
  /** The built client (`client/dist` in the app). */
  clientDist: string;
  /** Folder with the travel cache and the three NYC fixture files (`NYC_FIXTURES_DIR` in the app). */
  fixturesDir: string;
  /** The MVP II state file (`DEFAULT_V2_STATE_PATH` in the app). */
  statePath: string;
  /** The MVP 1 state file. Default: `state.json` in the folder of `statePath`, which is `data/state.json` in the app. */
  mvp1StatePath?: string;
  /** Passed to the Google clients instead of the global `fetch`. Tests give a fake, so nothing touches the network. */
  fetch?: FetchLike;
  /** Called with 1 after the "port is already in use" line. Default: `process.exit`. */
  exit?: (code: number) => void;
};

/** The listening http server, plus `stop()`: close it, stop both tickers, pause both clocks, write both state files. */
export type RelayServer = Server & { stop(): Promise<void> };

/**
 * Starts the whole server, as `npm start` and `npm run dev` do. In this order: `.env` is loaded, then `PORT`
 * and the key are read; both runs are loaded; the start lines go to `log`: MVP II (`v2StartLines`), the built
 * client, the Google server key (set or not set, never the value), and, once the port is bound, the address
 * with the port the server really listens on.
 */
export function startServer(opts: StartServerOptions): RelayServer {
  const { env, log } = opts;
  // First of all: a PORT or a key in .env counts. A variable that is already in the environment wins.
  loadDotEnv(opts.envPath, env);
  const port = Number(env.PORT ?? 3001);

  const store = createStore({
    filePath: opts.mvp1StatePath ?? path.join(path.dirname(opts.statePath), 'state.json'),
    initial: () => createInitialRun(loadDefaultScenario()),
  });
  const ticker = startClockTicker(store);

  // MVP II: fixtures/nyc/ (travel cache + NYC files) -> the v2 run in data/state-v2.json -> /api/v2.
  // The key is read from the environment (.env at the repo root) and is never logged.
  const key = serverKey(env);
  const v2 = createV2Runtime({ fixturesDir: opts.fixturesDir, statePath: opts.statePath, key, fetch: opts.fetch });
  if (v2.status === 'ready') v2.startTicker();
  for (const line of v2StartLines(v2)) log(line);
  log(clientStartLine(opts.clientDist));
  log(keyStartLine(key));

  const server: Server = createApp(store, { clientDist: opts.clientDist, v2: v2.deps }).listen(port, (err?: Error) => {
    if (err) return; // Express 5 also passes listen errors here; the 'error' handler below reports them
    // The bound port, not the configured one: PORT=0 (or an empty PORT) lets the system choose.
    log(`Relay API listening on http://localhost:${(server.address() as AddressInfo).port}`);
  });
  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      ticker.stop();
      console.error(portInUseMessage(port));
      (opts.exit ?? ((code: number) => process.exit(code)))(1);
      return;
    }
    throw e;
  });

  let stopped: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    stopped ??= (async () => {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections?.();
      await Promise.all([closed, shutdown(store, ticker, v2)]);
    })();
    return stopped;
  };
  return Object.assign(server, { stop });
}

if (isEntry) {
  const server = startServer({
    env: process.env,
    envPath: DEFAULT_ENV_PATH,
    log: (line) => console.log(line),
    clientDist,
    fixturesDir: NYC_FIXTURES_DIR,
    statePath: DEFAULT_V2_STATE_PATH,
  });

  let stopping = false;
  const onSignal = (sig: string) => {
    if (stopping) process.exit(0); // second signal: leave right away
    stopping = true;
    console.log(`${sig} received, saving state and shutting down (press Ctrl-C again to force)`);
    server.stop().then(
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
