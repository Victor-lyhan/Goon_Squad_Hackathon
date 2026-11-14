import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Landing, { OperationalSummary, type SummaryFacts } from '../../client/src/pages/Landing';
import type { NycSummary } from '../../client/src/pages/landingModel';

const ready: SummaryFacts = { status: 'ready', businesses: 18, commuters: 60, relayPoints: 18, matched: 24, requested: 24 };

const page = (props: Parameters<typeof Landing>[0]) =>
  renderToStaticMarkup(<MemoryRouter><Landing {...props} /></MemoryRouter>);

const workspaceLinks = (html: string) =>
  [...html.matchAll(/<a ([^>]*)>(.*?)<\/a>/g)]
    .filter((x) => /class="workspace-entry"/.test(x[1]))
    .map((x) => ({ href: /href="([^"]*)"/.exec(x[1])?.[1], body: x[2] }));

describe('homepage content', () => {
  const summary: NycSummary = { ...ready, businessIds: ['biz-a', 'biz-b'], employeeIds: ['emp-a', 'emp-b'] };
  const html = page({ initialSummary: summary });

  it('shows the introduction heading', () => {
    expect(html).toContain('Delivery infrastructure, powered by existing commutes.');
  });

  it('has exactly three workspace links in order Business, Employee, Simulator', () => {
    const links = workspaceLinks(html);
    expect(links).toHaveLength(3);
    expect(links[0].href).toBe('/business/biz-a');
    expect(links[1].href).toBe('/employee/emp-a');
    expect(links[2].href).toBe('/simulator');
    ['Business', 'Employee', 'Simulator'].forEach((t, i) => {
      expect(links[i].body).toContain(`>${t}</h2>`);
      expect(links[i].body).toContain('Open workspace');
    });
  });

  it('contains none of the removed content or broken values', () => {
    expect(html).not.toContain('Run the demo');
    expect(html).not.toContain('Current city');
    expect(html).not.toMatch(/<h2[^>]*>(Commute|Match|Simulated delivery)<\/h2>/);
    expect(html).not.toMatch(/NaN|undefined/);
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
