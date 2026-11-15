// Production mode for MVP IV (#810): the demo machine runs `npm run build` + `npm start`, one server for the
// API and the built client. Two MVP IV pieces are new there, and this file proves both on the real server
// (`startServer` of server/index.ts, as `npm start` runs it) with a temp `clientDist`:
// - the study page: `npm run build` copies client/public/study.html to client/dist/study.html, and the link
//   "The numbers" on `/` is a plain <a href="/study.html"> (DECISIONS pass 85). The server must answer the
//   file itself, byte for byte, not the app shell; HEAD answers like GET without a body. `/` stays the app
//   shell and a missing /assets file stays a 404 (pass 73);
// - POST /api/v2/parse-request with no GEMINI_API_KEY: 200 from the offline parser, and nothing is sent
//   (pass 83).
// As in the app, the server gets no `fetch` option, so every client of it (Google, Gemini) takes the global
// `fetch`. Here that is a spy that rejects every call, and the test's own requests go through node:http, so
// one call of the spy is one outgoing call of the server. Everything runs on a temp folder
// (v2-bootstrap-helper.ts) with the sample travel cache and an env object of its own: the repo's data/,
// client/dist and `.env` are never read or written, and no key is needed.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { CLIENT_SERVED_LINE, startServer, type RelayServer } from '../../server/index';
import { DEFAULT_V2_STATE_PATH } from '../../server/api/v2/bootRun';
import { GEMINI_KEY_NAME } from '../../server/ai/env';
import type { BusinessesResponse } from '../../shared/v2/api';
import type { ParseRequestResponse } from '../../shared/v2/parseRequest';
import { T, tempRepo, type TempRepo } from './v2-bootstrap-helper';
import { ownAddress } from './own-origin-helper';

const INDEX = '<!doctype html><html><head><title>Relay</title></head><body><div id="root">relay-shell</div></body></html>';
/** The committed study page (`npm run study` writes it, #787). `npm run build` copies it into client/dist. */
const STUDY_SOURCE = path.resolve(__dirname, '../../client/public/study.html');
const study = fs.readFileSync(STUDY_SOURCE);

/** Two network businesses of fixtures/nyc/businesses.json, found in the run by name. */
const SENDER = 'Brooklyn Roasting Company';
const RECIPIENT = 'Blue Bottle Coffee';
const SENTENCE = `Send a 0.5 kg envelope of espresso blend samples from ${SENDER} to ${RECIPIENT} by 10 a.m. tomorrow, ready at 4 p.m.`;

/** Not a real key. Only the control test at the end gives it, to prove the spy sees a Gemini call. */
const FAKE_GEMINI_KEY = 'FAKE-gemini-key-4c1d';

// ---------- the server ----------

type Started = { server: RelayServer; repo: TempRepo; host: string; port: number; lines: string[] };
const started: Started[] = [];

/** `npm start` on a temp repo whose client/dist holds index.html and a copy of the study page. */
async function boot(env: Record<string, string> = {}): Promise<Started> {
  const repo = tempRepo('sample');
  const dist = path.join(repo.root, 'client', 'dist');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), INDEX);
  fs.copyFileSync(STUDY_SOURCE, path.join(dist, 'study.html'));

  const lines: string[] = [];
  const server = startServer({
    env: { PORT: '0', ...env },
    envPath: path.join(repo.root, '.env'), // not there: the temp repo has no .env
    log: (line) => void lines.push(line),
    clientDist: dist,
    fixturesDir: repo.fixturesDir,
    statePath: repo.statePath,
    exit: () => undefined,
  });
  const one: Started = { server, repo, host: '', port: 0, lines };
  started.push(one);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  // Not 127.0.0.1:<port> unasked: another program may answer there (own-origin-helper.ts). Over node:http, so the spy sees nothing.
  ({ host: one.host, port: one.port } = await ownAddress(server));
  return one;
}

type Answer = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };

/** One request over node:http, not `fetch`: the `fetch` spy then counts only what the server sends. */
function request(one: Started, method: string, url: string, opts: { json?: unknown; headers?: Record<string, string> } = {}): Promise<Answer> {
  const payload = opts.json === undefined ? null : Buffer.from(JSON.stringify(opts.json));
  return new Promise<Answer>((resolve, reject) => {
    const req = http.request({
      host: one.host, port: one.port, method, path: url, agent: false,
      headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {}), ...opts.headers },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(payload ?? undefined);
  });
}

const json = <B>(answer: Answer) => JSON.parse(answer.body.toString('utf8')) as B;
const contentType = (answer: Answer) => String(answer.headers['content-type'] ?? '');
/** As a click on a link sends it. */
const AS_PAGE = { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };

// ---------- the spy, the environment, the repo's data/ ----------

/** Every call of the global `fetch`: "<method> <origin><path>", without the query string. */
const outgoing: string[] = [];
beforeEach(() => {
  outgoing.length = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    outgoing.push(`${init?.method ?? 'GET'} ${url.origin}${url.pathname}`);
    throw new Error('production-mvp4: the server must not reach the network');
  });
});

// The server reads the `env` it is given, never `process.env`. The key is taken out of `process.env` as
// well, so a machine that has one exported cannot make a route that looked there pass or call out.
let keyBefore: string | undefined;
beforeAll(() => {
  keyBefore = process.env[GEMINI_KEY_NAME];
  delete process.env[GEMINI_KEY_NAME];
});
afterAll(() => {
  if (keyBefore !== undefined) process.env[GEMINI_KEY_NAME] = keyBefore;
});

const repoDataDir = path.dirname(DEFAULT_V2_STATE_PATH);
const repoDataNames = () => (fs.existsSync(repoDataDir) ? fs.readdirSync(repoDataDir).sort() : null);
let repoDataBefore: string[] | null;
beforeAll(() => { repoDataBefore = repoDataNames(); });
afterAll(() => expect(repoDataNames()).toStrictEqual(repoDataBefore)); // the repo's data/ folder is untouched

afterEach(async () => {
  for (const one of started.splice(0)) {
    await one.server.stop();
    expect(fs.existsSync(path.join(one.repo.root, '.env'))).toBe(false); // no .env was there to read, and none was written
    one.repo.remove();
  }
  vi.restoreAllMocks();
});

// ---------- the tests ----------

describe('the study page with a built client', () => {
  it('GET /study.html answers 200, text/html and the bytes of client/public/study.html, not the app shell', async () => {
    const one = await boot();
    expect(one.lines).toContain(CLIENT_SERVED_LINE);
    expect(study.length).toBeGreaterThan(1000); // the committed page, not an empty file
    expect(study.includes('relay-shell')).toBe(false);

    for (const [what, headers] of [['plain', {}], ['as a clicked link', AS_PAGE]] as const) {
      const res = await request(one, 'GET', '/study.html', { headers });
      expect([what, res.status, contentType(res).split(';')[0]]).toStrictEqual([what, 200, 'text/html']);
      expect(res.body.equals(study), what).toBe(true);
      expect(Number(res.headers['content-length']), what).toBe(study.length);
    }
    expect(outgoing).toStrictEqual([]);
  }, T);

  it('HEAD /study.html answers like GET (status, type, length, validators) without a body', async () => {
    const one = await boot();
    const get = await request(one, 'GET', '/study.html');
    const head = await request(one, 'HEAD', '/study.html');

    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    expect(contentType(head).split(';')[0]).toBe('text/html');
    expect(Number(head.headers['content-length'])).toBe(study.length);
    const same = (res: Answer) => ['content-type', 'content-length', 'etag', 'last-modified'].map((name) => [name, res.headers[name]]);
    expect(same(head)).toStrictEqual(same(get));
    expect(head.headers.etag).toBeTruthy();
  }, T);

  it('the study page is the file in client/dist: a rebuilt one is served, and without it the path is the app shell', async () => {
    const one = await boot();
    const file = path.join(one.repo.root, 'client', 'dist', 'study.html');

    // `npm run study` + `npm run build` while the server runs: the next load is the new page.
    const rebuilt = Buffer.concat([study, Buffer.from('\n<!-- rebuilt -->\n')]);
    fs.writeFileSync(file, rebuilt);
    const after = await request(one, 'GET', '/study.html');
    expect(after.status).toBe(200);
    expect(after.body.equals(rebuilt)).toBe(true);

    // A build without the page (it was never generated): the path falls to the app, like any unknown page.
    // So the bytes of the tests above come from the file, and from no route of the server.
    fs.rmSync(file);
    const gone = await request(one, 'GET', '/study.html');
    expect([gone.status, gone.body.toString('utf8')]).toStrictEqual([200, INDEX]);
  }, T);

  it('GET / is still the app shell (the page\'s "back" link), and a missing /assets/x.js is still a 404', async () => {
    const one = await boot();
    expect(study.includes('href="/"')).toBe(true); // the study page links back to the app

    for (const method of ['GET', 'HEAD']) {
      const home = await request(one, method, '/', { headers: AS_PAGE });
      expect([method, home.status, home.body.toString('utf8')]).toStrictEqual([method, 200, method === 'GET' ? INDEX : '']);
      expect(contentType(home), method).toContain('text/html');
      expect(Number(home.headers['content-length']), method).toBe(Buffer.byteLength(INDEX));

      const missing = await request(one, method, '/assets/x.js');
      expect([method, missing.status, missing.body.toString('utf8')]).toStrictEqual([method, 404, method === 'GET' ? 'Not found' : '']);
      expect(contentType(missing), method).toContain('text/plain');
    }
    // A page of the app next to the static page: still the shell.
    const page = await request(one, 'GET', '/simulator?package=x&play=1', { headers: AS_PAGE });
    expect([page.status, page.body.toString('utf8')]).toStrictEqual([200, INDEX]);
    expect(outgoing).toStrictEqual([]);
  }, T);
});

describe('POST /api/v2/parse-request with a built client', () => {
  /** The two businesses of the sentence, from GET /api/v2/businesses of the running server. */
  async function namedBusinesses(one: Started) {
    const res = await request(one, 'GET', '/api/v2/businesses');
    expect(res.status).toBe(200);
    const { businesses } = json<BusinessesResponse>(res);
    const byName = (name: string) => {
      const found = businesses.filter((business) => business.name === name);
      expect([name, found.length]).toStrictEqual([name, 1]);
      return found[0];
    };
    return { sender: byName(SENDER), recipient: byName(RECIPIENT) };
  }

  it('with no GEMINI_API_KEY a sentence naming two network businesses answers 200 with source "offline" and nothing is sent', async () => {
    const one = await boot(); // the env is { PORT: '0' }: no Gemini key, no Google key
    expect(process.env[GEMINI_KEY_NAME]).toBeUndefined();
    const { sender, recipient } = await namedBusinesses(one);

    const res = await request(one, 'POST', '/api/v2/parse-request', { json: { text: SENTENCE } });
    expect(res.status, res.body.toString('utf8')).toBe(200);
    expect(contentType(res)).toContain('application/json');
    const parsed = json<ParseRequestResponse>(res);
    expect(parsed.source).toBe('offline');
    expect(parsed.rejected).toBeNull();
    expect(parsed.draft.originBusinessId).toBe(sender.id);
    expect(parsed.draft.destinationBusinessId).toBe(recipient.id);
    expect(parsed.missing).not.toContain('originBusinessId');
    expect(parsed.missing).not.toContain('destinationBusinessId');

    // Asked again, as a second click does: the same answer, and still nothing sent.
    const again = await request(one, 'POST', '/api/v2/parse-request', { json: { text: SENTENCE } });
    expect([again.status, json<ParseRequestResponse>(again)]).toStrictEqual([200, parsed]);

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(outgoing).toStrictEqual([]);
  }, T);

  it('an empty sentence is the JSON 400 and a GET of the route is the JSON 404, never the app shell', async () => {
    const one = await boot();
    const empty = await request(one, 'POST', '/api/v2/parse-request', { json: { text: '   ' } });
    expect(empty.status).toBe(400);
    expect(contentType(empty)).toContain('application/json');
    expect(typeof json<{ error: string }>(empty).error).toBe('string');

    const get = await request(one, 'GET', '/api/v2/parse-request', { headers: AS_PAGE });
    expect([get.status, get.body.toString('utf8')]).toStrictEqual([404, JSON.stringify({ error: 'Not found' })]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  }, T);

  it('control: with a key the same server does call out, so the spy above would have seen it; the call fails and the answer is still 200 offline', async () => {
    const warned: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => void warned.push(args.map(String).join(' ')));
    const one = await boot({ [GEMINI_KEY_NAME]: FAKE_GEMINI_KEY });

    const res = await request(one, 'POST', '/api/v2/parse-request', { json: { text: SENTENCE } });
    expect(res.status, res.body.toString('utf8')).toBe(200); // Gemini can never make the route answer 5xx (pass 83)
    expect(json<ParseRequestResponse>(res).source).toBe('offline');

    expect(outgoing.length).toBeGreaterThan(0);
    for (const line of outgoing) expect(line).toMatch(/^POST https:\/\/generativelanguage\.googleapis\.com\//);
    // The key is in no body, no start line and no log line.
    for (const text of [res.body.toString('utf8'), ...one.lines, ...warned, ...outgoing]) expect(text).not.toContain(FAKE_GEMINI_KEY);
  }, T);
});
