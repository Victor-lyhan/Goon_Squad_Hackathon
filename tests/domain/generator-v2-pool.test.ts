import { describe, expect, it } from 'vitest';
import type { Neighborhood } from '../../shared/v2/types.js';
import { generateHomePool, HOME_POOL_SEED } from '../../server/domain/v2/generator.js';

const neighborhoods: Neighborhood[] = [
  { id: 'nbh-zeta', name: 'Zeta', borough: 'Queens', bbox: { south: 40.70, west: -73.95, north: 40.72, east: -73.92 } },
  { id: 'nbh-alpha', name: 'Alpha', borough: 'Brooklyn', bbox: { south: 40.60, west: -74.02, north: 40.63, east: -73.98 } },
  { id: 'nbh-middle', name: 'Middle', borough: 'Manhattan', bbox: { south: 40.75, west: -73.99, north: 40.78, east: -73.96 } },
];

describe('generateHomePool', () => {
  it('creates a stable, evenly distributed cacheable pool inside neighborhood boxes', () => {
    const first = generateHomePool(neighborhoods);
    const second = generateHomePool(neighborhoods);
    const byName = new Map(neighborhoods.map(neighborhood => [neighborhood.name, neighborhood]));

    expect(HOME_POOL_SEED).toBeTypeOf('number');
    expect(first).toEqual(second);
    expect(first).toHaveLength(120);
    expect(new Set(first.map(home => home.id)).size).toBe(120);
    expect(first.map(home => home.id)).toEqual(Array.from({ length: 120 }, (_, i) => `home-${String(i + 1).padStart(3, '0')}`));

    for (const home of first) {
      const neighborhood = byName.get(home.neighborhood)!;
      expect(home.lat).toBeGreaterThanOrEqual(neighborhood.bbox.south);
      expect(home.lat).toBeLessThanOrEqual(neighborhood.bbox.north);
      expect(home.lng).toBeGreaterThanOrEqual(neighborhood.bbox.west);
      expect(home.lng).toBeLessThanOrEqual(neighborhood.bbox.east);
      expect(home.lat.toString().split('.')[1]?.length ?? 0).toBeLessThanOrEqual(5);
      expect(home.lng.toString().split('.')[1]?.length ?? 0).toBeLessThanOrEqual(5);
    }

    const shares = neighborhoods.map(neighborhood => first.filter(home => home.neighborhood === neighborhood.name).length);
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
    // Scenario seeds are intentionally irrelevant: the pool only uses HOME_POOL_SEED.
    expect(generateHomePool(neighborhoods)).toEqual(first);
  });
});
