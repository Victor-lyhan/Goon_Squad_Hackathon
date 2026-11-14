import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CityMap } from '../../client/src/components/CityMap';
import { MapMarkers } from '../../client/src/components/sim/MapMarkers';
import type { Graph } from '../../shared/types';

const graph = { nodes: [{ id: 'n0', x: 0, y: 0 }, { id: 'n1', x: 2, y: 2 }], edges: [] } as unknown as Graph;
const snapshot = {
  runId: 'r', timeMin: 10,
  markers: [{ employeeId: 'e1', x: 1, y: 1, servicing: true, carryingShipmentId: 's1' }],
  packagePositions: { s1: { x: 1, y: 1 } },
};

describe('MapMarkers', () => {
  it('renders projected markers inside CityMap', () => {
    const html = renderToStaticMarkup(
      <CityMap graph={graph} businesses={[]} hubs={[]}>
        <MapMarkers graph={graph} snapshot={snapshot} clock={{ speed: 30 }} />
      </CityMap>,
    );
    expect(html).toContain('aria-label="Vehicle e1, carrying s1, servicing"');
    expect(html).toContain('aria-label="Package s1"');
    expect(html).toContain('cx="500"');
    expect(html).toContain('marker-ring');
  });
  it('CityMap without children has no marker layer', () => {
    expect(renderToStaticMarkup(<CityMap graph={graph} businesses={[]} hubs={[]} />)).not.toContain('map-markers');
  });
});
