import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CityMap } from '../../client/src/components/CityMap';
import { selectedRoutes } from '../../client/src/components/sim/simPageModel';
import type { Graph } from '../../shared/types';

const leg = (routeNodeIds: string[]) => ({ tripId: 't', employeeId: 'e', routeNodeIds });
const sim = {
  plans: [
    { id: 'p1', shipmentId: 's1', kind: 'direct', legs: [leg(['a', 'b'])] },
    { id: 'p2', shipmentId: 's2', kind: 'relay', legs: [leg(['a', 'b', 'c']), leg(['d', 'e'])] },
  ],
} as any;

describe('selectedRoutes', () => {
  it('direct: one leg', () => {
    expect(selectedRoutes(sim, 's1')).toEqual({ legs: [['a', 'b']], baselines: [] });
  });
  it('relay: one list per leg', () => {
    expect(selectedRoutes(sim, 's2').legs).toEqual([['a', 'b', 'c'], ['d', 'e']]);
  });
  it('empty when nothing selected or unmatched', () => {
    expect(selectedRoutes(sim, undefined)).toEqual({ legs: [], baselines: [] });
    expect(selectedRoutes(sim, 'sX')).toEqual({ legs: [], baselines: [] });
  });
});

const graph = {
  nodes: [0, 1, 2, 3].map((i) => ({ id: `n${i}`, x: i, y: 0 })),
  edges: [0, 2].map((i) => ({ id: `e${i}`, from: `n${i}`, to: `n${i + 1}`, lengthM: 1, travelMin: 1 })),
} as unknown as Graph;

describe('CityMap highlightRoutes', () => {
  it('renders separate paths without joining legs', () => {
    const html = renderToStaticMarkup(
      <CityMap graph={graph} businesses={[]} hubs={[]} highlightRoutes={[['n0', 'n1'], ['n2', 'n3']]} />,
    );
    expect(html.match(/<polyline[^>]*route-hi-leg/g)).toHaveLength(2);
    expect(html).toContain('route-hi-alt');
  });
  it('no routes means no highlight polylines', () => {
    const html = renderToStaticMarkup(<CityMap graph={graph} businesses={[]} hubs={[]} highlightRoutes={[]} />);
    expect(html).not.toContain('<polyline');
  });
});
