// Relay MVP IV contract for "requests in plain English" (docs/mvp4.md F1, DECISIONS pass 80).
// Added by issue #764. HUMAN-OWNED like the rest of shared/: agents do not edit; write BLOCKED.md instead.
//
// Route (under the same /api/v2 prefix as shared/v2/api.ts):
//   POST  /api/v2/parse-request                 -> ParseRequestResponse (reads the run, never changes it)
//
// The answer is a DRAFT. Nothing is stored: the page shows it as an editable card, and its Send button
// posts the confirmed fields to the unchanged POST /api/v2/shipments (CreateShipmentRequest).
// Errors: 400 with the ApiError body (shared/v2/schemas.ts) for a missing, empty or too long text.
import { z } from 'zod';
import type { PackageCategory } from './types';

export const PARSE_TEXT_MAX = 500;

// Body of POST /api/v2/parse-request: one sentence, 1 to 500 characters after trimming.
export const ParseRequestBody = z.object({
  text: z.string({ error: 'Describe the delivery in one sentence' })
    .trim()
    .min(1, 'Describe the delivery in one sentence')
    .max(PARSE_TEXT_MAX, `Max ${PARSE_TEXT_MAX} characters`),
});
export type ParseRequestBody = z.infer<typeof ParseRequestBody>;

// The fields of CreateShipmentRequest a sentence can fill. `null` = the sentence did not say.
// Units as in the form: weight in kg, times in minutes since Day 1 00:00 ("tomorrow" = Day 2).
export type ParseDraft = {
  originBusinessId: string | null;       // always a network business of the run, or null
  destinationBusinessId: string | null;  // always a network business of the run, or null
  label: string | null;
  category: PackageCategory | null;
  description: string | null;
  weightKg: number | null;
  readyMin: number | null;               // defaults to the run clock's minute
  deadlineMin: number | null;
};

export type ParseSource = 'gemini' | 'offline';

export type ParseRequestResponse = {
  draft: ParseDraft;
  /** The draft fields that are null, in the order of ParseDraft. */
  missing: (keyof ParseDraft)[];
  /** A plain sentence when a stop is not a network business (a home, a street address, an unknown name); else null. */
  rejected: string | null;
  /** Who filled the draft: shown as "Parsed by Gemini" / "Parsed offline". */
  source: ParseSource;
};
