import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom';
import './styles/global.css';
import Landing, { DEFAULT_BUSINESS_PATH, DEFAULT_EMPLOYEE_PATH, SIMULATOR_PATH } from './pages/Landing';
import BusinessPortal from './pages/BusinessPortal';
import EmployeePortal from './pages/EmployeePortal';
import Simulator from './pages/Simulator';

export const BADGE_TEXT = 'Synthetic city · simulated deliveries';

export function Header() {
  return (
    <header className="app-header">
      <Link to="/" className="wordmark">Relay</Link>
      <nav aria-label="Portals" className="portal-switch">
        <NavLink to={DEFAULT_BUSINESS_PATH}>Business</NavLink>
        <NavLink to={DEFAULT_EMPLOYEE_PATH}>Employee</NavLink>
        <NavLink to={SIMULATOR_PATH}>Simulator</NavLink>
      </nav>
      <span className="badge">{BADGE_TEXT}</span>
      {/* SLOT: Demo account selector goes here (wired in a later issue once client/src/api lands, #4). */}
      <div className="demo-account-slot" data-slot="demo-account-selector" />
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
export function AppShell() {
  return (
    <>
      <Header />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Landing />} />
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
