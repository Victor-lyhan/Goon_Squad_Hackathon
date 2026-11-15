import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Landing, { LANDING_SENTENCE, OperationalSummary, WORKSPACES, type SummaryFacts } from '../../client/src/pages/Landing';
import type { NycSummary } from '../../client/src/pages/landingModel';

const ready: SummaryFacts = { status: 'ready', businesses: 18, commuters: 60, matched: 24, requested: 24 };

const page = (props: Parameters<typeof Landing>[0]) =>
  renderToStaticMarkup(<MemoryRouter><Landing {...props} /></MemoryRouter>);

const workspaceLinks = (html: string) =>
  [...html.matchAll(/<a ([^>]*)>(.*?)<\/a>/g)]
    .filter((x) => /class="workspace-entry"/.test(x[1]))
    .map((x) => ({ href: /href="([^"]*)"/.exec(x[1])?.[1], body: x[2] }));
const text = (html: string) => html.replace(/<[^>]+>/g, '');

describe('homepage content (docs/mvp3.md P4)', () => {
  const summary: NycSummary = { ...ready, businessIds: ['biz-a', 'biz-b'], employeeIds: ['emp-a', 'emp-b'], watchPackageId: 'shp-3' };
  const html = page({ initialSummary: summary });

  it('says what Relay does in one sentence, as the only heading', () => {
    expect(LANDING_SENTENCE).toBe('Relay moves packages between businesses on employees’ existing commutes.');
    expect(LANDING_SENTENCE.match(/[.!?]/g)).toHaveLength(1);
    const intro = /<section class="landing-intro">([\s\S]*?)<\/section>/.exec(html)![1];
    expect(intro.startsWith(`<h1>${LANDING_SENTENCE}</h1>`)).toBe(true);
    expect(html.match(/<h[1-6]/g)).toEqual(['<h1']);
    // nothing else in the introduction but the button: no second paragraph, no environment line (#610)
    expect(intro).not.toMatch(/<p[ >]/);
    expect(text(intro)).toBe(`${LANDING_SENTENCE}Watch a package`);
  });

  it('has the parts in order: the sentence, the button, Business and Employee, the stats line', () => {
    const at = ['<h1>', 'class="watch-button"', 'class="workspaces"', 'class="op-summary"']
      .map((part) => html.indexOf(part));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('ends with the stats line: the environment line is the header\'s, the page has no footer (#724)', () => {
    expect(html).not.toContain('Real NYC locations · simulated deliveries');
    expect(html).not.toContain('<footer');
    expect(html.endsWith('</section></div>')).toBe(true);
  });

  it('has exactly two smaller entries, Business then Employee, each one link with a short line', () => {
    expect(WORKSPACES.map((w) => w.key)).toEqual(['business', 'employee']);
    const links = workspaceLinks(html);
    expect(links).toHaveLength(2);
    expect(links[0].href).toBe('/business/biz-a');
    expect(links[1].href).toBe('/employee/emp-a');
    ['Business', 'Employee'].forEach((t, i) => {
      expect(links[i].body).toContain(`<span class="workspace-title">${t}</span>`);
      expect(text(links[i].body)).toBe(`${t}${WORKSPACES[i].text}→`);
      expect(WORKSPACES[i].text.length).toBeLessThanOrEqual(40);
    });
    expect(html.match(/<a /g)).toHaveLength(3); // the button and the two entries, nothing else
  });

  it('contains none of the removed content or broken values', () => {
    for (const gone of ['Guided demo', '/help', 'Open workspace', '03 / SIMULATOR', 'Run the demo', 'Current city']) {
      expect(html, gone).not.toContain(gone);
    }
    expect(html).not.toMatch(/NaN|undefined/);
  });

  it('takes no helpPath prop and exports no HELP_PATH (#652)', () => {
    const src = readFileSync('client/src/pages/Landing.tsx', 'utf8');
    expect(src).not.toMatch(/helpPath|HELP_PATH|Guided demo/);
    // @ts-expect-error the prop is gone
    page({ helpPath: '/somewhere' });
  });
});

describe('the stats line', () => {
  const line = (facts: SummaryFacts) => renderToStaticMarkup(<OperationalSummary facts={facts} />);

  it('ready: three facts in one list', () => {
    const h = line(ready);
    expect(h.match(/<li>/g)).toHaveLength(3);
    expect(text(h)).toBe('18 businesses60 commuters24 of 24 packages matched');
    expect(h).not.toContain('aria-busy');
  });

  it('loading: placeholders, Business and Employee not clickable, the button still a link', () => {
    const h = page({});
    expect(h).toContain('is-placeholder');
    expect(h).not.toMatch(/NaN|undefined/);
    expect(h).not.toContain('href="/business/');
    expect(h).not.toContain('href="/employee/');
    expect(h.match(/aria-disabled="true"/g)).toHaveLength(2);
    expect(workspaceLinks(h)).toEqual([]);
    expect(h).toMatch(/<a [^>]*class="watch-button"[^>]*href="\/simulator"|<a [^>]*href="\/simulator"[^>]*class="watch-button"/);
  });

  it('error: one line, Live numbers unavailable', () => {
    const h = line({ status: 'error' });
    expect(text(h)).toBe('Live numbers unavailable');
    expect(h).not.toMatch(/NaN|undefined|<li/);
  });

  it('never prints NaN for bad numbers', () => {
    const h = line({ ...ready, matched: Number.NaN } as SummaryFacts);
    expect(h).not.toContain('NaN');
    expect(text(h)).toContain('– of 24 packages matched');
  });
});

describe('landing.css rules', () => {
  const css = readFileSync('client/src/styles/landing.css', 'utf8');
  const narrow = [...css.matchAll(/@media \(max-width: (\d+)px\) \{([\s\S]*?)\n\}/g)]
    .filter((x) => Number(x[1]) >= 390)
    .map((x) => x[2]).join('\n');

  it('stacks the two entries in one column and gives the button the full width at 390 px', () => {
    expect(narrow).toMatch(/\.workspaces \{ grid-template-columns: 1fr; \}/);
    expect(narrow).toMatch(/\.watch-button \{ display: flex; \}/);
    expect(narrow).toMatch(/\.op-summary \{ font-size: var\(--text-xs, 12px\); \}/); // the stats fit one line
  });
  it('the button is large and has a visible focus ring of its own', () => {
    expect(css).toMatch(/\.watch-button \{[^}]*min-height: 56px/);
    expect(css).toMatch(/\.watch-button \{[^}]*font-size: var\(--text-lg, 18px\)/);
    const ring = /\.watch-button:focus-visible \{([^}]*)\}/.exec(css)![1];
    expect(ring).toMatch(/outline: 3px solid var\(--text, #171C24\)/);
    expect(ring).toMatch(/outline-offset: 3px/);
    expect(css).not.toMatch(/outline:\s*(none|0)\b/);
  });
  it('the entries are smaller than the button', () => {
    expect(css).toMatch(/\.workspace-title \{[^}]*font-size: var\(--text-md, 14px\)/);
    expect(css).not.toMatch(/\.workspace-entry \{[^}]*min-height/);
  });
  it('keeps the stats on one line: a flex row whose facts do not break inside', () => {
    expect(css).toMatch(/\.op-summary-list \{[^}]*display: flex/);
    expect(css).toMatch(/\.op-summary-list li \{[^}]*white-space: nowrap/);
    expect(css).not.toContain('op-summary-hint');
    expect(css).not.toContain('landing-indicator');
  });
  it('no radius over 6px (docs/mvp3.md P4), no shadows, no gradients', () => {
    for (const [, v] of css.matchAll(/border-radius:\s*([^;]+);/g)) {
      const px = [...v.matchAll(/(\d+(?:\.\d+)?)px/g)].map((x) => Number(x[1]));
      expect(px.every((n) => n <= 6)).toBe(true);
      expect(v).not.toMatch(/%|rem|em\b/);
    }
    expect(css).not.toContain('box-shadow');
    expect(css).not.toContain('gradient');
    expect(css).toContain(':focus-visible');
  });
});
