import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LEFT_BODY_ID, RIGHT_BODY_ID, SimWorkspace } from '../../client/src/components/sim/v2/SimWorkspace';
import { PanelSection } from '../../client/src/components/sim/v2/PanelSection';

const tags = (h: string, t: string) => h.match(new RegExp(`<${t}\\b[^>]*>`, 'g')) ?? [];
const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
const toggles = (h: string) => tags(h, 'button').filter((t) => t.includes('class="sw-toggle"'));
const bodyTag = (h: string, id: string) => tags(h, 'div').find((t) => t.includes(`id="${id}"`));

const slots = {
  map: <div data-testid="map-slot">MAP</div>,
  left: <div data-testid="left-slot">LEFT</div>,
  right: <div data-testid="right-slot">RIGHT</div>,
};

describe('SimWorkspace frame', () => {
  const html = renderToStaticMarkup(<SimWorkspace {...slots} onClearSelection={() => {}} />);

  it('renders the map slot and both panels with their contents', () => {
    expect(html).toContain('data-testid="map-slot"');
    expect(html).toContain('data-testid="left-slot"');
    expect(html).toContain('data-testid="right-slot"');
    expect(html).toContain('aria-label="Controls panel"');
    expect(html).toContain('aria-label="Inspector panel"');
  });

  it('has a labelled toggle per panel with aria-expanded and aria-controls', () => {
    const t = toggles(html);
    expect(t).toHaveLength(2);
    expect(t.map((x) => attr(x, 'aria-expanded'))).toEqual(['true', 'true']);
    expect(t.map((x) => attr(x, 'aria-controls'))).toEqual([LEFT_BODY_ID, RIGHT_BODY_ID]);
    expect(html).toMatch(/class="sw-toggle-text">Controls</);
    expect(html).toMatch(/class="sw-toggle-text">Inspector</);
    expect(bodyTag(html, LEFT_BODY_ID)).not.toContain('hidden');
    expect(bodyTag(html, RIGHT_BODY_ID)).not.toContain('hidden');
  });

  it('puts the map between the panels and nothing above the map', () => {
    const left = html.indexOf('aria-label="Controls panel"');
    const map = html.indexOf('data-testid="map-slot"');
    const right = html.indexOf('aria-label="Inspector panel"');
    expect(left).toBeLessThan(map);
    expect(map).toBeLessThan(right);
    expect(html).not.toMatch(/class="mc[ "-]/);
    expect(html).not.toContain('<h1');
  });

  it('includes the narrow-screen message in the markup', () => {
    expect(html).toContain('Open the simulator on a desktop-size screen.');
    expect(html).toContain('class="sw-frame"');
    expect(html).toContain('class="sw-narrow"');
  });

  it('collapses both panels to rails that keep their toggles', () => {
    const c = renderToStaticMarkup(
      <SimWorkspace {...slots} initialPanels={{ leftOpen: false, rightOpen: false }} />,
    );
    const t = toggles(c);
    expect(t).toHaveLength(2);
    expect(t.map((x) => attr(x, 'aria-expanded'))).toEqual(['false', 'false']);
    expect(bodyTag(c, LEFT_BODY_ID)).toMatch(/\bhidden=""/);
    expect(bodyTag(c, RIGHT_BODY_ID)).toMatch(/\bhidden=""/);
    expect(c).toContain('data-testid="map-slot"');
    expect((c.match(/is-collapsed/g) ?? []).length).toBe(2);
  });

  it('collapses one side without touching the other', () => {
    const c = renderToStaticMarkup(<SimWorkspace {...slots} initialPanels={{ leftOpen: true, rightOpen: false }} />);
    expect(toggles(c).map((x) => attr(x, 'aria-expanded'))).toEqual(['true', 'false']);
    expect(bodyTag(c, LEFT_BODY_ID)).not.toContain('hidden');
    expect(bodyTag(c, RIGHT_BODY_ID)).toMatch(/\bhidden=""/);
  });
});

describe('SimWorkspace journey frame', () => {
  it('shows the package title and a Back to network button at the top of the left panel', () => {
    const html = renderToStaticMarkup(
      <SimWorkspace {...slots} journey={{ title: 'Gift box for Chelsea office', onExit: () => {} }} />,
    );
    expect(html).toContain('Gift box for Chelsea office');
    expect(html).toMatch(/<button[^>]*>(<span[^>]*>[^<]*<\/span>)?Back to network<\/button>/);
    const body = html.slice(html.indexOf(`id="${LEFT_BODY_ID}"`));
    expect(body.indexOf('Gift box for Chelsea office')).toBeLessThan(body.indexOf('data-testid="left-slot"'));
  });

  it('has no journey header in network mode', () => {
    const html = renderToStaticMarkup(<SimWorkspace {...slots} />);
    expect(html).not.toContain('Back to network');
  });
});

describe('PanelSection', () => {
  it('renders a titled section labelled by its heading', () => {
    const html = renderToStaticMarkup(<PanelSection title="Planning cycle"><p>body</p></PanelSection>);
    expect(html).toContain('<section class="sw-section" aria-labelledby="sw-section-planning-cycle">');
    expect(html).toContain('id="sw-section-planning-cycle">Planning cycle</h2>');
    expect(html).toContain('<p>body</p>');
  });
});

describe('SimWorkspace.css', () => {
  const css = readFileSync('client/src/components/sim/v2/SimWorkspace.css', 'utf8');
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('keeps corners square: no border-radius over 4px', () => {
    const radii = [...noComments.matchAll(/border-radius\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(radii.length).toBeGreaterThan(0);
    for (const r of radii) {
      for (const px of r.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px[1]), r).toBeLessThanOrEqual(4);
      expect(r).not.toMatch(/%|em\b|rem\b/);
    }
  });

  it('has no shadows or gradients', () => {
    expect(noComments).not.toMatch(/box-shadow/);
    expect(noComments).not.toMatch(/gradient/);
  });

  it('styles keyboard focus on the toggles', () => {
    expect(noComments).toMatch(/\.sw-toggle:focus-visible\s*\{[^}]*outline/);
  });

  it('removes the collapse transition for reduced motion', () => {
    expect(noComments).toMatch(/\.sw-panel\s*\{[^}]*transition:\s*width/);
    const rm = noComments.slice(noComments.indexOf('prefers-reduced-motion'));
    expect(rm).toMatch(/\.sw-panel\s*\{\s*transition:\s*none/);
  });

  it('shows only the desktop message below 900px', () => {
    const mq = noComments.slice(noComments.indexOf('@media (max-width: 899px)'));
    expect(mq).toMatch(/\.sw-frame\s*\{\s*display:\s*none/);
    expect(mq).toMatch(/\.sw-narrow\s*\{[^}]*display:\s*flex/);
  });
});
