// One day-card in the weekplan result grid (docs/DESIGN_PRINCIPLES.md §5: "result:
// photo cards with Akkoord/Alternatief"). Dag-label is derived from the plan's
// weekStart + slot offset — real per-day scheduling (cook_date) lands with the
// Google Calendar integration in a later WP.
import { RecipeCard } from '@/components/RecipeCard';
import { cn } from '@/components/cn';
import type { PlanMealDto } from '@/shared/dto';

export interface PlanMealCardProps {
  meal: PlanMealDto;
  dayLabel: string;
  busy: boolean;
  readOnly: boolean;
  onApprove: () => void;
  onReplace: () => void;
}

export function PlanMealCard({ meal, dayLabel, busy, readOnly, onApprove, onReplace }: PlanMealCardProps) {
  return (
    <div
      role="group"
      aria-label={dayLabel}
      className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-surface p-3 shadow-sm"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{dayLabel}</span>
      <RecipeCard recipe={meal.recipe} href={`/recepten/${meal.recipe.id}`} />

      {!readOnly && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onApprove}
            aria-pressed={meal.approved}
            className={cn(
              'flex h-10 flex-1 items-center justify-center rounded-full text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60',
              meal.approved ? 'bg-success/10 text-success' : 'border border-ink/15 text-ink hover:border-ink/30'
            )}
          >
            {meal.approved ? '✓ Akkoord' : 'Akkoord'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onReplace}
            className="flex h-10 flex-1 items-center justify-center rounded-full border border-ink/15 text-sm font-semibold text-ink hover:border-ink/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Bezig…' : 'Alternatief'}
          </button>
        </div>
      )}
    </div>
  );
}
