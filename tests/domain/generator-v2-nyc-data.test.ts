import { describe, expect, it } from 'vitest';
import businessesFixture from '../../fixtures/nyc/businesses.json';
import neighborhoodsFixture from '../../fixtures/nyc/neighborhoods.json';
import demoStoryFixture from '../../fixtures/nyc/demoStory.json';

type Borough = 'Manhattan' | 'Brooklyn' | 'Queens';
type BusinessKind = 'office' | 'shop' | 'cafe';
type Business = {
  id: string;
  name: string;
  address: string;
  neighborhood: string;
  borough: Borough;
  kind: BusinessKind;
};
type Neighborhood = {
  id: string;
  name: string;
  borough: Borough;
  bbox: { south: number; west: number; north: number; east: number };
};
type FeaturedEmployee = {
  id: string;
  name: string;
  businessId: string;
  home: { id: string; neighborhood: string; lat: number; lng: number };
  eveningDepartureMin: number;
  morningDepartureMin: number;
  maxExtraMin: number;
  availableEvening: boolean;
  availableMorning: boolean;
  note: string;
};
type Shipment = {
  label: string;
  description: string;
  category: 'envelope' | 'small_box';
  weightGrams: number;
  originBusinessId: string;
  destinationBusinessId: string;
  readyMin: number;
  deadlineMin: number;
  pickupInstructions: string;
  dropoffInstructions: string;
  expect: 'direct' | 'relay' | 'any';
  note?: string;
};

const businesses = businessesFixture.businesses as Business[];
const neighborhoods = neighborhoodsFixture.neighborhoods as Neighborhood[];
const featuredEmployees = demoStoryFixture.featuredEmployees as FeaturedEmployee[];
const shipments = demoStoryFixture.shipments as Shipment[];

const unique = (values: string[]) => new Set(values).size === values.length;

const containsCoordinateKey = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(containsCoordinateKey);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).some(([key, child]) =>
      key === 'lat' || key === 'lng' || containsCoordinateKey(child));
  }
  return false;
};

describe('curated NYC fixture data', () => {
  it('has an address-only network business directory with the intended mix', () => {
    expect(businesses).toHaveLength(18);
    expect(unique(businesses.map((business) => business.id))).toBe(true);
    expect(businesses.every((business) => /^biz-[a-z0-9-]+$/.test(business.id))).toBe(true);
    expect(businesses.filter((business) => business.borough === 'Manhattan')).toHaveLength(8);
    expect(businesses.filter((business) => business.borough === 'Brooklyn')).toHaveLength(6);
    expect(businesses.filter((business) => business.borough === 'Queens')).toHaveLength(4);

    for (const kind of ['office', 'shop', 'cafe'] satisfies BusinessKind[]) {
      expect(businesses.filter((business) => business.kind === kind).length).toBeGreaterThanOrEqual(4);
    }
    expect(containsCoordinateKey(businessesFixture)).toBe(false);
  });

  it('keeps residential neighborhood boxes conservative and within NYC', () => {
    expect(neighborhoods.length).toBeGreaterThanOrEqual(8);
    expect(neighborhoods.length).toBeLessThanOrEqual(10);
    expect(unique(neighborhoods.map((neighborhood) => neighborhood.id))).toBe(true);

    for (const neighborhood of neighborhoods) {
      const { south, west, north, east } = neighborhood.bbox;
      const northSouthKm = (north - south) * 111;
      const eastWestKm = (east - west) * 111 * Math.cos(((south + north) / 2) * Math.PI / 180);

      expect(south).toBeLessThan(north);
      expect(west).toBeLessThan(east);
      expect(south).toBeGreaterThanOrEqual(40.49);
      expect(north).toBeLessThanOrEqual(40.92);
      expect(west).toBeGreaterThanOrEqual(-74.27);
      expect(east).toBeLessThanOrEqual(-73.68);
      expect(northSouthKm).toBeGreaterThanOrEqual(0.5);
      expect(northSouthKm).toBeLessThanOrEqual(3);
      expect(eastWestKm).toBeGreaterThanOrEqual(0.5);
      expect(eastWestKm).toBeLessThanOrEqual(3);
    }
  });

  it('places featured commute endpoints inside their named neighborhood boxes', () => {
    expect(featuredEmployees.length).toBeGreaterThanOrEqual(8);
    expect(featuredEmployees.length).toBeLessThanOrEqual(10);
    const businessIds = new Set(businesses.map((business) => business.id));
    const neighborhoodByName = new Map(neighborhoods.map((neighborhood) => [neighborhood.name, neighborhood]));

    for (const [index, employee] of featuredEmployees.entries()) {
      expect(employee.id).toBe(`emp-${index + 1}`);
      expect(businessIds.has(employee.businessId)).toBe(true);
      const neighborhood = neighborhoodByName.get(employee.home.neighborhood);
      expect(neighborhood).toBeDefined();
      const bbox = neighborhood!.bbox;
      expect(employee.home.lat).toBeGreaterThanOrEqual(bbox.south);
      expect(employee.home.lat).toBeLessThanOrEqual(bbox.north);
      expect(employee.home.lng).toBeGreaterThanOrEqual(bbox.west);
      expect(employee.home.lng).toBeLessThanOrEqual(bbox.east);
      expect(employee.eveningDepartureMin).toBeGreaterThanOrEqual(990);
      expect(employee.eveningDepartureMin).toBeLessThanOrEqual(1110);
      expect(employee.morningDepartureMin).toBeGreaterThanOrEqual(1860);
      expect(employee.morningDepartureMin).toBeLessThanOrEqual(1980);
      expect(employee.maxExtraMin).toBeGreaterThanOrEqual(5);
      expect(employee.maxExtraMin).toBeLessThanOrEqual(15);
      expect(employee.availableEvening).toBe(true);
      expect(employee.availableMorning).toBe(true);
    }
  });

  it('supplies 24 valid, distinct business-to-business package requests', () => {
    expect(shipments).toHaveLength(24);
    expect(unique(shipments.map((shipment) => shipment.label))).toBe(true);
    const businessIds = new Set(businesses.map((business) => business.id));

    for (const shipment of shipments) {
      expect(businessIds.has(shipment.originBusinessId)).toBe(true);
      expect(businessIds.has(shipment.destinationBusinessId)).toBe(true);
      expect(shipment.originBusinessId).not.toBe(shipment.destinationBusinessId);
      expect(shipment.readyMin).toBeGreaterThanOrEqual(930);
      expect(shipment.readyMin).toBeLessThanOrEqual(2160);
      expect(shipment.deadlineMin).toBeGreaterThanOrEqual(shipment.readyMin);
      expect(shipment.deadlineMin).toBeLessThanOrEqual(2160);
      expect(shipment.weightGrams).toBeGreaterThan(0);
      expect(shipment.weightGrams).toBeLessThanOrEqual(2000);
      expect(['envelope', 'small_box']).toContain(shipment.category);
      expect(['direct', 'relay', 'any']).toContain(shipment.expect);
    }

    const storyShipments = shipments.slice(0, 8);
    expect(storyShipments.filter((shipment) => shipment.expect === 'direct').length).toBeGreaterThanOrEqual(3);
    expect(storyShipments.filter((shipment) => shipment.expect === 'relay').length).toBeGreaterThanOrEqual(3);
  });
});
