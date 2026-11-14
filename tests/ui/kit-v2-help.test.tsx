import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../../client/src/App';

const render = (path: string) =>
  renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><AppShell initialV2={{ status: 'loading' }} initialV2Businesses={{ status: 'loading' }} /></MemoryRouter>);

describe('Guided demo', () => {
  it('unknown paths still render the 404 page', () => {
    expect(render('/help/extra')).toContain('Page not found');
    expect(render('/nowhere')).toContain('Page not found');
  });
  it('does not import from Landing', () => {
    expect(readFileSync('client/src/pages/Help.tsx', 'utf8')).not.toMatch(/from '\.\/Landing'/);
  });
});
