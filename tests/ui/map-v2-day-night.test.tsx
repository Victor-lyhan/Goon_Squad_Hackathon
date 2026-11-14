// #649 (docs/mvp3.md P1 "Day vs night must be obvious"): the pure day/night function, the dark
// basemap style, the night casing under routes, the sun/moon badge, its CSS and the simulator's map
// props. All in Node (no DOM, no WebGL, no key).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DAY_NIGHT_ALT, NIGHT_CASING, NIGHT_CASING_EXTRA_PX, NIGHT_END_MIN, NIGHT_START_MIN, dayNightAt, dayNightClockText,
  withNightCasing,
} from '../../client/src/components/map/dayNight';
import { DayNightBadge, GoogleBaseMap } from '../../client/src/components/map/GoogleBaseMap';
import { buildLayerSpecs, type PathSpec } from '../../client/src/components/map/layers';
import { MAP_STYLE, NIGHT_MAP_STYLE, mapStyleFor } from '../../client/src/components/map/mapStyle';
import { mapOptions } from '../../client/src/components/map/mapModel';
import type { LayerVisibility, MapPlace, MapRoute } from '../../client/src/components/map/types';
import { simPageView, type SimReadyView } from '../../client/src/components/sim/v2/compose/simPageView';
import { INITIAL_SIM_DATA, type SimDataState } from '../../client/src/components/sim/v2/live/simDataModel';
import { DEFAULT_LAYERS } from '../../client/src/components/sim/v2/workspaceModel';
import { T, map as journeyMap, simAt } from './sim-v2-journey-sample';
import { RULES, resolveVars } from './sim-v2-qa-css-rules';

const visible: LayerVisibility = { routes: true, businesses: true, homes: true, packages: true };
const places: MapPlace[] = [{ id: 'biz-a', kind: 'business', lat: 40.7, lng: -73.99, label: 'DUMBO Café' }];
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('dayNightAt', () => {
  it('is night from Day 1 4:30 PM (990) up to Day 2 6:45 AM (1845), day otherwise', () => {
    expect([NIGHT_START_MIN, NIGHT_END_MIN]).toEqual([990, 1845]);
    expect(dayNightAt(989)).toBe('day');
    expect(dayNightAt(990)).toBe('night');
    expect(dayNightAt(1844)).toBe('night');
    expect(dayNightAt(1845)).toBe('day');
  });

  it('the ends of the run are day: Day 1 3:30 PM (930) and Day 2 noon (2160)', () => {
    expect(dayNightAt(930)).toBe('day');
    expect(dayNightAt(2160)).toBe('day');
  });

  it('midnight is night; a clock that is not a number is day', () => {
    expect(dayNightAt(1440)).toBe('night');
    expect(dayNightAt(Number.NaN)).toBe('day');
  });

  it('the badge time reads "Day 1 · 6:12 PM"', () => {
    expect(dayNightClockText(1092)).toBe('Day 1 · 6:12 PM');
    expect(dayNightClockText(990)).toBe('Day 1 · 4:30 PM');
    expect(dayNightClockText(1845)).toBe('Day 2 · 6:45 AM');
    expect(dayNightClockText(1440)).toBe('Day 2 · 12:00 AM');
  });
});

describe('NIGHT_MAP_STYLE', () => {
  const colorsOf = (style: typeof MAP_STYLE) =>
    style.flatMap((s) => s.stylers.map((st) => st.color)).filter((c): c is string => typeof c === 'string');
  const shape = (style: typeof MAP_STYLE) =>
    style.map((s) => `${s.featureType ?? ''}|${s.elementType ?? ''}|${s.stylers.map((st) => st.visibility ?? 'color').join(',')}`);

  it('has the same rules as the light style (no POI, transit or road labels), only the colors differ', () => {
    expect(shape(NIGHT_MAP_STYLE)).toEqual(shape(MAP_STYLE));
  });

  it('every surface (land, roads, parks, water) is dark, and much darker than by day', () => {
    const geometry = (style: typeof MAP_STYLE) =>
      style.filter((s) => s.elementType === 'geometry').map((s) => String(s.stylers[0].color));
    const day = geometry(MAP_STYLE);
    const night = geometry(NIGHT_MAP_STYLE);
    expect(night.length).toBe(day.length);
    night.forEach((c, i) => {
      expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      expect(luminance(c), c).toBeLessThan(0.08);
      expect(luminance(day[i]) / luminance(c), `${day[i]} → ${c}`).toBeGreaterThan(8);
    });
    for (const c of colorsOf(NIGHT_MAP_STYLE)) expect(luminance(c), c).toBeLessThan(0.4);
  });

  it('mapStyleFor: night gets the dark style; day and "no prop" get the light one', () => {
    expect(mapStyleFor('night')).toBe(NIGHT_MAP_STYLE);
    expect(mapStyleFor('day')).toBe(MAP_STYLE);
    expect(mapStyleFor(undefined)).toBe(MAP_STYLE);
    expect(mapOptions().styles).toBe(MAP_STYLE); // the default map is unchanged
  });
});

describe('withNightCasing: routes on the dark map', () => {
  const routes: MapRoute[] = [
    { id: 'leg-1', kind: 'leg', tone: 'leg1', path: [[-73.99, 40.7], [-73.98, 40.74]], ownerIds: ['shp-1'] },
    { id: 'base-1', kind: 'baseline', path: [[-73.99, 40.7], [-73.95, 40.72]], ownerIds: ['emp-1'] },
  ];
  const day = buildLayerSpecs({ places, routes, movers: [], visible });
  const night = withNightCasing(day);
  const isCasing = (id: string) => id.endsWith('-night-casing');

  it('keeps every day layer as it is, in the same order: nothing is recolored or dimmed', () => {
    expect(night.filter((s) => !isCasing(s.id))).toEqual(day);
  });

  it('puts a light, wider, non-pickable line directly under each solid route', () => {
    const legs = day.find((s) => s.id === 'routes-leg') as PathSpec;
    const at = night.findIndex((s) => s.id === 'routes-leg');
    const casing = night[at - 1] as PathSpec;
    expect(casing.id).toBe('routes-leg-night-casing');
    expect(casing.type).toBe('path');
    expect(casing.props.pickable).toBe(false);
    expect(casing.props.widthUnits).toBe(legs.props.widthUnits);
    expect(casing.data.map((d) => d.id)).toEqual(['leg-1']);
    expect(casing.data[0].path).toBe(legs.data[0].path);
    expect(casing.data[0].color).toEqual(NIGHT_CASING);
    expect(casing.data[0].width).toBe(legs.data[0].width + NIGHT_CASING_EXTRA_PX);
  });

  it('gives faint lines (the normal commute, dimmed routes) no casing', () => {
    expect(night.some((s) => s.id === 'routes-baseline-night-casing')).toBe(false);
    // With something else selected the leg is dimmed, so it gets no casing either.
    const dimmed = withNightCasing(buildLayerSpecs({ places, routes, movers: [], visible, selectedIds: ['biz-a'] }));
    expect(dimmed.some((s) => isCasing(s.id))).toBe(false);
  });

  it('adds nothing when there are no routes', () => {
    const none = buildLayerSpecs({ places, routes: [], movers: [], visible });
    expect(withNightCasing(none)).toEqual(none);
  });
});

describe('DayNightBadge', () => {
  it('night: a moon with the text alternative "Night" and the time', () => {
    const html = renderToStaticMarkup(<DayNightBadge phase="night" clockText="Day 1 · 6:12 PM" />);
    expect(html).toContain('class="map-v2__daynight map-v2__daynight--night"');
    expect(html).toContain('data-day-night="night"');
    expect(html).toMatch(/<svg[^>]*role="img"[^>]*aria-label="Night"/);
    expect(text(html)).toBe('Day 1 · 6:12 PM');
  });

  it('day: a sun with the text alternative "Day" and the time', () => {
    const html = renderToStaticMarkup(<DayNightBadge phase="day" clockText="Day 2 · 8:30 AM" />);
    expect(html).toContain('class="map-v2__daynight map-v2__daynight--day"');
    expect(html).toMatch(/<svg[^>]*role="img"[^>]*aria-label="Day"/);
    expect(html).toContain('<circle'); // the sun's disc; the moon is one path
    expect(text(html)).toBe('Day 2 · 8:30 AM');
    expect(DAY_NIGHT_ALT).toEqual({ day: 'Day', night: 'Night' });
  });

  it('without a time it is the icon alone', () => {
    const html = renderToStaticMarkup(<DayNightBadge phase="night" />);
    expect(html).toContain('aria-label="Night"');
    expect(html).not.toContain('map-v2__daynight-time');
  });
});

describe('GoogleBaseMap with the day/night prop (static render)', () => {
  const render = (props: { dayNight?: 'day' | 'night'; clockText?: string }) =>
    renderToStaticMarkup(<GoogleBaseMap places={places} routes={[]} movers={[]} visible={visible} {...props} />);

  it('night: the map area is marked dark and the badge shows the moon and the time', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', 'TEST-ONLY-NOT-A-REAL-KEY-649');
    const html = render({ dayNight: 'night', clockText: 'Day 1 · 6:12 PM' });
    expect(html.startsWith('<div class="map-v2 map-v2--night">')).toBe(true);
    expect(html).toContain('aria-label="Night"');
    expect(text(html)).toContain('Day 1 · 6:12 PM');
  });

  it('day: the light map area and the badge with the sun', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', 'TEST-ONLY-NOT-A-REAL-KEY-649');
    const html = render({ dayNight: 'day', clockText: 'Day 2 · 8:30 AM' });
    expect(html.startsWith('<div class="map-v2">')).toBe(true);
    expect(html).toContain('aria-label="Day"');
    expect(text(html)).toContain('Day 2 · 8:30 AM');
  });

  it('without the prop (Business and Employee maps) nothing changes: no badge, no night class', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', 'TEST-ONLY-NOT-A-REAL-KEY-649');
    const html = render({});
    expect(html.startsWith('<div class="map-v2">')).toBe(true);
    expect(html).not.toContain('daynight');
    expect(html).not.toContain('map-v2--night');
    // A clock text alone shows nothing either.
    expect(render({ clockText: 'Day 1 · 6:12 PM' })).toBe(html);
  });

  it('without a key the badge still shows next to the key-missing message', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
    const html = render({ dayNight: 'night', clockText: 'Day 1 · 6:12 PM' });
    expect(text(html)).toContain('Google Maps key missing.');
    expect(html).toContain('aria-label="Night"');
    expect(render({})).not.toContain('daynight');
  });
});

describe('map.css: the badge and the night map area', () => {
  const mapRules = RULES.filter((r) => r.file.endsWith('map/map.css'));
  const decl = (selector: string, prop: string) =>
    mapRules
      .filter((r) => r.selectors.includes(selector) && r.media === null)
      .flatMap((r) => r.decls)
      .filter(([p]) => p === prop)
      .map(([, v]) => v)
      .pop();
  const color = (selector: string, prop: string) => resolveVars(decl(selector, prop) ?? '');

  it('the time is in IBM Plex Mono', () => {
    expect(decl('.map-v2__daynight', 'font-family')).toMatch(/^var\(--font-mono, 'IBM Plex Mono'/);
  });

  it('the badge text meets 4.5:1 on both backgrounds', () => {
    const day = contrast(color('.map-v2__daynight', 'color'), color('.map-v2__daynight', 'background'));
    const night = contrast(color('.map-v2__daynight--night', 'color'), color('.map-v2__daynight--night', 'background'));
    expect(day).toBeGreaterThanOrEqual(4.5);
    expect(night).toBeGreaterThanOrEqual(4.5);
    // The night badge is the dark one.
    expect(luminance(color('.map-v2__daynight--night', 'background'))).toBeLessThan(0.05);
    expect(luminance(color('.map-v2__daynight', 'background'))).toBeGreaterThan(0.8);
  });

  it('the area behind the night tiles is dark, so tiles do not load over a light flash', () => {
    expect(luminance(color('.map-v2--night', 'background'))).toBeLessThan(0.05);
  });

  it('the badge sits above the map and takes no clicks; the switch has no animation at all', () => {
    expect(decl('.map-v2__daynight', 'position')).toBe('absolute');
    expect(Number(decl('.map-v2__daynight', 'z-index'))).toBeGreaterThanOrEqual(2);
    expect(decl('.map-v2__daynight', 'pointer-events')).toBe('none');
    // No transition or animation anywhere in map.css, so the switch is instant with and without
    // prefers-reduced-motion.
    const moving = mapRules.flatMap((r) => r.decls).filter(([p, v]) => /^(transition|animation)/.test(p) && v !== 'none');
    expect(moving).toEqual([]);
    // Nothing in map.css dims what is drawn on the map.
    for (const r of mapRules.filter((x) => x.selectors.some((s) => /night|canvas/.test(s)))) {
      expect(r.decls.map(([p]) => p).filter((p) => p === 'opacity' || p === 'filter')).toEqual([]);
    }
  });
});

describe('simPageView: the map follows the polled clock', () => {
  const dataAt = (timeMin: number): SimDataState =>
    ({ ...INITIAL_SIM_DATA, view: 'ready', sim: simAt(timeMin, { 'shp-2': 'at_hub' }), map: journeyMap });
  const mapAt = (timeMin: number, packageId?: string) => {
    const v = simPageView({
      data: dataAt(timeMin), selection: packageId ? { kind: 'package', id: packageId } : null, layers: DEFAULT_LAYERS,
    });
    expect(v.view).toBe('ready');
    return v as SimReadyView;
  };
  const sky = (v: SimReadyView) => ({ dayNight: v.map.dayNight, clockText: v.map.clockText });

  it('network mode: light before 4:30 PM, dark overnight, light again in the morning', () => {
    expect(sky(mapAt(989))).toEqual({ dayNight: 'day', clockText: 'Day 1 · 4:29 PM' });
    expect(sky(mapAt(990))).toEqual({ dayNight: 'night', clockText: 'Day 1 · 4:30 PM' });
    expect(sky(mapAt(T.overnight))).toEqual({ dayNight: 'night', clockText: 'Day 2 · 1:00 AM' });
    expect(sky(mapAt(1844))).toEqual({ dayNight: 'night', clockText: 'Day 2 · 6:44 AM' });
    expect(sky(mapAt(1845))).toEqual({ dayNight: 'day', clockText: 'Day 2 · 6:45 AM' });
  });

  it('journey mode: the evening leg is dark, the morning leg is light', () => {
    const evening = mapAt(T.onLeg1, 'shp-2');
    expect(evening.mode).toBe('journey');
    expect(evening.right.kind).toBe('journey');
    expect(sky(evening)).toEqual({ dayNight: 'night', clockText: 'Day 1 · 5:30 PM' });
    const morning = mapAt(T.onLeg2, 'shp-2');
    expect(morning.right.kind).toBe('journey');
    expect(sky(morning)).toEqual({ dayNight: 'day', clockText: 'Day 2 · 8:40 AM' });
  });

  it('an unmatched package and an unknown package ID get the same sky as the network', () => {
    expect(sky(mapAt(T.overnight, 'shp-3'))).toEqual({ dayNight: 'night', clockText: 'Day 2 · 1:00 AM' });
    expect(sky(mapAt(T.overnight, 'shp-nope'))).toEqual({ dayNight: 'night', clockText: 'Day 2 · 1:00 AM' });
  });

  it('the value is the polled clock, read as is (the same object fields every poll)', () => {
    const data = dataAt(1092);
    const v = simPageView({ data, selection: null, layers: DEFAULT_LAYERS }) as SimReadyView;
    expect(data.sim!.clock.timeMin).toBe(1092);
    expect(sky(v)).toEqual({ dayNight: 'night', clockText: 'Day 1 · 6:12 PM' });
  });
});
