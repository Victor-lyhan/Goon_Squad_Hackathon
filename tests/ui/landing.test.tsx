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

  it('links to the three surfaces', () => {
    expect(html).toContain('Business portal');
    expect(html).toContain('href="/simulator"');
    expect(html).toContain('Business portal');
    expect(html).toContain('Employee portal');
  });

  it('shows the badge and three how-it-works steps', () => {
    expect(html).toContain(BADGE_TEXT);
    expect(html.match(/class="panel step"/g)).toHaveLength(3);
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
