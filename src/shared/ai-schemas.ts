// Zod schemas for structured LLM output (docs/ARCHITECTURE.md §5, docs/PROMPTS.md
// header: "Never parse LLM text with regex").
//
// DEVIATION (flagged, matches the architect's WP-05 scope adjustment): `planSchema`,
// `cardExtractionSchema` and `validateProductSchema` (docs/PROMPTS.md §1-4) are NOT
// defined here yet — they land in WP-06 (weekplan) and WP-08 (card scan / product
// validation), once those work packages own the exact field shapes. Defining them now
// from a partial spec would risk a second, incompatible schema landing later.
//
// `pingSchema` is a REAL, exercised-in-tests schema: it proves the generic plumbing
// (callStructured's retry-on-invalid loop, the FAKE_AI fixture path, the per-provider
// POST /api/ai/test connectivity check) without depending on those future schemas.

import { z } from 'zod';

export const pingSchema = z.object({
  pong: z.literal(true),
  message: z.string().min(1),
});

export type PingResult = z.infer<typeof pingSchema>;
