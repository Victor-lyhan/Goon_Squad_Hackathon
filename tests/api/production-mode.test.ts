// Production mode (#721): `npm run build && npm start` is one server for the API and the built client.
// On the real server (`startServer` of server/index.ts, as `npm start` runs it) with a temp `clientDist`:
// - an unknown /api or /api/v2 path answers the JSON 404 with every method, never index.html;
// - a page and a deep link with a query string answer index.html, on the first load and on a reload;
// - the built files answer 200 with their own content type (JS, CSS, both font formats);
// - after a stop and a start on the same folder the page is served again and the run is the saved one, paused.
// Everything runs on a temp folder (v2-bootstrap-helper.ts) with the sample travel cache. The repo's data/,
// client/dist and `.env` are never read or written, and nothing reaches the network.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { CLIENT_SERVED_LINE, createApp, startServer, type RelayServer } from '../../server/index';
import { DEFAULT_V2_STATE_PATH } from '../../server/api/v2/bootRun';
import type { SimulatorResponse } from '../../shared/v2/api';
import { noNetwork, T, tempRepo, type TempRepo } from './v2-bootstrap-helper';
import { ownOrigin } from './own-origin-helper';

const INDEX = '<!doctype html><html><head><title>Relay</title></head><body><div id="root">relay-shell</div></body></html>';
/** Made-up built files, named like Vite's output. The font bytes are not real fonts: only the serving is tested. */
const ASSETS: [name: string, body: string, type: string][] = [
  ['index-Cz_NeMQt.js', 'console.log("relay-asset");', 'text/javascript'],
  ['index-dmrJd8lK.css', 'body { margin: 0; }', 'text/css'],
  ['inter-latin-400-normal-C38fXH4l.woff2', 'inter-woff2', 'font/woff2'],
  ['inter-latin-400-normal-CyCys3Eg.woff', 'inter-woff', 'font/woff'],
  ['ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2', 'plex-mono-woff2', 'font/woff2'],
  ['ibm-plex-mono-latin-400-normal-CvHOgSBP.woff', 'plex-mono-woff', 'font/woff'],
];

/** The pages of the demo, as a pasted link: the fallback does not look at the IDs, so made-up ones are enough. */
const PAGES = [
  '/',
  '/simulator',
  '/simulator?package=x&play=1',
  '/business/biz-1',
  '/business/biz-1?shipment=shp-1',
  '/employee/emp-1',
  '/employee/emp-1?job=plan-shp-1-L0',
  '/nope',
  '/nope?x=1&y=2',
];

const UNKNOWN_API = ['/api/x', '/api/v2/x', '/api/v2/x/y?z=1', '/api/v2/simulator/nope', '/api/x?package=x&play=1'];
const NOT_FOUND = { error: 'Not found' };

function writeDist(repo: TempRepo): string {
  const dist = path.join(repo.root, 'client', 'dist');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), INDEX);
  for (const [name, body] of ASSETS) fs.writeFileSync(path.join(dist, 'assets', name), body);
  return dist;
}

type Started = { server: RelayServer; repo: TempRepo; origin: string; lines: string[]; network: string[] };
const started: Started[] = [];
const repos: TempRepo[] = [];

/** `npm start` on a temp repo that has a built client. With `repo` it is a restart on the same folder. */
async function boot(repo?: TempRepo): Promise<Started> {
  const at = repo ?? tempRepo('sample');
  if (!repo) {
    repos.push(at);
    writeDist(at);
  }
  const lines: string[] = [];
  const network = noNetwork();
  const server = startServer({
    env: { PORT: '0' },
    envPath: path.join(at.root, '.env'),
    log: (line) => void lines.push(line),
    clientDist: path.join(at.root, 'client', 'dist'),
    fixturesDir: at.fixturesDir,
    statePath: at.statePath,
    fetch: network.fetch,
    exit: () => undefined,
  });
  const one: Started = { server, repo: at, origin: '', lines, network: network.calls };
  started.push(one);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  one.origin = await ownOrigin(server); // not 127.0.0.1:<port>: another program may answer there (own-origin-helper.ts)
  return one;
}

const call = async (origin: string, method: string, url: string, headers: Record<string, string> = {}) => {
  const withBody = method !== 'GET' && method !== 'DELETE';
  const res = await fetch(origin + url, {
    method,
    headers: withBody ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: withBody ? '{}' : undefined,
  });
  return { status: res.status, type: res.headers.get('content-type') ?? '', etag: res.headers.get('etag'), text: await res.text() };
};

const control = async (one: Started, body: unknown) => {
  const res = await fetch(`${one.origin}/api/v2/simulator/control`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as SimulatorResponse;
};

const simulator = async (one: Started) => (await (await fetch(`${one.origin}/api/v2/simulator`)).json()) as SimulatorResponse;

const repoDataDir = path.dirname(DEFAULT_V2_STATE_PATH);
const repoDataNames = () => (fs.existsSync(repoDataDir) ? fs.readdirSync(repoDataDir).sort() : null);
let repoDataBefore: string[] | null;
beforeAll(() => { repoDataBefore = repoDataNames(); });
afterAll(() => expect(repoDataNames()).toStrictEqual(repoDataBefore)); // the repo's data/ folder is untouched

afterEach(async () => {
  for (const one of started.splice(0)) await one.server.stop();
  for (const repo of repos.splice(0)) repo.remove();
});

describe('unknown API paths with a built client', () => {
  it('/api/x and /api/v2/x answer the JSON 404 with every method, never index.html', async () => {
    const one = await boot();
    expect(one.lines).toContain(CLIENT_SERVED_LINE);
    for (const url of UNKNOWN_API) {
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        const res = await call(one.origin, method, url);
        expect([method, url, res.status, res.text]).toStrictEqual([method, url, 404, JSON.stringify(NOT_FOUND)]);
        expect(res.type).toContain('application/json');
      }
    }
    // Also when the request asks for a page, as a link pasted into the address bar does.
    for (const url of ['/api/x', '/api/v2/x']) {
      const res = await call(one.origin, 'GET', url, { Accept: 'text/html,application/xhtml+xml' });
      expect([url, res.status, res.type.includes('application/json'), res.text]).toStrictEqual([url, 404, true, JSON.stringify(NOT_FOUND)]);
    }
    const health = await call(one.origin, 'GET', '/api/health');
    expect([health.status, JSON.parse(health.text)]).toStrictEqual([200, { ok: true }]);
    expect(one.network).toStrictEqual([]);
  }, T);

  it('while /api/v2 is not loaded an unknown /api/v2 path is JSON too (the 503), and /api/x stays the 404', async () => {
    const repo = tempRepo('empty');
    repos.push(repo);
    const server = createApp({ clientDist: writeDist(repo) }).listen(0, '127.0.0.1');
    try {
      await new Promise((resolve) => server.once('listening', resolve));
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const v2 = await call(origin, 'GET', '/api/v2/x');
      expect([v2.status, v2.type.includes('application/json')]).toStrictEqual([503, true]);
      expect(typeof JSON.parse(v2.text).error).toBe('string');
      expect(v2.text).not.toContain('relay-shell');
      const other = await call(origin, 'GET', '/api/x');
      expect([other.status, other.text]).toStrictEqual([404, JSON.stringify(NOT_FOUND)]);
      const page = await call(origin, 'GET', '/simulator?package=x&play=1'); // the pages do not wait for /api/v2
      expect([page.status, page.text]).toStrictEqual([200, INDEX]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, T);
});

describe('pages and deep links with a built client', () => {
  it('every page and deep link, also with a query string, answers index.html, and again on a reload', async () => {
    const one = await boot();
    for (const url of PAGES) {
      for (const load of ['first load', 'reload']) {
        const res = await call(one.origin, 'GET', url, { Accept: 'text/html,application/xhtml+xml' });
        expect([url, load, res.status, res.text]).toStrictEqual([url, load, 200, INDEX]);
        expect(res.type).toContain('text/html');
      }
    }
    expect(one.network).toStrictEqual([]);
  }, T);

  it('a reload that sends the cached ETag gets 304, and the full page once index.html was rebuilt', async () => {
    const one = await boot();
    const url = '/simulator?package=x&play=1';
    const first = await call(one.origin, 'GET', url);
    expect(first.etag).toBeTruthy();
    // As Chrome's reload sends it. Without a Cache-Control of its own, Node's fetch adds `no-cache` to a
    // conditional request, and the server then rightly answers the full page.
    const reload = { 'If-None-Match': first.etag as string, 'Cache-Control': 'max-age=0' };
    const again = await call(one.origin, 'GET', url, reload);
    expect([again.status, again.text]).toStrictEqual([304, '']);

    // `npm run build` while the server runs: the next reload gets the new shell, not the cached one.
    const rebuilt = INDEX.replace('relay-shell', 'relay-shell-rebuilt');
    const indexPath = path.join(one.repo.root, 'client', 'dist', 'index.html');
    fs.writeFileSync(indexPath, rebuilt);
    fs.utimesSync(indexPath, new Date(), new Date(Date.now() + 5_000)); // a later mtime, whatever the clock's grain
    const after = await call(one.origin, 'GET', url, reload);
    expect([after.status, after.text]).toStrictEqual([200, rebuilt]);
  }, T);

  it('the built JS, CSS and both font families answer 200 with their own content type', async () => {
    const one = await boot();
    for (const [name, body, type] of ASSETS) {
      const res = await call(one.origin, 'GET', `/assets/${name}`);
      expect([name, res.status, res.text]).toStrictEqual([name, 200, body]);
      expect([name, res.type.split(';')[0]]).toStrictEqual([name, type]);
    }
  }, T);
});

describe('the brand files with a built client (#784)', () => {
  // `npm run build` copies client/public/brand to client/dist/brand. Here the real files are copied the same
  // way into the temp dist, and the server must answer them as images, not with index.html.
  const BRAND: [name: string, type: string][] = [
    ['favicon.ico', 'image/vnd.microsoft.icon'], // the registered type of .ico; browsers take it
    ['icon-32.png', 'image/png'],
    ['icon-180.png', 'image/png'],
    ['icon-192.png', 'image/png'],
    ['relay-logo.png', 'image/png'],
  ];

  it('/brand/favicon.ico, the PNG icons and the logo answer 200 with the file and an image content type', async () => {
    const one = await boot();
    const source = path.resolve('client/public/brand');
    expect(fs.readdirSync(source).filter((name) => !name.startsWith('.')).sort()).toStrictEqual(BRAND.map(([name]) => name).sort());
    fs.cpSync(source, path.join(one.repo.root, 'client', 'dist', 'brand'), { recursive: true });
    for (const [name, type] of BRAND) {
      const res = await fetch(`${one.origin}/brand/${name}`);
      const body = Buffer.from(await res.arrayBuffer());
      expect([name, res.status, res.headers.get('content-type')]).toStrictEqual([name, 200, type]);
      expect(body.equals(fs.readFileSync(path.join(source, name))), name).toBe(true);
    }
    expect(one.network).toStrictEqual([]);
  }, T);
});

describe('a restart in production mode', () => {
  it('stop and start on the same folder: the page is served again and the run is the saved one, paused at the same minute', async () => {
    const first = await boot();
    await control(first, { action: 'play' });
    const seeked = await control(first, { action: 'seek', timeMin: 1422 });
    expect(seeked.clock).toMatchObject({ phase: 'locked', playing: true });
    await first.server.stop(); // pauses and saves, as SIGINT and SIGTERM do
    started.splice(started.indexOf(first), 1);
    const saved = JSON.parse(fs.readFileSync(first.repo.statePath, 'utf8')).run as { clock: SimulatorResponse['clock'] };
    expect(saved.clock.playing).toBe(false);
    expect(saved.clock.timeMin).toBeGreaterThanOrEqual(1422); // the ticker may have moved it before the stop

    const second = await boot(first.repo);
    expect(second.lines.filter((line) => line.includes('stale') || line.includes('.bad-'))).toStrictEqual([]);
    expect(second.lines).toContain(CLIENT_SERVED_LINE);
    const page = await call(second.origin, 'GET', '/simulator?package=x&play=1');
    expect([page.status, page.text]).toStrictEqual([200, INDEX]);

    const restored = await simulator(second);
    expect(restored.clock).toStrictEqual(saved.clock);
    expect(restored.runId).toBe(seeked.runId);
    expect(restored.shipments).toStrictEqual(seeked.shipments);
    expect(restored.plans).toStrictEqual(seeked.plans);
    expect(restored.jobs).toStrictEqual(seeked.jobs);
    expect(restored.unmatched).toStrictEqual(seeked.unmatched);
    // Paused means paused: the ticker of the new server does not move the clock by itself.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await simulator(second)).clock).toStrictEqual(saved.clock);
    expect(second.network).toStrictEqual([]);
  }, T);
});
