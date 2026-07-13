'use client';

// Recepten library body (docs/DESIGN_PRINCIPLES.md §5, docs/workpackages/WP-07-photo-
// pipeline.md §8): owns the recipe grid, the "Genereer ontbrekende foto's" backfill
// action, and — while any recipe is still `pending`/`generating` a dish photo (a new AI
// recipe just queued at plan-save, or an in-progress backfill) — polls GET /api/recipes
// every 1.5s so cards shimmer -> swap to the real photo without a page reload (same
// polling pattern as scannen/_components/ScannenView.tsx). Wraps PageHeader itself
// (rather than living purely inside its `action` slot) so the header's action buttons
// and the grid below share one source of truth for `missingCount`/`backfillRunning`.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { ProgressList, type ProgressItemData } from '@/components/ProgressList';
import { RecipeCard } from '@/components/RecipeCard';
import type { RecipeListItemDto } from '@/shared/recipes';
import { ReceptenFilterBar, type ReceptenFilterBarProps } from './ReceptenFilterBar';

const POLL_INTERVAL_MS = 1500;
// Safety valve against an unbounded client-side loop — the backend batch itself is also
// bounded (imageGenService.BACKFILL_BATCH_SIZE), this just caps how many round trips one
// "Genereer ontbrekende foto's" click makes even for a very large library.
const MAX_BACKFILL_ROUNDS = 50;

interface BackfillResponse {
  processed: number;
  remaining: number;
  stopped: boolean;
}

export interface ReceptenLibraryViewProps {
  initialRecipes: RecipeListItemDto[];
  /** URLSearchParams-encoded query, mirrors the current filter bar state — used to re-fetch the same (filtered) view while polling. */
  queryString: string;
  hasActiveFilter: boolean;
  initialMissingPhotoCount: number;
  filterBarProps: ReceptenFilterBarProps;
}

export function ReceptenLibraryView({ initialRecipes, queryString, hasActiveFilter, initialMissingPhotoCount, filterBarProps }: ReceptenLibraryViewProps) {
  const [recipes, setRecipes] = useState(initialRecipes);
  const [missingCount, setMissingCount] = useState(initialMissingPhotoCount);
  const [backfillRunning, setBackfillRunning] = useState(false);

  // Reset from the server-rendered payload whenever the filter/sort query changes (a
  // real navigation, not a poll) — same "SSR is the source of truth on nav" pattern the
  // rest of the app uses (e.g. ReceptDetailView keeps client state only until its own actions).
  useEffect(() => {
    setRecipes(initialRecipes);
  }, [initialRecipes]);
  useEffect(() => {
    setMissingCount(initialMissingPhotoCount);
  }, [initialMissingPhotoCount]);

  const hasLiveWork = recipes.some((recipe) => recipe.photoStatus === 'pending' || recipe.photoStatus === 'generating');

  async function refreshRecipes() {
    const res = await fetch(`/api/recipes?${queryString}`);
    if (res.ok) {
      const body: { recipes: RecipeListItemDto[] } = await res.json();
      setRecipes(body.recipes);
    }
  }

  useEffect(() => {
    if (!hasLiveWork && !backfillRunning) return;
    const timer = setInterval(refreshRecipes, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshRecipes is stable enough (only closes over queryString, listed below)
  }, [hasLiveWork, backfillRunning, queryString]);

  async function handleBackfill() {
    setBackfillRunning(true);
    try {
      let remaining = missingCount;
      for (let round = 0; remaining > 0 && round < MAX_BACKFILL_ROUNDS; round += 1) {
        const res = await fetch('/api/recipes/backfill-photos', { method: 'POST' });
        if (!res.ok) break;
        const body = (await res.json()) as BackfillResponse;
        remaining = body.remaining;
        setMissingCount(body.remaining);
        await refreshRecipes();
        if (body.stopped || body.processed === 0) break;
      }
    } finally {
      setBackfillRunning(false);
    }
  }

  async function handleStopBackfill() {
    await fetch('/api/recipes/backfill-photos/stop', { method: 'POST' });
  }

  const progressItems: ProgressItemData[] = recipes
    .filter((recipe) => recipe.photoStatus === 'pending' || recipe.photoStatus === 'generating' || recipe.photoStatus === 'failed')
    .map((recipe): ProgressItemData => {
      if (recipe.photoStatus === 'failed') return { id: String(recipe.id), label: recipe.title, status: 'error', detail: 'Mislukt' };
      return { id: String(recipe.id), label: recipe.title, status: recipe.photoStatus === 'generating' ? 'active' : 'pending' };
    });

  return (
    <div>
      <PageHeader
        title="Recepten"
        description="Jullie bibliotheek — foto's van HelloFresh-kaarten en zelfgemaakte recepten."
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/meer/scannen"
              className="inline-flex h-11 items-center justify-center rounded-full border border-ink/15 px-5 text-sm font-semibold text-ink hover:bg-ink/5"
            >
              Scan kaarten
            </Link>
            {missingCount > 0 &&
              (backfillRunning ? (
                <button
                  type="button"
                  onClick={handleStopBackfill}
                  className="inline-flex h-11 items-center justify-center rounded-full border border-ink/15 px-5 text-sm font-semibold text-ink hover:bg-ink/5"
                >
                  Stoppen…
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleBackfill}
                  className="inline-flex h-11 items-center justify-center rounded-full border border-ink/15 px-5 text-sm font-semibold text-ink hover:bg-ink/5"
                >
                  Genereer ontbrekende foto&apos;s ({missingCount})
                </button>
              ))}
            <Link
              href="/recepten/nieuw"
              className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover"
            >
              + Nieuw recept
            </Link>
          </div>
        }
      />

      <ReceptenFilterBar {...filterBarProps} />

      {progressItems.length > 0 && <ProgressList items={progressItems} className="mb-6" />}

      {recipes.length === 0 ? (
        hasActiveFilter ? (
          <EmptyState
            illustration="🔍"
            title="Geen recepten gevonden"
            description="Probeer een andere zoekterm of een ander filter."
          />
        ) : (
          <div className="flex flex-col items-center gap-3">
            <EmptyState
              illustration="📖"
              title="Nog geen recepten"
              description="Scan je HelloFresh-kaarten om je bibliotheek in één keer te vullen, of voeg een recept handmatig toe."
              action={{ label: 'Scan kaarten', href: '/meer/scannen' }}
            />
            <Link href="/recepten/nieuw" className="text-sm font-semibold text-primary underline underline-offset-2">
              Of voeg een recept handmatig toe
            </Link>
          </div>
        )
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {recipes.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} href={`/recepten/${recipe.id}`} />
          ))}
        </div>
      )}
    </div>
  );
}
