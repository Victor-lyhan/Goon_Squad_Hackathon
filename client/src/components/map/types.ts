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
  /**
   * The tooltip's first line: what this line is, in names (e.g. "Coffee samples · leg 1 of 2 · carried by
   * Cy Lam", or an employee's name for a commute). The role ("Delivery route", "Normal commute") is the
   * second line, so it is not repeated here. None = the generic text ("Delivery route" / "Commute").
   */
  label?: string;
  /**
   * Journey mode, for a `leg` route: `true` = the part the carrier drives with the package (drawn thick,
   * CARRIED_WIDTH); `false` = the carrier's whole commute of that trip (drawn thin, COMMUTE_WIDTH, below
   * the thick part, same colour). None = an ordinary delivery route (LEG_WIDTH), as the previews draw it.
   */
  carried?: boolean;
};

export type RouteTone = 'leg1' | 'leg2';

/**
 * What a journey stop is drawn as instead of a numbered circle: the sender a filled square, the relay
 * business an ink diamond, the handoff at the relay a two-arrow swap, the recipient a flag.
 */
export type StopSymbol = 'sender' | 'relay' | 'swap' | 'recipient';

/**
 * A journey stop (1 Pickup → 2 Drop at relay → 3 Pickup at relay → 4 Delivered). Without `symbol` it is a
 * numbered circle and `label` is its tooltip. With `symbol` it is that symbol and `label` is the short
 * text drawn next to it on the map ("Overnight · Roastery", "Delivered 9:12 AM"); `detail` is the
 * tooltip's second line.
 */
export type MapStop = {
  id: string;
  n: number;
  lat: number;
  lng: number;
  label: string;
  symbol?: StopSymbol;
  detail?: string;
};

/** Pan request: the map pans (no zoom change) each time `key` changes. */
export type MapPanTarget = { lat: number; lng: number; key: string };

export type MapMover = {
  id: string;
  kind: 'vehicle' | 'package';
  lat: number;
  lng: number;
  label: string;
  /** Journey mode: the leg a carrier's vehicle drives. `leg1` / `leg2` get that leg's colour; none = VEHICLE_FILL. */
  tone?: RouteTone;
  /** Journey mode: a letter drawn on the vehicle ("A", "B"), so a carrier is never told apart by colour alone. */
  badge?: string;
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
