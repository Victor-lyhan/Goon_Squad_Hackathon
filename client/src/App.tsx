import { useState } from 'react';
import { BrowserRouter, Link, matchPath, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { Business, Employee } from '../../shared/types';
import {
  portalPaths, readIdentity, resolveIdentity, useDirectory, writeIdentity,
  type Directory,
} from './demoIdentity';
import './styles/global.css';
import Landing, { SIMULATOR_PATH } from './pages/Landing';
import BusinessPortal from './pages/BusinessPortal';
import EmployeePortal from './pages/EmployeePortal';
import Simulator from './pages/Simulator';

export const BADGE_TEXT = 'Synthetic city · simulated deliveries';

export { readIdentity, writeIdentity, resolveIdentity };

export type DirectoryData = { businesses: Business[]; employees: Employee[] };

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
    if (!id) return;
    if (bizMatch) {
      writeIdentity({ ...readIdentity(), businessId: id });
      navigate(`/business/${encodeURIComponent(id)}`);
    } else {
      writeIdentity({ ...readIdentity(), employeeId: id });
      navigate(`/employee/${encodeURIComponent(id)}`);
    }
  };

  if (bizMatch) {
    return (
      <label className="demo-account">
        <span>Demo account</span>
        <select value={bizMatch.params.id ?? ''} onChange={(e) => choose(e.target.value)}>
          {!dir.businesses.some((b) => b.id === bizMatch.params.id) && <option value="">Choose a business</option>}
          {dir.businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
    );
  }
  const bizName = (id: string) => dir.businesses.find((b) => b.id === id)?.name ?? id;
  return (
    <label className="demo-account">
      <span>Demo account</span>
      <select value={empMatch?.params.id ?? ''} onChange={(e) => choose(e.target.value)}>
        {!dir.employees.some((x) => x.id === empMatch?.params.id) && <option value="">Choose an employee</option>}
        {dir.employees.map((x) => (
          <option key={x.id} value={x.id}>{x.name} ({bizName(x.businessId)})</option>
        ))}
      </select>
    </label>
  );
}

/** `initial` skips the API load (used by tests). */
export function Header({ initial }: { initial?: DirectoryData } = {}) {
  const dir = useDirectory(initial);
  // Re-read after route changes so a fresh choice is reflected in the portal links.
  const { pathname } = useLocation();
  const [stored, setStored] = useState(readIdentity);
  const [seen, setSeen] = useState(pathname);
  if (seen !== pathname) {
    setSeen(pathname);
    setStored(readIdentity());
  }
  const paths = portalPaths(
    dir.status === 'ready' ? resolveIdentity(stored, dir.businesses, dir.employees) : null,
  );
  return (
    <header className="app-header">
      <Link to="/" className="wordmark">Relay</Link>
      <nav aria-label="Portals" className="portal-switch">
        {paths.business ? <NavLink to={paths.business}>Business</NavLink> : <span className="nav-pending">Business</span>}
        {paths.employee ? <NavLink to={paths.employee}>Employee</NavLink> : <span className="nav-pending">Employee</span>}
        <NavLink to={SIMULATOR_PATH}>Simulator</NavLink>
      </nav>
      <span className="badge">{BADGE_TEXT}</span>
      <div className="demo-account-slot" data-slot="demo-account-selector">
        <DemoAccountSelector dir={dir} />
      </div>
    </header>
  );
}

function NotFound() {
  return (
    <div className="panel">
      <h1>Page not found</h1>
      <p><Link to="/">Back to the Relay home page</Link></p>
    </div>
  );
}

/** Header + routes, without a router, so tests can wrap it in MemoryRouter. */
export function AppShell({ initial }: { initial?: DirectoryData } = {}) {
  return (
    <>
      <Header initial={initial} />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Landing initial={initial} />} />
          <Route path="/business/:id" element={<BusinessPortal />} />
          <Route path="/employee/:id" element={<EmployeePortal />} />
          <Route path="/simulator" element={<Simulator />} />
          <Route path="*" element={<NotFound />} />
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
