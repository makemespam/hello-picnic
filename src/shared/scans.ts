// Zod schemas + DTO types for the card-scanning domain (docs/ARCHITECTURE.md §3/§4,
// docs/workpackages/WP-08-card-scanning.md, docs/PROMPTS.md §3). Shared between the
// client (/meer/scannen) and the /api/scans/* route handlers. No secret fields ever
// live here (scans carry no credentials), so — like recipes.ts — there is no
// tri-state `Configured` dance.

import { z } from 'zod';
import { recipeCreateSchema } from './recipes';
import type { CardScanStatus } from './labels';
import type { StoredCardExtraction } from './ai-schemas';

// --- Images (uploaded card photos) --------------------------------------------------

export interface ScanImageDto {
  id: number;
  url: string;
}

// --- Stored extraction (extraction_json), post-rescale -------------------------------

/**
 * `card_scans.extraction_json`'s shape — see `storedCardExtractionSchema` in
 * ai-schemas.ts for the full definition (co-located with `cardExtractionSchema`, which
 * it extends). Re-declared as an alias here purely so every scan DTO type lives in one
 * importable place for the client, same as recipes.ts/shopping.ts.
 */
export type StoredCardExtractionDto = StoredCardExtraction;

// --- Card scan (one front + optional back) --------------------------------------------

export interface CardScanDto {
  id: number;
  status: CardScanStatus;
  frontImage: ScanImageDto;
  backImage: ScanImageDto | null;
  extraction: StoredCardExtractionDto | null;
  error: string | null;
  createdAt: string;
}

/** GET /api/scans response: unpaired uploaded photos (pairing UI) + every scan (progress/review). */
export interface ScanBoardDto {
  unpairedImages: ScanImageDto[];
  scans: CardScanDto[];
}

// --- POST /api/scans/pair --------------------------------------------------------------

export const pairScansInputSchema = z.object({
  pairs: z
    .array(
      z.object({
        frontImageId: z.number().int().positive(),
        backImageId: z.number().int().positive().optional(),
      })
    )
    .min(1),
});

export type PairScansInput = z.infer<typeof pairScansInputSchema>;

// --- POST /api/scans/:id/approve --------------------------------------------------------

// A reviewed, corrected recipe payload — identical shape to the manual recipe editor's
// create payload (recipeCreateSchema), minus `source` (scanService always forces
// `source: 'card'`), plus a `confirmDuplicate` flag the client resubmits with after the
// user acknowledges a duplicate-title warning.
export const scanApproveInputSchema = recipeCreateSchema.omit({ source: true }).extend({
  confirmDuplicate: z.boolean().default(false),
});

export type ScanApproveInput = z.infer<typeof scanApproveInputSchema>;

export interface ScanDuplicateWarningDto {
  status: 'duplicate';
  duplicate: { id: number; title: string; similarity: number };
}

export interface ScanApprovedDto {
  status: 'approved';
  recipeId: number;
}

export type ScanApproveResultDto = ScanDuplicateWarningDto | ScanApprovedDto;

// --- POST /api/scans/extract-all --------------------------------------------------------

export interface ExtractAllResultDto {
  processed: number;
}
