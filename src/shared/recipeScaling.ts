// Pure per-serving ingredient scaling (docs/workpackages/WP-04-recipe-domain-migration.md
// §5, docs/DESIGN_PRINCIPLES.md §5 "ingredients with per-serving scaling stepper").
// No DB/React access here so this stays cheaply unit-testable — see recipeScaling.test.ts.
//
// Dutch rounding rules (WP-04 scope text, verbatim): "0,5 stapjes voor stuks" (round to
// the nearest half-unit for piece-like ingredients) and "5g/ml afronding" (round to the
// nearest 5 for weight/volume). We apply the 5-unit step to grams and millilitres, and
// the 0.5-unit step to every other unit (stuks, teen, bos, krop, el, tl, ...) — the WP
// text names exactly these two rules, so anything not explicitly weight/volume falls
// back to the "stapjes" rule rather than staying unrounded.

const WEIGHT_VOLUME_UNITS = new Set(['g', 'gram', 'ml']);

function roundingStepFor(unit: string): number {
  return WEIGHT_VOLUME_UNITS.has(unit.trim().toLowerCase()) ? 5 : 0.5;
}

/** Round to 2 decimals to shake off floating-point noise (e.g. 37.500000000000004). */
function clean(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface ScaleAmountInput {
  amount: number;
  unit: string;
  fromServings: number;
  toServings: number;
}

/**
 * Scales one ingredient amount from `fromServings` to `toServings`, applying the Dutch
 * rounding rules above. Never rounds a positive amount down to zero (you can't buy "0"
 * of an ingredient the recipe actually needs) — floors to one rounding step instead.
 */
export function scaleIngredientAmount({ amount, unit, fromServings, toServings }: ScaleAmountInput): number {
  if (fromServings <= 0) throw new Error('fromServings must be > 0');
  if (toServings <= 0) throw new Error('toServings must be > 0');
  if (amount <= 0) return 0;

  const raw = (amount * toServings) / fromServings;
  const step = roundingStepFor(unit);
  const rounded = clean(Math.round(raw / step) * step);

  return rounded > 0 ? rounded : step;
}

export interface ScalableIngredient {
  amount: number;
  unit: string;
}

/** Scales every ingredient in a list, preserving order and all other fields via the caller. */
export function scaleIngredients<T extends ScalableIngredient>(ingredients: T[], fromServings: number, toServings: number): T[] {
  return ingredients.map((ingredient) => ({
    ...ingredient,
    amount: scaleIngredientAmount({ amount: ingredient.amount, unit: ingredient.unit, fromServings, toServings }),
  }));
}

/** Dutch-formatted amount for display ("1,5" not "1.5"), trimming trailing zeros. */
export function formatAmountNl(amount: number): string {
  return amount.toLocaleString('nl-NL', { maximumFractionDigits: 2 });
}
