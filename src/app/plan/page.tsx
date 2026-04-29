'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import RecipeCard from '@/components/RecipeCard';
import ShoppingList from '@/components/ShoppingList';
import type { MealPlan, Recipe, RecipeLibraryItem, ShoppingItem, AppSettings, PicnicPromotion } from '@/lib/types';
import { DEFAULT_PANTRY_KEYS } from '@/data/pantry';
import { normalizeSettings } from '@/lib/settings';
import {
  DEFAULT_LLM_PROVIDER,
  DEFAULT_MEAL_COUNT,
  DEFAULT_SERVINGS,
  getDefaultModel,
  getProviderConfig,
  type LlmProvider,
} from '@/lib/llm';

type ConfigStatus = {
  llmApiKeys: Partial<Record<LlmProvider, boolean>>;
  picnicCredentials: boolean;
};

function buildShoppingList(plan: MealPlan, pantryItems: string[]): ShoppingItem[] {
  const normalizeIngredientKey = (value: string) => {
    const normalized = value
      .trim()
      .toLocaleLowerCase('nl-NL')
      .replace(/[^a-z0-9à-ÿ]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (normalized === 'ei' || normalized === 'eieren') return 'eieren';
    if (normalized === 'wortel' || normalized === 'wortelen' || normalized === 'waspeen') return 'wortelen';
    return normalized;
  };
  const pantrySet = new Set(pantryItems.map(normalizeIngredientKey));
  const map = new Map<string, ShoppingItem>();

  for (const recipe of plan.recipes) {
    for (const ing of recipe.ingredients) {
      const key = normalizeIngredientKey(ing.name || ing.display);
      const isPantry = ing.pantry || pantrySet.has(key);
      const existing = map.get(key);
      if (existing) {
        // merge if same unit, otherwise keep separate entries
        if (existing.unit.toLocaleLowerCase('nl-NL') === ing.unit.toLocaleLowerCase('nl-NL')) {
          existing.totalAmount = Math.round((existing.totalAmount + ing.amount) * 10) / 10;
        }
        if (!existing.recipeIds.includes(recipe.id)) existing.recipeIds.push(recipe.id);
      } else {
        map.set(key, {
          name: key,
          display: ing.display,
          totalAmount: ing.amount,
          unit: ing.unit,
          category: ing.category,
          productPreference: ing.productPreference ?? (ing.category === 'groenten' ? 'fresh' : undefined),
          pantry: isPantry,
          enabled: true,
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

function loadBrowserSettings(): Partial<AppSettings> | null {
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

function formatEuro(cents: number) {
  return `€${(cents / 100).toFixed(2)}`;
}

function buildLibrarySummaries(items: RecipeLibraryItem[]) {
  return items
    .filter((item) => item.status !== 'rejected')
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.libraryNumber - a.libraryNumber)
    .slice(0, 40)
    .map((item) => {
      const rating = item.rating ? `, ${item.rating}/5 sterren` : '';
      const favorite = item.favorite ? ', favoriet' : '';
      return `#${item.libraryNumber}: ${item.recipe.title} (${item.recipe.type}${rating}${favorite}) - ${item.recipe.description}`;
    })
    .join('\n');
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
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
  const [replacingRecipeId, setReplacingRecipeId] = useState<string | null>(null);
  const [libraryItems, setLibraryItems] = useState<RecipeLibraryItem[]>([]);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);

  const fetchConfigStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/config/status');
      const data = await res.json();
      setConfigStatus(data);
    } catch {
      setConfigStatus(null);
    }
  }, []);

  const fetchPromotions = useCallback(async (token: string) => {
    setLoadingPromos(true);
    try {
      const res = await fetch('/api/picnic/promotions', {
        headers: { 'x-picnic-auth': token },
      });
      const data = await res.json();
      setPromotions(data.promotions ?? []);
    } catch {
      /* silent - promotions are optional */
    } finally {
      setLoadingPromos(false);
    }
  }, []);

  const fetchLibrary = useCallback(async () => {
    try {
      const res = await fetch('/api/recipe-library');
      const data = await res.json();
      setLibraryItems(data.items ?? []);
    } catch {
      setLibraryItems([]);
    }
  }, []);

  useEffect(() => {
    async function loadAppSettings() {
      const browserSettings = loadBrowserSettings();
      let s = normalizeSettings(browserSettings);
      try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        s = normalizeSettings(data.exists ? { ...browserSettings, ...data.settings } : browserSettings);
        localStorage.setItem('helloPicknicSettings', JSON.stringify(s));
      } catch {
        /* browser settings are enough to keep the page usable */
      }

      setSettings(s);

      const saved = loadSavedPlan();
      if (saved) {
        setPlan(saved);
        const pantry = s?.pantryItems ?? DEFAULT_PANTRY_KEYS;
        setShoppingItems(buildShoppingList(saved, pantry));
      }

      if (s?.picnicAuthToken) fetchPromotions(s.picnicAuthToken);
    }

    loadAppSettings();
    fetchConfigStatus();
    fetchLibrary();
  }, [fetchConfigStatus, fetchLibrary, fetchPromotions]);

  async function generate() {
    setLoading(true);
    setError('');

    const pantryItems = settings?.pantryItems ?? DEFAULT_PANTRY_KEYS;
    const mealTarget = settings?.mealCount ?? DEFAULT_MEAL_COUNT;
    const selectedLibraryRecipes = selectedLibraryIds
      .map((libraryId) => libraryItems.find((item) => item.libraryId === libraryId)?.recipe)
      .filter((recipe): recipe is Recipe => Boolean(recipe))
      .slice(0, mealTarget);
    const newMealCount = Math.max(0, mealTarget - selectedLibraryRecipes.length);

    if (newMealCount === 0) {
      const nextPlan: MealPlan = {
        recipes: selectedLibraryRecipes,
        rationale: 'Deze selectie bestaat volledig uit eerder opgeslagen maaltijden uit je bibliotheek.',
        generatedAt: new Date().toISOString(),
        preferences,
        mealCount: selectedLibraryRecipes.length,
        servings: settings?.servings ?? DEFAULT_SERVINGS,
      };
      setPlan(nextPlan);
      localStorage.setItem('helloPicknicPlan', JSON.stringify(nextPlan));
      setShoppingItems(buildShoppingList(nextPlan, pantryItems));
      setLoading(false);
      return;
    }

    const res = await fetch('/api/generate-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preferences,
        pantryItems,
        promotions,
        provider: settings?.llmProvider ?? DEFAULT_LLM_PROVIDER,
        apiKeys: {
          anthropic: settings?.anthropicApiKey ?? '',
          openai: settings?.openaiApiKey ?? '',
          gemini: settings?.geminiApiKey ?? '',
        },
        model: settings?.model ?? getDefaultModel(DEFAULT_LLM_PROVIDER),
        mealCount: newMealCount,
        servings: settings?.servings ?? DEFAULT_SERVINGS,
        allergies: settings?.allergies ?? '',
        useUpProducts: settings?.useUpProducts ?? '',
        enabledRecipeTypes: settings?.enabledRecipeTypes ?? ['vegetarisch', 'vis'],
        enabledMealStyles: settings?.enabledMealStyles ?? ['makkelijk', 'fit', 'gezin'],
        librarySummaries: buildLibrarySummaries(libraryItems),
      }),
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      setError(data.error ?? 'Er ging iets mis. Probeer het opnieuw.');
      setLoading(false);
      return;
    }

    let newPlan: MealPlan = data.plan;
    newPlan = await saveRecipesToLibrary(newPlan);
    if (selectedLibraryRecipes.length > 0) {
      newPlan = {
        ...newPlan,
        recipes: [...selectedLibraryRecipes, ...newPlan.recipes],
        mealCount: selectedLibraryRecipes.length + newPlan.recipes.length,
        rationale: `Eerder gekozen uit je bibliotheek: ${selectedLibraryRecipes.map((recipe) => recipe.title).join(', ')}. ${newPlan.rationale}`,
      };
    }
    setPlan(newPlan);
    localStorage.setItem('helloPicknicPlan', JSON.stringify(newPlan));

    const items = buildShoppingList(newPlan, pantryItems);
    setShoppingItems(items);
    fetchLibrary();
    setLoading(false);
  }

  async function saveRecipesToLibrary(nextPlan: MealPlan): Promise<MealPlan> {
    const res = await fetch('/api/recipe-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipes: nextPlan.recipes }),
    });
    const data = await res.json();
    const items = (data.items ?? []) as RecipeLibraryItem[];
    const recipes = nextPlan.recipes.map((recipe, index) => items[index]?.recipe ?? recipe);
    return { ...nextPlan, recipes };
  }

  async function updateRecipeStatus(recipe: Recipe, status: Recipe['status']) {
    if (!recipe.libraryId || !status || !plan) return;
    const res = await fetch('/api/recipe-library', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ libraryId: recipe.libraryId, status }),
    });
    const data = await res.json();
    const updated = data.item?.recipe as Recipe | undefined;
    if (!updated) return;
    const nextPlan = {
      ...plan,
      recipes: plan.recipes.map((item) => item.libraryId === recipe.libraryId ? updated : item),
    };
    setPlan(nextPlan);
    localStorage.setItem('helloPicknicPlan', JSON.stringify(nextPlan));
  }

  async function replaceRecipe(recipe: Recipe) {
    if (!plan) return;
    setReplacingRecipeId(recipe.libraryId ?? recipe.id);
    setError('');
    if (recipe.libraryId) {
      await updateRecipeStatus(recipe, 'rejected');
    }

    const pantryItems = settings?.pantryItems ?? DEFAULT_PANTRY_KEYS;
    const avoidTitles = plan.recipes.map((item) => item.title).join(', ');
    const res = await fetch('/api/generate-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preferences: `Genereer 1 alternatief voor "${recipe.title}". Vermijd deze eerder gegenereerde maaltijden: ${avoidTitles}. Houd dezelfde stijl, vegetarisch of vis, en maak het duidelijk anders.`,
        pantryItems,
        promotions,
        provider: settings?.llmProvider ?? DEFAULT_LLM_PROVIDER,
        apiKeys: {
          anthropic: settings?.anthropicApiKey ?? '',
          openai: settings?.openaiApiKey ?? '',
          gemini: settings?.geminiApiKey ?? '',
        },
        model: settings?.model ?? getDefaultModel(DEFAULT_LLM_PROVIDER),
        mealCount: 1,
        servings: settings?.servings ?? DEFAULT_SERVINGS,
        allergies: settings?.allergies ?? '',
        useUpProducts: settings?.useUpProducts ?? '',
        enabledRecipeTypes: settings?.enabledRecipeTypes ?? ['vegetarisch', 'vis'],
        enabledMealStyles: settings?.enabledMealStyles ?? ['makkelijk', 'fit', 'gezin'],
        librarySummaries: buildLibrarySummaries(libraryItems),
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      setError(data.error ?? 'Alternatief genereren mislukt.');
      setReplacingRecipeId(null);
      return;
    }

    const replacementPlan = await saveRecipesToLibrary(data.plan);
    const replacement = replacementPlan.recipes[0];
    const nextPlan = {
      ...plan,
      recipes: plan.recipes.map((item) => item.libraryId === recipe.libraryId || item.id === recipe.id ? replacement : item),
    };
    setPlan(nextPlan);
    localStorage.setItem('helloPicknicPlan', JSON.stringify(nextPlan));
    setShoppingItems(buildShoppingList(nextPlan, pantryItems));
    fetchLibrary();
    setReplacingRecipeId(null);
  }

  const handleItemsChange = useCallback((items: ShoppingItem[]) => {
    setShoppingItems(items);
  }, []);

  const provider = getProviderConfig(settings?.llmProvider ?? DEFAULT_LLM_PROVIDER);
  const selectedApiKey =
    provider.id === 'anthropic'
      ? settings?.anthropicApiKey
      : provider.id === 'openai'
        ? settings?.openaiApiKey
        : settings?.geminiApiKey;
  const hasApiKey = !!(selectedApiKey || configStatus?.llmApiKeys?.[provider.id]);
  const mealCount = settings?.mealCount ?? DEFAULT_MEAL_COUNT;
  const servings = settings?.servings ?? DEFAULT_SERVINGS;
  const selectedPricedItems = shoppingItems.filter((item) => item.enabled !== false && !item.pantry && item.picnicArticle);
  const pricedItemCount = selectedPricedItems.length;
  const totalSelectedItems = shoppingItems.filter((item) => item.enabled !== false && !item.pantry).length;
  const totalPicnicCents = selectedPricedItems.reduce((sum, item) => {
    const price = item.picnicArticle?.price ?? 0;
    return sum + price * (item.picnicCount ?? 1);
  }, 0);
  const totalPortions = plan ? plan.recipes.length * plan.servings : 0;
  const pricePerPortion = totalPortions > 0 ? totalPicnicCents / totalPortions : 0;
  const selectableLibraryItems = libraryItems
    .filter((item) => item.status !== 'rejected')
    .sort((a, b) => {
      if (a.status === 'approved' && b.status !== 'approved') return -1;
      if (a.status !== 'approved' && b.status === 'approved') return 1;
      return b.libraryNumber - a.libraryNumber;
    })
    .slice(0, 12);

  function toggleLibraryMeal(libraryId: string) {
    setSelectedLibraryIds((current) => {
      if (current.includes(libraryId)) return current.filter((id) => id !== libraryId);
      if (current.length >= mealCount) return current;
      return [...current, libraryId];
    });
  }

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold text-stone-900">Weekplan genereren</h1>
        <p className="mt-1 text-stone-500">
          Vertel wat je lekker lijkt, en {provider.label} stelt {mealCount} slimme maaltijden voor {servings} personen samen.
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
              <span className="text-emerald-600">✓ {promotions.length} Picnic-aanbiedingen meegestuurd naar {provider.label}</span>
            ) : (
              <span>Geen aanbiedingen gevonden (of niet ingelogd)</span>
            )}
          </div>
        )}

        {!hasApiKey && (
          <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-4 py-2">
            ⚠️ Stel eerst je {provider.label} API-sleutel in via{' '}
            <a href="/instellingen" className="underline font-medium">Instellingen</a>.
          </p>
        )}

        {error && (
          <p className="text-sm text-red-700 bg-red-50 rounded-lg px-4 py-2">❌ {error}</p>
        )}

        {selectableLibraryItems.length > 0 && (
          <div className="rounded-xl border border-stone-100 bg-stone-50 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-stone-800">Maaltijden uit bibliotheek</p>
                <p className="text-xs text-stone-500">
                  Kies er nul of meer; de app vult de rest aan met nieuwe recepten.
                </p>
              </div>
              {selectedLibraryIds.length > 0 && (
                <button
                  onClick={() => setSelectedLibraryIds([])}
                  className="text-xs font-semibold text-stone-500 hover:text-stone-800"
                >
                  Wis selectie
                </button>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {selectableLibraryItems.map((item) => (
                <label key={item.libraryId} className="flex cursor-pointer items-start gap-2 rounded-lg bg-white p-3 text-sm shadow-sm ring-1 ring-stone-100">
                  <input
                    type="checkbox"
                    checked={selectedLibraryIds.includes(item.libraryId)}
                    onChange={() => toggleLibraryMeal(item.libraryId)}
                    className="mt-1 h-4 w-4 rounded accent-orange-500"
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold text-stone-800">
                      #{item.libraryNumber} {item.recipe.emoji} {item.recipe.title}
                    </span>
                    <span className="block truncate text-xs text-stone-500">
                      {item.status === 'approved' ? 'Goedgekeurd' : 'Nieuw'} · {item.recipe.time} min · {item.recipe.type}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={generate}
          disabled={loading || !hasApiKey}
          className="btn-primary w-full justify-center py-4 text-base"
        >
          {loading ? (
            <>
              <span className="animate-spin">⏳</span>
              {provider.label} genereert je weekplan…
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
              <h2 className="text-xl font-bold text-stone-900">Jouw {plan.recipes.length} maaltijden</h2>
              <button
                onClick={generate}
                disabled={loading}
                className="btn-secondary text-sm"
              >
                🔄 Opnieuw genereren
              </button>
              <Link href="/overzicht" className="btn-secondary text-sm">
                Overzicht
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {plan.recipes.map((recipe, i) => (
                <RecipeCard
                  key={recipe.libraryId ?? recipe.id}
                  recipe={recipe}
                  day={i + 1}
                  onApprove={(item) => updateRecipeStatus(item, 'approved')}
                  onReplace={replaceRecipe}
                  replacing={replacingRecipeId === (recipe.libraryId ?? recipe.id)}
                />
              ))}
            </div>
          </div>

          {/* Shopping list */}
          <div>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <h2 className="text-xl font-bold text-stone-900">Boodschappenlijst</h2>
              {pricedItemCount > 0 && (
                <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                  <p className="font-semibold">
                    {formatEuro(Math.round(pricePerPortion))} per portie
                  </p>
                  <p className="text-xs text-blue-700">
                    {formatEuro(totalPicnicCents)} totaal · {pricedItemCount}/{totalSelectedItems} producten met Picnic-prijs
                  </p>
                </div>
              )}
            </div>
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
