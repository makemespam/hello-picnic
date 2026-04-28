'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { RecipeLibraryItem } from '@/lib/types';

export default function LibraryPage() {
  const [items, setItems] = useState<RecipeLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadLibrary() {
      const res = await fetch('/api/recipe-library');
      const data = await res.json();
      setItems(data.items ?? []);
      setLoading(false);
    }
    loadLibrary();
  }, []);

  const sorted = [...items].sort((a, b) => b.libraryNumber - a.libraryNumber);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-stone-900">Maaltijdbibliotheek</h1>
        <p className="mt-1 text-stone-500">Alle gegenereerde maaltijden worden hier lokaal bewaard met hun eigen nummer.</p>
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
          </article>
        ))}
      </div>
    </div>
  );
}
