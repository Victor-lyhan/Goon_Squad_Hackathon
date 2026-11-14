import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Spinner } from '../../client/src/ui/Spinner';

const css = readFileSync('client/src/ui/ui.css', 'utf8');
const globalCss = readFileSync('client/src/styles/global.css', 'utf8');

describe('kit accessibility', () => {
  it('Spinner keeps a text label', () => {
    const html = renderToStaticMarkup(<Spinner label="Matching" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('>Matching<');
    expect(renderToStaticMarkup(<Spinner />)).toContain('>Loading<');
  });
  it('css has focus-visible and reduced motion rules', () => {
    expect(css).toMatch(/\.ui-btn:focus-visible/);
    expect(css).toMatch(/prefers-reduced-motion:reduce\)\{[^@]*\.ui-spinner\{animation:none/);
    expect(globalCss).toContain('prefers-reduced-motion: reduce');
    expect(globalCss).toContain('.demo-account select:focus-visible');
  });
});
