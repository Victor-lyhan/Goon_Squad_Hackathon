import { Link } from 'react-router-dom';
import type { Business, Employee } from '../../../shared/types';
import { portalPaths, readIdentity, resolveIdentity, useDirectory } from '../demoIdentity';
import '../styles/help.css';

type Target = 'business' | 'employee' | 'simulator';

/** The six steps of SPEC.md "The 2-minute demo". Kept here on purpose (not shared with Landing). */
export const HELP_STEPS: readonly { title: string; text: string; target: Target; action: string }[] = [
  { title: 'Check a commute', text: 'Open the Employee workspace: the saved commute, departure times and added-time limit.', target: 'employee', action: 'Open Employee' },
  { title: 'Request a delivery', text: 'In Business, pick a recipient, describe the package, set times and choose Find a delivery match.', target: 'business', action: 'Open Business' },
  { title: 'Read the match', text: 'The backend returns a Delivery arranged card with shipment ID, ETA, price, carriers and relay point.', target: 'business', action: 'Open Business' },
  { title: 'See the new job', text: 'Back in Employee, without refreshing, the new job is already listed with its stops and reward.', target: 'employee', action: 'Open Employee' },
  { title: 'Run the simulation', text: 'In Simulator, play the evening leg, watch the package wait overnight, Jump to morning, then see it delivered.', target: 'simulator', action: 'Open Simulator' },
  { title: 'Check the results', text: 'Sender and recipient tracking and employee earnings update from the same run.', target: 'business', action: 'Open Business' },
];

export const HELP_SIMULATOR_PATH = '/simulator';

export default function Help({ initial }: { initial?: { businesses: Business[]; employees: Employee[] } }) {
  const dir = useDirectory(initial);
  const paths = portalPaths(
    dir.status === 'ready' ? resolveIdentity(readIdentity(), dir.businesses, dir.employees) : null,
  );
  const href = (t: Target) => (t === 'simulator' ? HELP_SIMULATOR_PATH : paths[t]);
  return (
    <div className="help">
      <h1>Guided demo</h1>
      <p className="help-lead">Six steps, about two minutes. Each step opens the workspace it happens in.</p>
      <ol className="help-steps">
        {HELP_STEPS.map((s, i) => {
          const to = href(s.target);
          return (
            <li key={i} className="help-step">
              <span className="help-step-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
              <div className="help-step-body">
                <h2>{s.title}</h2>
                <p>{s.text}</p>
              </div>
              {to
                ? <Link className="help-step-link" to={to}>{s.action}</Link>
                : <span className="help-step-link nav-pending" aria-disabled="true">{s.action}</span>}
            </li>
          );
        })}
      </ol>
      <section className="help-about" aria-labelledby="help-about-title">
        <h2 id="help-about-title">What you are looking at</h2>
        <p>
          Relay matches business packages to employees who already commute past the pickup and drop-off,
          either directly or through one relay point overnight. Every business, employee and delivery here
          is demo data, and deliveries are simulated by the backend: the pages only show what it returns.
        </p>
      </section>
    </div>
  );
}
