// Weekplan page (docs/ARCHITECTURE.md §1 "Pages never call integrations directly" —
// this Server Component reads via the service layer directly, same pattern as
// recepten/page.tsx). Client interaction (generate/approve/replace/finalize round
// trips) lives in WeekplanView.
import { getLatestPlan } from '@/server/services/planService';
import { listRecipes } from '@/server/services/recipeService';
import { getHouseholdPrefs } from '@/server/services/settingsService';
import { recipeQuerySchema } from '@/shared/recipes';
import { WeekplanView } from './_components/WeekplanView';

// Plan state (draft/final, approvals) mutates constantly via the API routes below and
// carries no per-request input (no searchParams) to otherwise force dynamic rendering —
// without this, `next build` would statically prerender the DB read once and freeze the
// weekplan at build time (regression risk: same latent gap exists on /meer/instellingen
// and /meer/kosten, flagged separately, out of this WP's scope to fix).
export const dynamic = 'force-dynamic';

export default async function WeekplanPage() {
  const [plan, libraryRecipes, prefs] = await Promise.all([
    getLatestPlan(),
    listRecipes(recipeQuerySchema.parse({ sort: 'rating' })),
    getHouseholdPrefs(),
  ]);

  return (
    <WeekplanView
      initialPlan={plan}
      libraryRecipes={libraryRecipes}
      defaultServings={prefs.servings}
      defaultMealCount={prefs.mealCount}
    />
  );
}
