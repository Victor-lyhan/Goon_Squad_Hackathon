import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EarningsSummary } from '../../client/src/components/employee/EarningsSummary';
import { formatCents } from '../../client/src/ui/format';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { employeeDashboard } from '../../server/api/views';
import { snapshotAt } from '../../server/domain/simulation';

const run = createInitialRun(loadDefaultScenario());
const { employees, settings } = run.scenario;
const relay = run.assignments.plans.find((p) => p.kind === 'relay')!;
const firstId = relay.legs[0].employeeId;
const dropMin = run.events.find((e) => e.planId === relay.id && e.kind === 'hub_drop')!.timeMin;

function card(empId: string, t: number) {
  const d = employeeDashboard(run, snapshotAt(run, t), empId)!;
  const html = renderToStaticMarkup(<EarningsSummary earnedCents={d.earnedCents} assigned={d.assigned} completed={d.completed} />);
  const text = html.replace(/<[^>]*>/g, ' ');
  return { d, html, text };
}
const apiScheduled = (d: ReturnType<typeof card>['d']) => d.assigned.reduce((s, v) => s + v.job.rewardCents, 0);

describe('EarningsSummary with real Demo-city data', () => {
  it('at start: earned $0.00, no completed jobs, scheduled matches the API', () => {
    for (const e of employees) {
      const { d, html, text } = card(e.id, settings.simStartMin);
      expect(d.earnedCents).toBe(0);
      expect(html).toContain('$0.00');
      expect(html).toContain('No completed jobs yet');
      expect(text).toContain(formatCents(apiScheduled(d)));
      expect(html).not.toMatch(/NaN|undefined|null/);
    }
  });

  it('after the evening: relay first-leg employee is paid at hub drop', () => {
    const { d, html, text } = card(firstId, dropMin);
    expect(d.earnedCents).toBeGreaterThan(0);
    expect(text).toContain(formatCents(d.earnedCents));
    expect(d.completed.length).toBeGreaterThan(0);
    expect(html).not.toContain('No completed jobs yet');
    expect(html).toContain(`>${d.completed.length}<`);
    expect(html).not.toMatch(/NaN|undefined|null/);
  });

  it('at finish: totals match the API, nothing scheduled', () => {
    for (const e of employees) {
      const { d, html, text } = card(e.id, settings.simEndMin);
      expect(d.assigned).toHaveLength(0);
      expect(text).toContain(formatCents(d.earnedCents));
      expect(text).toContain(formatCents(0));
      expect(html).toContain(`>${d.completed.length}<`);
      expect(html).not.toMatch(/NaN|undefined|null/);
    }
  });

  it('uses a heading and labelled values', () => {
    const { html } = card(firstId, settings.simStartMin);
    expect(html).toMatch(/<h2[^>]*id="earnings-heading"/);
    expect(html).toContain('aria-labelledby="earnings-heading"');
    for (const l of ['Earned so far', 'Scheduled', 'Completed jobs']) expect(html).toMatch(new RegExp(`<dt[^>]*>${l}</dt><dd`));
  });
});

describe('employee portal CSS (390 px, keyboard, motion)', () => {
  const dir = 'client/src/components/employee/';
  const css = ['EmployeePortal.css', 'JobDetail.css', 'employee.css', 'CommuteEditor.css'].map((f) => readFileSync(dir + f, 'utf8')).join('\n');
  it('has narrow-screen rules, sticky Save, focus outlines and reduced motion', () => {
    expect(css).toMatch(/@media \(max-width: 600px\)/);
    expect(css).toMatch(/\.earnings__list \{ grid-template-columns: 1fr; \}/);
    expect(css).toMatch(/\.commute-editor__save \{ position: sticky/);
    expect(css).toMatch(/:focus-visible \{ outline: 3px/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/\.job-card \{ max-width: 100%; \}/);
  });
});
