'use client';

// "Uit jullie keuken" (docs/DESIGN_PRINCIPLES.md §5, docs/workpackages/
// WP-13-proactive-suggestions.md §3): 3 suggestion cards with a one-tap "→ Zet in
// weekplan" that adds the recipe to the current draft plan (or starts a new one) and
// navigates to /plan.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/Alert';
import type { SuggestionsDto } from '@/shared/dto';
import { SuggestionCard } from './SuggestionCard';

export interface SuggestionsSectionProps {
  suggestions: SuggestionsDto;
}

const DISPLAY_LIMIT = 3;

export function SuggestionsSection({ suggestions }: SuggestionsSectionProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = suggestions.items.slice(0, DISPLAY_LIMIT);
  if (items.length === 0) return null;

  async function handleAdd(recipeId: number) {
    setBusyId(recipeId);
    setError(null);
    try {
      const res = await fetch('/api/plans/add-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipeId }),
      });
      if (!res.ok) throw new Error('add-suggestion failed');
      router.push('/plan');
    } catch {
      setError('Toevoegen aan het weekplan is niet gelukt. Probeer het nog eens.');
      setBusyId(null);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-bold text-ink">Uit jullie keuken</h2>
      {error && <Alert variant="danger">{error}</Alert>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {items.map((item) => (
          <SuggestionCard key={item.recipe.id} item={item} busy={busyId === item.recipe.id} onAdd={() => handleAdd(item.recipe.id)} />
        ))}
      </div>
    </section>
  );
}
