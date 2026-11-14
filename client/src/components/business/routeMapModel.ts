import type { MapResponse, ShipmentView } from '../../../../shared/api';
import type { Business, Hub } from '../../../../shared/types';
import type { CityMapProps } from '../CityMap';

export type MiniMapInput = {
  originNodeId: string;
  destinationNodeId: string;
  hubId?: string;
  /** Routes returned by the API (one per carrier leg). The frontend never computes routes. */
  legRoutes?: string[][];
  baselineRoutes?: string[][];
};

export type MiniMapProps = Pick<CityMapProps, 'graph' | 'businesses' | 'hubs' | 'highlightRoutes' | 'baselineRoutes'>;

/** Pure: pick the businesses, hub and routes CityMap should draw. Unknown ids are dropped. */
export function miniMapProps(map: MapResponse, input: MiniMapInput): MiniMapProps {
  const ends = new Set([input.originNodeId, input.destinationNodeId]);
  const businesses: Business[] = map.businesses.filter((b) => ends.has(b.nodeId));
  const hubs: Hub[] = input.hubId ? map.hubs.filter((h) => h.id === input.hubId) : [];
  const known = new Set(map.graph.nodes.map((n) => n.id));
  const usable = (rs?: string[][]) => (rs ?? []).filter((r) => r.length >= 2 && r.every((id) => known.has(id)));
  return {
    graph: map.graph,
    businesses,
    hubs,
    highlightRoutes: usable(input.legRoutes),
    baselineRoutes: usable(input.baselineRoutes),
  };
}

/** Pure: ShipmentView + MapResponse -> CityMap props. Unmatched shipments have no legs, so no routes. */
export function routeMapFromView(view: ShipmentView, map: MapResponse): MiniMapProps {
  const byId = (id: string) => map.businesses.find((b) => b.id === id)?.nodeId ?? '';
  return miniMapProps(map, {
    originNodeId: byId(view.shipment.originBusinessId),
    destinationNodeId: byId(view.shipment.destinationBusinessId),
    hubId: view.plan?.kind === 'relay' ? view.plan.hubId : undefined,
    legRoutes: view.plan?.legs.map((l) => l.routeNodeIds) ?? [],
  });
}
