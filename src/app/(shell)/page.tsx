// Vandaag (home) page (docs/workpackages/WP-06-planner-v2.md §6, docs/workpackages/
// WP-13-proactive-suggestions.md §4): tonight's meal from the latest finalized plan
// (cook_date == today, else the first meal — cook_date is only ever set once the
// Google Calendar integration lands in a later WP) with "start met koken om HH:MM"
// back-calculated from the household's dinnerTime setting, plus "Uit jullie keuken" —
// 3 proactive library suggestions with one-tap "zet in weekplan".
import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { PhotoFrame } from '@/components/PhotoFrame';
import { RecipeTypeBadge } from '@/components/RecipeTypeBadge';
import { amsterdamDateKey } from '@/server/integrations/ai/prompts/plan';
import { getLatestFinalizedPlan } from '@/server/services/planService';
import { getHouseholdPrefs } from '@/server/services/settingsService';
import { getSuggestions } from '@/server/services/suggestionService';
import { SuggestionsSection } from './_components/SuggestionsSection';

// Depends on "today" and the latest finalized plan — both change without any
// searchParams/cookies signal that would otherwise force dynamic rendering, so
// `next build` would statically freeze this page at build time without this
// (see src/app/(shell)/plan/page.tsx for the same fix + longer explanation).
export const dynamic = 'force-dynamic';

const MINUTES_PER_DAY = 24 * 60;

/** dinnerTime ("18:00") minus the recipe's prep time, wrapped to a valid HH:MM. */
function computeStartTime(dinnerTime: string, prepMinutes: number): string {
  const [hours, minutes] = dinnerTime.split(':').map(Number);
  const totalMinutes = (hours ?? 18) * 60 + (minutes ?? 0) - prepMinutes;
  const normalized = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default async function VandaagPage() {
  const [plan, prefs, suggestions] = await Promise.all([getLatestFinalizedPlan(), getHouseholdPrefs(), getSuggestions()]);

  if (!plan || plan.meals.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Vandaag" description="Vanavond op tafel." />
        <EmptyState
          illustration="🍽️"
          title="Nog geen etentje gepland"
          description="Zodra je een weekmenu hebt vastgelegd, zie je hier wat jullie vanavond eten."
          action={{ label: 'Naar weekplan', href: '/plan' }}
        />
        <SuggestionsSection suggestions={suggestions} />
      </div>
    );
  }

  const today = amsterdamDateKey(new Date());
  const meal = plan.meals.find((m) => m.cookDate === today) ?? plan.meals[0]!;
  const startTime = computeStartTime(prefs.dinnerTime, meal.recipe.timeMin);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Vandaag" description="Vanavond op tafel." />

      <Link
        href={`/recepten/${meal.recipe.id}`}
        className="block overflow-hidden rounded-lg border border-ink/10 bg-surface shadow-sm transition-shadow hover:shadow-md"
      >
        <PhotoFrame src={meal.recipe.photoUrl} blurDataUrl={meal.recipe.blurDataUrl} alt={meal.recipe.title} aspect="16:9" />
        <div className="flex flex-col gap-2 p-5">
          <RecipeTypeBadge type={meal.recipe.type} />
          <h2 className="text-2xl font-bold text-ink md:text-[30px]">{meal.recipe.title}</h2>
          <p className="text-sm font-semibold text-primary">Start met koken om {startTime}</p>
        </div>
      </Link>

      <SuggestionsSection suggestions={suggestions} />
    </div>
  );
}
