import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmployeeWorkspace } from '../../client/src/components/employee/v2/EmployeeWorkspace';
import { EMPTY_TEXT, LOCKED_TEXT } from '../../client/src/components/employee/v2/employeeWorkspaceModel';
import { businesses, dashboard, directView, emptyDashboard, lockedDashboard, noMorning, relayView } from './employee-v2-workspace-sample';

const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/** No NaN/undefined, no coordinates, no raw place IDs in visible text, no "hub". */
function expectClean(html: string) {
  const t = text(html);
  expect(html).not.toMatch(/NaN|undefined/);
  expect(t).not.toMatch(/-?\d{2}\.\d{3,}/); // latitude / longitude
  expect(t).not.toMatch(/\b(biz|home)-/);
  expect(html).not.toMatch(/\b(biz|home)-/); // not even in attributes (links use job / shipment IDs)
  expect(html).not.toMatch(/hub/i);
}

describe('EmployeeWorkspace static render', () => {
  const html = renderToStaticMarkup(
    <EmployeeWorkspace dashboard={dashboard} businesses={businesses} onEditCommute={() => {}} />,
  );
  const t = text(html);

  it('renders header, commute, assigned deliveries, earnings, completed, in that order', () => {
    const order = ['Maya Chen', 'Saved commute', 'Assigned deliveries', 'Earnings', 'Completed deliveries']
      .map((s) => t.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(t.indexOf('Acme Studio')).toBeLessThan(t.indexOf('Saved commute'));
  });

  it('shows both trips with mono times, route words and the detour limit', () => {
    expect(t).toContain('Evening Acme Studio → to Astoria');
    expect(t).toContain('Morning Astoria → to Acme Studio');
    expect(html).toContain('<span class="ew-mono">Departs 5:30 PM</span>');
    expect(html).toContain('<span class="ew-mono">34 min</span>');
    expect(html).toContain('<span class="ew-mono">8.4 km</span>');
    expect(t).toContain('Up to 15 min extra per trip');
    expect(html).toMatch(/<button type="button" class="ew-btn">Edit commute<\/button>/);
  });

  it('renders delivery rows with stops, relay wording, links and earnings', () => {
    expect(t).toContain('Fabric swatches');
    expect(t).toContain('Relay point: Corner Books');
    expect(t).toContain('Relay leg 2 of 2');
    expect(t).toContain('Direct');
    expect(html).toContain('href="/employee/emp-001?job=plan-shp-001-L0"');
    // "Watch in simulator" opens the package and plays its journey (DECISIONS pass 64); `&` is `&amp;` in markup.
    expect(html).toContain('href="/simulator?package=shp-001&amp;play=1"');
    expect(html).toContain('href="/simulator?package=shp-002&amp;play=1"');
    // One link per row, the completed delivery included, and none without play=1.
    expect(html.match(/href="\/simulator[^"]*"/g)).toStrictEqual(
      ['shp-001', 'shp-002', 'shp-003'].map((id) => `href="/simulator?package=${id}&amp;play=1"`),
    );
    expect(t).toContain('Earned $5.00');
    expect(t).toContain('Projected $20.00');
    expect(t).toContain('Signed contract');
    expect(html).not.toContain('class="ew-new"');
    expect(html).not.toContain(LOCKED_TEXT);
  });

  it('shows the home only as its neighborhood', () => {
    expect(t).toContain('Astoria');
    expect(html).not.toContain('home-story-maya');
  });

  it('is clean', () => expectClean(html));
});

describe('EmployeeWorkspace states', () => {
  it('empty deliveries', () => {
    const html = renderToStaticMarkup(<EmployeeWorkspace dashboard={emptyDashboard} businesses={businesses} />);
    expect(text(html)).toContain(EMPTY_TEXT); // #882: the title is its own element, the sentence after it
    expect(html).toContain('No completed deliveries yet.');
    expect(text(html)).toContain('Earned $0.00');
    expectClean(html);
  });

  it('locked phase shows one line and disables editing', () => {
    const html = renderToStaticMarkup(
      <EmployeeWorkspace dashboard={lockedDashboard} businesses={businesses} onEditCommute={() => {}} />,
    );
    expect(html.split(LOCKED_TEXT)).toHaveLength(2);
    // #745: the note names the simulator's "Back to start", the control that unlocks (#734, DECISIONS pass 74).
    expect(LOCKED_TEXT).toBe('The run is playing, so commute edits are closed until you press Back to start in the simulator.');
    expect(html).toMatch(/<p class="ew-locked" role="status">The run is playing[^<]*Back to start in the simulator\.<\/p>/);
    expect(html.split('Back to start')).toHaveLength(2);
    expect(html).not.toMatch(/planning cycle/i);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Edit commute/);
    expectClean(html);
  });

  it('editor slot replaces the commute summary', () => {
    const html = renderToStaticMarkup(
      <EmployeeWorkspace dashboard={dashboard} businesses={businesses} editor={<form data-testid="editor">EDITOR</form>} />,
    );
    expect(html).toContain('data-testid="editor"');
    expect(html).not.toContain('Saved commute');
    expect(html.indexOf('EDITOR')).toBeLessThan(html.indexOf('Assigned deliveries'));
    expectClean(html);
  });

  it('flags a row in newJobIds with "New"', () => {
    const html = renderToStaticMarkup(
      <EmployeeWorkspace dashboard={dashboard} businesses={businesses} newJobIds={new Set(['plan-shp-002-L1'])} />,
    );
    expect(html.match(/class="ew-new"/g)).toHaveLength(1);
    const row = html.match(/<li class="ew-row" data-job-id="plan-shp-002-L1">.*?<\/li>/)![0];
    expect(row).toContain('>New<');
    expectClean(html);
  });

  it('a leg shorter than the commute reads "3 min shorter" in its row, never "+-3 min" (#633)', () => {
    const plan = { ...directView.plan, legs: [{ ...directView.plan.legs[0], extraMin: -3 }] };
    const html = renderToStaticMarkup(
      <EmployeeWorkspace dashboard={{ ...dashboard, assigned: [{ ...directView, plan }, relayView] }} businesses={businesses} />,
    );
    const row = (id: string) => html.match(new RegExp(`<li class="ew-row" data-job-id="${id}">.*?</li>`))![0];
    expect(row(directView.job.id)).toContain('<dt>Extra time</dt><dd class="ew-mono">3 min shorter</dd>');
    expect(row(relayView.job.id)).toContain('<dt>Extra time</dt><dd class="ew-mono">+4 min</dd>');
    expect(html).not.toContain('+-');
    expectClean(html);
  });

  it('missing morning trip reads "Not available in the morning"', () => {
    const html = renderToStaticMarkup(<EmployeeWorkspace dashboard={noMorning} businesses={businesses} />);
    expect(html).toContain('Not available in the morning');
    expect(html).not.toContain('Edit commute'); // no handler, no action
    expectClean(html);
  });
});

describe('EmployeeWorkspace.css', () => {
  const css = readFileSync('client/src/components/employee/v2/EmployeeWorkspace.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('has a 390 px rule', () => expect(css).toMatch(/@media \(max-width: 390px\)/));

  it('no radius over 4px', () => {
    for (const m of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      for (const px of m[1].matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px[1])).toBeLessThanOrEqual(4);
      expect(m[1]).not.toMatch(/%|999|rem|em/);
    }
  });

  it('no shadows except a 1px focus ring, no gradients', () => {
    const shadows = [...css.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1]);
    for (const s of shadows) expect(s).toMatch(/^0 0 0 1px /);
    expect(css).not.toMatch(/gradient/i);
    expect(css).not.toMatch(/text-shadow/);
  });

  it(':focus-visible on links and buttons', () => {
    expect(css).toMatch(/\.ew a:focus-visible/);
    expect(css).toMatch(/\.ew button:focus-visible/);
  });

  it('reads tokens with fallbacks', () => {
    const bare = [...css.matchAll(/var\(--[a-z0-9-]+\)/g)];
    expect(bare).toHaveLength(0);
  });
});
