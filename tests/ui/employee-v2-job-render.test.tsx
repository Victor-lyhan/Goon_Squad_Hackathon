import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JobDetailV2, JobV2Missing, JobV2Other } from '../../client/src/components/employee/v2/JobDetailV2';
import {
  JOB_MISSING_TEXT, JOB_MISSING_TITLE, JOB_OTHER_TEXT, JOB_OTHER_TITLE, STATUS_NOTE_LEFT,
} from '../../client/src/components/employee/v2/jobDetailV2Model';
import { businesses, eveningDirect, morningDirect, relayLeg1, relayLeg2, STATUSES } from './employeeV2JobSample';

const noop = () => {};
const render = (job: ReturnType<typeof eveningDirect>, nbh = 'Astoria') =>
  renderToStaticMarkup(<JobDetailV2 job={job} businesses={businesses} homeNeighborhood={nbh} onBack={noop} />);

/** Visible text only (attributes such as class names are not shown to the user). */
const text = (html: string) => html.replace(/<[^>]*>/g, ' ');

function expectClean(html: string) {
  const t = text(html);
  expect(t).not.toMatch(/NaN|undefined|null/);
  expect(html).not.toMatch(/biz-|home-/);
  expect(t).not.toMatch(/\bhub\b/i);
  expect(t).not.toMatch(/\blat\b|\blng\b|latitude|longitude|40\.\d{3}|-73\.\d{3}/i);
}

const LEGS = { eveningDirect, morningDirect, relayLeg1, relayLeg2 };

describe('JobDetailV2 render', () => {
  for (const [name, make] of Object.entries(LEGS)) {
    it.each(STATUSES)(`${name} at %s renders clean`, (status) => {
      const html = render(make(status));
      expectClean(html);
      expect(html).toContain('Back to deliveries');
      // "Watch this package" opens the package and plays its journey (DECISIONS pass 64); `&` is `&amp;` in markup.
      expect(html).toContain(`href="/simulator?package=${make(status).shipment.id}&amp;play=1"`);
      expect(html.match(/href="\/simulator[^"]*"/g)).toHaveLength(1);
      expect(html).toContain('Watch this package');
      expect(html).toMatch(/<h2[^>]*tabindex="-1"/);
      expect(html).toContain('<dl');
    });
  }

  it('evening direct shows title, trip, route, numbers and home by neighborhood only', () => {
    const t = text(render(eveningDirect('in_progress')));
    for (const s of ['Brand proofs', 'Direct delivery', 'Evening commute, leaves Day 1, 5:15 PM', 'In progress',
      'Ink Studio', '55 Water St, Brooklyn', 'Midtown Agency', 'Home · Astoria', 'Day 1, 5:44 PM', 'Day 1, 6:01 PM',
      'Collect the package', 'Hand over the package', 'Ask for Maya at reception', 'Leave with the front desk',
      '+8 min', '+3.4 km', '$4.50', '38 min']) {
      expect(t).toContain(s);
    }
    expect(t).not.toContain('relay');
  });

  // #781: "(done)" on a stop comes from the API's `stopsDone`, not from the job status.
  it('marks "Collect the package (done)" only once the server counts the pickup', () => {
    const marks = (html: string) => [...html.matchAll(/data-kind="([^"]+)" data-done="([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
    // The commute left, the package is not collected yet.
    const left = render({ ...eveningDirect('in_progress'), stopsDone: 0 });
    expect(text(left)).toContain('Leave work (done)');
    expect(text(left)).not.toContain('Collect the package (done)');
    expect(text(left)).toContain('Collect the package');
    expect(marks(left)).toEqual(['start true', 'pickup false', 'delivery false', 'end false']);
    expectClean(left);
    // The pickup is handled.
    const collected = render({ ...eveningDirect('in_progress'), stopsDone: 1 });
    expect(text(collected)).toContain('Collect the package (done)');
    expect(text(collected)).not.toContain('Hand over the package (done)');
    expect(marks(collected)).toEqual(['start true', 'pickup true', 'delivery false', 'end false']);
    // Everything is done.
    const done = render({ ...eveningDirect('completed'), stopsDone: 2 });
    expect(marks(done)).toEqual(['start true', 'pickup true', 'delivery true', 'end true']);
    // An answer without the count keeps the old marks.
    expect(marks(render(eveningDirect('in_progress')))).toEqual(['start true', 'pickup true', 'delivery false', 'end false']);
  });

  // #791: "(done)" on the start row comes from the API's `departed`, not from the job status.
  it('marks "Leave work (done)" / "Leave home (done)" once the server says the commute has left', () => {
    const marks = (html: string) => [...html.matchAll(/data-kind="([^"]+)" data-done="([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
    // Before the departure.
    const waiting = render({ ...eveningDirect('assigned'), stopsDone: 0, departed: false });
    expect(text(waiting)).toContain('Leave work');
    expect(text(waiting)).not.toContain('(done)');
    expect(marks(waiting)).toEqual(['start false', 'pickup false', 'delivery false', 'end false']);
    expect(text(waiting)).toContain('Not started yet. It starts when your commute leaves.');
    // The commute left, the package is not collected yet: the job is still "Assigned".
    const left = render({ ...eveningDirect('assigned'), stopsDone: 0, departed: true });
    expect(text(left)).toContain('Leave work (done)');
    expect(text(left)).not.toContain('Collect the package (done)');
    expect(text(left).match(/\(done\)/g)).toHaveLength(1);
    expect(marks(left)).toEqual(['start true', 'pickup false', 'delivery false', 'end false']);
    expect(left).toMatch(/data-status="assigned"/);
    expect(text(left)).toContain('Assigned');
    expect(text(left)).toContain(STATUS_NOTE_LEFT);
    expect(text(left)).not.toContain('Not started yet');
    expectClean(left);
    // A morning leg starts at home.
    const morning = render({ ...relayLeg2('assigned'), stopsDone: 0, departed: true }, 'Park Slope');
    expect(text(morning)).toContain('Leave home (done)');
    expect(marks(morning)).toEqual(['start true', 'hub_pickup false', 'delivery false', 'end false']);
    expectClean(morning);
    // Later in the day the row stays done; the stop and end rows are as before.
    expect(marks(render({ ...eveningDirect('in_progress'), stopsDone: 1, departed: true })))
      .toEqual(['start true', 'pickup true', 'delivery false', 'end false']);
    expect(marks(render({ ...eveningDirect('completed'), stopsDone: 2, departed: true })))
      .toEqual(['start true', 'pickup true', 'delivery true', 'end true']);
    // An answer without the flag keeps the old marks: the start row waits for the status.
    expect(marks(render({ ...eveningDirect('assigned'), stopsDone: 0 }))).toEqual(['start false', 'pickup false', 'delivery false', 'end false']);
    expect(marks(render(eveningDirect('in_progress')))).toEqual(['start true', 'pickup true', 'delivery false', 'end false']);
  });

  // #836: "(done)" on the end row comes from the API's `arrived`, not from the job status.
  it('marks "Arrive home (done)" / "Arrive at work (done)" only once the server says the commute has arrived', () => {
    const marks = (html: string) => [...html.matchAll(/data-kind="([^"]+)" data-done="([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
    // The relay drop is handled, the job is "Completed", and the carrier is still driving home.
    const driving = render({ ...relayLeg1('completed'), stopsDone: 2, departed: true, arrived: false });
    expect(text(driving)).toContain('Leave it at the relay point for the morning carrier (done)');
    expect(text(driving)).toContain('Arrive home');
    expect(text(driving)).not.toContain('Arrive home (done)');
    expect(text(driving).match(/\(done\)/g)).toHaveLength(3);
    expect(marks(driving)).toEqual(['start true', 'pickup true', 'hub_drop true', 'end false']);
    // The status is the API's, untouched.
    expect(driving).toMatch(/data-status="completed"/);
    expect(text(driving)).toContain('Completed');
    expectClean(driving);
    // Home.
    const home = render({ ...relayLeg1('completed'), stopsDone: 2, departed: true, arrived: true });
    expect(text(home)).toContain('Arrive home (done)');
    expect(marks(home)).toEqual(['start true', 'pickup true', 'hub_drop true', 'end true']);
    expectClean(home);
    // A morning leg ends at work.
    const atWork = render({ ...relayLeg2('completed'), stopsDone: 2, departed: true, arrived: true }, 'Park Slope');
    expect(text(atWork)).toContain('Arrive at work (done)');
    expect(marks(atWork)).toEqual(['start true', 'hub_pickup true', 'delivery true', 'end true']);
    expect(text(render({ ...relayLeg2('completed'), stopsDone: 2, departed: true, arrived: false }, 'Park Slope')))
      .not.toContain('Arrive at work (done)');
    // An answer without the flag keeps the old marks: the end row follows the status.
    expect(marks(render({ ...relayLeg1('completed'), stopsDone: 2, departed: true }))).toEqual(['start true', 'pickup true', 'hub_drop true', 'end true']);
    expect(marks(render({ ...relayLeg1('in_progress'), stopsDone: 1, departed: true }))).toEqual(['start true', 'pickup true', 'hub_drop false', 'end false']);
  });

  it('"What it adds" lists the reward first and a shorter detour as "km shorter" (#551)', () => {
    const job = eveningDirect();
    job.plan.legs[job.job.legIndex].extraDistanceM = -5496;
    const html = render(job);
    const keys = [...html.matchAll(/data-number="([^"]+)"/g)].map((m) => m[1]);
    expect(keys).toEqual(['reward', 'extra-time', 'extra-distance', 'usual-commute']);
    const t = text(html);
    expect(t).toContain('5.5 km shorter');
    expect(t).not.toMatch(/-\s*\d/);
    expectClean(html);
  });

  it('relay legs show the relay sentence and relay-point actions', () => {
    const t1 = text(render(relayLeg1()));
    expect(t1).toContain('Relay: you take it to River Cafe Roasters; another carrier takes it from there');
    expect(t1).toContain('Leave it at the relay point for the morning carrier');
    expect(t1).toContain('You leave the package at River Cafe Roasters');
    const t2 = text(render(relayLeg2(), 'Park Slope'));
    expect(t2).toContain('Relay: another carrier brings it to River Cafe Roasters; you take it from there');
    expect(t2).toContain('Collect it from the relay point');
    expect(t2).toContain('Home · Park Slope');
    expect(t2).toContain('Another carrier brought the package from LIC Bakery to River Cafe Roasters');
  });

  it('an unresolved place renders "Unknown place"', () => {
    const job = relayLeg2();
    job.plan.legs[1].stops[0] = { ...job.plan.legs[1].stops[0], placeId: 'biz-gone' };
    const html = render(job);
    expectClean(html);
    expect(html).toContain('Unknown place');
  });

  it('missing-job and other-employee states', () => {
    const missing = renderToStaticMarkup(<JobV2Missing onBack={noop} />);
    expect(missing).toContain(`>${JOB_MISSING_TITLE}</h2>`);
    expect(missing).toContain(`>${JOB_MISSING_TEXT}</p>`);
    expect(missing).toContain('Back to deliveries');
    expectClean(missing);
    const other = renderToStaticMarkup(<JobV2Other href="/employee/emp-02?job=job-1" onBack={noop} />);
    expect(other).toContain(`>${JOB_OTHER_TITLE}</h2>`);
    expect(other).toContain(`>${JOB_OTHER_TEXT}</p>`);
    expect(other).toContain('href="/employee/emp-02?job=job-1"');
    expect(other).toContain('Back to deliveries');
    expectClean(other);
  });

  // #634: a 404 also follows a re-match, so neither state blames a city change, and both say "delivery".
  it('the two states use the #634 wording: "delivery", not "job", and no claim that the city changed', () => {
    expect(JOB_MISSING_TITLE).toBe('This delivery is no longer assigned to you');
    expect(JOB_MISSING_TEXT).toBe('It was re-matched or the run changed. Your current deliveries are on your page.');
    expect(JOB_OTHER_TITLE).toBe('This delivery is assigned to another carrier');
    for (const html of [
      renderToStaticMarkup(<JobV2Missing onBack={noop} />),
      renderToStaticMarkup(<JobV2Other href="/employee/emp-02?job=job-1" onBack={noop} />),
    ]) {
      expect(text(html)).toMatch(/delivery/);
      expect(text(html)).not.toMatch(/\bjobs?\b/i);
      expect(text(html)).not.toMatch(/city/i);
      expect(text(html)).not.toMatch(/own deliveries/);
    }
  });

  it('JobDetailV2.tsx takes its titles from the v2 model, not from the MVP 1 file', () => {
    const src = readFileSync(resolve(__dirname, '../../client/src/components/employee/v2/JobDetailV2.tsx'), 'utf8');
    expect(src).not.toMatch(/from '\.\.\/jobDetailModel'/);
    expect(src).toMatch(/JOB_MISSING_TITLE[^;]*from '\.\/jobDetailV2Model'/);
  });
});

describe('JobDetailV2.css', () => {
  const css = readFileSync(resolve(__dirname, '../../client/src/components/employee/v2/JobDetailV2.css'), 'utf8');

  it('has a 390 px rule', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*480px\)/); // #882: phone rules from 480 px down, so 390 px has them
  });
  it('uses no radius over 4px; only a station of the route line is round (issue 957)', () => {
    for (const m of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      if (m[1].trim() === '50%') continue;
      for (const px of m[1].matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px[1])).toBeLessThanOrEqual(4);
      expect(m[1]).not.toMatch(/%|999|rem|em\b/);
    }
  });
  it('uses no box-shadow except a 1px focus ring', () => {
    const shadows = [...css.matchAll(/([^{}]+)\{[^}]*box-shadow:\s*([^;]+);/g)];
    for (const [, selector, value] of shadows) {
      expect(selector).toContain(':focus-visible');
      expect(value.trim()).toMatch(/^0 0 0 1px /);
    }
  });
  it('has :focus-visible on links and buttons', () => {
    expect(css).toMatch(/\.job-v2__link:focus-visible/);
    expect(css).toMatch(/\.job-v2__button:focus-visible/);
  });
  it('writes tokens with fallbacks', () => {
    for (const m of css.matchAll(/var\(--[\w-]+(\s*[,)])/g)) expect(m[1].trim()).toBe(',');
  });
});
