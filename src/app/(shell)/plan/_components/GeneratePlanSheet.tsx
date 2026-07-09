'use client';

// Generation sheet (docs/DESIGN_PRINCIPLES.md §5: "generate flow as a sheet (porties,
// dagen-picker, wensen-veld, bibliotheek-picks)"). Shared between the initial "Genereer
// weekmenu" flow and "Opnieuw genereren" (regenerate, which only refills unapproved
// slots server-side — this sheet just collects the same inputs either way).
import { useEffect, useState } from 'react';
import { Alert } from '@/components/Alert';
import { Field } from '@/components/Field';
import { PhotoFrame } from '@/components/PhotoFrame';
import { Sheet } from '@/components/Sheet';
import { Textarea } from '@/components/Textarea';
import { cn } from '@/components/cn';
import type { RecipeListItemDto } from '@/shared/recipes';

const MIN_SERVINGS = 1;
const MAX_SERVINGS = 8;
const MIN_MEAL_COUNT = 1;
const MAX_MEAL_COUNT = 7;

export interface GeneratePlanInputPayload {
  servings: number;
  mealCount: number;
  preferences?: string;
  libraryRecipeIds: number[];
}

export interface GeneratePlanSheetProps {
  open: boolean;
  onClose: () => void;
  mode: 'create' | 'regenerate';
  libraryRecipes: RecipeListItemDto[];
  defaultServings: number;
  defaultMealCount: number;
  submitting: boolean;
  error: string | null;
  onSubmit: (input: GeneratePlanInputPayload) => void;
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-ink">{label}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Minder ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-ink/15 text-lg text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          −
        </button>
        <span className="w-8 text-center text-base font-bold text-ink" aria-live="polite">
          {value}
        </span>
        <button
          type="button"
          aria-label={`Meer ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-ink/15 text-lg text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}

export function GeneratePlanSheet({
  open,
  onClose,
  mode,
  libraryRecipes,
  defaultServings,
  defaultMealCount,
  submitting,
  error,
  onSubmit,
}: GeneratePlanSheetProps) {
  const [servings, setServings] = useState(defaultServings);
  const [mealCount, setMealCount] = useState(defaultMealCount);
  const [preferences, setPreferences] = useState('');
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<number[]>([]);

  // Reset the form to fresh defaults every time the sheet opens (docs/DESIGN_PRINCIPLES.md
  // §1.5: never leave stale state from a previous open behind).
  useEffect(() => {
    if (open) {
      setServings(defaultServings);
      setMealCount(defaultMealCount);
      setPreferences('');
      setSelectedLibraryIds([]);
    }
  }, [open, defaultServings, defaultMealCount]);

  function toggleLibraryPick(id: number) {
    setSelectedLibraryIds((current) => {
      if (current.includes(id)) return current.filter((existing) => existing !== id);
      if (current.length >= mealCount) return current;
      return [...current, id];
    });
  }

  function handleMealCountChange(next: number) {
    setMealCount(next);
    setSelectedLibraryIds((current) => current.slice(0, next));
  }

  function handleSubmit() {
    onSubmit({ servings, mealCount, preferences: preferences.trim() || undefined, libraryRecipeIds: selectedLibraryIds });
  }

  return (
    <Sheet open={open} onClose={onClose} title={mode === 'regenerate' ? 'Opnieuw genereren' : 'Genereer weekmenu'}>
      <div className="flex flex-col gap-5">
        <Stepper label="Porties" value={servings} min={MIN_SERVINGS} max={MAX_SERVINGS} onChange={setServings} />
        <Stepper label="Aantal maaltijden" value={mealCount} min={MIN_MEAL_COUNT} max={MAX_MEAL_COUNT} onChange={handleMealCountChange} />

        <Field label="Wensen" htmlFor="plan-wishes" hint="Bijvoorbeeld: graag iets met pasta, of geen vis deze week.">
          <Textarea id="plan-wishes" value={preferences} onChange={(event) => setPreferences(event.target.value)} />
        </Field>

        {libraryRecipes.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-ink">
              Bibliotheekkeuzes <span className="text-ink-muted">({selectedLibraryIds.length}/{mealCount})</span>
            </p>
            <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto">
              {libraryRecipes.map((recipe) => {
                const selected = selectedLibraryIds.includes(recipe.id);
                const disabled = !selected && selectedLibraryIds.length >= mealCount;
                return (
                  <button
                    key={recipe.id}
                    type="button"
                    aria-pressed={selected}
                    disabled={disabled}
                    onClick={() => toggleLibraryPick(recipe.id)}
                    className={cn(
                      'relative overflow-hidden rounded-md border-2 text-left disabled:cursor-not-allowed disabled:opacity-40',
                      selected ? 'border-primary' : 'border-transparent'
                    )}
                  >
                    <PhotoFrame src={recipe.photoUrl} alt={recipe.title} aspect="1:1" blurDataUrl={recipe.blurDataUrl} />
                    <span className="absolute inset-x-0 bottom-0 truncate bg-ink px-1.5 py-1 text-[11px] font-semibold text-white">
                      {recipe.title}
                    </span>
                    {selected && (
                      <span aria-hidden="true" className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-white">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {error && <Alert variant="danger">{error}</Alert>}

        <button
          type="button"
          disabled={submitting}
          onClick={handleSubmit}
          className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Bezig met genereren…' : mode === 'regenerate' ? 'Opnieuw genereren' : 'Genereer weekmenu'}
        </button>
      </div>
    </Sheet>
  );
}
