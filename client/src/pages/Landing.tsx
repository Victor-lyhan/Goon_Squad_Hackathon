import { Link } from 'react-router-dom';

export const DEFAULT_BUSINESS_PATH = '/business/biz-a';
export const DEFAULT_EMPLOYEE_PATH = '/employee/emp-1';
export const SIMULATOR_PATH = '/simulator';

const STEPS = [
  { title: 'Commute', text: 'Employees share the route they already drive each day.' },
  { title: 'Match', text: 'Business packages are matched to a commute, direct or via one hub relay.' },
  { title: 'Simulated delivery', text: 'Watch the matched deliveries run on a synthetic city map.' },
];

export default function Landing() {
  return (
    <div className="landing">
      <section className="panel hero">
        <h1>Deliver on the way home.</h1>
        <p className="pitch">
          Relay matches B2B packages to the commutes employees already make, direct or through one hub relay.
        </p>
        <div className="cta-row">
          <Link className="btn btn-primary" to={DEFAULT_BUSINESS_PATH}>Business portal</Link>
          <Link className="btn" to={DEFAULT_EMPLOYEE_PATH}>Employee portal</Link>
          <Link className="btn" to={SIMULATOR_PATH}>Simulator</Link>
        </div>
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
