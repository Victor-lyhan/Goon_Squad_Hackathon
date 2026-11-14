import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Landing, { OperationalSummary, type SummaryFacts } from '../../client/src/pages/Landing';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { snapshotAt } from '../../server/domain/simulation';

const run = createInitialRun(loadDefaultScenario());
const { businesses, employees, hubs } = run.scenario;
const m = snapshotAt(run, run.clock.timeMin).metrics;
const ready: SummaryFacts = {
  status: 'ready', businesses: businesses.length, commuters: employees.length,
  relayPoints: hubs.length, matched: m.matched, requested: m.requested,
};

const page = (props: Parameters<typeof Landing>[0]) =>
  renderToStaticMarkup(<MemoryRouter><Landing {...props} /></MemoryRouter>);

const workspaceLinks = (html: string) =>
  [...html.matchAll(/<a ([^>]*)>(.*?)<\/a>/g)]
    .filter((x) => /class="workspace-entry"/.test(x[1]))
    .map((x) => ({ href: /href="([^"]*)"/.exec(x[1])?.[1], body: x[2] }));

describe('MVP II homepage with real Demo city data', () => {
  const html = page({ initial: { businesses, employees }, initialFacts: ready });

  it('shows the introduction heading', () => {
    expect(html).toContain('Delivery infrastructure, powered by existing commutes.');
  });

  it('shows the four live summary numbers from the run', () => {
    const values = [...html.matchAll(/<dd class="op-summary-value">([^<]*)<\/dd>/g)].map((x) => x[1]);
    expect(values).toEqual([
      String(businesses.length), String(employees.length), String(hubs.length), `${m.matched} / ${m.requested}`,
    ]);
  });

  it('has exactly three workspace links in order Business, Employee, Simulator', () => {
    const links = workspaceLinks(html);
    expect(links).toHaveLength(3);
    expect(links[0].href).toBe(`/business/${encodeURIComponent(businesses[0].id)}`);
    expect(links[1].href).toBe(`/employee/${encodeURIComponent(employees[0].id)}`);
    expect(links[2].href).toBe('/simulator');
    ['Business', 'Employee', 'Simulator'].forEach((t, i) => {
      expect(links[i].body).toContain(`>${t}</h2>`);
      expect(links[i].body).toContain('Open workspace');
    });
  });

  it('has the minimal footer with a Guided demo link', () => {
    expect(html).toContain('Simulated environment. No real deliveries are made.');
    expect(html).toMatch(/<a [^>]*href="\/help"[^>]*>Guided demo<\/a>/);
  });

  it('contains none of the removed content or broken values', () => {
    expect(html).not.toContain('Run the demo');
    expect(html).not.toContain('Current city');
    expect(html).not.toMatch(/<h2[^>]*>(Commute|Match|Simulated delivery)<\/h2>/);
    expect(html).not.toMatch(/NaN|undefined/);
    const nodeIds = new Set<string>([
      ...businesses.map((b) => b.nodeId), ...employees.map((e) => e.homeNodeId), ...hubs.map((h) => h.nodeId),
    ]);
    const text = html.replace(/<[^>]+>/g, ' ');
    for (const id of nodeIds) expect(text).not.toMatch(new RegExp(`(^|\\s)${id}(\\s|$)`));
  });
});

describe('loading and error states', () => {
  it('loading: placeholders, Business/Employee not clickable, Simulator still a link', () => {
    const h = page({});
    expect(h).toContain('is-placeholder');
    expect(h).not.toMatch(/NaN|undefined/);
    expect(h).not.toContain('href="/business/');
    expect(h).not.toContain('href="/employee/');
    expect(h.match(/aria-disabled="true"/g)).toHaveLength(2);
    expect(workspaceLinks(h).map((l) => l.href)).toEqual(['/simulator']);
    expect(h.match(/Open workspace/g)).toHaveLength(3);
  });

  it('error: summary says Live numbers unavailable', () => {
    const h = renderToStaticMarkup(<OperationalSummary facts={{ status: 'error' }} />);
    expect(h).toContain('Live numbers unavailable');
    expect(h).not.toMatch(/NaN|undefined/);
  });

  it('empty city: no portal links to unknown IDs', () => {
    const h = page({ initial: { businesses: [], employees: [] }, initialFacts: { status: 'error' } });
    expect(h).toContain('Live numbers unavailable');
    expect(h).not.toContain('href="/business/');
    expect(h).not.toContain('href="/employee/');
  });

  it('never prints NaN for bad numbers', () => {
    const h = renderToStaticMarkup(<OperationalSummary facts={{ ...ready, matched: Number.NaN } as SummaryFacts} />);
    expect(h).not.toContain('NaN');
  });
});

describe('landing.css rules', () => {
  const css = readFileSync('client/src/styles/landing.css', 'utf8');
  it('stacks the three entries in one column at 390 px', () => {
    const narrow = [...css.matchAll(/@media \(max-width: (\d+)px\) \{([\s\S]*?)\n\}/g)]
      .filter((x) => Number(x[1]) >= 390)
      .map((x) => x[2]).join('\n');
    expect(narrow).toMatch(/\.workspaces \{ grid-template-columns: 1fr; \}/);
  });
  it('no radius over 4px, no shadows, no gradients', () => {
    for (const [, v] of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      const px = [...v.matchAll(/(\d+(?:\.\d+)?)px/g)].map((x) => Number(x[1]));
      expect(px.every((n) => n <= 4)).toBe(true);
      expect(v).not.toMatch(/%|rem|em\b/);
    }
    expect(css).not.toContain('box-shadow');
    expect(css).not.toContain('gradient');
    expect(css).toContain(':focus-visible');
  });
});
