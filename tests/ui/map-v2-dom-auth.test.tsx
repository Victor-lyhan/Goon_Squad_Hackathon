// @vitest-environment jsdom
// GoogleBaseMap when Google rejects the browser key (#510), in a real DOM with the Google loader and
// deck.gl faked: the gm_authFailure watcher is installed before the loader starts and removed on
// unmount, the status stays auth-error whatever the load does, and the overlay gets no more updates.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayerVisibility, MapPlace } from '../../client/src/components/map/types';
import { deferred, flush, mount, textOf } from './kitDom';

const KEY = 'TEST-ONLY-NOT-A-REAL-KEY-510';

const fake = vi.hoisted(() => ({
  load: null as null | { promise: Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void },
  watcherAtLoad: [] as string[],
  importLibrary: { calls: 0 },
  overlays: [] as Array<{ setPropsCount: number; finalized: boolean; map: unknown }>,
}));

vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: () => {},
  importLibrary: () => {
    fake.importLibrary.calls += 1;
    fake.watcherAtLoad.push(typeof (window as { gm_authFailure?: unknown }).gm_authFailure);
    return fake.load!.promise;
  },
}));

vi.mock('@deck.gl/google-maps', () => ({
  GoogleMapsOverlay: class {
    setPropsCount = 0;
    finalized = false;
    map: unknown = null;
    constructor() {
      fake.overlays.push(this);
    }
    setMap(m: unknown) {
      this.map = m;
    }
    finalize() {
      this.finalized = true;
    }
    setProps() {
      this.setPropsCount += 1;
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
  fitBounds() {}
  panTo() {}
}

const visible: LayerVisibility = { routes: true, businesses: true, homes: true, packages: true };
const placesA: MapPlace[] = [{ id: 'biz-a', kind: 'business', lat: 40.7, lng: -73.99, label: 'DUMBO Café' }];
const placesB: MapPlace[] = [...placesA, { id: 'biz-b', kind: 'business', lat: 40.72, lng: -73.98, label: 'Bakery Row' }];

type W = { gm_authFailure?: unknown };
const win = () => window as unknown as W;

async function freshMap() {
  // A fresh module per test: the "Google already rejected the key on this page" flag lives in it.
  vi.resetModules();
  return (await import('../../client/src/components/map/GoogleBaseMap')).GoogleBaseMap;
}

const setPropsCalls = () => fake.overlays[0].setPropsCount;

beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', KEY);
  const d = deferred<unknown>();
  fake.load = d;
  fake.watcherAtLoad = [];
  fake.importLibrary.calls = 0;
  fake.overlays = [];
  delete win().gm_authFailure;
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete win().gm_authFailure;
});

async function resolveLoad() {
  await act(async () => {
    fake.load!.resolve({ Map: FakeMap });
    await Promise.resolve();
  });
  await flush();
}

function fireAuthFailure() {
  act(() => {
    (win().gm_authFailure as () => void)();
  });
}

// #890: the rejected key is said in the placeholder's status region (polite), never in an alert.
const REJECTED = 'Google rejected the browser key.';
const noticeOf = (root: Element) => {
  expect(root.querySelector('[role="alert"], [aria-live="assertive"]')).toBeNull();
  const region = root.querySelector('.map-v2__state-text[role="status"]');
  return region && textOf(region).includes(REJECTED) ? region : null;
};

describe('GoogleBaseMap: Google rejects the browser key', () => {
  it('installs the watcher before the loader starts', async () => {
    const GoogleBaseMap = await freshMap();
    mount(<GoogleBaseMap places={placesA} routes={[]} movers={[]} visible={visible} />);
    await flush();
    expect(fake.importLibrary.calls).toBe(1);
    expect(fake.watcherAtLoad).toEqual(['function']);
  });

  it('failure then load: shows the rejected-key notice and a later load does not switch to ready or create an overlay', async () => {
    const GoogleBaseMap = await freshMap();
    const m = mount(<GoogleBaseMap places={placesA} routes={[]} movers={[]} visible={visible} />);
    await flush();
    fireAuthFailure();
    expect(noticeOf(m.container)).not.toBeNull();
    await resolveLoad();
    expect(noticeOf(m.container)).not.toBeNull();
    expect(m.container.textContent).not.toContain('Loading the map');
    expect(fake.overlays).toHaveLength(0);
  });

  it('load then failure: the overlay is detached and gets no more layer updates', async () => {
    const GoogleBaseMap = await freshMap();
    const el = (places: MapPlace[]) => <GoogleBaseMap places={places} routes={[]} movers={[]} visible={visible} />;
    const m = mount(el(placesA));
    await flush();
    await resolveLoad();
    expect(noticeOf(m.container)).toBeNull();
    m.rerender(el(placesB));
    const before = setPropsCalls();
    expect(before).toBeGreaterThan(0);

    fireAuthFailure();
    const overlay = fake.overlays[0];
    expect(overlay.map).toBeNull();
    expect(overlay.finalized).toBe(true);
    expect(noticeOf(m.container)).not.toBeNull();

    m.rerender(el(placesA));
    m.rerender(el(placesB));
    expect(setPropsCalls()).toBe(before);
  });

  it('keeps the map area and its status region, prints the origin and never the key', async () => {
    const GoogleBaseMap = await freshMap();
    const m = mount(<GoogleBaseMap places={placesA} routes={[]} movers={[]} visible={visible} selectedIds={['biz-a']} />);
    await flush();
    fireAuthFailure();
    const root = m.container.querySelector('.map-v2');
    expect(root).not.toBeNull();
    // The canvas stays in the page, hidden under the ink frame: Google's grey error box never shows.
    expect(root!.querySelector('.map-v2__canvas--hidden')).not.toBeNull();
    expect(root!.querySelector('.map-v2__state--dark')).not.toBeNull();
    expect(textOf(m.container.querySelector('[data-testid="map-selected"]')!)).toBe(
      'Selected on map: DUMBO Café, Network business',
    );
    expect(textOf(noticeOf(m.container)!)).toContain(`allow ${window.location.origin} for the key in Google Cloud`);
    expect(m.container.innerHTML).not.toContain(KEY);
    expect(m.container.querySelector('button')).toBeNull(); // no Retry: only a reload helps
  });

  it('removes the watcher on unmount and puts back a handler that was there before', async () => {
    const before = vi.fn();
    win().gm_authFailure = before;
    const GoogleBaseMap = await freshMap();
    const m = mount(<GoogleBaseMap places={placesA} routes={[]} movers={[]} visible={visible} />);
    await flush();
    expect(win().gm_authFailure).not.toBe(before);
    fireAuthFailure();
    expect(before).toHaveBeenCalledTimes(1);
    m.unmount();
    expect(win().gm_authFailure).toBe(before);
  });

  it('a map mounted after the failure on the same page starts in auth-error without loading again', async () => {
    const GoogleBaseMap = await freshMap();
    const first = mount(<GoogleBaseMap places={placesA} routes={[]} movers={[]} visible={visible} />);
    await flush();
    fireAuthFailure();
    first.unmount();
    expect(win().gm_authFailure).toBeUndefined();

    const second = mount(<GoogleBaseMap places={placesA} routes={[]} movers={[]} visible={visible} />);
    await flush();
    expect(noticeOf(second.container)).not.toBeNull();
    expect(fake.importLibrary.calls).toBe(1);
  });
});
