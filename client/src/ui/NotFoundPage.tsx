import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getBusinesses, getEmployees, isTravelUnavailable } from '../api/v2';
import { readIdentity } from '../demoIdentity';
import {
  startV2BusinessDirectory, startV2Directory, type V2BusinessDirectory, type V2Directory,
} from './shell';
import { pickAccount, SIMULATOR_PAGE_PATH, workspaceHrefs } from './shellModel';
import './shell.css';

export const SIMULATOR_HREF = SIMULATOR_PAGE_PATH;

/** The 404 page. Its workspace links use the /api/v2 accounts (the stored identity if it is in the lists). */
export default function NotFoundPage({ initialEmployees, initialBusinesses }: {
  /** Skip the /api/v2 requests and use these lists (tests). */
  initialEmployees?: V2Directory; initialBusinesses?: V2BusinessDirectory;
} = {}) {
  const [employees, setEmployees] = useState<V2Directory>(initialEmployees ?? { status: 'loading' });
  const [businesses, setBusinesses] = useState<V2BusinessDirectory>(initialBusinesses ?? { status: 'loading' });
  useEffect(() => {
    const stopE = initialEmployees ? undefined : startV2Directory(getEmployees, isTravelUnavailable, setEmployees);
    const stopB = initialBusinesses ? undefined : startV2BusinessDirectory(getBusinesses, isTravelUnavailable, setBusinesses);
    return () => { stopE?.(); stopB?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const stored = readIdentity();
  const paths = workspaceHrefs(
    pickAccount(stored.businessId, businesses.status === 'ready' ? businesses.businesses.map((b) => b.id) : undefined),
    pickAccount(stored.employeeId, employees.status === 'ready' ? employees.employees.map((e) => e.id) : undefined),
  );
  return (
    <div className="panel not-found">
      <h1>Page not found</h1>
      <p>That address isn't part of Relay. Try one of these:</p>
      <ul className="not-found-links">
        <li><Link to="/">Relay home</Link></li>
        <li>{paths.business ? <Link to={paths.business}>Business workspace</Link> : <span className="nav-pending">Business workspace</span>}</li>
        <li>{paths.employee ? <Link to={paths.employee}>Employee workspace</Link> : <span className="nav-pending">Employee workspace</span>}</li>
        <li><Link to={SIMULATOR_HREF}>Simulator</Link></li>
      </ul>
    </div>
  );
}
