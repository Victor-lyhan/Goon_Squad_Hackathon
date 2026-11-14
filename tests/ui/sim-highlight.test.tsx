import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CityMap } from '../../client/src/components/CityMap';
import type { Graph } from '../../shared/types';

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
