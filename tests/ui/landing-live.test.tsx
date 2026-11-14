import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Landing from '../../client/src/pages/Landing';

describe('landing headings', () => {
  it('one h1 and ordered headings', () => {
    const h = renderToStaticMarkup(<MemoryRouter><Landing /></MemoryRouter>);
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
