import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CityMap } from '../../client/src/components/CityMap';
import type { Graph } from '../../shared/types';

const graph = { nodes: [{ id: 'n0', x: 0, y: 0 }, { id: 'n1', x: 2, y: 2 }], edges: [] } as unknown as Graph;

describe('CityMap', () => {
  it('CityMap without children has no marker layer', () => {
    expect(renderToStaticMarkup(<CityMap graph={graph} businesses={[]} hubs={[]} />)).not.toContain('map-markers');
  });
});
