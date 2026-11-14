import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SimulatorView } from '../../client/src/components/sim/SimulatorView';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { buildSimulatorResponse } from '../../server/api/simulator';
import type { MapResponse } from '../../shared/api';

const run = createInitialRun(loadDefaultScenario());
const { scenario } = run;
const map: MapResponse = {
  runId: run.runId, graph: scenario.graph, businesses: scenario.businesses, hubs: scenario.hubs,
  homes: scenario.employees.map((e) => ({ employeeId: e.id, nodeId: e.homeNodeId })),
};
const sim = buildSimulatorResponse(run);
const html = renderToStaticMarkup(
  <MemoryRouter>
    <SimulatorView sim={sim} map={map} employees={scenario.employees} onSelect={() => {}} onControl={() => {}} />
  </MemoryRouter>,
);
const attr = (h: string, name: string) => h.match(new RegExp(`${name}="([^"]*)"`))?.[1];
const tags = (h: string, t: string) => h.match(new RegExp(`<${t}\\b[^>]*>`, 'g')) ?? [];
const bar = html.slice(html.indexOf('class="playback-bar"'), html.indexOf('class="playback-bar"') + 6000);
const barEnd = bar.indexOf('pb-hint');
const barHtml = bar.slice(0, barEnd);

describe('Simulator layout and accessibility', () => {
  it('names every playback control', () => {
    const names = [...tags(barHtml, 'button'), ...tags(barHtml, 'input')].map((t) => attr(t, 'aria-label'));
    for (const n of ['Play simulation', 'Speed 30 times', 'Jump to next event', 'Jump to morning',
      'Finish simulation', 'Reset playback', 'Simulation time']) expect(names).toContain(n);
    expect(names.every((n) => !!n)).toBe(true);
    expect(barHtml).toContain('role="toolbar"');
  });

  it('exposes pressed state on speed buttons and valuetext on the scrubber', () => {
    const speeds = tags(barHtml, 'button').filter((t) => /aria-label="Speed /.test(t));
    expect(speeds.length).toBeGreaterThan(1);
    expect(speeds.every((t) => /aria-pressed="(true|false)"/.test(t))).toBe(true);
    expect(speeds.filter((t) => t.includes('aria-pressed="true"'))).toHaveLength(1);
    expect(tags(barHtml, 'input')[0]).toMatch(/aria-valuetext="[^"]+"/);
  });

  it('shows the simulated day/time', () => {
    expect(barHtml).toMatch(/class="pb-time"[^>]*>Day \d/);
  });

  it('gives the map role=img and a title with the city and time', () => {
    const svg = tags(html, 'svg').find((t) => t.includes('city-map'))!;
    expect(svg).toContain('role="img"');
    const label = attr(svg, 'aria-label')!;
    expect(label).toMatch(/city/i);
    expect(label).toMatch(/Day \d/);
    expect(html).toContain(`<title>${label}</title>`);
  });

  it('orders metrics, map, playback bar, queue, detail in the DOM', () => {
    const marks = ['class="mc"', 'class="city-map', 'class="playback-bar"', 'class="pq"', 'aria-label="Package detail'];
    const idx = marks.map((m) => html.indexOf(m));
    idx.forEach((i, k) => expect(i, marks[k]).toBeGreaterThanOrEqual(0));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });
});
