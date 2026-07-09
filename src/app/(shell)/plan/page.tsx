// Weekplan page (docs/ARCHITECTURE.md §1 "Pages never call integrations directly" —
// this Server Component reads via the service layer directly, same pattern as
// recepten/page.tsx). Client interaction (generate/approve/replace/finalize round
// trips) lives in WeekplanView.
import { amsterdamDateKey } from '@/server/integrations/ai/prompts/plan';
import { getLatestPlan } from '@/server/services/planService';
import { listRecipes } from '@/server/services/recipeService';
import { getHouseholdPrefs } from '@/server/services/settingsService';
import { getShoppingList } from '@/server/services/shoppingService';
import { getSuggestions } from '@/server/services/suggestionService';
import { recipeQuerySchema } from '@/shared/recipes';
import type { CostSummary } from './_components/CostSummaryPanel';
import { WeekplanView } from './_components/WeekplanView';

// Plan state (draft/final, approvals) mutates constantly via the API routes below and
// carries no per-request input (no searchParams) to otherwise force dynamic rendering —
// without this, `next build` would statically prerender the DB read once and freeze the
// weekplan at build time (regression risk: same latent gap exists on /meer/instellingen
// and /meer/kosten, flagged separately, out of this WP's scope to fix).
export const dynamic = 'force-dynamic';

export default async function WeekplanPage() {
  const [plan, libraryRecipes, prefs, suggestions] = await Promise.all([
    getLatestPlan(),
    listRecipes(recipeQuerySchema.parse({ sort: 'rating' })),
    getHouseholdPrefs(),
    getSuggestions(),
  ]);

  // Cost summary (docs/workpackages/WP-10-basket-optimizer.md §6: "€ total + €/portie
  // vs TARGET_COST_PER_SERVING delta") only makes sense once the plan is finalized —
  // that's when shoppingService.buildFromPlan has aggregated + priced the list.
  let costSummary: CostSummary | null = null;
  if (plan?.status === 'final') {
    const shoppingList = await getShoppingList(plan.id);
    if (shoppingList) {
      const totalServings = plan.servings * plan.mealCount;
      costSummary = {
        totalCents: shoppingList.totalPriceCents,
        perServingCents: totalServings > 0 ? Math.round(shoppingList.totalPriceCents / totalServings) : 0,
        targetPerServingCents: prefs.targetCostPerServingCents,
      };
    }
  }

  return (
    <WeekplanView
      initialPlan={plan}
      libraryRecipes={libraryRecipes}
      defaultServings={prefs.servings}
      defaultMealCount={prefs.mealCount}
      costSummary={costSummary}
      suggestedRecipeIds={suggestions.items.slice(0, 3).map((item) => item.recipe.id)}
      todayKey={amsterdamDateKey(new Date())}
    />
  );
}
