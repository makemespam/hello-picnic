'use client';

// Weekplan screen (docs/DESIGN_PRINCIPLES.md §5): generation sheet, result day-cards,
// rationale collapsible ("Slim hergebruik"), "Opnieuw genereren" (unapproved slots
// only), finalize ("Plan vastleggen"). Orchestrates the generate/approve/replace/
// finalize round trips against /api/plans/* — planService itself is server-only.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import type { PlanDto } from '@/shared/dto';
import type { RecipeListItemDto } from '@/shared/recipes';
import { GeneratePlanSheet, type GeneratePlanInputPayload } from './GeneratePlanSheet';
import { PlanMealCard } from './PlanMealCard';

export interface WeekplanViewProps {
  initialPlan: PlanDto | null;
  libraryRecipes: RecipeListItemDto[];
  defaultServings: number;
  defaultMealCount: number;
}

/** Dutch short day label ("wo 15 juli", docs/DESIGN_PRINCIPLES.md §6) for weekStart + a slot offset. */
function dayLabel(weekStartIso: string, offsetDays: number): string {
  const date = new Date(`${weekStartIso}T12:00:00`);
  date.setDate(date.getDate() + offsetDays);
  return new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'long' }).format(date);
}

async function postJson(url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function WeekplanView({ initialPlan, libraryRecipes, defaultServings, defaultMealCount }: WeekplanViewProps) {
  const router = useRouter();
  const [plan, setPlan] = useState(initialPlan);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [busyMealId, setBusyMealId] = useState<number | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  const isDraft = plan?.status === 'draft';

  async function handleGenerate(input: GeneratePlanInputPayload) {
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await postJson('/api/plans', { ...input, planId: isDraft ? plan!.id : undefined });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.error === 'string' ? body.error : 'Genereren is niet gelukt.');
      }
      const data = (await res.json()) as PlanDto;
      setPlan(data);
      setSheetOpen(false);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Genereren is niet gelukt.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleApprove(mealId: number) {
    if (!plan) return;
    setBusyMealId(mealId);
    try {
      const res = await postJson(`/api/plans/${plan.id}/approve-meal`, { mealId });
      if (res.ok) setPlan(await res.json());
    } finally {
      setBusyMealId(null);
    }
  }

  async function handleReplace(mealId: number) {
    if (!plan) return;
    setBusyMealId(mealId);
    try {
      const res = await postJson(`/api/plans/${plan.id}/replace-meal`, { mealId });
      if (res.ok) setPlan(await res.json());
    } finally {
      setBusyMealId(null);
    }
  }

  async function handleFinalize() {
    if (!plan) return;
    setFinalizing(true);
    try {
      const res = await postJson(`/api/plans/${plan.id}/finalize`);
      if (res.ok) {
        setPlan(await res.json());
        router.refresh(); // Vandaag now has a finalized plan to show.
      }
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-24">
      <PageHeader
        title="Weekplan"
        description={plan ? undefined : 'Stel jullie weekmenu samen — bibliotheekfavorieten eerst, de rest genereren we erbij.'}
        action={
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover"
          >
            {isDraft ? 'Opnieuw genereren' : 'Genereer weekmenu'}
          </button>
        }
      />

      {!plan && (
        <EmptyState
          illustration="📅"
          title="Nog geen weekmenu"
          description="Genereer jullie eerste weekmenu uit de receptenbibliotheek en verse AI-suggesties."
          action={{ label: 'Genereer weekmenu', onClick: () => setSheetOpen(true) }}
        />
      )}

      {plan && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {plan.meals.map((meal, index) => (
              <PlanMealCard
                key={meal.id}
                meal={meal}
                dayLabel={dayLabel(plan.weekStart, index)}
                busy={busyMealId === meal.id}
                readOnly={plan.status === 'final'}
                onApprove={() => handleApprove(meal.id)}
                onReplace={() => handleReplace(meal.id)}
              />
            ))}
          </div>

          {plan.rationale && (
            <details className="rounded-lg border border-ink/10 bg-surface p-4">
              <summary className="cursor-pointer text-sm font-semibold text-ink">Slim hergebruik</summary>
              <p className="mt-2 whitespace-pre-line text-sm text-ink-muted">{plan.rationale}</p>
            </details>
          )}

          {isDraft && (
            <div className="sticky bottom-[calc(56px+env(safe-area-inset-bottom))] flex justify-end md:static">
              <button
                type="button"
                disabled={finalizing}
                onClick={handleFinalize}
                className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {finalizing ? 'Bezig met vastleggen…' : 'Plan vastleggen'}
              </button>
            </div>
          )}
        </div>
      )}

      <GeneratePlanSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        mode={isDraft ? 'regenerate' : 'create'}
        libraryRecipes={libraryRecipes}
        defaultServings={plan?.servings ?? defaultServings}
        defaultMealCount={plan?.mealCount ?? defaultMealCount}
        submitting={generating}
        error={generateError}
        onSubmit={handleGenerate}
      />
    </div>
  );
}
