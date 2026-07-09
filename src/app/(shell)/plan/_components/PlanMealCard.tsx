// One day-card in the weekplan result grid (docs/DESIGN_PRINCIPLES.md §5: "result:
// photo cards with Akkoord/Alternatief"). Dag-label is derived from the plan's
// weekStart + slot offset. docs/workpackages/WP-12-google-calendar.md §3 adds the
// day-assignment picker (writes `cook_date`, independent of Akkoord/Alternatief — kept
// visible in both draft and final state) and a "in agenda" indicator once the meal's
// prep event has been published.
import { RecipeCard } from '@/components/RecipeCard';
import { cn } from '@/components/cn';
import type { PlanMealDto } from '@/shared/dto';
import { DayPicker, type DayOption } from './DayPicker';

export interface PlanMealCardProps {
  meal: PlanMealDto;
  dayLabel: string;
  busy: boolean;
  readOnly: boolean;
  onApprove: () => void;
  onReplace: () => void;
  /** docs/workpackages/WP-12 §3: next-7-days options for the day-picker (with "druk" hints from §4's freebusy check). */
  dayOptions: DayOption[];
  onSetCookDate: (cookDate: string | null) => void;
  cookDateBusy: boolean;
}

export function PlanMealCard({
  meal,
  dayLabel,
  busy,
  readOnly,
  onApprove,
  onReplace,
  dayOptions,
  onSetCookDate,
  cookDateBusy,
}: PlanMealCardProps) {
  return (
    <div
      role="group"
      aria-label={dayLabel}
      className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-surface p-3 shadow-sm"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{dayLabel}</span>
      <RecipeCard recipe={meal.recipe} href={`/recepten/${meal.recipe.id}`} />

      <div className="flex flex-col gap-1">
        <DayPicker
          id={`cook-date-${meal.id}`}
          value={meal.cookDate}
          options={dayOptions}
          disabled={cookDateBusy}
          onChange={onSetCookDate}
        />
        {meal.calendarEventId && (
          <span className="text-xs font-medium text-success" role="status">
            📅 in agenda
          </span>
        )}
      </div>

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
