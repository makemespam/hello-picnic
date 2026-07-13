// Prompt builder for purpose 'image' (docs/PROMPTS.md §5, normative — the exact text
// below must match it verbatim). Pure function — no I/O — snapshot-testable like
// plan.ts/scanCard.ts/suggest.ts. imageGenService gathers the dynamic inputs (recipe
// title + its top-5 non-pantry ingredient displays) and calls this; callImage sends the
// result to the model.

const KEY_INGREDIENT_COUNT = 5;

export interface BuildImagePromptInput {
  title: string;
  /** Every ingredient display, in sort order — pantry items are filtered out here (docs/PROMPTS.md §5: "top-5 non-pantry ingredients"). */
  ingredients: Array<{ display: string; pantry: boolean }>;
}

/** The top-5 non-pantry ingredient displays, in recipe order — the KEY_INGREDIENTS_VISIBLE the prompt names. */
export function keyIngredientsForPhoto(ingredients: Array<{ display: string; pantry: boolean }>): string[] {
  return ingredients
    .filter((ingredient) => !ingredient.pantry)
    .slice(0, KEY_INGREDIENT_COUNT)
    .map((ingredient) => ingredient.display);
}

/** docs/PROMPTS.md §5: overhead 3/4 top-down HelloFresh-style dish photo, square 1:1. */
export function buildImagePrompt(input: BuildImagePromptInput): string {
  const keyIngredients = keyIngredientsForPhoto(input.ingredients);
  const keyIngredientsVisible = keyIngredients.length > 0 ? keyIngredients.join(', ') : input.title;

  return `Overhead 3/4 top-down food photography of ${input.title}: ${keyIngredientsVisible}.
Plated home-style on a ceramic plate, warm natural daylight, fresh garnish,
shallow depth of field, appetizing, realistic home cooking (not restaurant plating),
neutral light background, no text, no hands, no packaging. Square 1:1.`;
}
