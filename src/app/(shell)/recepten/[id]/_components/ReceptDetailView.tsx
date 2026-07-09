'use client';

// Recept detail (docs/DESIGN_PRINCIPLES.md §5): full-bleed photo header, meta chips,
// per-serving ingredient scaling stepper, numbered steps, cook-mode with large text +
// screen wake lock. Rating/favorite/archive round-trip through PATCH/DELETE
// /api/recipes/:id (docs/workpackages/WP-04 §4).
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { PhotoFrame } from '@/components/PhotoFrame';
import { RecipeTypeBadge } from '@/components/RecipeTypeBadge';
import { Stars } from '@/components/Stars';
import { StepperList } from '@/components/StepperList';
import { cn } from '@/components/cn';
import { DIFFICULTY_LABEL, INGREDIENT_CATEGORY_LABEL } from '@/shared/labels';
import { formatAmountNl, scaleIngredients } from '@/shared/recipeScaling';
import type { RecipeDetailDto } from '@/shared/recipes';

function MetaChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-ink/10 bg-surface px-2.5 py-1 text-xs font-semibold text-ink">
      {children}
    </span>
  );
}

const MIN_SERVINGS = 1;
const MAX_SERVINGS = 12;

export function ReceptDetailView({ recipe: initial }: { recipe: RecipeDetailDto }) {
  const router = useRouter();
  const [recipe, setRecipe] = useState(initial);
  const [servings, setServings] = useState(initial.servingsBase);
  const [cookMode, setCookMode] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [busy, setBusy] = useState(false);

  // Screen wake-lock while actively cooking, guarded (docs/workpackages/WP-04 §5:
  // "screen wake-lock via navigator.wakeLock guarded") — many browsers (older Safari)
  // don't implement the API at all, so this must never throw when it's absent.
  useEffect(() => {
    if (!cookMode) return;
    // Guarded: many browsers (older Safari, etc.) don't implement the Screen Wake
    // Lock API at all — this must never throw when it's absent (docs/workpackages/
    // WP-04 §5: "screen wake-lock via navigator.wakeLock guarded").
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | undefined;
    let cancelled = false;
    navigator.wakeLock
      .request('screen')
      .then((s) => {
        if (cancelled) void s.release();
        else sentinel = s;
      })
      .catch(() => {
        // Wake lock can be refused (e.g. low battery, backgrounded tab) — cook mode
        // still works, it just won't keep the screen on. Never surface this as an error.
      });

    return () => {
      cancelled = true;
      void sentinel?.release();
    };
  }, [cookMode]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/recipes/${recipe.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) setRecipe(await res.json());
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive() {
    setBusy(true);
    const res = await fetch(`/api/recipes/${recipe.id}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) router.push('/recepten');
  }

  const scaledIngredients = scaleIngredients(recipe.ingredients, recipe.servingsBase, servings);

  return (
    <div className="flex flex-col gap-6 pb-8">
      <PhotoFrame
        src={recipe.photoUrlLarge}
        blurDataUrl={recipe.blurDataUrl}
        alt={recipe.title}
        aspect="16:9"
        className="rounded-lg"
      />

      <div>
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-2xl font-bold text-ink md:text-[30px]">{recipe.title}</h2>
          <button
            type="button"
            disabled={busy}
            onClick={() => patch({ favorite: !recipe.favorite })}
            aria-pressed={recipe.favorite}
            aria-label={recipe.favorite ? 'Verwijder uit favorieten' : 'Voeg toe aan favorieten'}
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-xl',
              recipe.favorite ? 'border-accent bg-accent-soft text-accent' : 'border-ink/15 text-ink-muted hover:border-ink/30'
            )}
          >
            {recipe.favorite ? '★' : '☆'}
          </button>
        </div>
        {recipe.description && <p className="mt-2 text-sm text-ink-muted">{recipe.description}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <RecipeTypeBadge type={recipe.type} />
          <MetaChip>⏱ {recipe.timeMin} min</MetaChip>
          <MetaChip>{DIFFICULTY_LABEL[recipe.difficulty]}</MetaChip>
        </div>

        <div className="mt-3">
          <Stars value={recipe.rating} onChange={(value) => patch({ rating: value })} size="md" label="Jouw beoordeling" />
        </div>
      </div>

      <section aria-labelledby="ingredienten-heading" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 id="ingredienten-heading" className="text-lg font-bold text-ink">
            Ingrediënten
          </h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-muted">Aantal porties</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Minder porties"
                disabled={servings <= MIN_SERVINGS}
                onClick={() => setServings((s) => Math.max(MIN_SERVINGS, s - 1))}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-ink/15 text-lg text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                −
              </button>
              <span className="w-8 text-center text-base font-bold text-ink" aria-live="polite">
                {servings}
              </span>
              <button
                type="button"
                aria-label="Meer porties"
                disabled={servings >= MAX_SERVINGS}
                onClick={() => setServings((s) => Math.min(MAX_SERVINGS, s + 1))}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-ink/15 text-lg text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                +
              </button>
            </div>
          </div>
        </div>

        <ul className="flex flex-col divide-y divide-ink/10 rounded-lg border border-ink/10 bg-surface">
          {scaledIngredients.map((ingredient, index) => (
            <li key={recipe.ingredients[index]?.id ?? index} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="text-ink">{ingredient.display}</span>
              <span className="shrink-0 font-medium text-ink-muted">
                {formatAmountNl(ingredient.amount)} {ingredient.unit}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-muted">
          Categorieën: {[...new Set(recipe.ingredients.map((i) => INGREDIENT_CATEGORY_LABEL[i.category]))].join(', ')}
        </p>
      </section>

      <section aria-labelledby="bereiding-heading" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 id="bereiding-heading" className="text-lg font-bold text-ink">
            Bereiding
          </h3>
          <button
            type="button"
            onClick={() => {
              setCookMode((v) => !v);
              setActiveStep(0);
            }}
            className={cn(
              'inline-flex h-11 items-center justify-center rounded-full px-5 text-sm font-semibold',
              cookMode ? 'bg-ink/10 text-ink' : 'bg-primary text-white hover:bg-primary-hover'
            )}
          >
            {cookMode ? 'Stop kookmodus' : 'Start met koken'}
          </button>
        </div>

        <StepperList
          steps={recipe.steps}
          activeIndex={cookMode ? activeStep : undefined}
          className={cn(cookMode && 'text-lg [&_p]:text-xl [&_p]:leading-relaxed')}
        />

        {cookMode && (
          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              disabled={activeStep === 0}
              onClick={() => setActiveStep((s) => Math.max(0, s - 1))}
              className="inline-flex h-11 items-center justify-center rounded-full border border-ink/15 px-5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              Vorige stap
            </button>
            <span className="text-xs text-ink-muted" aria-live="polite">
              Stap {activeStep + 1} van {recipe.steps.length}
            </span>
            <button
              type="button"
              disabled={activeStep >= recipe.steps.length - 1}
              onClick={() => setActiveStep((s) => Math.min(recipe.steps.length - 1, s + 1))}
              className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Volgende stap
            </button>
          </div>
        )}
      </section>

      <div className="flex flex-wrap gap-3 border-t border-ink/10 pt-6">
        <Link
          href={`/recepten/${recipe.id}/bewerken`}
          className="inline-flex h-11 items-center justify-center rounded-full border border-ink/15 px-5 text-sm font-semibold text-ink hover:border-ink/30"
        >
          Bewerken
        </Link>
        <button
          type="button"
          disabled={busy}
          onClick={handleArchive}
          className="inline-flex h-11 items-center justify-center rounded-full border border-danger/30 px-5 text-sm font-semibold text-danger hover:bg-danger/5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Archiveren
        </button>
      </div>
    </div>
  );
}
