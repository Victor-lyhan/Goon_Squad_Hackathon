// Plain prop types for the NYC map. Local on purpose (no shared/ import): callers map API
// responses into these shapes, and the map only draws what it is given.

export type MapPlace = {
  id: string;
  kind: 'business' | 'home';
  lat: number;
  lng: number;
  label: string;
  sublabel?: string;
};

export type MapRoute = {
  id: string;
  kind: 'baseline' | 'leg';
  /** Decoded polyline in deck.gl order: [lng, lat]. */
  path: [number, number][];
  /** Employee / package / plan IDs this route belongs to (used for selection highlighting). */
  ownerIds: string[];
};

export type MapMover = {
  id: string;
  kind: 'vehicle' | 'package';
  lat: number;
  lng: number;
  label: string;
};

export type LayerVisibility = {
  routes: boolean;
  businesses: boolean;
  homes: boolean;
  packages: boolean;
};

export type LatLngBounds = { north: number; south: number; east: number; west: number };

/** What hover/click report back: enough for a tooltip and for selecting by ID. */
export type MapItem = {
  id: string;
  kind: MapPlace['kind'] | MapRoute['kind'] | MapMover['kind'];
  label: string;
  role: string;
};
