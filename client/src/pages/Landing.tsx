import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { readIdentity } from '../demoIdentity';
import { NYC_ENV_TEXT, NYC_UNAVAILABLE_TEXT, nycWorkspacePaths, startNycSummary, type NycSummary } from './landingModel';
import '../styles/landing.css';

export const SIMULATOR_PATH = '/simulator';
export const HELP_PATH = '/help';

/** Live counts for the operational summary. Every number comes from an API response. */
export type SummaryFacts =
  | { status: 'loading' }
  | { status: 'error' }
  /** /api/v2 answered 503 (travel data not loaded). One line, no numbers. */
  | { status: 'unavailable' }
  | { status: 'ready'; businesses: number; commuters: number; relayPoints: number; matched: number; requested: number };

type WorkspaceKey = 'business' | 'employee' | 'simulator';

export const WORKSPACES: { key: WorkspaceKey; id: string; title: string; text: string }[] = [
  { key: 'business', id: '01 / BUSINESS', title: 'Business', text: 'Create shipment requests, find delivery matches and manage deliveries.' },
  { key: 'employee', id: '02 / EMPLOYEE', title: 'Employee', text: 'Manage your commute, departure times, maximum detour and assigned packages.' },
  { key: 'simulator', id: '03 / SIMULATOR', title: 'Simulator', text: 'Watch the delivery network, matched routes and relay points run.' },
];

const num = (n: number) => (Number.isFinite(n) ? String(n) : '–');

export function OperationalSummary({ facts }: { facts: SummaryFacts }) {
  if (facts.status === 'unavailable') {
    return (
      <section className="op-summary" aria-label="Operational summary">
        <p className="op-summary-note" role="status">{NYC_UNAVAILABLE_TEXT}</p>
      </section>
    );
  }
  if (facts.status === 'error') {
    return (
      <section className="op-summary" aria-label="Operational summary">
        <p className="op-summary-note">Live numbers unavailable</p>
      </section>
    );
  }
  const ready = facts.status === 'ready';
  const items: [string, string][] = [
    ['Businesses', ready ? num(facts.businesses) : '–'],
    ['Commuters', ready ? num(facts.commuters) : '–'],
    ['Relay points', ready ? num(facts.relayPoints) : '–'],
    ['Matched / requested', ready ? `${num(facts.matched)} / ${num(facts.requested)}` : '– / –'],
  ];
  return (
    <section className="op-summary" aria-label="Operational summary" aria-busy={ready ? undefined : true}>
      <dl className="op-summary-list">
        {items.map(([label, value]) => (
          <div className="op-summary-item" key={label}>
            <dt>{label}</dt>
            <dd className={ready ? 'op-summary-value' : 'op-summary-value is-placeholder'}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function EntryBody({ id, title, text }: { id: string; title: string; text: string }) {
  return (
    <>
      <span className="workspace-id">{id}</span>
      <h2 className="workspace-title">{title}</h2>
      <p className="workspace-text">{text}</p>
      <span className="workspace-action">Open workspace <span aria-hidden="true">→</span></span>
    </>
  );
}

export function WorkspaceEntries({ paths }: {
  paths: { business: string | null; employee: string | null; simulator?: string | null };
}) {
  return (
    <ul className="workspaces" aria-label="Workspaces">
      {WORKSPACES.map((w) => {
        const to = w.key === 'simulator' ? (paths.simulator === undefined ? SIMULATOR_PATH : paths.simulator) : paths[w.key];
        return (
          <li key={w.key}>
            {to
              ? <Link className="workspace-entry" to={to}><EntryBody {...w} /></Link>
              : (
                <div className="workspace-entry is-disabled" aria-disabled="true">
                  <EntryBody {...w} />
                </div>
              )}
          </li>
        );
      })}
    </ul>
  );
}

/** The NYC summary from /api/v2 (requests aborted on unmount). `initial` skips the requests (tests). */
function useNycSummary(initial?: NycSummary): NycSummary {
  const [summary, setSummary] = useState<NycSummary>(initial ?? { status: 'loading' });
  useEffect(() => {
    if (initial) return;
    return startNycSummary(setSummary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return summary;
}

function nycFacts(s: NycSummary): SummaryFacts {
  if (s.status !== 'ready') return s;
  const { businessIds: _b, employeeIds: _e, ...counts } = s;
  return counts;
}

/** The homepage on the NYC network: /api/v2 only, links to the main paths. */
export default function Landing({ initialSummary, helpPath = HELP_PATH }: {
  /**
   * Accepted and ignored: the NYC page is the only one. `App.tsx` still passes `dataset="nyc"` and is not
   * edited by the deletion issue (#565); remove the prop together with that attribute.
   */
  dataset?: 'nyc';
  /** Skip the /api/v2 requests and render this summary (tests). */
  initialSummary?: NycSummary;
  /** Where "Guided demo" goes (default /help). */
  helpPath?: string;
} = {}) {
  const summary = useNycSummary(initialSummary);
  return (
    <div className="landing landing-nyc">
      <section className="landing-intro">
        <h1>Delivery infrastructure, powered by existing commutes.</h1>
        <p>Relay matches business packages to the trips employees already make, direct or through one relay point.</p>
        <p className="landing-indicator">{NYC_ENV_TEXT}</p>
      </section>
      <OperationalSummary facts={nycFacts(summary)} />
      <WorkspaceEntries paths={nycWorkspacePaths(summary, readIdentity())} />
      <footer className="landing-footer">
        <span>{NYC_ENV_TEXT}</span>
        <Link to={helpPath}>Guided demo</Link>
      </footer>
    </div>
  );
}
