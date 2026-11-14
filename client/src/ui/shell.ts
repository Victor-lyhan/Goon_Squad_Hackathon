/** Path after switching the demo account: same portal type, new id, no query/hash. null = not an identity route. */
export function switchIdentityPath(
  pathname: string,
  id: string,
): { kind: 'business' | 'employee'; path: string } | null {
  const m = /^\/(business|employee)\/[^/]+\/?$/.exec(pathname);
  if (!m || !id) return null;
  const kind = m[1] as 'business' | 'employee';
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

/** One load; `entry` picks the fields of each employee that are kept. */
function loadV2Directory(
  fetchEmployees: FetchV2Employees,
  isUnavailable: (e: unknown) => boolean,
  onState: (d: V2Directory) => void,
  entry: (e: V2DirectoryEmployee) => V2DirectoryEmployee,
): () => void {
  const ctrl = new AbortController();
  let alive = true;
  fetchEmployees({ signal: ctrl.signal }).then(
    (r) => { if (alive) onState({ status: 'ready', employees: r.employees.map(entry) }); },
    (err: unknown) => {
      if (!alive) return;
      if (isUnavailable(err)) onState({ status: 'unavailable' });
      else onState({ status: 'error', message: err instanceof Error ? err.message : 'Could not load accounts' });
    },
  );
  return () => { alive = false; ctrl.abort(); };
}

/**
 * Starts one v2 directory load (id and name of each employee); returns a cancel function that aborts the
 * request and drops any late result. `isUnavailable` recognises the 503 TravelUnavailable error (injected so
 * this stays pure).
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

/** Like startV2Directory, for GET /api/v2/businesses. Returns a cancel function that aborts the request. */
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
