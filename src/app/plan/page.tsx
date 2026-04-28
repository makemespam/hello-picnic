'use client';

import { useState, useEffect, useCallback } from 'react';
import RecipeCard from '@/components/RecipeCard';
import ShoppingList from '@/components/ShoppingList';
import type { MealPlan, ShoppingItem, AppSettings, PicnicPromotion } from '@/lib/types';
import { DEFAULT_PANTRY_KEYS } from '@/data/pantry';

function buildShoppingList(plan: MealPlan, pantryItems: string[]): ShoppingItem[] {
  const pantrySet = new Set(pantryItems);
  const map = new Map<string, ShoppingItem>();

  for (const recipe of plan.recipes) {
    for (const ing of recipe.ingredients) {
      const isPantry = ing.pantry || pantrySet.has(ing.name);
      const existing = map.get(ing.name);
      if (existing) {
        // merge if same unit, otherwise keep separate entries
        if (existing.unit === ing.unit) {
          existing.totalAmount = Math.round((existing.totalAmount + ing.amount) * 10) / 10;
        }
        if (!existing.recipeIds.includes(recipe.id)) existing.recipeIds.push(recipe.id);
      } else {
        map.set(ing.name, {
          name: ing.name,
          display: ing.display,
          totalAmount: ing.amount,
          unit: ing.unit,
          category: ing.category,
          pantry: isPantry,
          recipeIds: [recipe.id],
        });
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.pantry !== b.pantry) return a.pantry ? 1 : -1;
    return a.category.localeCompare(b.category);
  });
}

function loadSettings(): AppSettings | null {
  try {
    const raw = localStorage.getItem('helloPicknicSettings');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function loadSavedPlan(): MealPlan | null {
  try {
    const raw = localStorage.getItem('helloPicknicPlan');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function PlanPage() {
  const [preferences, setPreferences] = useState('');
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [promotions, setPromotions] = useState<PicnicPromotion[]>([]);
  const [loadingPromos, setLoadingPromos] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    const s = loadSettings();
    setSettings(s);

    const saved = loadSavedPlan();
    if (saved) {
      setPlan(saved);
      const pantry = s?.pantryItems ?? DEFAULT_PANTRY_KEYS;
      setShoppingItems(buildShoppingList(saved, pantry));
    }

    if (s?.picnicAuthToken) fetchPromotions(s.picnicAuthToken);
  }, []);

  async function fetchPromotions(token: string) {
    setLoadingPromos(true);
    try {
      const res = await fetch('/api/picnic/promotions', {
        headers: { 'x-picnic-auth': token },
      });
      const data = await res.json();
      setPromotions(data.promotions ?? []);
    } catch {
      /* silent — promotions are optional */
    } finally {
      setLoadingPromos(false);
    }
  }

  async function generate() {
    setLoading(true);
    setError('');

    const pantryItems = settings?.pantryItems ?? DEFAULT_PANTRY_KEYS;

    const res = await fetch('/api/generate-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preferences,
        pantryItems,
        promotions,
        apiKey: settings?.anthropicApiKey ?? '',
        model: settings?.model ?? 'claude-sonnet-4-6',
      }),
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      setError(data.error ?? 'Er ging iets mis. Probeer het opnieuw.');
      setLoading(false);
      return;
    }

    const newPlan: MealPlan = data.plan;
    setPlan(newPlan);
    localStorage.setItem('helloPicknicPlan', JSON.stringify(newPlan));

    const items = buildShoppingList(newPlan, pantryItems);
    setShoppingItems(items);
    setLoading(false);
  }

  const handleItemsChange = useCallback((items: ShoppingItem[]) => {
    setShoppingItems(items);
  }, []);

  const hasApiKey = !!(settings?.anthropicApiKey || process.env.NEXT_PUBLIC_HAS_API_KEY);

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold text-stone-900">Weekplan genereren</h1>
        <p className="mt-1 text-stone-500">
          Vertel wat je lekker lijkt, en Claude stelt 4 slimme maaltijden samen.
        </p>
      </div>

      {/* Input card */}
      <div className="card p-6 space-y-4">
        <label className="block">
          <span className="font-semibold text-stone-700">Wat heb je zin in? <span className="font-normal text-stone-400">(optioneel)</span></span>
          <textarea
            value={preferences}
            onChange={(e) => setPreferences(e.target.value)}
            placeholder="Bijv: iets Aziatisch, gebruik de Picnic-aanbiedingen, liever geen zalm deze week, iets met pasta..."
            rows={3}
            className="mt-2 w-full rounded-xl border border-stone-200 px-4 py-3 text-sm text-stone-800 placeholder-stone-300 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100 resize-none"
          />
        </label>

        {/* Promotions status */}
        {settings?.picnicAuthToken && (
          <div className="flex items-center gap-2 text-sm text-stone-500">
            {loadingPromos ? (
              <span>⏳ Aanbiedingen ophalen…</span>
            ) : promotions.length > 0 ? (
              <span className="text-emerald-600">✓ {promotions.length} Picnic-aanbiedingen meegestuurd naar Claude</span>
            ) : (
              <span>Geen aanbiedingen gevonden (of niet ingelogd)</span>
            )}
          </div>
        )}

        {!settings?.anthropicApiKey && (
          <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-4 py-2">
            ⚠️ Stel eerst je Anthropic API-sleutel in via{' '}
            <a href="/instellingen" className="underline font-medium">Instellingen</a>.
          </p>
        )}

        {error && (
          <p className="text-sm text-red-700 bg-red-50 rounded-lg px-4 py-2">❌ {error}</p>
        )}

        <button
          onClick={generate}
          disabled={loading || !hasApiKey}
          className="btn-primary w-full justify-center py-4 text-base"
        >
          {loading ? (
            <>
              <span className="animate-spin">⏳</span>
              Claude genereert je weekplan…
            </>
          ) : (
            <>✨ Genereer weekplan</>
          )}
        </button>
      </div>

      {/* Generated plan */}
      {plan && (
        <>
          {/* Rationale */}
          <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-5">
            <p className="text-sm font-semibold text-emerald-800 mb-1">♻️ Slim hergebruik van ingrediënten</p>
            <p className="text-sm text-emerald-700">{plan.rationale}</p>
          </div>

          {/* Recipe grid */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-stone-900">Jouw 4 maaltijden</h2>
              <button
                onClick={generate}
                disabled={loading}
                className="btn-secondary text-sm"
              >
                🔄 Opnieuw genereren
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {plan.recipes.map((recipe, i) => (
                <RecipeCard key={recipe.id} recipe={recipe} day={i + 1} />
              ))}
            </div>
          </div>

          {/* Shopping list */}
          <div>
            <h2 className="text-xl font-bold text-stone-900 mb-4">Boodschappenlijst</h2>
            <ShoppingList
              items={shoppingItems}
              picnicToken={settings?.picnicAuthToken ?? null}
              onItemsChange={handleItemsChange}
            />
          </div>
        </>
      )}
    </div>
  );
}
