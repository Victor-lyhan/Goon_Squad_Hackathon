import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Link, matchPath, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { readIdentity, resolveIdentity, writeIdentity } from './demoIdentity';
import {
  getBusinesses as getV2Businesses, getEmployees as getV2Employees, getSimulator as getV2Simulator, isTravelUnavailable,
} from './api/v2';
import {
  activeDestination, cutoverPath, DESTINATIONS, employeeOptions, ENV_INDICATOR_TEXT, HELP_PAGE_PATH, HOME_PATH,
  isFullWidthPath, isHelpPath, pickAccount, reconcileSelection, RUN_POLL_MS, runChanged, staleNote, workspaceHrefs,
  type AccountOption,
} from './ui/shellModel';
import type { NycSummary } from './pages/landingModel';
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
import Help from './pages/Help';
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
 * identity and opens its page (path only, so ?shipment= / ?job= and the hash are dropped). An employee reads
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
  if (dir.status === 'loading') return <span className="demo-account-status">Loading accounts…</span>;
  if (dir.status === 'error') {
    return <span className="demo-account-status demo-account-error" role="alert">Accounts unavailable</span>;
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

type ShellProps = {
  /** The header's /api/v2 lists (tests); without them the header loads /api/v2. */
  initialV2?: V2Directory; initialV2Businesses?: V2BusinessDirectory;
  /** The homepage summary (tests); without it the page loads /api/v2. */
  initialNycSummary?: NycSummary;
};

/** `initialV2` / `initialV2Businesses` skip the API loads (used by tests). */
export function Header({ initialV2, initialV2Businesses }: ShellProps = {}) {
  const { employees, businesses } = useV2Lists(initialV2, initialV2Businesses);
  // Re-read after route changes so a fresh choice is reflected in the workspace links.
  const { pathname } = useLocation();
  const [stored, setStored] = useState(readIdentity);
  const [seen, setSeen] = useState(pathname);
  if (seen !== pathname) {
    setSeen(pathname);
    setStored(readIdentity());
  }
  const hrefs = workspaceHrefs(
    pickAccount(stored.businessId, idsOf(businesses)),
    pickAccount(stored.employeeId, idsOf(employees)),
  );
  const active = activeDestination(pathname);
  const onHelp = isHelpPath(pathname);
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
        <Link to={HELP_PAGE_PATH} className={onHelp ? 'shell-help active' : 'shell-help'} aria-current={onHelp ? 'page' : undefined}>Help</Link>
        <span className="shell-env">{ENV_INDICATOR_TEXT}</span>
      </div>
    </header>
  );
}

/** Header + routes, without a router, so tests can wrap it in MemoryRouter. */
export function AppShell({ initialV2, initialV2Businesses, initialNycSummary }: ShellProps = {}) {
  const { pathname } = useLocation();
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <ConnectionMonitor />
      <Header initialV2={initialV2} initialV2Businesses={initialV2Businesses} />
      <main className={isFullWidthPath(pathname) ? 'app-main app-main--full' : 'app-main'} id="main-content" tabIndex={-1}>
        <ErrorBoundary resetKey={pathname} homeHref={HOME_PATH}>
        <Routes>
          {/* MVP II on the real NYC run since the cutover (#548). The MVP 1 pages are no longer mounted. */}
          <Route path="/" element={<Landing dataset="nyc" initialSummary={initialNycSummary} />} />
          <Route path="/business/:id" element={<BusinessV2 />} />
          <Route path="/employee/:id" element={<EmployeeV2 />} />
          <Route path="/simulator" element={<SimulatorV2 />} />
          <Route path="/help" element={<Help dataset="nyc" initialEmployees={initialV2} initialBusinesses={initialV2Businesses} />} />
          {/* The old preview paths (DECISIONS pass 57). */}
          <Route path="/nyc/*" element={<CutoverRedirect />} />
          <Route path="*" element={<NotFoundPage initialEmployees={initialV2} initialBusinesses={initialV2Businesses} />} />
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
