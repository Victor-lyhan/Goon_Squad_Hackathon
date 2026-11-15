// #821: the test servers of tests/ui cannot be answered for by another program on 127.0.0.1.
// What went wrong (PR #818 note): a helper listened on every address (`app.listen(0)`) and then asked
// `http://127.0.0.1:<port>`. A server on every address shares its port number with a program that listens
// on 127.0.0.1 alone, and 127.0.0.1 then reaches that program: the suite failed with
// `"MCP server"... is not valid JSON`.
// Both helpers now listen on 127.0.0.1 only (`listen(0, '127.0.0.1')`), so the address is theirs alone.
//
// Here a dummy HTTP server that answers the text `MCP server` runs on 127.0.0.1 for the whole file. For each
// helper it then asks for the helper's own port number on 127.0.0.1, as the other program held it. That must
// be refused, and the requests of client/src/api must be answered by the Relay server.
// No network beyond 127.0.0.1, no key.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getBusinesses } from '../../client/src/api/v2';
import { T, startRealApi } from './business-v2-real-helper';
import { startRehearsalApi } from './demo-rehearse-twice-helper';

vi.setConfig({ testTimeout: T, hookTimeout: T });

const MCP_TEXT = 'MCP server';

/** `METHOD /path` of every request a dummy server answered. Must stay empty for the helpers' requests. */
const dummyHits: string[] = [];
const dummies: http.Server[] = [];

/**
 * A dummy server on 127.0.0.1 that answers `MCP server` to everything. `port` 0 asks for a free port.
 * Answers the port it listens on, or the error code when the system refuses the address.
 */
function startDummy(port: number): Promise<{ port: number } | { refused: string }> {
  const server = http.createServer((req, res) => {
    dummyHits.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(MCP_TEXT);
  });
  return new Promise((resolve) => {
    server.once('error', (err: NodeJS.ErrnoException) => resolve({ refused: err.code ?? String(err) }));
    server.listen(port, '127.0.0.1', () => {
      dummies.push(server);
      resolve({ port: (server.address() as AddressInfo).port });
    });
  });
}

async function closeDummies(keep: number): Promise<void> {
  for (const server of dummies.splice(keep)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

/** The port of the dummy that runs for the whole file. */
let dummyPort: number;

beforeAll(async () => {
  const started = await startDummy(0);
  if (!('port' in started)) throw new Error(`the dummy server did not start on 127.0.0.1: ${started.refused}`);
  dummyPort = started.port;
});

let closeApi: (() => Promise<void>) | undefined;

afterEach(async () => {
  await closeApi?.(); // also puts the real `fetch` back
  closeApi = undefined;
  await closeDummies(1);
  dummyHits.length = 0;
});

afterAll(() => closeDummies(0));

const HELPERS: { name: string; start: () => Promise<{ origin: string; close: () => Promise<void> }> }[] = [
  { name: 'business-v2-real-helper.ts (startRealApi)', start: startRealApi },
  { name: 'demo-rehearse-twice-helper.ts (startRehearsalApi)', start: startRehearsalApi },
];

describe('#821 a tests/ui test server is not answered for by another program on 127.0.0.1', () => {
  it('the dummy server answers "MCP server" on 127.0.0.1, which is not JSON', async () => {
    const res = await fetch(`http://127.0.0.1:${dummyPort}/api/health`);
    const body = await res.text();
    expect(body).toBe(MCP_TEXT);
    expect(() => JSON.parse(body) as unknown).toThrow(SyntaxError);
    expect(dummyHits).toEqual(['GET /api/health']);
  });

  it.each(HELPERS)('$name listens on 127.0.0.1 only and its requests reach the Relay server', async ({ start }) => {
    const api = await start();
    closeApi = api.close;

    // The helper's address is 127.0.0.1 with a port of its own: not the port of the running dummy.
    const origin = new URL(api.origin);
    expect(origin.protocol).toBe('http:');
    expect(origin.hostname).toBe('127.0.0.1');
    const port = Number(origin.port);
    expect(port).toBeGreaterThan(0);
    expect(port).not.toBe(dummyPort);

    // The other program asks for the same port number on 127.0.0.1. A helper on every address would share it.
    const second = await startDummy(port);

    // The requests the pages send (relative `/api/...` through the helper's `fetch`) are answered by Relay.
    const health = await fetch('/api/health');
    const healthBody = await health.text();
    expect(healthBody).not.toContain(MCP_TEXT);
    expect(health.status).toBe(200);
    expect(JSON.parse(healthBody)).toEqual({ ok: true });
    const { businesses } = await getBusinesses();
    expect(businesses.length).toBeGreaterThan(0);
    for (const business of businesses) expect(business.name).toEqual(expect.any(String));

    // Neither dummy saw one of them, and the second one never got the address.
    expect(dummyHits).toEqual([]);
    expect(second).toEqual({ refused: 'EADDRINUSE' });
  });
});
