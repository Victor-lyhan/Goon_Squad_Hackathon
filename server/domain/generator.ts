import type { Business, Employee, Graph, Hub, Node, Scenario, Shipment } from '../../shared/types.js';
import { DEFAULT_SETTINGS } from './pricing.js';

export type Rng = {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: T[]): T;
  shuffle<T>(items: T[]): T[];
};

/** A deterministic mulberry32 pseudo-random number generator. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };

  return {
    next,
    int(min: number, max: number): number {
      if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
        throw new RangeError('int requires integer bounds where min is at most max');
      }
      return min + Math.floor(next() * (max - min + 1));
    },
    pick<T>(items: T[]): T {
      if (items.length === 0) throw new RangeError('pick requires a non-empty array');
      return items[Math.floor(next() * items.length)]!;
    },
    shuffle<T>(items: T[]): T[] {
      const shuffled = [...items];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(next() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
      }
      return shuffled;
    },
  };
}

const streetNames = [
  'Maple', 'Oak', 'Cedar', 'Elm', 'Pine', 'Willow',
  'Birch', 'Ash', 'Cherry', 'Walnut', 'Spruce', 'Juniper',
];

const avenueNames = [
  '1st', '2nd', '3rd', '4th', '5th', '6th',
  '7th', '8th', '9th', '10th', '11th', '12th',
];

function friendlyLabel(row: number, col: number): string {
  const street = streetNames[row] ?? `Street ${row + 1}`;
  const avenue = avenueNames[col] ?? `${col + 1}th`;
  return `${street} St & ${avenue} Ave`;
}

function districtFor(row: number, col: number, rows: number, cols: number): string {
  const centralRow = row >= Math.floor(rows / 3) && row < Math.ceil((rows * 2) / 3);
  const centralCol = col >= Math.floor(cols / 3) && col < Math.ceil((cols * 2) / 3);
  if (centralRow && centralCol) return 'Downtown';
  if (row < Math.floor(rows / 3)) return 'Northside';
  if (row >= Math.ceil((rows * 2) / 3)) return 'Southside';
  if (col < Math.floor(cols / 3)) return 'Westside';
  return 'Eastside';
}

/** Builds a two-way rectangular road grid with friendly location metadata. */
export function gridGraph(rows = 12, cols = 12): Graph {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) {
    throw new RangeError('gridGraph requires positive integer dimensions');
  }

  const nodes: Node[] = [];
  const edges: Graph['edges'] = [];
  const nodeId = (row: number, col: number) => `n-${row}-${col}`;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      nodes.push({
        id: nodeId(row, col), x: col, y: row,
        label: friendlyLabel(row, col), district: districtFor(row, col, rows, cols),
      });

      for (const [nextRow, nextCol] of [[row, col + 1], [row + 1, col]]) {
        if (nextRow >= rows || nextCol >= cols) continue;
        const from = nodeId(row, col);
        const to = nodeId(nextRow, nextCol);
        edges.push(
          { from, to, distanceM: 500, durationMin: 2 },
          { from: to, to: from, distanceM: 500, durationMin: 2 },
        );
      }
    }
  }

  return { nodes, edges };
}

export type GenerateScenarioOptions = {
  seed: number;
  employees: number;
  packages: number;
  hubs: number;
  maxExtraMin: number;
  preset: 'demo' | 'random';
  name?: string;
};

export const DEMO_SCENARIO_OPTIONS: GenerateScenarioOptions = {
  preset: 'demo',
  employees: 60,
  packages: 24,
  hubs: 6,
  maxExtraMin: 8,
  seed: 0,
  name: 'Demo city',
};

const MAX_EMPLOYEES = 200;

const businessBlueprints = [
  ['atlas-print', 'Atlas Printworks', 'n-4-4'],
  ['brighton-law', 'Brighton Legal', 'n-4-6'],
  ['civic-studio', 'Civic Design Studio', 'n-5-5'],
  ['daylight-foods', 'Daylight Foods', 'n-5-7'],
  ['ember-books', 'Ember Books', 'n-6-4'],
  ['field-notes', 'Field Notes Supply', 'n-6-6'],
  ['golden-hour', 'Golden Hour Media', 'n-7-5'],
  ['harbor-accounting', 'Harbor Accounting', 'n-7-7'],
  ['indigo-labs', 'Indigo Labs', 'n-4-9'],
  ['juniper-health', 'Juniper Health', 'n-5-10'],
  ['kestrel-market', 'Kestrel Market', 'n-6-9'],
  ['lumen-works', 'Lumen Works', 'n-7-10'],
] as const;

const hubBlueprints = [
  ['central-exchange', 'Central Exchange', 'n-3-5'],
  ['east-gate', 'East Gate Hub', 'n-5-8'],
  ['market-crossing', 'Market Crossing Hub', 'n-8-6'],
  ['north-link', 'North Link Hub', 'n-3-6'],
  ['south-link', 'South Link Hub', 'n-8-5'],
  ['west-gate', 'West Gate Hub', 'n-6-3'],
  ['river-corner', 'River Corner Hub', 'n-3-8'],
  ['station-crossing', 'Station Crossing Hub', 'n-8-8'],
  ['garden-link', 'Garden Link Hub', 'n-5-3'],
  ['civic-bridge', 'Civic Bridge Hub', 'n-7-8'],
] as const;

const employeeFirstNames = [
  'Avery', 'Blair', 'Casey', 'Devon', 'Emery', 'Finley', 'Gray', 'Hayden', 'Indy', 'Jules',
  'Kai', 'Lane', 'Morgan', 'Noel', 'Oakley', 'Parker', 'Quinn', 'Reese', 'Sawyer', 'Taylor',
];

const employeeLastNames = [
  'Allen', 'Brooks', 'Chen', 'Davis', 'Ellis', 'Flores', 'Green', 'Hughes', 'Irwin', 'Jones',
  'Kim', 'Lopez', 'Martin', 'Nguyen', 'Owens', 'Patel', 'Reed', 'Shaw', 'Turner', 'Walker',
];

const packageIdeas: Array<{ label: string; description: string; category: Shipment['category'] }> = [
  { label: 'Orientation brochures', description: 'Printed welcome packs for new team members.', category: 'small_box' },
  { label: 'Signed client agreement', description: 'Executed agreement for the recipient records team.', category: 'envelope' },
  { label: 'Product sample kit', description: 'Small presentation samples for tomorrow morning.', category: 'small_box' },
  { label: 'Campaign proofs', description: 'Final color proofs for review and approval.', category: 'envelope' },
  { label: 'Event name badges', description: 'Prepared name badges for a partner breakfast.', category: 'small_box' },
  { label: 'Invoice packet', description: 'Printed invoices and supporting documents.', category: 'envelope' },
  { label: 'Coffee tasting box', description: 'Sealed tasting samples for the office kitchen.', category: 'small_box' },
  { label: 'Training workbook', description: 'Bound workbook for the morning workshop.', category: 'small_box' },
];

function nodeId(row: number, col: number): string {
  return `n-${row}-${col}`;
}

function generateBusinesses(): Business[] {
  return businessBlueprints.map(([slug, name, location]) => ({
    id: `biz-${slug}`,
    name,
    nodeId: location,
    district: Number(location.split('-')[2]) >= 8 ? 'Eastside' : 'Downtown',
  }));
}

function generateHubs(rng: Rng, count: number): Hub[] {
  if (count < 0 || count > hubBlueprints.length) {
    throw new RangeError(`hubs must be between 0 and ${hubBlueprints.length}`);
  }
  return rng.shuffle([...hubBlueprints]).slice(0, count).map(([slug, name, location]) => ({
    id: `hub-${slug}`,
    name,
    nodeId: location,
  }));
}

function residentialNodes(): string[] {
  const nodes: string[] = [];
  for (let row = 0; row < 12; row += 1) {
    for (let col = 0; col < 12; col += 1) {
      const district = districtFor(row, col, 12, 12);
      if (district === 'Northside' || district === 'Southside' || district === 'Westside') {
        nodes.push(nodeId(row, col));
      }
    }
  }
  return nodes;
}

function generateEmployeeRoster(rng: Rng, businesses: Business[], maxExtraMin: number): Employee[] {
  const homes = residentialNodes();
  const crossDistrictHomes = [nodeId(4, 8), nodeId(5, 8), nodeId(6, 8), nodeId(7, 8)];
  const roster: Employee[] = [];

  for (let index = 1; index <= MAX_EMPLOYEES; index += 1) {
    const business = rng.pick(businesses);
    // Most homes are residential; the remaining cross-district homes create shared central corridors.
    const homeNodeId = rng.next() < 0.84 ? rng.pick(homes) : rng.pick(crossDistrictHomes);
    roster.push({
      id: `emp-${index}`,
      name: `${rng.pick(employeeFirstNames)} ${rng.pick(employeeLastNames)}`,
      businessId: business.id,
      homeNodeId,
      eveningDepartureMin: rng.int(1020, 1080),
      morningDepartureMin: rng.int(1860, 1950),
      maxExtraMin,
      availableEvening: true,
      availableMorning: true,
      eveningViaNodeIds: [],
      morningViaNodeIds: [],
    });
  }
  return roster;
}

function generateShipments(rng: Rng, businesses: Business[], count: number, seed: number): Shipment[] {
  if (count < 0) throw new RangeError('packages must not be negative');
  const shipments: Shipment[] = [];

  for (let index = 1; index <= count; index += 1) {
    const origin = rng.pick(businesses);
    let destination = rng.pick(businesses);
    while (destination.id === origin.id) destination = rng.pick(businesses);
    const idea = rng.pick(packageIdeas);
    shipments.push({
      id: `shp-${index}`,
      clientRequestId: `seed-${seed}-${index}`,
      label: idea.label,
      originBusinessId: origin.id,
      destinationBusinessId: destination.id,
      readyMin: 960,
      deadlineMin: 2040,
      category: idea.category,
      description: idea.description,
      weightGrams: rng.int(100, 2000),
      pickupInstructions: 'Please collect from reception and ask for the prepared Relay parcel.',
      dropoffInstructions: 'Please leave with reception and confirm the recipient business name.',
      createdSeq: index,
    });
  }
  return shipments;
}

/** Builds a deterministic synthetic Relay city using the shared API scenario contract. */
export function generateScenario(opts: GenerateScenarioOptions): Scenario {
  if (!Number.isInteger(opts.employees) || opts.employees < 0 || opts.employees > MAX_EMPLOYEES) {
    throw new RangeError(`employees must be an integer between 0 and ${MAX_EMPLOYEES}`);
  }
  if (!Number.isInteger(opts.maxExtraMin) || opts.maxExtraMin < 0) {
    throw new RangeError('maxExtraMin must be a non-negative integer');
  }

  const rng = createRng(opts.seed);
  const businesses = generateBusinesses();
  const hubs = generateHubs(rng, opts.hubs);
  // Always consume the full roster before packages. This keeps packages independent of employee count.
  const roster = generateEmployeeRoster(rng, businesses, opts.maxExtraMin);
  const shipments = generateShipments(rng, businesses, opts.packages, opts.seed);

  return {
    schemaVersion: 1,
    name: opts.name ?? (opts.preset === 'demo' ? 'Relay Demo City' : 'Relay Random City'),
    preset: opts.preset,
    seed: opts.seed,
    graph: gridGraph(),
    businesses,
    hubs,
    employees: roster.slice(0, opts.employees),
    shipments,
    settings: { ...DEFAULT_SETTINGS, defaultMaxExtraMin: opts.maxExtraMin },
  };
}
