// @vitest-environment jsdom
// #649: GoogleBaseMap switching between day and night in a real DOM, with the Google loader and
// deck.gl faked. The one map is kept: only its style changes, and only when the phase changes. The
// deck.gl layers keep their colors; at night each solid route also gets a light casing under it.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Compared with toEqual: each test loads a fresh copy of the map modules, and the two styles differ.
import { MAP_STYLE, NIGHT_MAP_STYLE } from '../../client/src/components/map/mapStyle';
import type { LayerVisibility, MapPlace, MapRoute } from '../../client/src/components/map/types';
import { deferred, flush, mount } from './kitDom';

type FakeLayer = { props: { id: string; data: Array<{ id: string; color?: number[] }> } };

const fake = vi.hoisted(() => ({
  load: null as null | { promise: Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void },
  maps: [] as Array<{ created: { styles?: unknown }; setOptionsCalls: Array<{ styles?: unknown }> }>,
  layers: [] as unknown[],
}));

vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: () => {},
  importLibrary: () => fake.load!.promise,
}));

vi.mock('@deck.gl/google-maps', () => ({
  GoogleMapsOverlay: class {
    setMap() {}
    finalize() {}
    setProps(p: { layers?: unknown[] }) {
      if (p.layers) fake.layers = p.layers;
    }
  },
}));

vi.mock('@deck.gl/layers', () => {
  class Layer {
    constructor(public props: unknown) {}
  }
  return { PathLayer: Layer, ScatterplotLayer: Layer, TextLayer: Layer };
});

class FakeMap {
  created: { styles?: unknown };
  setOptionsCalls: Array<{ styles?: unknown }> = [];
  constructor(_el: unknown, options: { styles?: unknown }) {
    this.created = options;
    fake.maps.push(this);
  }
  setOptions(o: { styles?: unknown }) {
    this.setOptionsCalls.push(o);
  }
  fitBounds() {}
  panTo() {}
}

const visible: LayerVisibility = { routes: true, businesses: true, homes: true, packages: true };
const places: MapPlace[] = [{ id: 'biz-a', kind: 'business', lat: 40.7, lng: -73.99, label: 'DUMBO Café' }];
const routes: MapRoute[] = [
  { id: 'leg-1', kind: 'leg', tone: 'leg1', path: [[-73.99, 40.7], [-73.98, 40.74]], ownerIds: ['shp-1'] },
];

async function freshMap() {
  vi.resetModules();
  return (await import('../../client/src/components/map/GoogleBaseMap')).GoogleBaseMap;
}

async function resolveLoad() {
  await act(async () => {
    fake.load!.resolve({ Map: FakeMap });
    await Promise.resolve();
  });
  await flush();
}

const layers = () => fake.layers as FakeLayer[];
const layerIds = () => layers().map((l) => l.props.id);
const legColor = () => layers().find((l) => l.props.id === 'routes-leg')!.props.data[0].color;
const badge = (root: Element) => root.querySelector('.map-v2__daynight');

beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', 'TEST-ONLY-NOT-A-REAL-KEY-649');
  fake.load = deferred<unknown>();
  fake.maps = [];
  fake.layers = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GoogleBaseMap: day and night', () => {
  it('turns dark and light as the clock moves, on the same map, without touching the route colors', async () => {
    const GoogleBaseMap = await freshMap();
    const el = (dayNight: 'day' | 'night', clockText: string) => (
      <GoogleBaseMap places={places} routes={routes} movers={[]} visible={visible} dayNight={dayNight} clockText={clockText} />
    );
    const m = mount(el('day', 'Day 1 · 4:29 PM'));
    await flush();
    await resolveLoad();

    // Day: the light style from creation, a sun, no casing.
    expect(fake.maps).toHaveLength(1);
    const map = fake.maps[0];
    expect(map.created.styles).toEqual(MAP_STYLE);
    expect(map.setOptionsCalls).toEqual([]);
    expect(badge(m.container)!.querySelector('svg')!.getAttribute('aria-label')).toBe('Day');
    expect(badge(m.container)!.textContent).toBe('Day 1 · 4:29 PM');
    expect(m.container.querySelector('.map-v2--night')).toBeNull();
    expect(layerIds()).toContain('routes-leg');
    expect(layerIds().some((id) => id.endsWith('-night-casing'))).toBe(false);
    const dayColor = legColor();

    // 4:30 PM: the dark style on the same map, a moon, the route as bright as before plus a casing.
    m.rerender(el('night', 'Day 1 · 4:30 PM'));
    expect(fake.maps).toHaveLength(1);
    expect(map.setOptionsCalls).toEqual([{ styles: NIGHT_MAP_STYLE }]);
    expect(badge(m.container)!.querySelector('svg')!.getAttribute('aria-label')).toBe('Night');
    expect(badge(m.container)!.textContent).toBe('Day 1 · 4:30 PM');
    expect(m.container.querySelector('.map-v2--night')).not.toBeNull();
    expect(legColor()).toEqual(dayColor);
    expect(layerIds().indexOf('routes-leg-night-casing')).toBe(layerIds().indexOf('routes-leg') - 1);

    // Later polls in the same night only change the time: the style is not set again.
    m.rerender(el('night', 'Day 1 · 6:12 PM'));
    m.rerender(el('night', 'Day 2 · 1:00 AM'));
    expect(map.setOptionsCalls).toHaveLength(1);
    expect(badge(m.container)!.textContent).toBe('Day 2 · 1:00 AM');

    // 6:45 AM: light again.
    m.rerender(el('day', 'Day 2 · 6:45 AM'));
    expect(map.setOptionsCalls).toEqual([{ styles: NIGHT_MAP_STYLE }, { styles: MAP_STYLE }]);
    expect(badge(m.container)!.querySelector('svg')!.getAttribute('aria-label')).toBe('Day');
    expect(m.container.querySelector('.map-v2--night')).toBeNull();
    expect(layerIds().some((id) => id.endsWith('-night-casing'))).toBe(false);
    expect(legColor()).toEqual(dayColor);
    expect(fake.maps).toHaveLength(1);
  });

  it('a map that loads at night is created dark (no light flash, no second style call)', async () => {
    const GoogleBaseMap = await freshMap();
    mount(<GoogleBaseMap places={places} routes={routes} movers={[]} visible={visible} dayNight="night" clockText="Day 1 · 6:12 PM" />);
    await flush();
    await resolveLoad();
    expect(fake.maps[0].created.styles).toEqual(NIGHT_MAP_STYLE);
    expect(fake.maps[0].setOptionsCalls).toEqual([]);
    expect(layerIds()).toContain('routes-leg-night-casing');
  });

  it('without the prop (Business and Employee maps) the map stays light and its style is never set again', async () => {
    const GoogleBaseMap = await freshMap();
    const el = (r: MapRoute[]) => <GoogleBaseMap places={places} routes={r} movers={[]} visible={visible} />;
    const m = mount(el(routes));
    await flush();
    await resolveLoad();
    m.rerender(el([]));
    m.rerender(el(routes));
    expect(fake.maps[0].created.styles).toEqual(MAP_STYLE);
    expect(fake.maps[0].setOptionsCalls).toEqual([]);
    expect(badge(m.container)).toBeNull();
    expect(m.container.querySelector('.map-v2--night')).toBeNull();
    expect(layerIds().some((id) => id.endsWith('-night-casing'))).toBe(false);
  });
});
