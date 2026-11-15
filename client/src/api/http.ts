// The fetch core of client/src/api: one `request` wrapper (timeout, abort, error mapping), its error class
// and the server liveness probe. No route helper lives here; the typed helpers for /api/v2 are in ./v2.
// Plain TS + fetch only (no JSX / DOM-only APIs / import.meta.env) so Node tests can typecheck it.

export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'abort';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly fieldErrors: Record<string, string> | undefined;
  /** 'http' for server replies; status 0 errors are 'network', 'timeout' or 'abort'. */
  readonly kind: ApiErrorKind;
  /** Machine-readable `code` of the error body, if the server sent one (the /api/v2 503 TravelUnavailable bodies do). */
  readonly code: string | undefined;
  constructor(status: number, message: string, fieldErrors?: Record<string, string>, kind?: ApiErrorKind, code?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.kind = kind ?? (status === 0 ? 'network' : 'http');
    this.code = code;
  }
}

// Note: everything exported here that is not a route helper is a named function expression with a capital
// letter, because tests/api/v2-client-routes.test.ts treats every lowercase-named exported function as a
// route helper.
/** True when the request never got an HTTP answer (fetch failure or timeout), not when the caller aborted. */
export const isNetworkError = function IsNetworkError(e: unknown): boolean {
  return e instanceof ApiRequestError && e.status === 0 && e.kind !== 'abort';
};
/** True when the caller aborted the request through its own signal. */
export const isAbortError = function IsAbortError(e: unknown): boolean {
  return e instanceof ApiRequestError && e.kind === 'abort';
};

export interface RequestOptions {
  /** Abort the request; rejects with an abort error (see isAbortError). */
  signal?: AbortSignal;
  /** Per-call timeout in ms; defaults to the value from apiConfig.timeoutMs (8000). */
  timeoutMs?: number;
}

/**
 * The sentences this layer writes itself, for the cases where the server sent no text of its own (#909).
 * Each is one plain sentence that says what to do: no milliseconds, no status number, no browser wording.
 * A page may show `error.message` as it is. Text the server sent in `error` is never replaced by these.
 * Not exported: pages branch on `status`, `kind` and `code`, not on the wording.
 */
const API_ERROR_TEXT = {
  /** fetch itself failed: server down, connection refused, offline. */
  network: "Can't reach the Relay server, so check it's running and try again.",
  /** No answer within the time limit. */
  timeout: 'The Relay server took too long to answer, so try again in a moment.',
  /** The caller's own signal ended the call. Pages stay silent on this one (see isAbortError). */
  abort: 'This was cancelled before the Relay server answered, so try again.',
  /** A 2xx whose body is empty or not JSON (an HTML page, another program on the port). */
  badReply: "The Relay server's answer couldn't be read, so reload the page and try again.",
  /** A non-2xx with no `error` text in its body (a proxy's reply when the server is down, a crash page). */
  noErrorText: "The Relay server had a problem, so check it's running and try again.",
} as const;

export const DEFAULT_TIMEOUT_MS = 8000;
/** Mutable settings; tests set `apiConfig.timeoutMs` and restore DEFAULT_TIMEOUT_MS afterwards. */
export const apiConfig = { timeoutMs: DEFAULT_TIMEOUT_MS };

/**
 * The one fetch wrapper (timeout, abort, error mapping). Exported for client/src/api/v2.ts; UI code
 * uses the typed helpers there. Capitalised function expression so the route-coverage test skips it (see above).
 */
export const request = async function ApiRequest<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {},
  extra: { cache?: RequestCache; ignoreBody?: boolean } = {}): Promise<T> {
  const { signal } = opts;
  const timeoutMs = opts.timeoutMs ?? apiConfig.timeoutMs;
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  // `answered`: fetch gave a 2xx and the failure came from reading its body.
  const fail = (e: unknown, answered = false): never => {
    if (e instanceof ApiRequestError) throw e;
    if (timedOut) throw new ApiRequestError(0, API_ERROR_TEXT.timeout, undefined, 'timeout');
    if (signal?.aborted) throw new ApiRequestError(0, API_ERROR_TEXT.abort, undefined, 'abort');
    // The browser's or the JSON parser's own text is never passed on. A SyntaxError on a body means it was
    // empty or not JSON; any other failure means no answer came, or it broke off on the way.
    const unreadable = answered && e instanceof Error && e.name === 'SyntaxError';
    throw new ApiRequestError(0, unreadable ? API_ERROR_TEXT.badReply : API_ERROR_TEXT.network, undefined, 'network');
  };
  try {
    let res: Response;
    try {
      res = await fetch(path, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: extra.cache,
      });
    } catch (e) {
      return fail(e);
    }
    if (!res.ok) {
      let message: string = API_ERROR_TEXT.noErrorText;
      let fieldErrors: Record<string, string> | undefined;
      let code: string | undefined;
      try {
        const data = (await res.json()) as { error?: unknown; fieldErrors?: Record<string, string>; code?: unknown };
        // The server's own sentence goes through as it is; an empty one is no text.
        if (typeof data?.error === 'string' && data.error.trim() !== '') message = data.error;
        fieldErrors = data?.fieldErrors;
        if (typeof data?.code === 'string') code = data.code;
      } catch {
        /* empty or non-JSON error body: keep the default sentence */
      }
      if (timedOut) return fail(new Error('timeout'));
      if (signal?.aborted) return fail(new Error('aborted'));
      throw new ApiRequestError(res.status, message, fieldErrors, undefined, code);
    }
    try {
      if (extra.ignoreBody) { await res.arrayBuffer(); return undefined as T; }
      return (await res.json()) as T;
    } catch (e) {
      return fail(e, true);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
};

/**
 * Server liveness probe: GET /api/health with cache 'no-store' and the same timeout/signal handling
 * as the other GETs. Resolves true on a 2xx and false on a network error, timeout or non-2xx.
 * Never throws, except that a caller abort (opts.signal) rejects with an error for which isAbortError is true.
 * Capitalised function expression: /api/health is not in the route list of shared/v2/api.ts, see the note above.
 */
export const probeHealth = async function ProbeHealth(opts?: RequestOptions): Promise<boolean> {
  try {
    await request<void>('GET', '/api/health', undefined, opts, { cache: 'no-store', ignoreBody: true });
    return true;
  } catch (e) {
    if (isAbortError(e)) throw e;
    return false;
  }
};
