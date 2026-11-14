// Relay MVP II request schemas (Zod). HUMAN-OWNED. Agents: do not edit; write BLOCKED.md instead.
// Responses are typed in shared/v2/api.ts; requests are validated here on the server
// and reused by the client for inline form validation.
import { z } from 'zod';

// Unchanged from MVP 1.
export { CreateShipmentRequest, PatchShipmentRequest, SimControlRequest, CompareRequest, ApiError } from '../schemas';

// Home in the commute editor: an existing home, or a new point picked from the address search.
// A new point gets the ID home-c-<lat>_<lng> (5 decimals) on the server; see shared/v2/types.ts.
const CommuteHome = z.union(
  [
    z.object({ homeId: z.string().min(1) }),
    z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      neighborhood: z.string().trim().min(1),
    }),
  ],
  { error: 'Choose a home: an existing homeId, or lat, lng and neighborhood' },
);

// No waypoint fields in MVP II.
export const PutCommuteRequest = z.object({
  businessId: z.string().min(1),
  home: CommuteHome,
  eveningDepartureMin: z.number().int().min(0).max(1439),       // Day 1
  morningDepartureMin: z.number().int().min(1440).max(2879),    // Day 2
  availableEvening: z.boolean(),
  availableMorning: z.boolean(),
  maxExtraMin: z.number().int().min(0).max(30),
});
export type PutCommuteRequest = z.infer<typeof PutCommuteRequest>;

// No `hubs`: every network business is a relay point.
export const GenerateScenarioRequest = z.object({
  preset: z.enum(['demo', 'random']),
  seed: z.number().int().default(42),
  employees: z.number().int().min(10).max(120).default(60),
  packages: z.number().int().min(5).max(60).default(24),
  maxExtraMin: z.number().int().min(0).max(30).default(8),
});
export type GenerateScenarioRequest = z.infer<typeof GenerateScenarioRequest>;

// GET /api/v2/geocode?q=
export const GeocodeQuery = z.object({
  q: z.string().trim().min(3, 'Type at least 3 characters').max(200, 'Max 200 characters'),
});
export type GeocodeQuery = z.infer<typeof GeocodeQuery>;
