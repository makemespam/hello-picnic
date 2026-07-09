// Zod schemas for the weekplan API (docs/ARCHITECTURE.md §4, docs/workpackages/
// WP-06-planner-v2.md §5). Co-located with the DTO types they mirror, re-exported via
// src/shared/dto.ts (same pattern as recipes.ts/settings.ts).

import { z } from 'zod';

export const generatePlanSchema = z
  .object({
    preferences: z.string().max(2000).optional(),
    mealCount: z.number().int().min(1).max(7),
    servings: z.number().int().min(1).max(8),
    libraryRecipeIds: z.array(z.number().int().positive()).default([]),
    // Presence => POST /api/plans regenerates this existing draft plan's unapproved
    // slots instead of creating a brand-new plan (docs/DESIGN_PRINCIPLES.md §5
    // "Opnieuw genereren").
    planId: z.number().int().positive().optional(),
  })
  .refine((data) => data.libraryRecipeIds.length <= data.mealCount, {
    message: 'Aantal gekozen bibliotheekrecepten is groter dan het aantal maaltijden.',
    path: ['libraryRecipeIds'],
  });

export type GeneratePlanInput = z.infer<typeof generatePlanSchema>;

export const replaceMealSchema = z.object({
  mealId: z.number().int().positive(),
  wishes: z.string().max(2000).optional(),
});

export type ReplaceMealInput = z.infer<typeof replaceMealSchema>;

export const approveMealSchema = z.object({
  mealId: z.number().int().positive(),
});

export type ApproveMealInput = z.infer<typeof approveMealSchema>;

// docs/workpackages/WP-13-proactive-suggestions.md §4: Vandaag's one-tap "→ Zet in
// weekplan" action — POST /api/plans/add-suggestion.
export const addSuggestionSchema = z.object({
  recipeId: z.number().int().positive(),
});

export type AddSuggestionInput = z.infer<typeof addSuggestionSchema>;
