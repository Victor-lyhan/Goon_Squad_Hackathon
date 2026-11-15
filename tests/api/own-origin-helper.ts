// The address a test may call its own server on (#820).
//
// `startServer` of server/index.ts listens on every address (`::`) of its port. On this Mac another program
// can listen on 127.0.0.1 alone with the same port number, in either order, and it then answers every call to
// `http://127.0.0.1:<port>` instead of the test's server (seen: `"MCP server"... is not valid JSON`).
//
// Two rules follow for the tests in this folder:
//   - a server the test builds itself listens on 127.0.0.1 only (`listen(0, '127.0.0.1')`): the system then
//     gives a port that is free on the address the test calls, and no other program can take it;
//   - a `startServer` server is called on the origin `ownOrigin` gives: the loopback address of the server's
//     own family first, and only an address where `/api/health` answers as the app does.
// tests/api/own-origin.test.ts holds both, with a dummy "MCP server" on 127.0.0.1.
import http from 'node:http';
import type { AddressInfo, Server } from 'node:net';

export type OwnAddress = {
  /** For `http.request({ host })`: `::1` or `127.0.0.1`, no brackets. */
  host: string;
  port: number;
  /** For `fetch`: `http://[::1]:<port>` or `http://127.0.0.1:<port>`, no slash at the end. */
  origin: string;
};

/** How long one address gets to answer `/api/health`. The server is in this process: it answers in milliseconds. */
const HEALTH_TIMEOUT_MS = 2000;

/**
 * True when `GET /api/health` on that address answers 200 with `{ "ok": true }`, as `createApp` does.
 * Over node:http, not `fetch`: a test that spies on the global `fetch` does not see this request.
 */
function healthAnswers(host: string, port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const req = http.get({ host, port, path: '/api/health', agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('error', () => resolve(false));
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { ok?: unknown } | null;
          resolve(res.statusCode === 200 && body?.ok === true);
        } catch {
          resolve(false); // not JSON: another program
        }
      });
    });
    req.setTimeout(HEALTH_TIMEOUT_MS, () => req.destroy());
    req.on('error', () => resolve(false)); // nothing listens there, or it did not answer in time
  });
}

/**
 * The loopback address this listening server answers on, proved by `/api/health`. A server on every address
 * of IPv6 (`::`, what `listen(port)` gives) is asked on `::1` first: only that server can answer there.
 * Throws when no address answers as the app does, so a test never goes on to call another program.
 */
export async function ownAddress(server: Server): Promise<OwnAddress> {
  const { port, family } = server.address() as AddressInfo;
  const hosts = family === 'IPv6' ? ['::1', '127.0.0.1'] : ['127.0.0.1'];
  const origins = hosts.map((host) => `http://${host.includes(':') ? `[${host}]` : host}:${port}`);
  for (const [i, host] of hosts.entries()) {
    if (await healthAnswers(host, port)) return { host, port, origin: origins[i] };
  }
  throw new Error(`ownOrigin: the test server on port ${port} does not answer /api/health on ${origins.join(' or ')}`);
}

/** `ownAddress(server).origin`: what a test puts in front of `/api/...`. */
export async function ownOrigin(server: Server): Promise<string> {
  return (await ownAddress(server)).origin;
}
