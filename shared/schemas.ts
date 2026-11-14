// Relay request schemas (Zod). HUMAN-OWNED. Agents: do not edit; write BLOCKED.md instead.
// Responses are typed in shared/api.ts; requests are validated here on the server
// and reused by the client for inline form validation.
import { z } from 'zod';

const minute = z.number().int().min(0).max(2 * 1440);

export const CreateShipmentRequest = z
  .object({
    clientRequestId: z.string().min(1),
    originBusinessId: z.string().min(1),
    destinationBusinessId: z.string().min(1),
    label: z.string().trim().min(1, 'Package name is required'),
    category: z.enum(['envelope', 'small_box']),
    description: z.string().trim().min(1, 'Describe the contents'),
    weightKg: z.number().gt(0, 'Weight must be above 0 kg').max(2, 'Max 2 kg'),
    readyMin: minute,
    deadlineMin: minute,
    pickupInstructions: z.string().default(''),
    dropoffInstructions: z.string().default(''),
  })
  .refine((v) => v.originBusinessId !== v.destinationBusinessId, {
    path: ['destinationBusinessId'], message: 'Choose a different business',
  })
  .refine((v) => v.deadlineMin > v.readyMin, {
    path: ['deadlineMin'], message: 'Deliver-by must be after ready time',
  });
export type CreateShipmentRequest = z.infer<typeof CreateShipmentRequest>;

export const PatchShipmentRequest = z.object({
  label: z.string().trim().min(1).optional(),
  category: z.enum(['envelope', 'small_box']).optional(),
  description: z.string().trim().min(1).optional(),
  weightKg: z.number().gt(0).max(2).optional(),
  destinationBusinessId: z.string().min(1).optional(),
  readyMin: minute.optional(),
  deadlineMin: minute.optional(),
  pickupInstructions: z.string().optional(),
  dropoffInstructions: z.string().optional(),
});
export type PatchShipmentRequest = z.infer<typeof PatchShipmentRequest>;

const via = z.array(z.string()).max(3, 'Up to 3 waypoints');
export const PutCommuteRequest = z.object({
  businessId: z.string().min(1),
  homeNodeId: z.string().min(1),
  eveningDepartureMin: z.number().int().min(0).max(1439),       // Day 1
  morningDepartureMin: z.number().int().min(1440).max(2879),    // Day 2
  availableEvening: z.boolean(),
  availableMorning: z.boolean(),
  maxExtraMin: z.number().int().min(0).max(30),
  eveningViaNodeIds: via.default([]),
  morningViaNodeIds: via.default([]),
});
export type PutCommuteRequest = z.infer<typeof PutCommuteRequest>;

export const SimControlRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('play') }),
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('speed'), speed: z.union([z.literal(30), z.literal(120), z.literal(600)]) }),
  z.object({ action: z.literal('seek'), timeMin: minute }),
  z.object({ action: z.literal('next_event') }),
  z.object({ action: z.literal('jump_to_morning') }), // seek to first Day 2 event minus 5 min
  z.object({ action: z.literal('finish') }),
  z.object({ action: z.literal('reset_playback') }),
]);
export type SimControlRequest = z.infer<typeof SimControlRequest>;

export const GenerateScenarioRequest = z.object({
  preset: z.enum(['demo', 'random']),
  seed: z.number().int().default(42),
  employees: z.number().int().min(10).max(200).default(60),
  packages: z.number().int().min(5).max(60).default(24),
  hubs: z.number().int().min(0).max(10).default(6),
  maxExtraMin: z.number().int().min(0).max(30).default(8),
});
export type GenerateScenarioRequest = z.infer<typeof GenerateScenarioRequest>;

export const CompareRequest = z.object({}).default({});

// Error body for every 4xx: field errors render beside form fields.
export const ApiError = z.object({
  error: z.string(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
});
export type ApiError = z.infer<typeof ApiError>;
