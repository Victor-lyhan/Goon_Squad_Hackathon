import { Link } from 'react-router-dom';

import { portalPaths, readIdentity, resolveIdentity, useDirectory } from '../demoIdentity';

export const SIMULATOR_PATH = '/simulator';

const STEPS = [
  { title: 'Commute', text: 'Employees share the route they already drive each day.' },
  { title: 'Match', text: 'Business packages are matched to a commute, direct or via one hub relay.' },
  { title: 'Simulated delivery', text: 'Watch the matched deliveries run on a synthetic city map.' },
];

export default function Landing({ initial }: { initial?: Parameters<typeof useDirectory>[0] } = {}) {
  const dir = useDirectory(initial);
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
    </div>
  );
}
