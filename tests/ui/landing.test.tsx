import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../../client/src/App';
import { loadWorkspacePages } from './lazy-pages-helper';

// The workspace pages are lazy routes (#885): load them first, so a render shows the page, not the loading line.
await loadWorkspacePages();

/** The line the header's top right held until #854 (the homepage lost it in #833). */
const OLD_ENV_TEXT = 'Real NYC locations · simulated deliveries';

const render = (path: string) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <AppShell />
    </MemoryRouter>,
  );

describe('landing page', () => {
  const html = render('/');

  const body = /<main[^>]*>([\s\S]*)<\/main>/.exec(html)![1];

  it('shows the Watch a package button and the Business and Employee entries (#652)', () => {
    expect(body).toMatch(/<a [^>]*href="\/simulator"[^>]*>[\s\S]*?Watch a package<\/a>/);
    for (const t of ['Business', 'Employee']) expect(body).toContain(`<span class="workspace-title">${t}</span>`);
    expect(body).not.toContain('Guided demo');
  });

  it('shows no environment line on the homepage, header included (#833), and no MVP 1 step cards', () => {
    expect(html).not.toContain(OLD_ENV_TEXT);
    expect(html).not.toContain('class="panel step"');
  });
});

describe('shell', () => {
  it('keeps the header on other routes, without the badge (#854)', () => {
    const html = render('/simulator');
    expect(html).toContain('<header class="shell-header">');
    expect(html).not.toContain(OLD_ENV_TEXT);
    expect(html).toContain('Relay');
  });

  it('unknown routes link back home', () => {
    expect(render('/nope')).toContain('href="/"');
  });
});
