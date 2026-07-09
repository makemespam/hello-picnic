'use client';

// Weekplan screen (docs/DESIGN_PRINCIPLES.md §5): generation sheet, result day-cards,
// rationale collapsible ("Slim hergebruik"), "Opnieuw genereren" (unapproved slots
// only), finalize ("Plan vastleggen"). Orchestrates the generate/approve/replace/
// finalize round trips against /api/plans/* — planService itself is server-only.
// docs/workpackages/WP-12-google-calendar.md §3/§4 adds: per-meal day assignment
// (PATCH .../meals/:mealId), "Zet in agenda" publish on the finalized plan, and
// freebusy "druk" hints next to the day-picker.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/Alert';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import type { PlanDto } from '@/shared/dto';
import type { RecipeListItemDto } from '@/shared/recipes';
import { CostSummaryPanel, type CostSummary } from './CostSummaryPanel';
import type { DayOption } from './DayPicker';
import { GeneratePlanSheet, type GeneratePlanInputPayload } from './GeneratePlanSheet';
import { PlanMealCard } from './PlanMealCard';

export interface WeekplanViewProps {
  initialPlan: PlanDto | null;
  libraryRecipes: RecipeListItemDto[];
  defaultServings: number;
  defaultMealCount: number;
  costSummary?: CostSummary | null;
  /** Top-3 Vandaag suggestion ids (docs/workpackages/WP-13-proactive-suggestions.md §5), for the sheet's "Verras ons" quick action. */
  suggestedRecipeIds?: number[];
  /** Europe/Amsterdam "today" (YYYY-MM-DD), server-computed — anchors the day-picker's next-7-days range and the freebusy query. */
  todayKey: string;
}

/** Dutch short day label ("wo 15 juli", docs/DESIGN_PRINCIPLES.md §6) for weekStart + a slot offset. */
function dayLabel(weekStartIso: string, offsetDays: number): string {
  const date = new Date(`${weekStartIso}T12:00:00`);
  date.setDate(date.getDate() + offsetDays);
  return new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'long' }).format(date);
}

/** Pure calendar-day arithmetic on a `YYYY-MM-DD` key (client-side twin of google/timezone.ts's dateKeyPlusDays — deliberately not imported, client components never import src/server/*). */
function dateKeyPlusDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function dayOptionLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00`);
  return new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
}

async function postJson(url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

interface FreeBusyResponse {
  hints: { date: string; busy: boolean }[];
}

interface PublishResponse {
  published: number;
  skipped: number;
}

export function WeekplanView({
  initialPlan,
  libraryRecipes,
  defaultServings,
  defaultMealCount,
  costSummary,
  suggestedRecipeIds,
  todayKey,
}: WeekplanViewProps) {
  const router = useRouter();
  const [plan, setPlan] = useState(initialPlan);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [busyMealId, setBusyMealId] = useState<number | null>(null);
  const [cookDateBusyMealId, setCookDateBusyMealId] = useState<number | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [busyDates, setBusyDates] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState<{ variant: 'success' | 'danger'; text: string } | null>(null);

  const isDraft = plan?.status === 'draft';

  // docs/workpackages/WP-12 §4: "show the busy hints next to the day assignment UI
  // after generation as well" — fetched unconditionally once a plan exists (the sheet's
  // own "Check agenda" toggle below additionally previews hints before generating).
  useEffect(() => {
    if (!plan) return;
    fetch(`/api/calendar/freebusy?week=${encodeURIComponent(todayKey)}`)
      .then((res) => (res.ok ? (res.json() as Promise<FreeBusyResponse>) : null))
      .then((data) => {
        if (!data) return;
        setBusyDates(new Set(data.hints.filter((hint) => hint.busy).map((hint) => hint.date)));
      })
      .catch(() => undefined);
  }, [plan, todayKey]);

  const dayOptions: DayOption[] = Array.from({ length: 7 }, (_, offset) => {
    const dateKey = dateKeyPlusDays(todayKey, offset);
    return { dateKey, label: dayOptionLabel(dateKey), busy: busyDates.has(dateKey) };
  });

  async function handleSetCookDate(mealId: number, cookDate: string | null) {
    if (!plan) return;
    setCookDateBusyMealId(mealId);
    try {
      const res = await fetch(`/api/plans/${plan.id}/meals/${mealId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookDate }),
      });
      if (res.ok) setPlan(await res.json());
    } finally {
      setCookDateBusyMealId(null);
    }
  }

  async function handlePublish() {
    if (!plan) return;
    setPublishing(true);
    setPublishMessage(null);
    try {
      const res = await postJson('/api/calendar/publish', { planId: plan.id });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPublishMessage({ variant: 'danger', text: typeof body.message === 'string' ? body.message : (body.error ?? 'Publiceren naar de agenda is niet gelukt.') });
        return;
      }
      const result = body as PublishResponse;
      setPublishMessage({ variant: 'success', text: `${result.published} afspraken gezet in de agenda.` });
      // No GET /api/plans/:id route exists (docs/ARCHITECTURE.md §4) — re-read the
      // per-meal calendarEventId via the singleton "latest plan" (same assumption
      // e2e/plan.spec.ts documents: single household, this finalized plan is it).
      const latestRes = await fetch('/api/plans/latest');
      if (latestRes.ok) setPlan(await latestRes.json());
    } catch {
      setPublishMessage({ variant: 'danger', text: 'Netwerkfout bij het publiceren naar de agenda.' });
    } finally {
      setPublishing(false);
    }
  }

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
                dayOptions={dayOptions}
                cookDateBusy={cookDateBusyMealId === meal.id}
                onSetCookDate={(cookDate) => handleSetCookDate(meal.id, cookDate)}
              />
            ))}
          </div>

          {plan.status === 'final' && costSummary && <CostSummaryPanel summary={costSummary} />}

          {plan.status === 'final' && (
            <div className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">Google Agenda</p>
                  <p className="text-xs text-ink-muted">Zet de kook-voorbereidingen als afspraken in de agenda (op de gekozen dagen hierboven).</p>
                </div>
                <button
                  type="button"
                  disabled={publishing}
                  onClick={handlePublish}
                  className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {publishing ? 'Bezig…' : 'Zet in agenda'}
                </button>
              </div>
              {publishMessage && <Alert variant={publishMessage.variant}>{publishMessage.text}</Alert>}
            </div>
          )}

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
        suggestedRecipeIds={suggestedRecipeIds}
        todayKey={todayKey}
      />
    </div>
  );
}
