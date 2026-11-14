import { readdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommuteRoutePreview } from '../../client/src/components/employee/v2/route/CommuteRoutePreview';
import { BUSINESSES, DASHBOARD, HOME, JOB, MAP, TRIPS, WORK, withLine } from './employee-v2-route-sample';

const DIR = 'client/src/components/employee/v2/route';
const V2_DIR = 'client/src/components/employee/v2';
const legendOf = (html: string) => html.match(/<ul class="ecr__legend"[\s\S]*?<\/ul>/)![0];
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const render = (over: Partial<Parameters<typeof CommuteRoutePreview>[0]> = {}) => renderToStaticMarkup(
  <CommuteRoutePreview employee={DASHBOARD.employee} home={HOME} trips={TRIPS} businesses={BUSINESSES} map={MAP} {...over} />,
);

beforeEach(() => vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', ''));
afterEach(() => vi.unstubAllEnvs());

describe('CommuteRoutePreview', () => {
  it('with no job: both directions as text next to the key-missing map, no departure, and a legend of the commute only (#626)', () => {
    const html = render();
    const t = text(html);
    expect(t).toContain('Google Maps key missing.'); // the map cannot load: the text still names both directions
    expect(t).toContain('Evening: 34 min, 9.8 km');
    expect(t).toContain('Morning: 31 min, 9.7 km');
    expect(t).not.toMatch(/leaves|\d:\d\d|[AP]M\b|[ap]\.m\./); // the commute card has the departures
    const legend = legendOf(html);
    expect(legend.match(/<li>/g)).toHaveLength(1);
    expect(text(legend)).toBe('Your normal commute');
    expect(t).not.toContain('Delivery route');
    expect(t).not.toContain('Route line not loaded yet');
    expect(html).not.toMatch(/NaN|undefined/);
  });

  it('with a job open the legend lists "Delivery route" and the lines give the departure as "5:30 PM" (#626)', () => {
    const html = render({ job: JOB });
    const legend = legendOf(html);
    expect(legend.match(/<li>/g)).toHaveLength(2);
    expect(text(legend)).toBe('Your normal commute Delivery route');
    const t = text(html);
    expect(t).toContain('Evening: leaves 5:30 PM, 34 min, 9.8 km');
    expect(t).toContain('Morning: leaves 8:30 AM, 31 min, 9.7 km');
    expect(t).not.toMatch(/[ap]\.m\./);
  });

  it('a job with no leg line drawn gets no "Delivery route" in the legend (#626)', () => {
    const commuteLines = { ...MAP, polylines: MAP.polylines.slice(0, 2) };
    const html = render({ job: JOB, map: commuteLines });
    expect(text(legendOf(html))).toBe('Your normal commute');
    expect(text(html)).toContain('Route line not loaded yet');
    expect(text(html)).toContain('1 Pickup · Bakery Row'); // the stops stay as text
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
    expect(t).toContain('Evening: leaves 5:30 PM, 34 min, 9.8 km');
    expect(text(legendOf(html))).toBe('Your normal commute'); // no leg is drawn while the map loads
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

  it('no "a.m." or "p.m." in any file under the Employee v2 folder (#626, DECISIONS pass 60)', () => {
    const files = (readdirSync(V2_DIR, { recursive: true }) as string[]).filter((f) => /\.(ts|tsx|css)$/.test(f));
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith('commuteRouteModel.ts'))).toBe(true);
    for (const f of files) {
      expect(readFileSync(`${V2_DIR}/${f}`, 'utf8'), f).not.toMatch(/\b[ap]\.m\./i);
    }
  });

  it('the model takes its clock and duration from client/src/ui/format.ts', () => {
    const src = readFileSync(`${DIR}/commuteRouteModel.ts`, 'utf8');
    expect(src).toMatch(/import \{ formatClock, formatDuration \} from '..\/..\/..\/..\/ui\/format'/);
    expect(src).not.toMatch(/clockText|durationText/);
  });

  it('is not ignored by git, so the source files reach the commit', () => {
    const ignored = execSync(`git check-ignore ${DIR}/commuteRouteModel.ts ${DIR}/CommuteRoutePreview.tsx ${DIR}/commuteRoute.css || true`, { encoding: 'utf8' });
    expect(ignored.trim()).toBe('');
  });
});
