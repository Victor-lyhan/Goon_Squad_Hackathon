// @vitest-environment jsdom
// #610: the homepage recovers by itself. Mounted in a real DOM on a fake fetch: the API is down (or answers
// 503) on the first load, the page shows the failure and disabled entries, and after the retry the numbers
// show and Business and Employee are links, with no reload. Unmounting during the wait asks for nothing more.
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Landing from '../../client/src/pages/Landing';
import { NYC_UNAVAILABLE_TEXT } from '../../client/src/pages/landingModel';
import { mount, textOf } from './kitDom';
import { businesses, employees, simulator, travelMissingBody } from './landing-nyc-sample';

const BODIES: Record<string, unknown> = {
  '/api/v2/businesses': businesses, '/api/v2/employees': employees, '/api/v2/simulator': simulator,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Moves fake time by `ms`, runs the promises it settles, then flushes React (kitDom's flush needs real timers). */
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const until = async (ok: () => boolean) => { for (let i = 0; i < 50 && !ok(); i++) await advance(0); };

function start(answer: (url: string) => Promise<Response>) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string) => { urls.push(url); return answer(url); }));
  const m = mount(<MemoryRouter><Landing /></MemoryRouter>);
  const q = (sel: string) => m.container.querySelector(sel);
  const summary = () => textOf(q('.op-summary')!);
  const entryLinks = () => [...m.container.querySelectorAll('a.workspace-entry')].map((a) => a.getAttribute('href'));
  const disabled = () => m.container.querySelectorAll('.workspace-entry.is-disabled').length;
  const values = () => [...m.container.querySelectorAll('dd.op-summary-value')].map(textOf);
  return { ...m, urls, summary, entryLinks, disabled, values };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('the homepage after the API was down', () => {
  it('shows the failure, asks again after 1 s, then shows the numbers and links Business and Employee', async () => {
    let up = false;
    const p = start(async (url) => { if (!up) throw new TypeError('Failed to fetch'); return json(BODIES[url]); });
    await until(() => p.summary() === 'Live numbers unavailable');
    expect(p.summary()).toBe('Live numbers unavailable');
    expect(p.entryLinks()).toEqual(['/simulator']);
    expect(p.disabled()).toBe(2);
    expect(p.urls).toHaveLength(3);

    up = true;
    await advance(999);
    expect(p.urls).toHaveLength(3);
    await advance(1);
    await until(() => p.values().length === 4);
    expect(p.urls).toHaveLength(6);
    expect(p.values()).toEqual(['5', '3', '5', '19 / 24']);
    expect(p.entryLinks()).toEqual([`/business/${businesses.businesses[0].id}`, '/employee/emp-7', '/simulator']);
    expect(p.disabled()).toBe(0);
    expect(p.container.innerHTML).not.toContain('aria-busy="true"');
    expect(p.summary()).not.toContain('unavailable');

    await advance(60_000); // ready: nothing is asked again
    expect(p.urls).toHaveLength(6);
  });

  it('a 503 shows the travel-data line, and the page recovers the same way once the data is there', async () => {
    let loaded = false;
    const p = start(async (url) => (loaded ? json(BODIES[url]) : json(travelMissingBody, 503)));
    await until(() => p.summary() === NYC_UNAVAILABLE_TEXT);
    expect(p.summary()).toBe(NYC_UNAVAILABLE_TEXT);
    expect(p.disabled()).toBe(2);

    await advance(1000); // still 503: the line stays, the next try is 2 s later
    await until(() => p.urls.length === 6);
    expect(p.summary()).toBe(NYC_UNAVAILABLE_TEXT);
    loaded = true;
    await advance(2000);
    await until(() => p.values().length === 4);
    expect(p.values()).toEqual(['5', '3', '5', '19 / 24']);
    expect(p.disabled()).toBe(0);
  });

  it('leaving the page during the wait drops the timer: no further request', async () => {
    const p = start(async () => { throw new TypeError('Failed to fetch'); });
    await until(() => p.summary() === 'Live numbers unavailable');
    expect(vi.getTimerCount()).toBe(1);
    p.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(p.urls).toHaveLength(3);
  });
});
