// @vitest-environment jsdom
// Issue #626: when Google refuses the browser key the map area says so (a status since #890), and the text under it
// still names both commute directions. On the workspace it repeats no departure (the commute card
// has them) and the legend lists only the commute. The Google loader is faked; no network, no key.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUSINESSES, DASHBOARD, HOME, JOB, MAP, TRIPS } from './employee-v2-route-sample';
import { flush, mount } from './kitDom';

vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: () => {},
  importLibrary: () => new Promise(() => {}), // the load never ends: Google answers with gm_authFailure
}));

type W = { gm_authFailure?: unknown };
const win = () => window as unknown as W;

beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', 'TEST-ONLY-NOT-A-REAL-KEY-626');
  delete win().gm_authFailure;
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete win().gm_authFailure;
});

async function refusedPreview(job: typeof JOB | null) {
  vi.resetModules(); // the "key already rejected on this page" flag lives in the map module
  const { CommuteRoutePreview } = await import('../../client/src/components/employee/v2/route/CommuteRoutePreview');
  const m = mount(
    <CommuteRoutePreview employee={DASHBOARD.employee} home={HOME} trips={TRIPS} businesses={BUSINESSES} map={MAP} job={job} />,
  );
  await flush();
  act(() => { (win().gm_authFailure as () => void)(); });
  return m.container;
}
// #890: the map says it in its placeholder's status region; nothing on the map is an alert any more.
const notice = (root: Element) => {
  expect(root.querySelector('[role="alert"]')).toBeNull();
  return root.querySelector('.ecr__map .map-v2__state-text[role="status"]')!.textContent;
};
const items = (root: Element, selector: string) => [...root.querySelectorAll(`${selector} li`)].map((li) => li.textContent!.trim());

describe('CommuteRoutePreview when Google refuses the key', () => {
  it('on the workspace: the notice, both directions as text with no departure, the commute alone in the legend', async () => {
    const root = await refusedPreview(null);
    expect(notice(root)).toContain('Google rejected the browser key.');
    expect(items(root, '.ecr__summary')).toEqual(['Evening: 34 min, 9.8 km', 'Morning: 31 min, 9.7 km']);
    expect(items(root, '.ecr__legend')).toEqual(['Your normal commute']);
  });

  it('with a job open: both directions with their departure, the stops, and "Delivery route" in the legend', async () => {
    const root = await refusedPreview(JOB);
    expect(notice(root)).toContain('Google rejected the browser key.');
    expect(items(root, '.ecr__summary')).toEqual([
      'Evening: leaves 5:30 PM, 34 min, 9.8 km',
      'Morning: leaves 8:30 AM, 31 min, 9.7 km',
    ]);
    expect(items(root, '.ecr__stops')).toEqual(['1 Pickup · Bakery Row', '2 Drop at relay point · Atlas Books']);
    expect(items(root, '.ecr__legend')).toEqual(['Your normal commute', 'Delivery route']);
  });
});
