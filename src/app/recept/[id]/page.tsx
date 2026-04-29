'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { MealPlan, Recipe } from '@/lib/types';

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: 'Makkelijk',
  medium: 'Gemiddeld',
  hard: 'Uitdagend',
};

const GRADIENTS: Record<string, string> = {
  vegan: 'bg-gradient-to-br from-lime-50 to-emerald-100',
  vegetarisch: 'bg-gradient-to-br from-emerald-50 to-green-100',
  vega: 'bg-gradient-to-br from-emerald-50 to-green-100',
  vis: 'bg-gradient-to-br from-blue-50 to-cyan-100',
  rund: 'bg-gradient-to-br from-red-50 to-rose-100',
  kip: 'bg-gradient-to-br from-amber-50 to-yellow-100',
  varken: 'bg-gradient-to-br from-pink-50 to-rose-100',
};

const TYPE_LABEL: Record<string, string> = {
  vegan: 'Vegan',
  vegetarisch: 'Vegetarisch',
  vega: 'Vega',
  vis: 'Vis',
  rund: 'Rund',
  kip: 'Kip',
  varken: 'Varken',
};

export default function RecipePage() {
  const { id } = useParams<{ id: string }>();
  const [recipe, setRecipe] = useState<Recipe | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('helloPicknicPlan');
      if (!raw) return;
      const plan: MealPlan = JSON.parse(raw);
      const found = plan.recipes.find((r) => r.id === id);
      if (found) setRecipe(found);
    } catch {
      /* nothing */
    }
  }, [id]);

  if (!recipe) {
    return (
      <div className="py-24 text-center space-y-4">
        <div className="text-5xl">🍽️</div>
        <p className="text-stone-500">Recept niet gevonden. Genereer eerst een weekplan.</p>
        <Link href="/plan" className="btn-primary">Naar weekplan →</Link>
      </div>
    );
  }

  const toBuy = recipe.ingredients.filter((i) => !i.pantry);
  const pantryIngs = recipe.ingredients.filter((i) => i.pantry);

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Hero */}
      <div className={`rounded-3xl flex flex-col items-center justify-center gap-4 py-16 ${GRADIENTS[recipe.type] ?? 'bg-gradient-to-br from-stone-50 to-stone-100'}`}>
        <span className="text-8xl">{recipe.emoji}</span>
        <div className="text-center px-6">
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className={recipe.type === 'vis' ? 'badge-vis' : 'badge-vega'}>
              {TYPE_LABEL[recipe.type] ?? recipe.type}
            </span>
          </div>
          <h1 className="text-3xl font-extrabold text-stone-900">{recipe.title}</h1>
          <p className="mt-2 text-stone-600">{recipe.description}</p>
        </div>
      </div>

      {/* Meta */}
      <div className="grid grid-cols-3 gap-4 text-center">
        {[
          { label: 'Bereidingstijd', value: `${recipe.time} min` },
          { label: 'Moeilijkheid', value: DIFFICULTY_LABEL[recipe.difficulty] },
          { label: 'Porties', value: `${recipe.servings} personen` },
        ].map((m) => (
          <div key={m.label} className="card py-4">
            <p className="text-xs text-stone-400 uppercase tracking-wide">{m.label}</p>
            <p className="font-bold text-stone-900 mt-1">{m.value}</p>
          </div>
        ))}
      </div>

      {/* Ingredients */}
      <div className="card p-6 space-y-4">
        <h2 className="text-lg font-bold text-stone-900">Ingrediënten</h2>
        <ul className="divide-y divide-stone-50">
          {toBuy.map((ing) => (
            <li key={ing.name} className="flex items-center justify-between py-2.5">
              <span className="text-stone-800">{ing.display}</span>
              <span className="text-stone-500 text-sm">{ing.amount} {ing.unit}</span>
            </li>
          ))}
        </ul>
        {pantryIngs.length > 0 && (
          <details className="text-sm text-stone-400">
            <summary className="cursor-pointer">Uit de kast ({pantryIngs.length})</summary>
            <ul className="mt-2 space-y-1 pl-2">
              {pantryIngs.map((ing) => (
                <li key={ing.name}>{ing.amount} {ing.unit} {ing.display}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* Steps */}
      <div className="space-y-3">
        <h2 className="text-lg font-bold text-stone-900">Bereiding</h2>
        {recipe.steps.map((step, i) => (
          <div key={i} className="flex gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-500 text-sm font-bold text-white">
              {i + 1}
            </div>
            <div className="card flex-1 px-4 py-3 text-sm text-stone-700 leading-relaxed">
              {step}
            </div>
          </div>
        ))}
      </div>

      <Link href="/plan" className="btn-secondary w-full justify-center">
        ← Terug naar weekplan
      </Link>
    </div>
  );
}
