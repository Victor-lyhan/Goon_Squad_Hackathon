import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppShell, BADGE_TEXT } from '../../client/src/App';

const render = (path: string) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <AppShell />
    </MemoryRouter>,
  );

describe('landing page', () => {
  const html = render('/');

  it('shows the three workspace entries', () => {
    for (const t of ['01 / BUSINESS', '02 / EMPLOYEE', '03 / SIMULATOR']) expect(html).toContain(t);
    expect(html).toContain('href="/simulator"');
  });

  it('shows the badge and no how-it-works step cards', () => {
    expect(html).toContain(BADGE_TEXT);
    expect(html).not.toContain('class="panel step"');
  });
});

describe('shell', () => {
  it('keeps header and badge on other routes', () => {
    const html = render('/simulator');
    expect(html).toContain(BADGE_TEXT);
    expect(html).toContain('Relay');
  });

  it('unknown routes link back home', () => {
    expect(render('/nope')).toContain('href="/"');
  });
});
