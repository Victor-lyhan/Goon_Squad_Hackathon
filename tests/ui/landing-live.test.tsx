import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Landing from '../../client/src/pages/Landing';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { generateScenario } from '../../server/domain/generator';

const page = (scenario: { businesses: any[]; employees: any[] }) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <Landing initial={{ businesses: scenario.businesses, employees: scenario.employees }} />
    </MemoryRouter>,
  );

describe('landing workspace links use IDs from the current city', () => {
  const demo = createInitialRun(loadDefaultScenario()).scenario;
  const random = generateScenario({ seed: 7, employees: 40, packages: 30, hubs: 3, maxExtraMin: 15, preset: 'random' });
  const cities: [string, typeof demo][] = [['Demo city', demo], ['random city', random]];
  for (const [name, sc] of cities) {
    it(`${name}: workspace entries point at the first business/employee`, () => {
      const h = page(sc);
      expect(h).toContain(`href="/business/${encodeURIComponent(sc.businesses[0].id)}"`);
      expect(h).toContain(`href="/employee/${encodeURIComponent(sc.employees[0].id)}"`);
    });
  }
  it('one h1 and ordered headings', () => {
    const h = page(demo);
    expect(h.match(/<h1/g)).toHaveLength(1);
    expect(h.indexOf('<h1')).toBeLessThan(h.indexOf('<h2'));
    expect(h).not.toMatch(/<h3/);
  });
});

describe('landing 390 px css', () => {
  const css = readFileSync('client/src/styles/landing.css', 'utf8');
  it('has a narrow media query and visible focus', () => {
    expect(css).toMatch(/@media \(max-width: 480px\)/);
    expect(css).toContain('focus-visible');
    expect(css).toContain('flex-wrap: wrap');
  });
});
