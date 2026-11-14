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

/** Path after switching the account on /nyc/employee/:id; null elsewhere. Stays inside the preview. */
export function switchPreviewEmployeePath(pathname: string, id: string): string | null {
  if (!id || !/^\/nyc\/employee\/[^/]+\/?$/.test(pathname)) return null;
  return `/nyc/employee/${encodeURIComponent(id)}`;
}

/** The header's v2 employee list. `unavailable` = /api/v2 answered 503 (no travel data yet). */
export type V2Directory =
  | { status: 'loading' }
  | { status: 'ready'; employees: { id: string; name: string }[] }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

type FetchV2Employees = (opts: { signal: AbortSignal }) => Promise<{ employees: { id: string; name: string }[] }>;

/**
 * Starts one v2 directory load; returns a cancel function that aborts the request and drops any
 * late result. `isUnavailable` recognises the 503 TravelUnavailable error (injected so this stays pure).
 */
export function startV2Directory(
  fetchEmployees: FetchV2Employees,
  isUnavailable: (e: unknown) => boolean,
  onState: (d: V2Directory) => void,
): () => void {
  const ctrl = new AbortController();
  let alive = true;
  fetchEmployees({ signal: ctrl.signal }).then(
    (r) => { if (alive) onState({ status: 'ready', employees: r.employees.map(({ id, name }) => ({ id, name })) }); },
    (err: unknown) => {
      if (!alive) return;
      if (isUnavailable(err)) onState({ status: 'unavailable' });
      else onState({ status: 'error', message: err instanceof Error ? err.message : 'Could not load accounts' });
    },
  );
  return () => { alive = false; ctrl.abort(); };
}
