import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { getBusinesses, getEmployees, getSimulator } from '../api';
import { portalPaths, readIdentity, resolveIdentity, useDirectory } from '../demoIdentity';
import { Spinner } from '../ui';
import '../styles/landing.css';

export const SIMULATOR_PATH = '/simulator';

const STEPS = [
  { title: 'Commute', text: 'Employees share the route they already drive each day.' },
  { title: 'Match', text: 'Business packages are matched to a commute, direct or via one hub relay.' },
  { title: 'Simulated delivery', text: 'Watch the matched deliveries run on a synthetic city map.' },
];

export type GuideFacts =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; businesses: number; commuters: number; matched: number; requested: number };

export type GuidePaths = { business: string | null; employee: string | null };

type GuideStep = { text: string; label: string; target: 'employee' | 'business' | 'simulator' };

// Wording follows SPEC.md "The 2-minute demo".
export const GUIDE_STEPS: GuideStep[] = [
  { text: 'Employee portal: see the saved commute, departure times and added-time limit.', label: 'Open employee portal', target: 'employee' },
  { text: 'Business portal: pick a recipient, describe the package, set times and Find a delivery match.', label: 'Open business portal', target: 'business' },
  { text: 'The backend returns a real Delivery arranged card: shipment ID, ETA, price, carriers and hub.', label: 'See the result card', target: 'business' },
  { text: 'Back on the employee tab, with no refresh, the new job is already there with stops and reward.', label: 'Check the employee jobs', target: 'employee' },
  { text: 'Simulator: play the evening leg, let the package sit at the hub overnight, jump to morning and watch it delivered.', label: 'Open simulator', target: 'simulator' },
  { text: 'Sender and recipient tracking and employee earnings update from the same run.', label: 'Open tracking', target: 'business' },
];

export function DemoGuide({ paths, facts }: { paths: GuidePaths; facts: GuideFacts }) {
  return (
    <section className="panel demo-guide" aria-labelledby="demo-guide-title">
      <h2 id="demo-guide-title">Run the demo</h2>
      <p className="demo-guide-intro">Six steps, about two minutes.</p>
      <ol className="guide-steps">
        {GUIDE_STEPS.map((s, i) => {
          const to = s.target === 'simulator' ? SIMULATOR_PATH : paths[s.target];
          return (
            <li className="guide-step" key={s.label}>
              <span className="step-num">{i + 1}</span>
              <p>{s.text}</p>
              {to
                ? <Link className="btn" to={to}>{s.label}</Link>
                : <span className="btn btn-disabled" aria-disabled="true">{s.label}</span>}
            </li>
          );
        })}
      </ol>
      {facts.status === 'loading' && <p className="guide-facts-note"><Spinner label="Loading live numbers" /> Loading live numbers…</p>}
      {facts.status === 'error' && <p className="guide-facts-note">Live numbers unavailable</p>}
      {facts.status === 'ready' && (
        <ul className="guide-facts" aria-label="Demo city facts">
          <li><strong>{facts.businesses}</strong> businesses</li>
          <li><strong>{facts.commuters}</strong> commuters</li>
          <li><strong>{facts.matched} / {facts.requested}</strong> packages matched / requested</li>
        </ul>
      )}
    </section>
  );
}

function useGuideFacts(): GuideFacts {
  const [facts, setFacts] = useState<GuideFacts>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    Promise.all([getBusinesses(), getEmployees(), getSimulator()])
      .then(([b, e, sim]) => {
        if (cancelled) return;
        setFacts({
          status: 'ready',
          businesses: b.businesses.length,
          commuters: e.employees.length,
          matched: sim.snapshot.metrics.matched,
          requested: sim.snapshot.metrics.requested,
        });
      })
      .catch(() => { if (!cancelled) setFacts({ status: 'error' }); });
    return () => { cancelled = true; };
  }, []);
  return facts;
}

export default function Landing({ initial }: { initial?: Parameters<typeof useDirectory>[0] } = {}) {
  const dir = useDirectory(initial);
  const facts = useGuideFacts();
  const paths = portalPaths(
    dir.status === 'ready' ? resolveIdentity(readIdentity(), dir.businesses, dir.employees) : null,
  );
  return (
    <div className="landing">
      <section className="panel hero">
        <h1>Deliver on the way home.</h1>
        <p className="pitch">
          Relay matches B2B packages to the commutes employees already make, direct or through one hub relay.
        </p>
        <div className="cta-row">
          {paths.business
            ? <Link className="btn btn-primary" to={paths.business}>Business portal</Link>
            : <span className="btn btn-primary btn-disabled" aria-disabled="true">Business portal</span>}
          {paths.employee
            ? <Link className="btn" to={paths.employee}>Employee portal</Link>
            : <span className="btn btn-disabled" aria-disabled="true">Employee portal</span>}
          <Link className="btn" to={SIMULATOR_PATH}>Simulator</Link>
        </div>
        {dir.status === 'loading' && <p className="demo-account-status">Loading demo accounts…</p>}
        {dir.status === 'error' && <p className="demo-account-status demo-account-error" role="alert">Could not load demo accounts. Is the API running?</p>}
      </section>
      <section aria-label="How it works">
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li className="panel step" key={s.title}>
              <span className="step-num">{i + 1}</span>
              <h2>{s.title}</h2>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>
      <DemoGuide paths={paths} facts={facts} />
    </div>
  );
}
