'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { RecipeLibraryItem } from '@/lib/types';

export default function LibraryPage() {
  const [items, setItems] = useState<RecipeLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'recent' | 'rating' | 'favorite' | 'title'>('recent');

  useEffect(() => {
    async function loadLibrary() {
      const res = await fetch('/api/recipe-library');
      const data = await res.json();
      setItems(data.items ?? []);
      setLoading(false);
    }
    loadLibrary();
  }, []);

  async function updateItem(libraryId: string, updates: { rating?: number; favorite?: boolean }) {
    const res = await fetch('/api/recipe-library', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ libraryId, ...updates }),
    });
    const data = await res.json();
    if (!res.ok || !data.item) return;
    setItems((current) => current.map((item) => item.libraryId === libraryId ? data.item : item));
  }

  async function deleteItem(libraryId: string) {
    const res = await fetch(`/api/recipe-library?libraryId=${encodeURIComponent(libraryId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) return;
    setItems((current) => current.filter((item) => item.libraryId !== libraryId));
  }

  const sorted = [...items].sort((a, b) => {
    if (sortBy === 'rating') return (b.rating ?? 0) - (a.rating ?? 0) || b.libraryNumber - a.libraryNumber;
    if (sortBy === 'favorite') return Number(b.favorite ?? false) - Number(a.favorite ?? false) || (b.rating ?? 0) - (a.rating ?? 0) || b.libraryNumber - a.libraryNumber;
    if (sortBy === 'title') return a.recipe.title.localeCompare(b.recipe.title, 'nl-NL');
    return b.libraryNumber - a.libraryNumber;
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-stone-900">Maaltijdbibliotheek</h1>
        <p className="mt-1 text-stone-500">Alle gegenereerde maaltijden worden hier lokaal bewaard met hun eigen nummer.</p>
      </div>

      <div className="flex justify-end">
        <label className="text-sm font-semibold text-stone-700">
          Sorteren
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
            className="ml-2 rounded-xl border border-stone-200 px-3 py-2 text-sm font-normal focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
          >
            <option value="recent">Nieuwste eerst</option>
            <option value="rating">Sterren eerst</option>
            <option value="favorite">Hartjes eerst</option>
            <option value="title">Titel A-Z</option>
          </select>
        </label>
      </div>

      {loading && <p className="text-stone-500">Bibliotheek laden...</p>}

      {!loading && sorted.length === 0 && (
        <div className="rounded-2xl bg-stone-50 p-6 text-center">
          <p className="text-stone-500">Nog geen maaltijden opgeslagen.</p>
          <Link href="/plan" className="btn-primary mt-4 inline-flex">Genereer weekplan</Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {sorted.map((item) => (
          <article key={item.libraryId} className="card p-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase text-stone-400">#{item.libraryNumber}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                item.status === 'approved'
                  ? 'bg-emerald-100 text-emerald-700'
                  : item.status === 'rejected'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-amber-100 text-amber-700'
              }`}>
                {item.status === 'approved' ? 'Goedgekeurd' : item.status === 'rejected' ? 'Afgekeurd' : 'Nieuw'}
              </span>
            </div>
            <h2 className="text-lg font-bold text-stone-900">{item.recipe.emoji} {item.recipe.title}</h2>
            <p className="mt-1 text-sm text-stone-500">{item.recipe.description}</p>
            <div className="mt-3 flex gap-2 text-xs text-stone-500">
              <span>{item.recipe.time} min</span>
              <span>{item.recipe.servings} porties</span>
              <span>{item.recipe.type}</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={() => updateItem(item.libraryId, { favorite: !item.favorite })}
                className={`rounded-full px-3 py-1 text-sm font-semibold ${item.favorite ? 'bg-red-100 text-red-700' : 'bg-stone-100 text-stone-500'}`}
                aria-label={item.favorite ? 'Verwijder hartje' : 'Geef hartje'}
              >
                {item.favorite ? '♥' : '♡'}
              </button>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((rating) => (
                  <button
                    key={rating}
                    onClick={() => updateItem(item.libraryId, { rating: item.rating === rating ? 0 : rating })}
                    className={`text-lg leading-none ${rating <= (item.rating ?? 0) ? 'text-amber-500' : 'text-stone-300'}`}
                    aria-label={`${rating} sterren`}
                  >
                    ★
                  </button>
                ))}
              </div>
              <button
                onClick={() => deleteItem(item.libraryId)}
                className="ml-auto rounded-full border border-red-100 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
              >
                Verwijder
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
