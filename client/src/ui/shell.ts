/**
 * Path after switching the demo account: same portal type, new id, no query/hash. null = not an identity route.
 * Any case, as the router reads a path: on `/Business/<id>` the selector is shown, so it must work (#918).
 */
export function switchIdentityPath(
  pathname: string,
  id: string,
): { kind: 'business' | 'employee'; path: string } | null {
  const m = /^\/(business|employee)\/[^/]+\/?$/i.exec(pathname);
  if (!m || !id) return null;
  const kind = m[1].toLowerCase() as 'business' | 'employee';
  return { kind, path: `/${kind}/${encodeURIComponent(id)}` };
}

/** One employee of a v2 list. `businessId` (the employer) is kept only by startV2DirectoryWithEmployers. */
export type V2DirectoryEmployee = { id: string; name: string; businessId?: string };

/** The header's v2 employee list. `unavailable` = /api/v2 answered 503 (no travel data yet). */
export type V2Directory =
  | { status: 'loading' }
  | { status: 'ready'; employees: V2DirectoryEmployee[] }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

type FetchV2Employees = (opts: { signal: AbortSignal }) => Promise<{ employees: V2DirectoryEmployee[] }>;

/** Wait between a failed load of a header list and the next try (#636, DECISIONS pass 62). */
export const DIRECTORY_RETRY_MS = 3000;

const NO_LIST_MESSAGE = 'Could not load accounts';

const sameFailure = (a:V2Directory | undefined, b: V2Directory): boolean =>
  a !== undefined && a.status === b.status && (a.status !== 'error' || b.status !== 'error' || a.message === b.message);

/**
 * Loads the list and, after `error` or `unavailable`, asks again every DIRECTORY_RETRY_MS until it is ready,
 * then stops (#636: the API can come up a moment after the page). The next try is scheduled only when the
 * request before it has failed, so there is never more than one request at a time. A failure equal to the
 * last reported one is not reported again. `entry` picks the fields of each employee that are kept. Returns
 * the cleanup: it aborts the request in flight and clears the timer; after it no request starts and no state
 * is reported.
 */
function loadV2Directory(
  fetchEmployees: FetchV2Employees,
  isUnavailable: (e: unknown) => boolean,
  onState: (d: V2Directory) => void,
  entry: (e: V2DirectoryEmployee) => V2DirectoryEmployee,
): () => void {
  let alive = true;
  let ctrl: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: V2Directory | undefined;
  const fail = (failed: V2Directory) => {
    // The timer is set before the report, so a cleanup called from inside onState clears it.
    timer = setTimeout(load, DIRECTORY_RETRY_MS);
    if (sameFailure(last, failed)) return;
    last = failed;
    onState(failed);
  };
  function load() {
    timer = undefined;
    const request = new AbortController();
    ctrl = request;
    // The Promise executor turns a fetcher that throws at once into a failed load like any other.
    new Promise<{ employees: V2DirectoryEmployee[] }>((resolve) => { resolve(fetchEmployees({ signal: request.signal })); }).then(
      (r) => {
        if (!alive) return;
        // An answer without a list is a failed load too: it is asked for again, not left on "Loading".
        if (!r || !Array.isArray(r.employees)) fail({ status: 'error', message: NO_LIST_MESSAGE });
        else onState({ status: 'ready', employees: r.employees.map(entry) });
      },
      (err: unknown) => {
        if (!alive) return;
        fail(isUnavailable(err)
          ? { status: 'unavailable' }
          : { status: 'error', message: err instanceof Error ? err.message : NO_LIST_MESSAGE });
      },
    );
  }
  load();
  return () => {
    alive = false;
    ctrl?.abort();
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
}

/**
 * Starts a v2 directory load (id and name of each employee) that tries again after a failure, see
 * loadV2Directory; returns a cancel function that aborts the request, stops the retries and drops any late
 * result. `isUnavailable` recognises the 503 TravelUnavailable error (injected so this stays pure).
 */
export function startV2Directory(
  fetchEmployees: FetchV2Employees,
  isUnavailable: (e: unknown) => boolean,
  onState: (d: V2Directory) => void,
): () => void {
  return loadV2Directory(fetchEmployees, isUnavailable, onState, ({ id, name }) => ({ id, name }));
}

/**
 * Like startV2Directory, and keeps each employee's `businessId` when the API sent one: the header's Demo
 * account selector shows the employer next to the name (#568).
 */
export function startV2DirectoryWithEmployers(
  fetchEmployees: FetchV2Employees,
  isUnavailable: (e: unknown) => boolean,
  onState: (d: V2Directory) => void,
): () => void {
  return loadV2Directory(fetchEmployees, isUnavailable, onState, ({ id, name, businessId }) =>
    (typeof businessId === 'string' ? { id, name, businessId } : { id, name }));
}

/** The header's v2 business list (same states as V2Directory). */
export type V2BusinessDirectory =
  | { status: 'loading' }
  | { status: 'ready'; businesses: { id: string; name: string }[] }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

type FetchV2Businesses = (opts: { signal: AbortSignal }) => Promise<{ businesses: { id: string; name: string }[] }>;

/**
 * Like startV2Directory (with the same retry), for GET /api/v2/businesses. Returns a cancel function that
 * aborts the request and stops the retries.
 */
export function startV2BusinessDirectory(
  fetchBusinesses: FetchV2Businesses,
  isUnavailable: (e: unknown) => boolean,
  onState: (d: V2BusinessDirectory) => void,
): () => void {
  return startV2Directory(
    (opts) => fetchBusinesses(opts).then((r) => ({ employees: r.businesses })),
    isUnavailable,
    (d) => onState(d.status === 'ready' ? { status: 'ready', businesses: d.employees } : d),
  );
}
