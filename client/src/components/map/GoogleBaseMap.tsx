/// <reference types="google.maps" />
// Reusable NYC map: one simplified light Google basemap + one deck.gl GoogleMapsOverlay drawing
// places, routes and movers from plain props. The map is created once per mount; prop changes
// (e.g. the 1 s simulator poll) only call overlay.setProps({ layers }).
//
// deck.gl is imported dynamically inside the load effect, so this file can be statically rendered
// in Node tests (no WebGL) and the heavy deck bundle loads only when a key is present.
import { useEffect, useMemo, useRef, useState } from 'react';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import type { GoogleMapsOverlay } from '@deck.gl/google-maps';
import type { PickingInfo } from '@deck.gl/core';
import { Button, Spinner } from '../../ui';
import { buildLayerSpecs, type LayerSpec, type PathDatum, type ScatterDatum, type TextDatum } from './layers';
import {
  KEY_MISSING_TEXT,
  LOAD_ERROR_TEXT,
  fitKey,
  initialStatus,
  mapOptions,
  panDecision,
  readBrowserKey,
  resolveFit,
  selectedItemText,
  type MapStatus,
} from './mapModel';
import type {
  LatLngBounds,
  LayerVisibility,
  MapItem,
  MapMover,
  MapPanTarget,
  MapPlace,
  MapRoute,
  MapStop,
} from './types';
import './map.css';

export type GoogleBaseMapProps = {
  places: MapPlace[];
  routes: MapRoute[];
  movers: MapMover[];
  visible: LayerVisibility;
  selectedIds?: readonly string[];
  onHover?: (item: MapItem | null) => void;
  onSelect?: (id: string | null) => void;
  fitTo?: 'places' | LatLngBounds;
  /** Numbered journey stops, drawn on top of everything (ignore `visible`, never dimmed). */
  stops?: MapStop[];
  /** Pan (no zoom change) to this point whenever `key` changes. */
  panTo?: MapPanTarget;
};

type DeckLayersModule = typeof import('@deck.gl/layers');
type Hover = { x: number; y: number; item: MapItem };

const NO_SELECTION: readonly string[] = [];
const NO_STOPS: MapStop[] = [];
const FIT_PADDING_PX = 48;

// setOptions must run once per page: a second call makes the loader log its options (with the key).
let optionsSet = false;
function ensureLoaderOptions(key: string) {
  if (optionsSet) return;
  optionsSet = true;
  // After a hot reload this module is fresh but google.maps.importLibrary is already installed.
  const g = (window as unknown as { google?: { maps?: { importLibrary?: unknown } } }).google;
  if (!g?.maps?.importLibrary) setOptions({ key, v: 'weekly' });
}

function toDeckLayer(spec: LayerSpec, mod: DeckLayersModule) {
  // Spec props are plain deck.gl layer props (units, picking, text styling).
  const props = spec.props as Record<string, never>;
  switch (spec.type) {
    case 'path':
      return new mod.PathLayer<PathDatum>({
        id: spec.id,
        data: spec.data,
        getPath: (d) => d.path,
        getColor: (d) => d.color,
        getWidth: (d) => d.width,
        ...props,
      });
    case 'scatter':
      return new mod.ScatterplotLayer<ScatterDatum>({
        id: spec.id,
        data: spec.data,
        getPosition: (d) => d.position,
        getFillColor: (d) => d.fillColor,
        getLineColor: (d) => d.lineColor,
        getRadius: (d) => d.radius,
        getLineWidth: (d) => d.lineWidth,
        ...props,
      });
    case 'text':
      return new mod.TextLayer<TextDatum>({
        id: spec.id,
        data: spec.data,
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getColor: (d) => d.color,
        ...props,
      });
  }
}

/** The no-key message. An alert, so it is announced without looking at the map area. */
export function MapKeyMissing() {
  return (
    <div className="map-v2__panel" role="alert">
      <strong>{KEY_MISSING_TEXT}</strong> Add <code>VITE_GOOGLE_MAPS_BROWSER_KEY</code> to <code>.env</code> and
      restart <code>npm run dev</code>.
    </div>
  );
}

/** The load-error message with Retry. An alert, like the no-key message. */
export function MapLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="map-v2__panel" role="alert">
      <strong>{LOAD_ERROR_TEXT}</strong>
      <p>Check your connection and the key's allowed referrers, then try again.</p>
      <Button variant="secondary" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

/** The hover tooltip's text for the selected item, for keyboard and screen-reader users. */
function SelectedAnnouncement({ text }: { text: string }) {
  return (
    <div className="map-v2__sr" role="status" aria-live="polite" data-testid="map-selected">
      {text ? `Selected on map: ${text}` : ''}
    </div>
  );
}

function pickedItem(info: PickingInfo): MapItem | null {
  const obj = info.object as { item?: MapItem } | null | undefined;
  return obj?.item ?? null;
}

export function GoogleBaseMap({
  places,
  routes,
  movers,
  visible,
  selectedIds = NO_SELECTION,
  onHover,
  onSelect,
  fitTo,
  stops = NO_STOPS,
  panTo,
}: GoogleBaseMapProps) {
  const apiKey = readBrowserKey(import.meta.env);
  const [status, setStatus] = useState<MapStatus>(() => initialStatus(apiKey));
  const [attempt, setAttempt] = useState(0);
  const [hover, setHover] = useState<Hover | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
  const layersModRef = useRef<DeckLayersModule | null>(null);
  const lastHoverIdRef = useRef<string | null>(null);
  const lastPanKeyRef = useRef<string | null>(null);

  // Latest callbacks/props for handlers attached once at creation.
  const latest = useRef({ onHover, onSelect, fitTo, places, panTo });
  useEffect(() => {
    latest.current = { onHover, onSelect, fitTo, places, panTo };
  });

  // Load the Maps JS API and create the map + overlay once (again only after a failed load + Retry).
  useEffect(() => {
    if (!apiKey) return; // no key: no network request at all
    let cancelled = false;
    setStatus('loading');
    (async () => {
      try {
        ensureLoaderOptions(apiKey);
        const [{ Map }, gm, layersMod] = await Promise.all([
          importLibrary('maps'),
          import('@deck.gl/google-maps'),
          import('@deck.gl/layers'),
        ]);
        if (cancelled || !containerRef.current) return;
        const map = new Map(containerRef.current, mapOptions());
        const overlay = new gm.GoogleMapsOverlay({
          layers: [],
          onHover: (info: PickingInfo) => {
            const item = pickedItem(info);
            setHover(item ? { x: info.x, y: info.y, item } : null);
            const id = item?.id ?? null;
            if (id !== lastHoverIdRef.current) {
              lastHoverIdRef.current = id;
              latest.current.onHover?.(item);
            }
          },
          onClick: (info: PickingInfo) => {
            latest.current.onSelect?.(pickedItem(info)?.id ?? null);
          },
        });
        overlay.setMap(map);
        mapRef.current = map;
        overlayRef.current = overlay;
        layersModRef.current = layersMod;
        setStatus('ready');
      } catch {
        // Never surface the error text: it can include the script URL (and so the key).
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      const overlay = overlayRef.current;
      if (overlay) {
        overlay.setMap(null);
        overlay.finalize();
      }
      overlayRef.current = null;
      mapRef.current = null;
    };
  }, [apiKey, attempt]);

  const hoveredId = hover?.item.id ?? null;
  const specs = useMemo(
    () => buildLayerSpecs({ places, routes, movers, visible, selectedIds, hoveredId, stops }),
    [places, routes, movers, visible, selectedIds, hoveredId, stops],
  );

  // Push layers to the existing overlay whenever the specs change. Never re-creates the map.
  useEffect(() => {
    const overlay = overlayRef.current;
    const mod = layersModRef.current;
    if (status !== 'ready' || !overlay || !mod) return;
    overlay.setProps({ layers: specs.map((s) => toDeckLayer(s, mod)) });
  }, [specs, status]);

  // Fit the camera only when the fit request's identity changes (not on every poll).
  const fk = fitKey(fitTo, places);
  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map || !fk) return;
    const bounds = resolveFit(latest.current.fitTo, latest.current.places);
    if (bounds) map.fitBounds(bounds, FIT_PADDING_PX);
  }, [fk, status]);

  // Pan once per new panTo.key (declared after the fit, so a pan requested at load wins).
  const panKey = panTo?.key;
  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map) return;
    const { key, target } = panDecision(lastPanKeyRef.current, latest.current.panTo);
    lastPanKeyRef.current = key;
    if (target) map.panTo(target);
  }, [panKey, status]);

  const selectedText = selectedItemText(selectedIds, places, movers, stops);

  if (status === 'missing-key') {
    return (
      <div className="map-v2 map-v2--state">
        <MapKeyMissing />
        <SelectedAnnouncement text={selectedText} />
      </div>
    );
  }

  return (
    <div
      className="map-v2"
      onMouseLeave={() => {
        setHover(null);
        if (lastHoverIdRef.current !== null) {
          lastHoverIdRef.current = null;
          latest.current.onHover?.(null);
        }
      }}
    >
      <div ref={containerRef} className="map-v2__canvas" />
      {status === 'loading' && (
        <div className="map-v2__overlay">
          <Spinner label="Loading map" />
        </div>
      )}
      {status === 'error' && (
        <div className="map-v2__overlay">
          <MapLoadError onRetry={() => setAttempt((a) => a + 1)} />
        </div>
      )}
      {status === 'ready' && hover && (
        <div className="map-v2__tooltip" role="tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <div className="map-v2__tooltip-label">{hover.item.label}</div>
          <div className="map-v2__tooltip-role">{hover.item.role}</div>
        </div>
      )}
      <SelectedAnnouncement text={selectedText} />
    </div>
  );
}

export default GoogleBaseMap;
