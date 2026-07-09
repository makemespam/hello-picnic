'use client';

// Filter bar (docs/DESIGN_PRINCIPLES.md §5 "Recepten": "type chips + search + sort
// select"). URL-driven (search params), not local-only state: filters stay shareable/
// bookmarkable and the grid re-renders server-side via listRecipes() — no client-side
// data fetching duplicate of the service layer (docs/ARCHITECTURE.md §1).
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Select } from '@/components/Select';
import { cn } from '@/components/cn';
import { RECIPE_TYPES, TYPE_LABEL, type RecipeType } from '@/shared/labels';
import type { RecipeSort } from '@/shared/recipes';

export interface ReceptenFilterBarProps {
  initialType?: RecipeType;
  initialText?: string;
  initialSort: RecipeSort;
  initialFavorite?: boolean;
}

export function ReceptenFilterBar({ initialType, initialText, initialSort, initialFavorite }: ReceptenFilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [text, setText] = useState(initialText ?? '');

  function pushParams(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === '') params.delete(key);
      else params.set(key, value);
    }
    router.push(`/recepten?${params.toString()}`);
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    pushParams({ text: text.trim() || undefined });
  }

  function toggleType(type: RecipeType) {
    pushParams({ type: initialType === type ? undefined : type });
  }

  return (
    <div className="mb-6 flex flex-col gap-3">
      <form onSubmit={handleSearchSubmit} className="flex gap-2" role="search">
        <label htmlFor="recepten-search" className="sr-only">
          Zoek in recepten
        </label>
        <input
          id="recepten-search"
          type="search"
          value={text}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setText(event.target.value)}
          placeholder="Zoek op titel of omschrijving…"
          className="h-11 w-full rounded-md border border-ink/15 bg-surface px-3 text-sm text-ink placeholder:text-ink-muted/70"
        />
        <button
          type="submit"
          className="h-11 shrink-0 rounded-full bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover"
        >
          Zoek
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filter op type" className="flex flex-wrap gap-2">
          {RECIPE_TYPES.map((type) => {
            const active = initialType === type;
            return (
              <button
                key={type}
                type="button"
                aria-pressed={active}
                onClick={() => toggleType(type)}
                className={cn(
                  'inline-flex h-9 items-center rounded-full border px-3 text-xs font-semibold transition-colors',
                  active ? 'border-primary bg-primary text-white' : 'border-ink/15 bg-surface text-ink hover:border-ink/30'
                )}
              >
                {TYPE_LABEL[type]}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={initialFavorite === true}
            onClick={() => pushParams({ favorite: initialFavorite ? undefined : 'true' })}
            className={cn(
              'inline-flex h-9 items-center gap-1 rounded-full border px-3 text-xs font-semibold transition-colors',
              initialFavorite ? 'border-accent bg-accent text-white' : 'border-ink/15 bg-surface text-ink hover:border-ink/30'
            )}
          >
            ★ Favorieten
          </button>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="recepten-sort" className="text-xs font-medium text-ink-muted">
            Sorteer
          </label>
          <Select
            id="recepten-sort"
            value={initialSort}
            onChange={(event) => pushParams({ sort: event.target.value })}
            className="h-9 w-40"
          >
            <option value="recent">Meest recent</option>
            <option value="rating">Hoogst gewaardeerd</option>
          </Select>
        </div>
      </div>
    </div>
  );
}
