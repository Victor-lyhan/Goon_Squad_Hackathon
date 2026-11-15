import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BrowserRouter, Link, matchPath, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { readIdentity, resolveIdentity, writeIdentity } from './demoIdentity';
import {
  getBusinesses as getV2Businesses, getEmployees as getV2Employees, getSimulator as getV2Simulator, isTravelUnavailable,
} from './api/v2';
import {
  ACCOUNTS_ERROR_TEXT, ACCOUNTS_LOADING_TEXT, activeDestination, bareWorkspace, cutoverPath, DESTINATIONS,
  employeeOptions, ENV_INDICATOR_TEXT, HOME_PATH, isFullWidthPath, openAccount, pickAccount, reconcileSelection,
  RUN_POLL_MS, runChanged, staleNote, withOpenAccount, workspaceHrefs,
  type AccountOption,
} from './ui/shellModel';
import { NYC_UNAVAILABLE_TEXT, type NycSummary } from './pages/landingModel';
import { ConnectionMonitor } from './ui/ConnectionBanner';
import NotFoundPage from './ui/NotFoundPage';
import { ErrorBoundary } from './ui/ErrorBoundary';
import {
  startV2BusinessDirectory, startV2DirectoryWithEmployers, switchIdentityPath,
  type V2BusinessDirectory, type V2Directory,
} from './ui/shell';
import './styles/global.css';
import './ui/shell.css';
import Landing from './pages/Landing';
import SimulatorV2 from './pages/v2/SimulatorV2';
import EmployeeV2 from './pages/v2/EmployeeV2';
import BusinessV2 from './pages/v2/BusinessV2';

/** Header environment indicator (kept for existing imports; the source is ENV_INDICATOR_TEXT). */
export const BADGE_TEXT = ENV_INDICATOR_TEXT;

export { readIdentity, writeIdentity, resolveIdentity };

/**
 * The header's two /api/v2 lists, reloaded when the polled NYC runId changes (a Random city or an import
 * gives new IDs). Requests are aborted on unmount. A list passed in is used as is and never loaded (tests).
 * With only one list passed, the effect still runs: it loads the other list, starts the runId poll, and a
 * run change reloads only that other list. With both passed, nothing is loaded and no poll starts.
 */
function useV2Lists(initialEmployees?: V2Directory, initialBusinesses?: V2BusinessDirectory) {
  const [employees, setEmployees] = useState<V2Directory>(initialEmployees ?? { status: 'loading' });
  const [businesses, setBusinesses] = useState<V2BusinessDirectory>(initialBusinesses ?? { status: 'loading' });
  const runId = useRef<string | null>(null);
  useEffect(() => {
    if (initialEmployees && initialBusinesses) return;
    let alive = true;
    let stops: (() => void)[] = [];
    const load = () => {
      for (const stop of stops) stop();
      stops = [];
      // A reload keeps the last list on screen until the new one answers.
      if (!initialEmployees) stops.push(startV2DirectoryWithEmployers(getV2Employees, isTravelUnavailable, (d) => { if (alive) setEmployees((old) => keepReady(old, d)); }));
      if (!initialBusinesses) stops.push(startV2BusinessDirectory(getV2Businesses, isTravelUnavailable, (d) => { if (alive) setBusinesses((old) => keepReady(old, d)); }));
    };
    load();
    const ctl = new AbortController();
    const tick = async () => {
      try {
        const { runId: next } = await getV2Simulator({ signal: ctl.signal });
        if (!alive) return;
        const changed = runChanged(runId.current, next);
        runId.current = next;
        if (changed) load();
      } catch { /* 503 or unreachable: the page and the connection banner say so; keep the last list */ }
    };
    void tick();
    const id = setInterval(() => void tick(), RUN_POLL_MS);
    return () => { alive = false; ctl.abort(); clearInterval(id); for (const stop of stops) stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { employees, businesses };
}

/** A failed reload keeps a list that was already shown; any other answer replaces it. */
function keepReady<T extends { status: string }>(old: T, next: T): T {
  return old.status === 'ready' && next.status === 'error' ? old : next;
}

type Account = { id: string; name: string };
const idsOf = (d: V2Directory | V2BusinessDirectory): string[] | undefined =>
  d.status !== 'ready' ? undefined : ('businesses' in d ? d.businesses : d.employees).map((a: Account) => a.id);

/**
 * Demo account on /business/:id and /employee/:id: the /api/v2 accounts. Choosing one stores it as the demo
 * identity and opens its page (path only, so ?shipment= / ?job= and the hash are dropped). The header stores
 * the account of a page opened by URL or by a link in the app (`openAccount`). An employee reads
 * "Name · Employer" (`employeeOptions`); until the business list is ready it reads the name alone.
 */
function DemoAccountSelector({ employees, businesses }: { employees: V2Directory; businesses: V2BusinessDirectory }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const bizMatch = matchPath('/business/:id', pathname);
  const m = bizMatch ?? matchPath('/employee/:id', pathname);
  if (!m) return null;
  const kind = bizMatch ? 'business' : 'employee';
  const dir = bizMatch ? businesses : employees;
  // 503 (no travel data yet): no selector; the page below explains it.
  if (dir.status === 'unavailable') return null;
  if (dir.status === 'loading') return <span className="demo-account-status">{ACCOUNTS_LOADING_TEXT}</span>;
  if (dir.status === 'error') {
    return <span className="demo-account-status demo-account-error" role="alert">{ACCOUNTS_ERROR_TEXT}</span>;
  }
  const accounts: Account[] = 'businesses' in dir ? dir.businesses : dir.employees;
  const options: AccountOption[] = 'businesses' in dir
    ? dir.businesses.map((b) => ({ id: b.id, label: b.name }))
    : employeeOptions(dir.employees, businesses.status === 'ready' ? businesses.businesses : undefined);
  const choose = (id: string) => {
    const next = switchIdentityPath(pathname, id);
    if (!next) return;
    writeIdentity({ ...readIdentity(), [next.kind === 'business' ? 'businessId' : 'employeeId']: id });
    navigate(next.path);
  };
  const sel = reconcileSelection(m.params.id, accounts.map((a) => a.id));
  const fallback = accounts.find((a) => a.id === sel.id);
  const fallbackPath = fallback ? switchIdentityPath(pathname, fallback.id)?.path : undefined;
  return (
    <>
      <label className="demo-account">
        <span>Demo account</span>
        <select value={sel.id} onChange={(e) => choose(e.target.value)}>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </label>
      {sel.stale && (
        <span className="demo-account-status" role="status">
          {staleNote(kind, fallback?.name ?? null)}{' '}
          {/* choose() stores the identity and navigates, so the Link must not push the path a second time (#529). */}
          {fallbackPath && <Link to={fallbackPath} onClick={(e) => { e.preventDefault(); choose(sel.id); }}>Switch</Link>}
        </span>
      )}
    </>
  );
}

/** `/nyc/...` → the same page on its main path, replacing the history entry and keeping ?query and #hash. */
function CutoverRedirect() {
  const { pathname, search, hash } = useLocation();
  return <Navigate replace to={{ pathname: cutoverPath(pathname) ?? HOME_PATH, search, hash }} />;
}

/**
 * `/business` and `/employee` without an ID (#724): a replace-redirect to the account the header's link of
 * that kind points to (the remembered one, else the first), so Back does not return here. The query string
 * and hash are dropped: a `?shipment=` or `?job=` belongs to one account. While the account list is loading
 * or failed, the page says so (the header's loader asks again until the list is ready); it is never the 404
 * page unless the list is loaded and empty.
 */
function AccountRedirect({ kind, list, notFound }: {
  kind: 'business' | 'employee'; list: V2Directory | V2BusinessDirectory; notFound: ReactNode;
}) {
  const ids = idsOf(list);
  const stored = readIdentity();
  const target = bareWorkspace(
    kind, ids ? { status: 'ready', ids } : { status: list.status as 'loading' | 'unavailable' | 'error' },
    kind === 'business' ? stored.businessId : stored.employeeId,
  );
  if (target.kind === 'redirect') return <Navigate replace to={target.to} />;
  if (target.kind === 'none') return <>{notFound}</>;
  if (target.kind === 'error') return <p className="shell-page-state shell-page-state--error" role="alert">{ACCOUNTS_ERROR_TEXT}</p>;
  return (
    <p className="shell-page-state" role="status">
      {target.kind === 'unavailable' ? NYC_UNAVAILABLE_TEXT : ACCOUNTS_LOADING_TEXT}
    </p>
  );
}

type ShellProps = {
  /** The header's /api/v2 lists (tests); without them the header loads /api/v2. */
  initialV2?: V2Directory; initialV2Businesses?: V2BusinessDirectory;
  /** The homepage summary (tests); without it the page loads /api/v2. */
  initialNycSummary?: NycSummary;
};

/** The header. Its two account lists come from the shell (`useV2Lists`), which also uses them for the bare paths. */
export function Header({ employees, businesses }: { employees: V2Directory; businesses: V2BusinessDirectory }) {
  // Re-read after route changes so a fresh choice is reflected in the workspace links.
  const { pathname } = useLocation();
  const [stored, setStored] = useState(readIdentity);
  const [seen, setSeen] = useState(pathname);
  if (seen !== pathname) {
    setSeen(pathname);
    setStored(readIdentity());
  }
  const businessIds = idsOf(businesses);
  const employeeIds = idsOf(employees);
  // Opening an account page counts as choosing that account (DECISIONS pass 62): the link of its kind points
  // to it at once, and the effect stores it, so the links still point to it on / and /simulator. An ID that
  // is not in the loaded list is not an open account: nothing is stored and the stale note offers "Switch".
  const open = openAccount(pathname, businessIds, employeeIds);
  const identity = withOpenAccount(stored, open);
  const openKey = open?.key;
  const openId = open?.id;
  useEffect(() => {
    if (openKey === undefined || openId === undefined) return;
    // Against what is stored now, so the other kind keeps its value and an unchanged ID is not written again.
    const now = readIdentity();
    const next = withOpenAccount(now, { key: openKey, id: openId });
    if (next === now) return;
    writeIdentity(next);
    setStored(next);
  }, [openKey, openId]);
  const hrefs = workspaceHrefs(pickAccount(identity.businessId, businessIds), pickAccount(identity.employeeId, employeeIds));
  const active = activeDestination(pathname);
  return (
    <header className="shell-header">
      <Link to={HOME_PATH} className="shell-wordmark">Relay</Link>
      <nav aria-label="Workspaces" className="shell-nav">
        {DESTINATIONS.map(({ key, label }) => {
          const to = hrefs[key];
          const on = active === key;
          return to ? (
            <Link key={key} to={to} className={on ? 'shell-nav-link active' : 'shell-nav-link'} aria-current={on ? 'page' : undefined}>
              {label}
            </Link>
          ) : (
            <span key={key} className="shell-nav-link nav-pending" aria-disabled="true">{label}</span>
          );
        })}
      </nav>
      <div className="shell-tools">
        <div className="demo-account-slot" data-slot="demo-account-selector">
          <DemoAccountSelector employees={employees} businesses={businesses} />
        </div>
        <span className="shell-env">{ENV_INDICATOR_TEXT}</span>
      </div>
    </header>
  );
}

/** Header + routes, without a router, so tests can wrap it in MemoryRouter. */
export function AppShell({ initialV2, initialV2Businesses, initialNycSummary }: ShellProps = {}) {
  const { pathname, search } = useLocation();
  // `initialV2` / `initialV2Businesses` skip the API loads (used by tests).
  const { employees, businesses } = useV2Lists(initialV2, initialV2Businesses);
  const notFound = <NotFoundPage initialEmployees={initialV2} initialBusinesses={initialV2Businesses} />;
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <ConnectionMonitor />
      <Header employees={employees} businesses={businesses} />
      <main className={isFullWidthPath(pathname) ? 'app-main app-main--full' : 'app-main'} id="main-content" tabIndex={-1}>
        <ErrorBoundary resetKey={pathname + search} homeHref={HOME_PATH}>
        <Routes>
          {/* MVP II on the real NYC run since the cutover (#548). The MVP 1 pages are no longer mounted. */}
          <Route path="/" element={<Landing dataset="nyc" initialSummary={initialNycSummary} />} />
          <Route path="/business/:id" element={<BusinessV2 />} />
          <Route path="/employee/:id" element={<EmployeeV2 />} />
          {/* Without an ID: on to the account the header links to (#724). A trailing slash matches too. */}
          <Route path="/business" element={<AccountRedirect kind="business" list={businesses} notFound={notFound} />} />
          <Route path="/employee" element={<AccountRedirect kind="employee" list={employees} notFound={notFound} />} />
          <Route path="/simulator" element={<SimulatorV2 />} />
          {/* The old preview paths (DECISIONS pass 57). */}
          <Route path="/nyc/*" element={<CutoverRedirect />} />
          <Route path="*" element={notFound} />
        </Routes>
        </ErrorBoundary>
      </main>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
