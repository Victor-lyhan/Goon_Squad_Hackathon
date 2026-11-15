/// <reference types="google.maps" />
// Reusable NYC map: one simplified light Google basemap + one deck.gl GoogleMapsOverlay drawing
// places, routes and movers from plain props. The map is created once per mount; prop changes
// (e.g. the 1 s simulator poll) only call overlay.setProps({ layers }).
//
// With the optional `dayNight` prop (the simulator, #649) the basemap switches between the light and
// the dark style and a badge shows a sun or a moon with the time. Only the basemap gets dark: the
// deck.gl routes, markers and names are never dimmed. Without the prop nothing changes.
//
// deck.gl is imported dynamically inside the load effect, so this file can be statically rendered
// in Node tests (no WebGL) and the heavy deck bundle loads only when a key is present.
import { Fragment, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import type { GoogleMapsOverlay } from '@deck.gl/google-maps';
import type { PickingInfo } from '@deck.gl/core';
import { DAY_NIGHT_ALT, withNightCasing, type DayNight } from './dayNight';
import { buildLayerSpecs, type LayerSpec, type PathDatum, type ScatterDatum, type TextDatum } from './layers';
import { mapStyleFor } from './mapStyle';
import {
  FIT_PADDING_PX,
  fitKey,
  initialStatus,
  mapOptions,
  mapStateCopy,
  nextMapStatus,
  panDecision,
  readBrowserKey,
  resolveFit,
  selectedItemText,
  watchAuthFailure,
  type AuthFailureTarget,
  type MapStateCopy,
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
  /** Name the businesses that are not dimmed, as many as fit at the current zoom without overlapping. */
  labelBusinesses?: boolean;
  /** Places that are always named (a journey's sender, recipient and relay business). */
  alwaysLabelIds?: readonly string[];
  /**
   * Simulator only: `'night'` draws the dark basemap and a moon badge, `'day'` the light basemap and
   * a sun badge. Routes, markers and names are never dimmed. Omitted: the light map and no badge.
   */
  dayNight?: DayNight;
  /** The time shown next to the badge's icon, e.g. "Day 1 · 6:12 PM". Shown only with `dayNight`. */
  clockText?: string;
};

type DeckLayersModule = typeof import('@deck.gl/layers');
type Hover = { x: number; y: number; item: MapItem };

const NO_SELECTION: readonly string[] = [];
const NO_STOPS: MapStop[] = [];
const NO_IDS: readonly string[] = [];

// Google calls gm_authFailure once per page; Google will not accept the key again until a reload, so
// a map mounted later (another page, the Employee commute preview) starts in auth-error.
let authFailedThisPage = false;

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
        getPixelOffset: (d) => d.offset ?? [0, 0],
        ...props,
      });
  }
}

/** A name inside a hint. It may wrap after an underscore, so a long variable name fits a narrow map. */
function HintCode({ text }: { text: string }) {
  const pieces = text.split('_');
  return (
    <code>
      {pieces.map((piece, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {i < pieces.length - 1 ? `${piece}_` : piece}
        </Fragment>
      ))}
    </code>
  );
}

export type MapPlaceholderProps = {
  /** What to say, or null for a map that is showing: then only the empty live region is left. */
  copy: MapStateCopy | null;
  /** Called by Retry, which is shown only when the copy says a retry can help. */
  onRetry?: () => void;
};

/**
 * The one placeholder of every map in the app (#890): no key, key rejected, load error and loading.
 * One plain line, an optional short hint and, where it can help, Retry.
 *
 * The text is in one `role="status"` region (polite, never an alert: nothing here should interrupt a
 * screen reader, #767). The region is in the page before its text and stays while the map shows, so a
 * change of state is announced once and the 1 s poll, which changes no text, announces nothing.
 * Retry is outside the region, so the announcement is the words only.
 */
export function MapPlaceholder({ copy, onRetry }: MapPlaceholderProps) {
  return (
    <div className={copy ? `map-v2__state map-v2__state--${copy.tone}` : 'map-v2__state map-v2__state--off'}>
      <div className="map-v2__state-body">
        <div className="map-v2__state-text" role="status">
          {copy && <p className="map-v2__state-line">{copy.line}</p>}
          {copy && copy.hint.length > 0 && (
            <p className="map-v2__state-hint">
              {copy.hint.map((part, i) =>
                typeof part === 'string' ? <Fragment key={i}>{part}</Fragment> : <HintCode key={i} text={part.code} />,
              )}
            </p>
          )}
        </div>
        {copy?.retry && onRetry && (
          // aria-disabled, not disabled, while a retry loads: a disabled button would drop the focus.
          <button
            type="button"
            className="map-v2__retry"
            aria-disabled={copy.busy || undefined}
            onClick={copy.busy ? undefined : onRetry}
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A map area that holds only the placeholder, for a page whose own map data is loading or failed (the
 * Business route preview): the same box and words as the map that replaces it.
 */
export function MapStateFrame({ copy, onRetry }: { copy: MapStateCopy; onRetry?: () => void }) {
  return (
    <div className="map-v2">
      <MapPlaceholder copy={copy} onRetry={onRetry} />
    </div>
  );
}

function pageOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

/** The hover tooltip's text for the selected item, for keyboard and screen-reader users. */
function SelectedAnnouncement({ text }: { text: string }) {
  return (
    <div className="map-v2__sr" role="status" aria-live="polite" data-testid="map-selected">
      {text ? `Selected on map: ${text}` : ''}
    </div>
  );
}

/**
 * The sun or moon with the time, in the map's top-left corner. The icon carries the text alternative
 * ("Day" / "Night"); the time is plain text and is not a live region (it changes every second in Play).
 * One look by day and at night (#864), so no phase modifier class (#874); the phase is in `data-day-night`.
 */
export function DayNightBadge({ phase, clockText }: { phase: DayNight; clockText?: string }) {
  return (
    <div className="map-v2__daynight" data-day-night={phase}>
      <svg className="map-v2__daynight-icon" role="img" aria-label={DAY_NIGHT_ALT[phase]} viewBox="0 0 16 16" width="16" height="16">
        {phase === 'night' ? (
          <path fill="currentColor" d="M6.82 2.12A6 6 0 1 0 13.88 9.18 5 5 0 0 1 6.82 2.12Z" />
        ) : (
          <>
            <circle cx="8" cy="8" r="3" fill="currentColor" />
            <path
              fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
              d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06"
            />
          </>
        )}
      </svg>
      {clockText ? <span className="map-v2__daynight-time">{clockText}</span> : null}
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
  labelBusinesses = false,
  alwaysLabelIds = NO_IDS,
  dayNight,
  clockText,
}: GoogleBaseMapProps) {
  const apiKey = readBrowserKey(import.meta.env);
  const [status, dispatch] = useReducer(nextMapStatus, apiKey, (k) => initialStatus(k, authFailedThisPage));
  const [attempt, setAttempt] = useState(0);
  const [hover, setHover] = useState<Hover | null>(null);
  // The map's zoom, so the layer builder can keep business names apart (null until the map exists).
  const [zoom, setZoom] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
  const layersModRef = useRef<DeckLayersModule | null>(null);
  const lastHoverIdRef = useRef<string | null>(null);
  const lastPanKeyRef = useRef<string | null>(null);
  // Whether the basemap now has the night style, so the style is set only when the phase changes.
  const nightStyleRef = useRef(false);
  const night = dayNight === 'night';

  // Latest callbacks/props for handlers attached once at creation.
  const latest = useRef({ onHover, onSelect, fitTo, places, panTo, night });
  useEffect(() => {
    latest.current = { onHover, onSelect, fitTo, places, panTo, night };
  });

  // Watch for Google rejecting the key. Declared before the load effect, so it is installed before
  // the loader starts; removed (the old handler put back) on unmount.
  useEffect(() => {
    if (!apiKey) return;
    return watchAuthFailure(window as unknown as AuthFailureTarget, () => {
      authFailedThisPage = true;
      dispatch('auth-failed');
    });
  }, [apiKey]);

  // Load the Maps JS API and create the map + overlay once (again only after a failed load + Retry).
  useEffect(() => {
    if (!apiKey || authFailedThisPage) return; // no key, or a key Google already rejected: no request
    let cancelled = false;
    dispatch('load-start');
    (async () => {
      try {
        ensureLoaderOptions(apiKey);
        const [{ Map }, gm, layersMod] = await Promise.all([
          importLibrary('maps'),
          import('@deck.gl/google-maps'),
          import('@deck.gl/layers'),
        ]);
        // Google rejected the key while the loader ran: create no map and no overlay.
        if (cancelled || authFailedThisPage || !containerRef.current) return;
        // A map that loads at night starts dark (no light flash).
        const startNight = latest.current.night;
        const map = new Map(containerRef.current, { ...mapOptions(), styles: mapStyleFor(startNight ? 'night' : 'day') });
        nightStyleRef.current = startNight;
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
        // Names follow the zoom. Optional calls: tracking the zoom must never fail the map's load
        // (without it the names are placed at NYC_ZOOM).
        const readZoom = () => {
          const z = map.getZoom?.();
          if (typeof z === 'number' && Number.isFinite(z)) setZoom(z);
        };
        map.addListener?.('zoom_changed', readZoom);
        readZoom();
        mapRef.current = map;
        overlayRef.current = overlay;
        layersModRef.current = layersMod;
        dispatch('loaded'); // stays auth-error if Google already rejected the key
      } catch {
        // Never surface the error text: it can include the script URL (and so the key).
        if (!cancelled) dispatch('load-failed');
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

  // After Google rejects the key, detach the deck.gl overlay: it gets no more layer updates or picks.
  useEffect(() => {
    if (status !== 'auth-error') return;
    const overlay = overlayRef.current;
    if (overlay) {
      overlay.setMap(null);
      overlay.finalize();
    }
    overlayRef.current = null;
    setHover(null);
  }, [status]);

  // Day <-> night: swap the basemap style on the existing map (never re-created). The deck.gl layers
  // are not touched, so nothing drawn on top gets darker. Skipped while the phase is unchanged, so a
  // map without the prop (Business, Employee) never calls it.
  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map || nightStyleRef.current === night) return;
    map.setOptions({ styles: mapStyleFor(night ? 'night' : 'day') });
    nightStyleRef.current = night;
  }, [night, status]);

  const hoveredId = hover?.item.id ?? null;
  const specs = useMemo(() => {
    const day = buildLayerSpecs({
      places, routes, movers, visible, selectedIds, hoveredId, stops, labelBusinesses, alwaysLabelIds,
      zoom: zoom ?? undefined,
    });
    // On the dark basemap each solid route gets a light casing, so it reads as well as by day.
    return night ? withNightCasing(day) : day;
  }, [places, routes, movers, visible, selectedIds, hoveredId, stops, labelBusinesses, alwaysLabelIds, zoom, night]);

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

  // `attempt` only grows when Retry is pressed, so a load with attempt > 0 is a retry.
  const copy = mapStateCopy(status, pageOrigin(), attempt > 0);
  // A map that is not coming (no key, key rejected, load error): the ink frame, and the canvas hidden
  // under it, so Google's own grey error box never shows.
  const noMap = copy?.tone === 'dark';

  return (
    <div
      className={night ? 'map-v2 map-v2--night' : 'map-v2'}
      onMouseLeave={() => {
        setHover(null);
        if (lastHoverIdRef.current !== null) {
          lastHoverIdRef.current = null;
          latest.current.onHover?.(null);
        }
      }}
    >
      {/* Without a key nothing loads, so there is no canvas at all. */}
      {status !== 'missing-key' && (
        <div ref={containerRef} className={noMap ? 'map-v2__canvas map-v2__canvas--hidden' : 'map-v2__canvas'} />
      )}
      <MapPlaceholder copy={copy} onRetry={() => setAttempt((a) => a + 1)} />
      {dayNight && <DayNightBadge phase={dayNight} clockText={clockText} />}
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
