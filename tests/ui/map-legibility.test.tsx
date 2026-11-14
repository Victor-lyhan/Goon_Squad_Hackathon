import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CityMap } from '../../client/src/components/CityMap';
import { estimateTextWidth, placeLabels } from '../../client/src/components/sim/mapGeometry';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { getMap } from '../../server/api/map';
import type { MapResponse } from '../../shared/api';

function demoMap(): MapResponse {
  const run = createInitialRun(loadDefaultScenario());
  let body: MapResponse | undefined;
  getMap({ get: () => run } as never)({} as never, { json: (b: MapResponse) => { body = b; } } as never);
  return body!;
}
const map = demoMap();
const html = (extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<CityMap graph={map.graph} businesses={map.businesses} hubs={map.hubs} homes={map.homes} {...extra} />);

describe('placeLabels', () => {
  const rect = (x: number, y: number, t: string, a: 'start' | 'middle' | 'end') => {
    const w = estimateTextWidth(t);
    const x0 = a === 'middle' ? x - w / 2 : a === 'start' ? x : x - w;
    return { x0, x1: x0 + w, y0: y - 20, y1: y + 5 };
  };
  it('keeps a lone label below its marker', () => {
    const [l] = placeLabels([{ id: 'a', x: 100, y: 100, text: 'Cafe' }]);
    expect(l.moved).toBe(false);
    expect(l.anchor).toBe('middle');
    expect(l.y).toBeGreaterThan(100);
  });
  it('offsets labels on the same node and on adjacent nodes so boxes do not overlap', () => {
    const items = [
      { id: 'a', x: 100, y: 100, text: 'Northside Bakery' },
      { id: 'b', x: 100, y: 100, text: 'Hub Central' },
      { id: 'c', x: 191, y: 100, text: 'Harbor Pharmacy' },
      { id: 'd', x: 100, y: 191, text: 'Corner Books' },
    ];
    const out = placeLabels(items);
    expect(out.some((l) => l.moved)).toBe(true);
    const boxes = out.map((l, i) => rect(l.x, l.y, items[i].text, l.anchor));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      expect(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1).toBe(false);
    }
  });
  it('is deterministic and handles empty input', () => {
    expect(placeLabels([])).toEqual([]);
    const items = [{ id: 'a', x: 0, y: 0, text: 'A' }, { id: 'b', x: 0, y: 0, text: 'B' }];
    expect(placeLabels(items)).toEqual(placeLabels(items));
  });
});

describe('CityMap legibility on the Demo city', () => {
  const out = html();
  const text = out.replace(/<[^>]*>/g, ' ');
  it('has a legend covering every symbol', () => {
    for (const w of ['Road', 'Business', 'Hub', 'Home', 'Vehicle', 'Selected route']) expect(text).toContain(w);
  });
  it('labels every hub and business by name with a title, never a raw node id', () => {
    expect(map.hubs.length).toBeGreaterThan(0);
    for (const x of [...map.hubs, ...map.businesses]) {
      expect(out).toContain(`<title>${x.name}</title>`);
      expect(out).toContain(`>${x.name}</text>`);
    }
    for (const n of map.graph.nodes) expect(text).not.toMatch(new RegExp(`(^|\\s)${n.id}(\\s|$)`));
    expect(out).not.toContain('NaN');
  });
  it('relay: two legs in distinct styles and the hub is emphasized; direct: one leg', () => {
    const hub = map.hubs[0].nodeId;
    const [a, b] = [map.businesses[0].nodeId, map.businesses[1].nodeId];
    const relay = html({ highlightRoutes: [[a, hub], [hub, b]] });
    expect(relay.match(/route-hi-leg/g)).toHaveLength(2);
    expect(relay).toContain('route-hi-alt');
    expect(relay).toContain('hub-ring');
    const direct = html({ highlightRoutes: [[a, b]] });
    expect(direct.match(/route-hi-leg/g)).toHaveLength(1);
    expect(direct).not.toContain('route-hi-alt');
    expect(direct).not.toContain('hub-ring');
  });
  it('uses text of at least 12px', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('client/src/components/sim/CityMap.css', 'utf8');
    const m = css.match(/\.city-map text \{ font: \d+ (\d+)px/);
    expect(Number(m![1])).toBeGreaterThanOrEqual(12);
  });
});
