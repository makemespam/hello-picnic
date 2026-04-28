'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { MealImageResult, MealPlan } from '@/lib/types';

function loadSavedPlan(): MealPlan | null {
  try {
    const raw = localStorage.getItem('helloPicknicPlan');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function OverviewPage() {
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [image, setImage] = useState<MealImageResult | null>(null);
  const [loadingImage, setLoadingImage] = useState(false);
  const [imageError, setImageError] = useState('');

  useEffect(() => {
    setPlan(loadSavedPlan());
    try {
      const raw = localStorage.getItem('helloPicknicMealImage');
      if (raw) setImage(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  async function generateImage() {
    if (!plan) return;
    setLoadingImage(true);
    setImageError('');
    const res = await fetch('/api/generate-meal-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipes: plan.recipes.slice(0, 4) }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      setImageError(data.error ?? 'Beeldgeneratie mislukt.');
      setLoadingImage(false);
      return;
    }

    setImage(data.result);
    localStorage.setItem('helloPicknicMealImage', JSON.stringify(data.result));
    setLoadingImage(false);
  }

  if (!plan) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 text-center">
        <h1 className="text-3xl font-extrabold text-stone-900">Receptenoverzicht</h1>
        <p className="text-stone-500">Genereer eerst een weekplan om hier je recepten te zien.</p>
        <Link href="/plan" className="btn-primary inline-flex">Maak weekplan</Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-stone-900">Receptenoverzicht</h1>
          <p className="mt-1 text-stone-500">Alle maaltijden compact bij elkaar, met een inspiratiebeeld in 2x2-stijl.</p>
        </div>
        <button
          onClick={generateImage}
          disabled={loadingImage}
          className="btn-primary justify-center"
        >
          {loadingImage ? 'Beeld maken...' : image ? 'Nieuw beeld maken' : 'Maak inspiratiebeeld'}
        </button>
      </div>

      {imageError && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">❌ {imageError}</p>
      )}

      {image && (
        <div className="space-y-3">
          <img
            src={image.imageDataUrl}
            alt="Inspiratiebeeld van vier maaltijden in een 2x2 grid"
            className="aspect-square w-full rounded-2xl border border-stone-200 object-cover"
          />
          <p className="text-xs text-stone-400">
            Gegenereerd met {image.provider === 'gemini' ? 'Gemini' : 'OpenAI'} · {image.model}
            {image.quality ? ` · ${image.quality}` : ''}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {plan.recipes.map((recipe, index) => (
          <section key={recipe.id} className="card p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase text-stone-400">Maaltijd {index + 1}</p>
                <h2 className="text-xl font-bold text-stone-900">{recipe.emoji} {recipe.title}</h2>
              </div>
              <span className={recipe.type === 'vega' ? 'badge-vega' : 'badge-vis'}>
                {recipe.type === 'vega' ? 'Vega' : 'Vis'}
              </span>
            </div>

            <p className="text-sm text-stone-500">{recipe.description}</p>

            <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-stone-500">
              <span className="rounded-lg bg-stone-50 px-2 py-1">{recipe.time} min</span>
              <span className="rounded-lg bg-stone-50 px-2 py-1">{recipe.servings} porties</span>
              <span className="rounded-lg bg-stone-50 px-2 py-1">{recipe.difficulty}</span>
            </div>

            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-stone-800">Ingrediënten</h3>
              <ul className="grid grid-cols-1 gap-1 text-sm text-stone-600 sm:grid-cols-2">
                {recipe.ingredients.slice(0, 8).map((ingredient) => (
                  <li key={`${recipe.id}-${ingredient.name}`}>
                    {ingredient.amount} {ingredient.unit} {ingredient.display}
                  </li>
                ))}
              </ul>
            </div>

            <Link
              href={`/recept/${recipe.id}`}
              className="mt-4 inline-flex rounded-full border border-stone-200 px-4 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              Bekijk recept
            </Link>
          </section>
        ))}
      </div>
    </div>
  );
}
