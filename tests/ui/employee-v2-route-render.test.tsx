import { readdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommuteRoutePreview } from '../../client/src/components/employee/v2/route/CommuteRoutePreview';
import { BUSINESSES, DASHBOARD, HOME, JOB, MAP, TRIPS, WORK, withLine } from './employee-v2-route-sample';

const DIR = 'client/src/components/employee/v2/route';
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const render = (over: Partial<Parameters<typeof CommuteRoutePreview>[0]> = {}) => renderToStaticMarkup(
  <CommuteRoutePreview employee={DASHBOARD.employee} home={HOME} trips={TRIPS} businesses={BUSINESSES} map={MAP} {...over} />,
);

beforeEach(() => vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', ''));
afterEach(() => vi.unstubAllEnvs());

describe('CommuteRoutePreview', () => {
  it('shows the summary lines and the two-item legend next to the key-missing map', () => {
    const html = render();
    const t = text(html);
    expect(t).toContain('Google Maps key missing.');
    expect(t).toContain('Evening: leaves 5:30 p.m., 34 min, 9.8 km');
    expect(t).toContain('Morning: leaves 8:30 a.m., 31 min, 9.7 km');
    const legend = html.match(/<ul class="ecr__legend"[\s\S]*?<\/ul>/)![0];
    expect(legend.match(/<li>/g)).toHaveLength(2);
    expect(text(legend)).toBe('Your normal commute Delivery route');
    expect(t).not.toContain('Route line not loaded yet');
    expect(html).not.toMatch(/NaN|undefined/);
  });

  it('shows the note when a commute line is not cached', () => {
    expect(text(render({ map: withLine(WORK.id, HOME.id, null) }))).toContain('Route line not loaded yet');
  });

  it('lists the numbered stops as text under the map with a job', () => {
    const t = text(render({ job: JOB }));
    expect(t).toContain('1 Pickup · Bakery Row');
    expect(t).toContain('2 Drop at relay point · Atlas Books');
    expect(t.indexOf('1 Pickup')).toBeLessThan(t.indexOf('2 Drop at relay point'));
  });

  it('with map null shows the summary and "Loading map…"', () => {
    const html = render({ map: null, job: JOB });
    const t = text(html);
    expect(t).toContain('Loading map…');
    expect(t).toContain('Evening: leaves 5:30 p.m., 34 min, 9.8 km');
    expect(t).toContain('1 Pickup · Bakery Row');
    expect(t).not.toContain('Google Maps key missing.');
  });

  it('never shows an address, a raw place ID or coordinates as text', () => {
    const t = text(render({ job: JOB }));
    expect(t).not.toContain('Sample Ave');
    expect(t).not.toMatch(/\b(biz|home)-[a-z0-9]/i);
    expect(t).not.toContain('40.7');
  });
});

describe('route folder', () => {
  it('has no "hub" or "synthetic" in any file', () => {
    for (const f of readdirSync(DIR)) {
      const src = readFileSync(`${DIR}/${f}`, 'utf8').toLowerCase();
      expect(src, f).not.toContain('hub');
      expect(src, f).not.toContain('synthetic');
    }
  });

  it('is not ignored by git, so the source files reach the commit', () => {
    const ignored = execSync(`git check-ignore ${DIR}/commuteRouteModel.ts ${DIR}/CommuteRoutePreview.tsx ${DIR}/commuteRoute.css || true`, { encoding: 'utf8' });
    expect(ignored.trim()).toBe('');
  });
});
