// Simplified light Google basemap (docs/mvp2-ui-redesign.md §1): quiet, desaturated, no POI or
// transit labels, light gray roads. Applied with the `styles` map option, so the map must NOT
// have a mapId (a map ID turns JSON styling off).

export type MapStyler = Record<string, string | number>;
export type MapTypeStyle = { featureType?: string; elementType?: string; stylers: MapStyler[] };

export const MAP_STYLE: MapTypeStyle[] = [
  // Base: light, desaturated land and quiet text.
  { elementType: 'geometry', stylers: [{ color: '#f3f4f6' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#7b8492' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f7f8fa' }] },

  // Administrative: faint borders, keep neighborhood/borough names readable but light.
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#d7dde5' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#9aa2ae' }] },

  // Points of interest: no labels, no icons; parks muted green-gray.
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#eceef1' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#e3eae2' }] },

  // Roads: light gray, most labels off (highway names stay, faint).
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e4e7eb' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#eef0f3' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e6e9ed' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#d7dde5' }] },
  { featureType: 'road.highway', elementType: 'labels.text', stylers: [{ visibility: 'on' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#a3abb6' }] },
  { featureType: 'road.highway', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },

  // Transit: off entirely (lines, stations, labels).
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },

  // Water: muted blue-gray.
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dbe3ea' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#a3b1bf' }] },
];

/**
 * The same map at night (docs/mvp3.md P1, #649): identical rules (no POI, transit or road labels),
 * dark slate colors. Only the basemap changes; the deck.gl routes, markers and names keep their colors.
 */
export const NIGHT_MAP_STYLE: MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#1c2430' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8f9bab' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#151b26' }] },

  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#2f3a4a' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#7f8b9c' }] },

  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#202936' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1f2e2c' }] },

  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c3644' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#232c38' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#303b4a' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3a4657' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#2a3441' }] },
  { featureType: 'road.highway', elementType: 'labels.text', stylers: [{ visibility: 'on' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#8492a4' }] },
  { featureType: 'road.highway', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },

  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },

  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f1620' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4f6074' }] },
];

/** The basemap style for a phase; a map without a day/night prop is always the light one. */
export function mapStyleFor(phase: 'day' | 'night' | undefined): MapTypeStyle[] {
  return phase === 'night' ? NIGHT_MAP_STYLE : MAP_STYLE;
}

/** NYC default view (about 40.73, -73.94, zoom 11). */
export const NYC_CENTER = { lat: 40.73, lng: -73.94 };
export const NYC_ZOOM = 11;
