import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Drawer } from '../../client/src/ui/Drawer';
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
  it('Drawer close button has an aria-label', () => {
    const html = renderToStaticMarkup(<Drawer open onClose={() => {}} title="Details">x</Drawer>);
    expect(html).toMatch(/<button[^>]*class="ui-drawer__close"[^>]*aria-label="Close"|<button[^>]*aria-label="Close"[^>]*class="ui-drawer__close"/);
  });
  it('css has focus-visible, reduced motion and 390px rules', () => {
    expect(css).toMatch(/\.ui-toast button:focus-visible/);
    expect(css).toMatch(/prefers-reduced-motion:reduce\)\{[^@]*\.ui-drawer[^@]*animation:none/);
    expect(css).toMatch(/max-width:480px\)\{[^@]*\.ui-drawer\{width:100vw/);
    expect(globalCss).toContain('prefers-reduced-motion: reduce');
    expect(globalCss).toContain('.demo-account select:focus-visible');
  });
});
