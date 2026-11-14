import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JobDetailV2, JobV2Missing, JobV2Other } from '../../client/src/components/employee/v2/JobDetailV2';
import {
  JOB_MISSING_TEXT, JOB_MISSING_TITLE, JOB_OTHER_TEXT, JOB_OTHER_TITLE,
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
      expect(html).toContain('href="/simulator?package=');
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
    expect(t1).toContain('Relay leg 1 of 2: drop at the relay point');
    expect(t1).toContain('Leave it at the relay point for the morning carrier');
    expect(t1).toContain('You leave the package at River Cafe Roasters');
    const t2 = text(render(relayLeg2(), 'Park Slope'));
    expect(t2).toContain('Relay leg 2 of 2: collect from the relay point');
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
    expect(css).toMatch(/@media\s*\(max-width:\s*390px\)/);
  });
  it('uses no radius over 4px', () => {
    for (const m of css.matchAll(/border-radius:\s*([^;]+);/g)) {
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
