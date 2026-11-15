import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { readIdentity } from '../demoIdentity';
import { LOGO_SRC } from '../ui/brand';
import {
  NYC_UNAVAILABLE_TEXT, nycWorkspacePaths, startNycSummary, watchPackageHref, type NycSummary,
} from './landingModel';
import '../styles/landing.css';

/** The one sentence of the homepage (docs/mvp3.md P4). */
export const LANDING_SENTENCE = 'Relay moves packages between businesses on employees’ existing commutes.';
export const WATCH_LABEL = 'Watch a package';

/** Live counts for the stats line. Every number comes from an API response. */
export type SummaryFacts =
  | { status: 'loading' }
  | { status: 'error' }
  /** /api/v2 answered 503 (travel data not loaded). One line, no numbers. */
  | { status: 'unavailable' }
  | { status: 'ready'; businesses: number; commuters: number; matched: number; requested: number };

type WorkspaceKey = 'business' | 'employee';

export const WORKSPACES: { key: WorkspaceKey; title: string; text: string }[] = [
  { key: 'business', title: 'Business', text: 'Send a package and track it' },
  { key: 'employee', title: 'Employee', text: 'Set a commute and see your deliveries' },
];

const num = (n: number) => (Number.isFinite(n) ? String(n) : '–');

/** The stats strip, as one line: "18 businesses · 60 commuters · 24 of 24 packages matched". */
export function OperationalSummary({ facts }: { facts: SummaryFacts }) {
  if (facts.status === 'unavailable' || facts.status === 'error') {
    return (
      <section className="op-summary" aria-label="Network summary">
        <p className="op-summary-note" role={facts.status === 'unavailable' ? 'status' : undefined}>
          {facts.status === 'unavailable' ? NYC_UNAVAILABLE_TEXT : 'Live numbers unavailable'}
        </p>
      </section>
    );
  }
  const ready = facts.status === 'ready' ? facts : null;
  /** One number of the line, or a dash while it is loading. */
  const value = (n: number | undefined) => (
    <span className={ready ? 'op-summary-value' : 'op-summary-value is-placeholder'}>{n === undefined ? '–' : num(n)}</span>
  );
  return (
    <section className="op-summary" aria-label="Network summary" aria-busy={ready ? undefined : true}>
      <ul className="op-summary-list">
        <li>{value(ready?.businesses)} businesses</li>
        <li>{value(ready?.commuters)} commuters</li>
        <li>{value(ready?.matched)} of {value(ready?.requested)} packages matched</li>
      </ul>
    </section>
  );
}

/** The large primary button: a link, so it works with the keyboard and before the run has loaded. */
export function WatchButton({ to }: { to: string }) {
  return (
    <Link className="watch-button" to={to}>
      <svg className="watch-button-icon" viewBox="0 0 12 12" width="14" height="14" aria-hidden="true" focusable="false">
        <path d="M2 1l9 5-9 5z" fill="currentColor" />
      </svg>
      {WATCH_LABEL}
    </Link>
  );
}

function EntryBody({ title, text }: { title: string; text: string }) {
  return (
    <>
      <span className="workspace-body">
        <span className="workspace-title">{title}</span>
        <span className="workspace-text">{text}</span>
      </span>
      <span className="workspace-arrow" aria-hidden="true">→</span>
    </>
  );
}

/** Business and Employee, the two smaller entries. An entry whose account list is not loaded is not a link yet. */
export function WorkspaceEntries({ paths }: { paths: { business: string | null; employee: string | null } }) {
  return (
    <ul className="workspaces" aria-label="Workspaces">
      {WORKSPACES.map((w) => {
        const to = paths[w.key];
        // Title and text by name: spreading `w` would hand its `key` to JSX, which React reports (#746).
        const body = <EntryBody title={w.title} text={w.text} />;
        return (
          <li key={w.key}>
            {to
              ? <Link className="workspace-entry" to={to}>{body}</Link>
              : <div className="workspace-entry is-disabled" aria-disabled="true">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The NYC summary from /api/v2. A failed load is asked for again until it is ready (#610); the requests and
 * the retry timer are dropped on unmount. `initial` skips the requests (tests).
 */
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
  const { businesses, commuters, matched, requested } = s;
  return { status: 'ready', businesses, commuters, matched, requested };
}

/**
 * The homepage (docs/mvp3.md P4): the logo, one sentence, one large "Watch a package" button that opens the simulator
 * on the story package and plays it, Business and Employee as two smaller entries, one stats line.
 * The environment line ("Real NYC locations · simulated deliveries") is the header's, not repeated here (#724).
 */
export default function Landing({ initialSummary }: {
  /**
   * Accepted and ignored: the NYC page is the only one. `App.tsx` still passes `dataset="nyc"` and is not
   * edited by this issue; remove the prop together with that attribute.
   */
  dataset?: 'nyc';
  /** Skip the /api/v2 requests and render this summary (tests). */
  initialSummary?: NycSummary;
} = {}) {
  const summary = useNycSummary(initialSummary);
  return (
    <div className="landing landing-nyc">
      <section className="landing-intro">
        {/* Decorative: the sentence under it says the name (#784). */}
        <img className="landing-logo" src={LOGO_SRC} alt="" width={96} height={96} />
        <h1>{LANDING_SENTENCE}</h1>
        <WatchButton to={watchPackageHref(summary)} />
      </section>
      <WorkspaceEntries paths={nycWorkspacePaths(summary, readIdentity())} />
      <OperationalSummary facts={nycFacts(summary)} />
    </div>
  );
}
