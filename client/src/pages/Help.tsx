import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { readIdentity, type DemoIdentity } from '../demoIdentity';
import { getBusinesses, getEmployees, isTravelUnavailable } from '../api/v2';
import {
  startV2BusinessDirectory, startV2Directory, type V2BusinessDirectory, type V2Directory,
} from '../ui/shell';
import { ENV_LABELS, pickAccount, workspaceHrefs } from '../ui/shellModel';
import '../styles/help.css';

type Target = 'business' | 'employee' | 'simulator';

type Step = { title: string; text: string; target: Target; action: string };

/**
 * The six steps of SPEC.md "The 2-minute demo" on the NYC network. Kept here on purpose (not shared with
 * Landing). "Relay point", never "hub"; the simulator step names only controls that are on main.
 */
export const NYC_HELP_STEPS: readonly Step[] = [
  { title: 'Check a commute', text: 'Open the Employee workspace: the home neighborhood, the commute on the map, departure times and the added-time limit.', target: 'employee', action: 'Open Employee' },
  { title: 'Request a delivery', text: 'In Business, choose New delivery, pick a recipient business, describe the package and choose Send request.', target: 'business', action: 'Open Business' },
  { title: 'Read the match', text: 'The backend plans it on a commute, direct or through a relay point: a network business that holds the package overnight. The delivery shows its ETA, price and carriers.', target: 'business', action: 'Open Business' },
  { title: 'See the new job', text: 'Back in Employee, without refreshing, the new job is already listed with its stops and reward.', target: 'employee', action: 'Open Employee' },
  { title: 'Run the simulation', text: 'In Simulator, select the package and choose Play to follow it along its route; the night at the relay point is skipped. With no package selected, Play runs the whole network.', target: 'simulator', action: 'Open Simulator' },
  { title: 'Check the results', text: 'Sender and recipient tracking and employee earnings update from the same run.', target: 'business', action: 'Open Business' },
];

/** The one line shown when /api/v2 answers 503 (same copy as the v2 workspaces, pass 46). */
export const NYC_HELP_UNAVAILABLE_TEXT = 'NYC travel data is not loaded on this server yet.';

export type NycHelpView = {
  links: Record<Target, string | null>;
  /** One line under the lead: loading, 503 or an error message; null when both lists are ready. */
  note: { kind: 'loading' | 'unavailable' | 'error'; text: string } | null;
};

/**
 * Pure: the step links (main paths; the stored demo identity if it is in the lists, else the first account)
 * and the status line from the two v2 lists.
 */
export function nycHelpView(employees: V2Directory, businesses: V2BusinessDirectory, stored: DemoIdentity = {}): NycHelpView {
  const links = workspaceHrefs(
    pickAccount(stored.businessId, businesses.status === 'ready' ? businesses.businesses.map((b) => b.id) : undefined),
    pickAccount(stored.employeeId, employees.status === 'ready' ? employees.employees.map((e) => e.id) : undefined),
  );
  const both = [employees, businesses];
  const failed = both.find((d) => d.status === 'error');
  let note: NycHelpView['note'] = null;
  if (both.some((d) => d.status === 'unavailable')) note = { kind: 'unavailable', text: NYC_HELP_UNAVAILABLE_TEXT };
  else if (failed && failed.status === 'error') note = { kind: 'error', text: failed.message };
  else if (both.some((d) => d.status === 'loading')) note = { kind: 'loading', text: 'Loading NYC accounts…' };
  return { links, note };
}

type NycHelpReads = { getEmployees: typeof getEmployees; getBusinesses: typeof getBusinesses };

/**
 * Starts the two v2 list loads (a list already given is skipped) and returns the cleanup that aborts
 * both requests and drops late answers.
 */
export function startNycHelpLists(
  onEmployees: (d: V2Directory) => void,
  onBusinesses: (d: V2BusinessDirectory) => void,
  skip: { employees?: boolean; businesses?: boolean } = {},
  api: NycHelpReads = { getEmployees, getBusinesses },
): () => void {
  const stopE = skip.employees ? undefined : startV2Directory(api.getEmployees, isTravelUnavailable, onEmployees);
  const stopB = skip.businesses ? undefined : startV2BusinessDirectory(api.getBusinesses, isTravelUnavailable, onBusinesses);
  return () => { stopE?.(); stopB?.(); };
}

/** The two lists for /help, loaded once and aborted on unmount. A list passed in is used as is (tests). */
function useNycLists(initialEmployees?: V2Directory, initialBusinesses?: V2BusinessDirectory) {
  const [employees, setEmployees] = useState<V2Directory>(initialEmployees ?? { status: 'loading' });
  const [businesses, setBusinesses] = useState<V2BusinessDirectory>(initialBusinesses ?? { status: 'loading' });
  useEffect(
    () => startNycHelpLists(setEmployees, setBusinesses, { employees: !!initialEmployees, businesses: !!initialBusinesses }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return { employees, businesses };
}

function Steps({ steps, href }: { steps: readonly Step[]; href: (t: Target) => string | null }) {
  return (
    <ol className="help-steps">
      {steps.map((s, i) => {
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
  );
}

/** /help: the Guided demo on the NYC network (/api/v2 lists, main paths). */
export default function Help({ initialEmployees, initialBusinesses }: {
  /**
   * Accepted and ignored: the NYC page is the only one. `App.tsx` still passes `dataset="nyc"` and is not
   * edited by the deletion issue (#565); remove the prop together with that attribute.
   */
  dataset?: 'nyc';
  /** Skip the /api/v2 requests and use these lists (tests). */
  initialEmployees?: V2Directory;
  initialBusinesses?: V2BusinessDirectory;
}) {
  const { employees, businesses } = useNycLists(initialEmployees, initialBusinesses);
  const { links, note } = nycHelpView(employees, businesses, readIdentity());
  return (
    <div className="help help-nyc">
      <h1>Guided demo</h1>
      <p className="help-lead">Six steps on the NYC network, about two minutes. Each step opens the workspace it happens in.</p>
      <p className="help-indicator">{ENV_LABELS.nyc}</p>
      {note && (
        <p className={note.kind === 'loading' ? 'help-status' : 'help-status help-status--problem'} role={note.kind === 'error' ? 'alert' : 'status'}>
          {note.text}
        </p>
      )}
      <Steps steps={NYC_HELP_STEPS} href={(t) => links[t]} />
      <section className="help-about" aria-labelledby="help-about-title">
        <h2 id="help-about-title">What you are looking at</h2>
        <p>
          Relay matches business packages to employees who already commute past the pickup and drop-off,
          either directly or through one relay point overnight. The businesses are real NYC locations, and the
          travel times between them come from Google and are cached. Employees, their homes and the deliveries
          are simulated by the backend, and homes are shown by neighborhood only.
        </p>
      </section>
    </div>
  );
}
