// Helper for tests/ui/demo-rehearse-twice.test.tsx (#740): the Business and Employee pages against a REAL
// server, with the pages' own 1 s poll moved by hand.
// - `startRehearsalApi()` boots `createV2Runtime` on a COPY of fixtures/nyc in a temp folder, with a temp
//   state file (what `RELAY_STATE_PATH` sets in the app) and no key (DECISIONS pass 56), and listens on a
//   free local port. The clock ticker is not started: the clock moves only when a control moves it.
//   The global `fetch` is replaced so the relative `/api/...` URLs of client/src/api reach this server; any
//   other URL is refused and recorded. Every request is logged with its answer.
// - Time: only `setTimeout` / `setInterval` are fake (`useFakePollTimers`), so the pages poll when the test
//   says so while the HTTP requests stay real. `settle()` waits for every open request and React's updates;
//   `advancePolls()` moves the pages' timers by one poll interval.
// - `readmeDemo()` reads the ```demo-request block of README.md, so no story name is written in the test
//   (DECISIONS pass 54 and 59).
import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { vi } from 'vitest';
import { NYC_FIXTURES_DIR } from '../../server/api/v2/bootRun';
import { createV2Runtime } from '../../server/api/v2/bootstrap';
import { createApp } from '../../server/index';

/**
 * Timeout of the tests and hooks (DECISIONS pass 52): each boots or talks to a real HTTP server. The
 * slowest test (the two rehearsals) takes about 3 s locally, so this is more than 10x.
 */
export const T = 60_000;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ---------- the README's demo request ----------

/** The `key: value` lines of the README's ```demo-request block. */
export function readmeDemo(): Record<string, string> {
  const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
  const block = /```demo-request\n([\s\S]*?)```/.exec(readme)?.[1];
  if (!block) throw new Error('README.md has no ```demo-request block');
  return Object.fromEntries(block.trim().split('\n').map((line) => {
    const colon = line.indexOf(':');
    return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  }));
}

/** The one entry with this name. A name the run does not have, or has twice, fails. */
export function byName<V extends { name: string }>(list: V[], name: string, what: string): V {
  const found = list.filter((entry) => entry.name === name);
  if (found.length !== 1) throw new Error(`README names the ${what} "${name}", and the default run has ${found.length} of them`);
  return found[0];
}

// ---------- the server and the browser's fetch ----------

/** One request of the pages (or of the test, through client/src/api). `status` is null while it is open. */
export type Logged = {
  method: string;
  /** `/api/v2/...` with its query string. */
  path: string;
  /** The JSON body sent, or undefined. */
  sent: unknown;
  status: number | null;
  /** The JSON body answered, or undefined (open, or not JSON). */
  answer: unknown;
};

export type RehearsalApi = Awaited<ReturnType<typeof startRehearsalApi>>;

export async function startRehearsalApi() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-rehearse-twice-'));
  const fixturesDir = path.join(root, 'fixtures', 'nyc');
  fs.cpSync(NYC_FIXTURES_DIR, fixturesDir, { recursive: true });
  const statePath = path.join(root, 'data', 'state-v2.json');

  /** What the server's Google clients tried to fetch. Must stay empty. */
  const googleCalls: string[] = [];
  const runtime = createV2Runtime({
    fixturesDir,
    statePath,
    key: null,
    fetch: async (url) => {
      googleCalls.push(String(url).split('?')[0]);
      throw new Error('demo-rehearse-twice: the server must not call Google');
    },
  });
  if (runtime.status !== 'ready' || !runtime.deps.store) {
    throw new Error(`/api/v2 did not load on the copy of fixtures/nyc: ${runtime.reason ?? 'no store'}`);
  }
  const app = createApp({ clientDist: path.join(root, 'no-dist'), v2: runtime.deps });
  // 127.0.0.1 only (#821): a server on every address shares its port number with any program that listens
  // on 127.0.0.1 alone, and that program then answers the requests below instead ("MCP server", PR #818).
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const realFetch = globalThis.fetch;
  const log: Logged[] = [];
  /** What the browser side tried to fetch outside the test server. Must stay empty. */
  const outgoing: string[] = [];
  let open = 0;

  // The whole answer is read here, so a request counts as open until its body is in: `settle()` can then
  // tell "nothing in flight" from "headers in, body on its way".
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? 'GET';
    if (!url.startsWith('/api/')) {
      outgoing.push(`${method} ${url.split('?')[0]}`);
      throw new Error(`demo-rehearse-twice: unexpected fetch of ${url.split('?')[0]}`);
    }
    const entry: Logged = {
      method, path: url, status: null, answer: undefined,
      sent: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    log.push(entry);
    open += 1;
    try {
      const res = await realFetch(origin + url, init);
      const text = await res.text();
      entry.status = res.status;
      try { entry.answer = JSON.parse(text); } catch { /* not JSON: the status says enough */ }
      // Not a real `Response`: reading the body of one takes event-loop turns of its own, and the page's
      // update would then land after `settle()` has returned. These readers answer in the same turn.
      // client/src/api/http.ts reads `ok`, `status` and one of the three.
      const { status } = res;
      return {
        ok: res.ok,
        status,
        headers: res.headers,
        text: async () => text,
        json: async () => JSON.parse(text) as unknown,
        arrayBuffer: async () => new TextEncoder().encode(text).buffer,
      } as unknown as Response;
    } finally {
      open -= 1;
    }
  });

  return {
    root,
    fixturesDir,
    statePath,
    runtime,
    /** `http://127.0.0.1:<port>` of this server, the only address it listens on. */
    origin,
    log,
    googleCalls,
    outgoing,
    /** Requests that have no answer yet. */
    open: () => open,
    /** `METHOD /api/...` of every request from `from` on, in the order they were sent. */
    sentSince: (from: number) => log.slice(from).map((r) => `${r.method} ${r.path}`),
    close: async () => {
      vi.unstubAllGlobals();
      await new Promise((resolve) => server.close(resolve));
      await runtime.shutdown();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

// ---------- time ----------

/**
 * Fakes the timers the pages poll with, and nothing else: `setImmediate`, the microtask queue and the
 * sockets stay real, so a request to the test server is answered while the page's clock stands still.
 */
export function useFakePollTimers(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
}

/** Event-loop turns with no request open before the pages count as settled. */
const QUIET_TURNS = 5;
/** Far more turns than a page load needs (about 30); a request that never answers ends the wait. */
const MAX_TURNS = 20_000;

/**
 * Waits until no request is open and React has rendered the answers. The page's clock does not move, except
 * that 0 ms timers run, as they do in a browser (an immediate refetch after a poll in flight is one).
 */
export async function settle(api: RehearsalApi): Promise<void> {
  let quiet = 0;
  for (let turn = 0; quiet < QUIET_TURNS; turn++) {
    if (turn >= MAX_TURNS) throw new Error(`settle(): ${api.open()} request(s) still open after ${MAX_TURNS} turns`);
    // One `act` per turn, not one around the loop: React renders and runs effects when an `act` ends, and
    // an effect may send the next request (the map, once the run is known). It must be counted here.
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
      vi.advanceTimersByTime(0);
    });
    quiet = api.open() === 0 ? quiet + 1 : 0;
  }
}

/** Moves the pages' timers by `ms` and settles what they started. Nothing may be in flight before. */
export async function advancePolls(api: RehearsalApi, ms: number): Promise<void> {
  await settle(api);
  await act(async () => { vi.advanceTimersByTime(ms); });
  await settle(api);
}

// ---------- reading the pages ----------

/** True for a control the browser treats as disabled: its own attribute or a disabled fieldset around it. */
export function isDisabled(el: Element): boolean {
  return (el as HTMLButtonElement).disabled === true || el.closest('fieldset[disabled]') !== null;
}
