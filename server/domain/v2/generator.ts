import type {
  Employee,
  Home,
  Neighborhood,
  NetworkBusiness,
  NycBusinessesFile,
  NycDemoStoryFile,
  NycNeighborhoodsFile,
  Scenario,
  Shipment,
  TravelMatrixFile,
} from '../../../shared/v2/types.js';
import type { GenerateScenarioRequest } from '../../../shared/v2/schemas.js';
import { createRng } from './rng.js';
import { DEFAULT_SETTINGS } from '../pricing.js';

/** Stable seed for cacheable synthetic homes; it deliberately does not use a scenario seed. */
export const HOME_POOL_SEED = 20_261_114;

const backgroundFirstNames = [
  'Avery', 'Blair', 'Casey', 'Devon', 'Emery', 'Finley', 'Gray', 'Hayden', 'Indy', 'Jules',
  'Kai', 'Lane', 'Morgan', 'Noel', 'Oakley', 'Parker', 'Quinn', 'Reese', 'Sawyer', 'Taylor',
];
const backgroundLastNames = [
  'Allen', 'Brooks', 'Chen', 'Davis', 'Ellis', 'Flores', 'Green', 'Hughes', 'Irwin', 'Jones',
  'Kim', 'Lopez', 'Martin', 'Nguyen', 'Owens', 'Patel', 'Reed', 'Shaw', 'Turner', 'Walker',
];

const packageIdeas: Array<Pick<Shipment, 'label' | 'description' | 'category'>> = [
  { label: 'Signed agreement', description: 'Executed documents for the recipient records team.', category: 'envelope' },
  { label: 'Campaign proofs', description: 'Final color proofs for review and approval.', category: 'envelope' },
  { label: 'Product sample kit', description: 'Small presentation samples for tomorrow morning.', category: 'small_box' },
  { label: 'Training workbooks', description: 'Bound workbooks for a morning workshop.', category: 'small_box' },
  { label: 'Coffee tasting box', description: 'Sealed tasting samples for the office kitchen.', category: 'small_box' },
  { label: 'Invoice packet', description: 'Printed invoices and supporting documents.', category: 'envelope' },
];

export type BuildNycScenarioInput = {
  businessesFile: NycBusinessesFile;
  neighborhoodsFile: NycNeighborhoodsFile;
  storyFile: NycDemoStoryFile;
  places: TravelMatrixFile['places'];
  request: GenerateScenarioRequest;
};

function roundedCoordinate(value: number): number {
  return Number(value.toFixed(5));
}

/**
 * Creates cacheable, non-address home endpoints distributed evenly by neighborhood.
 * The fixed seed makes this independent from the scenario's Random preset seed.
 */
export function generateHomePool(
  neighborhoods: Neighborhood[],
  opts: { seed?: number; count?: number } = {},
): Home[] {
  const count = opts.count ?? 120;
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError('count must be a non-negative integer');
  }
  const ordered = [...neighborhoods].sort((a, b) => a.id.localeCompare(b.id));
  if (count > 0 && ordered.length === 0) {
    throw new RangeError('at least one neighborhood is required to generate homes');
  }

  const rng = createRng(opts.seed ?? HOME_POOL_SEED);
  const perNeighborhood = Math.floor(count / ordered.length);
  const remainder = count % ordered.length;
  const homes: Home[] = [];

  for (const [neighborhoodIndex, neighborhood] of ordered.entries()) {
    const { south, west, north, east } = neighborhood.bbox;
    if (north <= south || east <= west) {
      throw new RangeError(`neighborhood ${neighborhood.id} has an invalid bbox`);
    }
    const share = perNeighborhood + (neighborhoodIndex < remainder ? 1 : 0);
    const latPadding = (north - south) * 0.1;
    const lngPadding = (east - west) * 0.1;
    for (let index = 0; index < share; index += 1) {
      homes.push({
        id: `home-${String(homes.length + 1).padStart(3, '0')}`,
        neighborhood: neighborhood.name,
        lat: roundedCoordinate(south + latPadding + rng.next() * (north - south - 2 * latPadding)),
        lng: roundedCoordinate(west + lngPadding + rng.next() * (east - west - 2 * lngPadding)),
      });
    }
  }
  return homes;
}

function businessesWithCoordinates(
  file: NycBusinessesFile,
  places: TravelMatrixFile['places'],
): NetworkBusiness[] {
  return file.businesses.map(business => {
    const place = places[business.id];
    if (!place) {
      throw new Error(`Missing geocoded coordinates for business ${business.id}; run npm run fetch:routes.`);
    }
    return { ...business, lat: place.lat, lng: place.lng };
  });
}

/**
 * A plain "First Last" name that no employee of the run has yet. The PRNG is asked exactly twice per employee
 * (first name, last name), so the draws that follow are the same whether the pair is free or taken. A taken
 * pair moves to the next last name in the list (wrapping round), then to the next first name; no name ever
 * gets a number. `used` starts with the story employees' names, so a generated name never equals one of them.
 */
function uniqueName(rng: ReturnType<typeof createRng>, used: Set<string>): string {
  const firstStart = backgroundFirstNames.indexOf(rng.pick(backgroundFirstNames));
  const lastStart = backgroundLastNames.indexOf(rng.pick(backgroundLastNames));
  for (let firstStep = 0; firstStep < backgroundFirstNames.length; firstStep += 1) {
    const first = backgroundFirstNames[(firstStart + firstStep) % backgroundFirstNames.length]!;
    for (let lastStep = 0; lastStep < backgroundLastNames.length; lastStep += 1) {
      const name = `${first} ${backgroundLastNames[(lastStart + lastStep) % backgroundLastNames.length]!}`;
      if (!used.has(name)) {
        used.add(name);
        return name;
      }
    }
  }
  throw new RangeError('not enough distinct names for requested employees');
}

function departureTimes(rng: ReturnType<typeof createRng>): Pick<Employee, 'eveningDepartureMin' | 'morningDepartureMin'> {
  return {
    eveningDepartureMin: 990 + rng.int(0, 24) * 5,
    morningDepartureMin: 1860 + rng.int(0, 24) * 5,
  };
}

function nextEmployeeId(existing: Set<string>, ordinal: number): string {
  let number = ordinal;
  while (existing.has(`emp-${number}`)) number += 1;
  return `emp-${number}`;
}

function backgroundEmployees(
  rng: ReturnType<typeof createRng>,
  count: number,
  businesses: NetworkBusiness[],
  homes: Home[],
  maxExtraMin: number,
  featured: Employee[] = [],
  reservedNames: string[] = [],
): Employee[] {
  if (count === 0) return [];
  if (businesses.length === 0) throw new RangeError('at least one business is required to generate employees');
  if (count > homes.length) throw new RangeError('not enough unused pool homes for requested employees');

  const availableHomes = rng.shuffle(homes);
  const businessCounts = new Map(businesses.map(business => [business.id, 0]));
  for (const employee of featured) {
    businessCounts.set(employee.businessId, (businessCounts.get(employee.businessId) ?? 0) + 1);
  }
  const names = new Set([...featured.map(employee => employee.name), ...reservedNames]);
  const ids = new Set(featured.map(employee => employee.id));
  const employees: Employee[] = [];

  for (let index = 0; index < count; index += 1) {
    const underrepresented = businesses.filter(business => (businessCounts.get(business.id) ?? 0) < 2);
    const business = underrepresented.length > 0
      ? rng.pick(underrepresented)
      : rng.pick(businesses);
    const id = nextEmployeeId(ids, featured.length + index + 1);
    ids.add(id);
    businessCounts.set(business.id, (businessCounts.get(business.id) ?? 0) + 1);
    employees.push({
      id,
      name: uniqueName(rng, names),
      businessId: business.id,
      homeId: availableHomes[index]!.id,
      ...departureTimes(rng),
      maxExtraMin,
      availableEvening: true,
      availableMorning: true,
    });
  }
  return employees;
}

function storyEmployees(story: NycDemoStoryFile): { employees: Employee[]; homes: Home[] } {
  const employees = story.featuredEmployees.map(({ home, note: _note, ...employee }) => ({
    ...employee,
    homeId: home.id,
  }));
  return { employees, homes: story.featuredEmployees.map(employee => employee.home) };
}

function randomShipments(
  rng: ReturnType<typeof createRng>,
  businesses: NetworkBusiness[],
  count: number,
  seed: number,
): Shipment[] {
  if (count === 0) return [];
  if (businesses.length < 2) throw new RangeError('at least two businesses are required to generate shipments');
  return Array.from({ length: count }, (_, index) => {
    const origin = rng.pick(businesses);
    let destination = rng.pick(businesses);
    while (destination.id === origin.id) destination = rng.pick(businesses);
    const idea = rng.pick(packageIdeas);
    const sequence = index + 1;
    return {
      ...idea,
      id: `shp-${sequence}`,
      clientRequestId: `seed-${seed}-${sequence}`,
      originBusinessId: origin.id,
      destinationBusinessId: destination.id,
      readyMin: 960,
      deadlineMin: 2040,
      weightGrams: rng.int(100, 2_000),
      pickupInstructions: 'Please collect the prepared Relay parcel from reception.',
      dropoffInstructions: 'Please leave with reception and confirm the recipient business name.',
      createdSeq: sequence,
    };
  });
}

function storyShipments(story: NycDemoStoryFile, seed: number): Shipment[] {
  return story.shipments.map(({ expect: _expect, note: _note, ...shipment }, index) => {
    const sequence = index + 1;
    return {
      ...shipment,
      id: `shp-${sequence}`,
      clientRequestId: `seed-${seed}-${sequence}`,
      createdSeq: sequence,
    };
  });
}

/** Builds a deterministic, pure NYC scenario from parsed fixture data. */
export function buildNycScenario(input: BuildNycScenarioInput): Scenario {
  const { businessesFile, neighborhoodsFile, storyFile, places, request } = input;
  const businesses = businessesWithCoordinates(businessesFile, places);
  const pool = generateHomePool(neighborhoodsFile.neighborhoods);
  const rng = createRng(request.seed);
  const settings = { ...DEFAULT_SETTINGS, defaultMaxExtraMin: request.maxExtraMin };

  if (request.preset === 'demo') {
    const featured = storyEmployees(storyFile);
    const usedHomeIds = new Set(featured.homes.map(home => home.id));
    const availablePool = pool.filter(home => !usedHomeIds.has(home.id));
    const backgroundCount = Math.max(0, request.employees - featured.employees.length);
    const background = backgroundEmployees(
      rng,
      backgroundCount,
      businesses,
      availablePool,
      request.maxExtraMin,
      featured.employees,
    );
    const employees = [...featured.employees, ...background];
    const homeById = new Map([...featured.homes, ...availablePool].map(home => [home.id, home]));
    return {
      schemaVersion: 2,
      name: 'Relay NYC Demo',
      preset: 'demo',
      seed: request.seed,
      businesses,
      homes: employees.map(employee => homeById.get(employee.homeId)!),
      employees,
      shipments: storyShipments(storyFile, request.seed),
      settings,
    };
  }

  // Random city has no story employees, but it never reuses one of their names for someone else.
  const storyNames = storyFile.featuredEmployees.map(employee => employee.name);
  const employees = backgroundEmployees(rng, request.employees, businesses, pool, request.maxExtraMin, [], storyNames);
  const homeById = new Map(pool.map(home => [home.id, home]));
  return {
    schemaVersion: 2,
    name: 'Relay NYC Random',
    preset: 'random',
    seed: request.seed,
    businesses,
    homes: employees.map(employee => homeById.get(employee.homeId)!),
    employees,
    shipments: randomShipments(rng, businesses, request.packages, request.seed),
    settings,
  };
}
