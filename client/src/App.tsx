import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Link, matchPath, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { Business, Employee } from '../../shared/types';
import {
  portalPaths, readIdentity, resolveIdentity, writeIdentity,
  type Directory,
} from './demoIdentity';
import { getBusinesses, getEmployees, getSimulator } from './api';
import { getBusinesses as getV2Businesses, getEmployees as getV2Employees, isTravelUnavailable } from './api/v2';
import {
  activeDestination, DESTINATIONS, ENV_INDICATOR_TEXT, RUN_POLL_MS, reconcileSelection, runChanged, staleNote,
  envIndicatorFor, helpPathFor, homePathFor, isHelpPath, isFullWidthPath, isPreviewPath, previewDestination, previewHrefs,
  PREVIEW_HELP_PATH, PREVIEW_HOME_PATH,
} from './ui/shellModel';
import type { NycSummary } from './pages/landingModel';
import { ConnectionMonitor } from './ui/ConnectionBanner';
import NotFoundPage from './ui/NotFoundPage';
import { ErrorBoundary } from './ui/ErrorBoundary';
import {
  startV2BusinessDirectory, startV2Directory, switchIdentityPath, switchPreviewBusinessPath, switchPreviewEmployeePath,
  type V2BusinessDirectory, type V2Directory,
} from './ui/shell';
import './styles/global.css';
import './ui/shell.css';
import Landing, { SIMULATOR_PATH } from './pages/Landing';
import BusinessPortal from './pages/BusinessPortal';
import EmployeePortal from './pages/EmployeePortal';
import Simulator from './pages/Simulator';
import Help from './pages/Help';
import SimulatorV2 from './pages/v2/SimulatorV2';
import EmployeeV2 from './pages/v2/EmployeeV2';
import BusinessV2 from './pages/v2/BusinessV2';

/** Header environment indicator (kept for existing imports; the source is ENV_INDICATOR_TEXT). */
export const BADGE_TEXT = ENV_INDICATOR_TEXT;

export { readIdentity, writeIdentity, resolveIdentity };

export type DirectoryData = { businesses: Business[]; employees: Employee[] };

/** Loads the directory and reloads it whenever the polled runId changes. `initial` skips all loading (tests). */
function useLiveDirectory(initial?: DirectoryData): Directory {
  const [dir, setDir] = useState<Directory>(initial ? { status: 'ready', ...initial } : { status: 'loading' });
  const runId = useRef<string | null>(null);
  useEffect(() => {
    if (initial) return;
    let alive = true;
    const load = () =>
      Promise.all([getBusinesses(), getEmployees()])
        .then(([b, e]) => { if (alive) setDir({ status: 'ready', businesses: b.businesses, employees: e.employees }); })
        .catch((err: unknown) => {
          if (alive) setDir((d) => (d.status === 'ready' ? d : { status: 'error', message: err instanceof Error ? err.message : 'Could not load accounts' }));
        });
    void load();
    const tick = async () => {
      try {
        const { runId: next } = await getSimulator();
        if (!alive) return;
        const changed = runChanged(runId.current, next);
        runId.current = next;
        if (changed) await load();
      } catch { /* server unreachable: the connection banner covers it; keep the last list */ }
    };
    void tick();
    const id = setInterval(() => void tick(), RUN_POLL_MS);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return dir;
}

/**
 * The v2 employee list for the header, loaded only while on a /nyc/… path (DECISIONS pass 52).
 * The request is aborted when the header leaves the preview or unmounts. `initial` skips loading (tests).
 */
function useV2Directory(preview: boolean, initial?: V2Directory): V2Directory {
  const [dir, setDir] = useState<V2Directory>(initial ?? { status: 'loading' });
  useEffect(() => {
    if (initial || !preview) return;
    setDir({ status: 'loading' });
    return startV2Directory(getV2Employees, isTravelUnavailable, setDir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);
  return dir;
}

/** The v2 business list for the header: same rules as useV2Directory (only on /nyc/…, aborted on leaving). */
function useV2BusinessDirectory(preview: boolean, initial?: V2BusinessDirectory): V2BusinessDirectory {
  const [dir, setDir] = useState<V2BusinessDirectory>(initial ?? { status: 'loading' });
  useEffect(() => {
    if (initial || !preview) return;
    setDir({ status: 'loading' });
    return startV2BusinessDirectory(getV2Businesses, isTravelUnavailable, setDir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);
  return dir;
}

/** The selector list for a preview page: v2 businesses or v2 employees, with the same load states. */
type PreviewAccounts =
  | { status: 'loading' } | { status: 'unavailable' } | { status: 'error'; message: string }
  | { status: 'ready'; accounts: { id: string; name: string }[] };

function previewAccounts(dir: V2Directory | V2BusinessDirectory): PreviewAccounts {
  if (dir.status !== 'ready') return dir;
  return { status: 'ready', accounts: 'businesses' in dir ? dir.businesses : dir.employees };
}

/**
 * Demo account on /nyc/business/:id and /nyc/employee/:id: v2 accounts, navigates inside the preview
 * (path only, so ?shipment= is dropped), never stores the identity (DECISIONS pass 52).
 */
function PreviewAccountSelector({ employees, businesses }: { employees: V2Directory; businesses: V2BusinessDirectory }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const bizMatch = matchPath('/nyc/business/:id', pathname);
  const m = bizMatch ?? matchPath('/nyc/employee/:id', pathname);
  if (!m) return null;
  const kind = bizMatch ? 'business' : 'employee';
  const switchPath = bizMatch ? switchPreviewBusinessPath : switchPreviewEmployeePath;
  const dir = previewAccounts(bizMatch ? businesses : employees);
  // 503 (no travel data yet): no selector; the page below explains it.
  if (dir.status === 'unavailable') return null;
  if (dir.status === 'loading') return <span className="demo-account-status">Loading accounts…</span>;
  if (dir.status === 'error') {
    return <span className="demo-account-status demo-account-error" role="alert">Accounts unavailable</span>;
  }
  const choose = (id: string) => {
    const next = switchPath(pathname, id);
    if (next) navigate(next);
  };
  const options = dir.accounts.map((a) => ({ id: a.id, text: a.name }));
  const sel = reconcileSelection(m.params.id, options.map((o) => o.id));
  const fallback = options.find((o) => o.id === sel.id);
  const fallbackPath = fallback ? switchPath(pathname, fallback.id) : null;
  return (
    <>
      <label className="demo-account">
        <span>Demo account</span>
        <select value={sel.id} onChange={(e) => choose(e.target.value)}>
          {options.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
        </select>
      </label>
      {sel.stale && (
        <span className="demo-account-status" role="status">
          {staleNote(kind, fallback?.text ?? null)}{' '}
          {fallbackPath && <Link to={fallbackPath}>Switch</Link>}
        </span>
      )}
    </>
  );
}

function DemoAccountSelector({ dir }: { dir: Directory }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const bizMatch = matchPath('/business/:id', pathname);
  const empMatch = matchPath('/employee/:id', pathname);
  if (!bizMatch && !empMatch) return null;

  if (dir.status === 'loading') return <span className="demo-account-status">Loading accounts…</span>;
  if (dir.status === 'error') {
    return <span className="demo-account-status demo-account-error" role="alert">Accounts unavailable</span>;
  }

  const choose = (id: string) => {
    const next = switchIdentityPath(pathname, id);
    if (!next) return;
    writeIdentity({ ...readIdentity(), [next.kind === 'business' ? 'businessId' : 'employeeId']: id });
    navigate(next.path); // path only: drops ?shipment=/?job= and hash
  };

  const urlId = (bizMatch ?? empMatch)?.params.id;
  const kind = bizMatch ? 'business' : 'employee';
  const bizName = (id: string) => dir.businesses.find((b) => b.id === id)?.name ?? id;
  const options = bizMatch
    ? dir.businesses.map((b) => ({ id: b.id, text: b.name }))
    : dir.employees.map((x) => ({ id: x.id, text: `${x.name} (${bizName(x.businessId)})` }));
  const sel = reconcileSelection(urlId, options.map((o) => o.id));
  const fallback = options.find((o) => o.id === sel.id);
  const fallbackPath = fallback ? switchIdentityPath(pathname, fallback.id)?.path : undefined;
  return (
    <>
      <label className="demo-account">
        <span>Demo account</span>
        <select value={sel.id} onChange={(e) => choose(e.target.value)}>
          {options.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
        </select>
      </label>
      {sel.stale && (
        <span className="demo-account-status" role="status">
          {staleNote(kind, fallback?.text ?? null)}{' '}
          {/* choose() stores the identity and navigates, so the Link must not push the path a second time (#529). */}
          {fallbackPath && <Link to={fallbackPath} onClick={(e) => { e.preventDefault(); choose(sel.id); }}>Switch</Link>}
        </span>
      )}
    </>
  );
}

type ShellProps = {
  initial?: DirectoryData; initialV2?: V2Directory; initialV2Businesses?: V2BusinessDirectory;
  /** The /nyc homepage summary (tests); without it the page loads /api/v2. */
  initialNycSummary?: NycSummary;
};

/** `initial` / `initialV2` / `initialV2Businesses` skip the API loads (used by tests). */
export function Header({ initial, initialV2, initialV2Businesses }: ShellProps = {}) {
  const dir = useLiveDirectory(initial);
  // Re-read after route changes so a fresh choice is reflected in the portal links.
  const { pathname } = useLocation();
  const preview = isPreviewPath(pathname);
  const v2dir = useV2Directory(preview, initialV2);
  const v2biz = useV2BusinessDirectory(preview, initialV2Businesses);
  const [stored, setStored] = useState(readIdentity);
  const [seen, setSeen] = useState(pathname);
  if (seen !== pathname) {
    setSeen(pathname);
    setStored(readIdentity());
  }
  const paths = portalPaths(
    dir.status === 'ready' ? resolveIdentity(stored, dir.businesses, dir.employees) : null,
  );
  const active = preview ? previewDestination(pathname) : activeDestination(pathname);
  const hrefs: Record<string, string | null> = preview
    ? previewHrefs(
      v2dir.status === 'ready' ? v2dir.employees[0]?.id : undefined,
      v2biz.status === 'ready' ? v2biz.businesses[0]?.id : undefined,
    )
    : { business: paths.business, employee: paths.employee, simulator: SIMULATOR_PATH };
  const helpPath = helpPathFor(pathname);
  const onHelp = isHelpPath(pathname);
  return (
    <header className="shell-header">
      <Link to={homePathFor(pathname)} className="shell-wordmark">Relay</Link>
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
          {preview ? <PreviewAccountSelector employees={v2dir} businesses={v2biz} /> : <DemoAccountSelector dir={dir} />}
        </div>
        <Link to={helpPath} className={onHelp ? 'shell-help active' : 'shell-help'} aria-current={onHelp ? 'page' : undefined}>Help</Link>
        <span className="shell-env">{envIndicatorFor(pathname)}</span>
      </div>
    </header>
  );
}

/** Header + routes, without a router, so tests can wrap it in MemoryRouter. */
export function AppShell({ initial, initialV2, initialV2Businesses, initialNycSummary }: ShellProps = {}) {
  const { pathname } = useLocation();
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <ConnectionMonitor />
      <Header initial={initial} initialV2={initialV2} initialV2Businesses={initialV2Businesses} />
      <main className={isFullWidthPath(pathname) ? 'app-main app-main--full' : 'app-main'} id="main-content" tabIndex={-1}>
        <ErrorBoundary resetKey={pathname} homeHref={homePathFor(pathname)}>
        <Routes>
          <Route path="/" element={<Landing initial={initial} />} />
          <Route path="/business/:id" element={<BusinessPortal />} />
          <Route path="/employee/:id" element={<EmployeePortal />} />
          <Route path="/simulator" element={<Simulator />} />
          <Route path="/help" element={<Help initial={initial} />} />
          {/* MVP II preview (DECISIONS pass 46, pass 52, pass 55). */}
          <Route path={PREVIEW_HOME_PATH} element={<Landing dataset="nyc" initialSummary={initialNycSummary} helpPath={PREVIEW_HELP_PATH} />} />
          <Route path={PREVIEW_HELP_PATH} element={<Help dataset="nyc" initialEmployees={initialV2} initialBusinesses={initialV2Businesses} />} />
          <Route path="/nyc/business/:id" element={<BusinessV2 />} />
          <Route path="/nyc/simulator" element={<SimulatorV2 />} />
          <Route path="/nyc/employee/:id" element={<EmployeeV2 />} />
          <Route path="*" element={<NotFoundPage initial={initial} />} />
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
