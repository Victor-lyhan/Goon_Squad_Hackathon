import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Link, matchPath, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { Business, Employee } from '../../shared/types';
import {
  portalPaths, readIdentity, resolveIdentity, writeIdentity,
  type Directory,
} from './demoIdentity';
import { getBusinesses, getEmployees, getSimulator } from './api';
import { getEmployees as getV2Employees, isTravelUnavailable } from './api/v2';
import {
  activeDestination, DESTINATIONS, ENV_INDICATOR_TEXT, RUN_POLL_MS, reconcileSelection, runChanged, staleNote,
  envIndicatorFor, isFullWidthPath, isPreviewPath, previewDestination, previewHrefs,
} from './ui/shellModel';
import { ConnectionMonitor } from './ui/ConnectionBanner';
import NotFoundPage from './ui/NotFoundPage';
import { startV2Directory, switchIdentityPath, switchPreviewEmployeePath, type V2Directory } from './ui/shell';
import './styles/global.css';
import './ui/shell.css';
import Landing, { SIMULATOR_PATH } from './pages/Landing';
import BusinessPortal from './pages/BusinessPortal';
import EmployeePortal from './pages/EmployeePortal';
import Simulator from './pages/Simulator';
import Help from './pages/Help';
import SimulatorV2 from './pages/v2/SimulatorV2';
import EmployeeV2 from './pages/v2/EmployeeV2';

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

/** Demo account on /nyc/employee/:id: v2 employees, navigates inside the preview, never stores the identity. */
function PreviewAccountSelector({ dir }: { dir: V2Directory }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const m = matchPath('/nyc/employee/:id', pathname);
  if (!m) return null;
  // 503 (no travel data yet): no selector; the page below explains it.
  if (dir.status === 'unavailable') return null;
  if (dir.status === 'loading') return <span className="demo-account-status">Loading accounts…</span>;
  if (dir.status === 'error') {
    return <span className="demo-account-status demo-account-error" role="alert">Accounts unavailable</span>;
  }
  const choose = (id: string) => {
    const next = switchPreviewEmployeePath(pathname, id);
    if (next) navigate(next);
  };
  const options = dir.employees.map((e) => ({ id: e.id, text: e.name }));
  const sel = reconcileSelection(m.params.id, options.map((o) => o.id));
  const fallback = options.find((o) => o.id === sel.id);
  const fallbackPath = fallback ? switchPreviewEmployeePath(pathname, fallback.id) : null;
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
          {staleNote('employee', fallback?.text ?? null)}{' '}
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
          {fallbackPath && <Link to={fallbackPath} onClick={() => choose(sel.id)}>Switch</Link>}
        </span>
      )}
    </>
  );
}

/** `initial` / `initialV2` skip the API loads (used by tests). */
export function Header({ initial, initialV2 }: { initial?: DirectoryData; initialV2?: V2Directory } = {}) {
  const dir = useLiveDirectory(initial);
  // Re-read after route changes so a fresh choice is reflected in the portal links.
  const { pathname } = useLocation();
  const preview = isPreviewPath(pathname);
  const v2dir = useV2Directory(preview, initialV2);
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
    ? previewHrefs(v2dir.status === 'ready' ? v2dir.employees[0]?.id : undefined)
    : { business: paths.business, employee: paths.employee, simulator: SIMULATOR_PATH };
  return (
    <header className="shell-header">
      <Link to="/" className="shell-wordmark">Relay</Link>
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
          {preview ? <PreviewAccountSelector dir={v2dir} /> : <DemoAccountSelector dir={dir} />}
        </div>
        <Link to="/help" className={pathname === '/help' ? 'shell-help active' : 'shell-help'} aria-current={pathname === '/help' ? 'page' : undefined}>Help</Link>
        <span className="shell-env">{envIndicatorFor(pathname)}</span>
      </div>
    </header>
  );
}

/** Header + routes, without a router, so tests can wrap it in MemoryRouter. */
export function AppShell({ initial, initialV2 }: { initial?: DirectoryData; initialV2?: V2Directory } = {}) {
  const { pathname } = useLocation();
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <ConnectionMonitor />
      <Header initial={initial} initialV2={initialV2} />
      <main className={isFullWidthPath(pathname) ? 'app-main app-main--full' : 'app-main'} id="main-content" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Landing initial={initial} />} />
          <Route path="/business/:id" element={<BusinessPortal />} />
          <Route path="/employee/:id" element={<EmployeePortal />} />
          <Route path="/simulator" element={<Simulator />} />
          <Route path="/help" element={<Help initial={initial} />} />
          {/* MVP II preview (DECISIONS pass 46); /nyc/business/:id follows once BusinessV2 is on main. */}
          <Route path="/nyc/simulator" element={<SimulatorV2 />} />
          <Route path="/nyc/employee/:id" element={<EmployeeV2 />} />
          <Route path="*" element={<NotFoundPage initial={initial} />} />
        </Routes>
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
