import { Link } from 'react-router-dom';
import type { Business, Employee } from '../../../shared/types';
import { portalPaths, readIdentity, resolveIdentity, useDirectory } from '../demoIdentity';
import './shell.css';

export const SIMULATOR_HREF = '/simulator';

export default function NotFoundPage({ initial }: { initial?: { businesses: Business[]; employees: Employee[] } }) {
  const dir = useDirectory(initial);
  const paths = portalPaths(
    dir.status === 'ready' ? resolveIdentity(readIdentity(), dir.businesses, dir.employees) : null,
  );
  return (
    <div className="panel not-found">
      <h1>Page not found</h1>
      <p>That address isn't part of Relay. Try one of these:</p>
      <ul className="not-found-links">
        <li><Link to="/">Relay home</Link></li>
        <li>{paths.business ? <Link to={paths.business}>Business portal</Link> : <span className="nav-pending">Business portal</span>}</li>
        <li>{paths.employee ? <Link to={paths.employee}>Employee portal</Link> : <span className="nav-pending">Employee portal</span>}</li>
        <li><Link to={SIMULATOR_HREF}>Simulator</Link></li>
        <li><Link to="/help">Guided demo</Link></li>
      </ul>
    </div>
  );
}
