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
  /** Journey mode: which leg a `leg` route is. `leg2` gets the second color; none = accent (leg 1). */
  tone?: RouteTone;
};

export type RouteTone = 'leg1' | 'leg2';

/** A numbered journey stop (1 Pickup → 2 Drop at relay → 3 Pickup at relay → 4 Delivered). */
export type MapStop = { id: string; n: number; lat: number; lng: number; label: string };

/** Pan request: the map pans (no zoom change) each time `key` changes. */
export type MapPanTarget = { lat: number; lng: number; key: string };

export type MapMover = {
  id: string;
  kind: 'vehicle' | 'package';
  lat: number;
  lng: number;
  label: string;
  /** Journey mode: the leg a carrier's vehicle drives. `leg2` gets the second leg colour; none = as `leg1`. */
  tone?: RouteTone;
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
  kind: MapPlace['kind'] | MapRoute['kind'] | MapMover['kind'] | 'stop';
  label: string;
  role: string;
};
