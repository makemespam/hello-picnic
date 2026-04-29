'use client';

import { useEffect, useRef, useState } from 'react';
import type { ShoppingItem, PicnicArticle } from '@/lib/types';

const CATEGORY_ORDER = ['groenten', 'fruit', 'vis', 'zuivel', 'kruiden', 'granen', 'peulvruchten', 'overig'];
const CATEGORY_LABEL: Record<string, string> = {
  groenten: '🥦 Groenten',
  fruit: '🍋 Fruit',
  vis: '🐟 Vis & zeevruchten',
  zuivel: '🧀 Zuivel & eieren',
  kruiden: '🌿 Verse kruiden',
  granen: '🌾 Granen & pasta',
  peulvruchten: '🫘 Peulvruchten',
  overig: '🛒 Overig',
};

type PackageUnit = 'g' | 'ml' | 'stuks';

function recipeAmountInComparableUnit(item: ShoppingItem): { amount: number; unit: PackageUnit } | null {
  const unit = item.unit.toLocaleLowerCase('nl-NL');
  if (['g', 'gram', 'gr'].includes(unit)) return { amount: item.totalAmount, unit: 'g' };
  if (['kg', 'kilo'].includes(unit)) return { amount: item.totalAmount * 1000, unit: 'g' };
  if (['ml', 'milliliter'].includes(unit)) return { amount: item.totalAmount, unit: 'ml' };
  if (['l', 'liter'].includes(unit)) return { amount: item.totalAmount * 1000, unit: 'ml' };
  if (['stuk', 'stuks', 'stronk', 'bos', 'plak', 'plakken'].includes(unit)) return { amount: item.totalAmount, unit: 'stuks' };
  return null;
}

function parsePackageAmount(unitQuantity: string | undefined, desiredUnit?: PackageUnit): { amount: number; unit: PackageUnit; label: string } | null {
  if (!unitQuantity) return null;
  const lower = unitQuantity.toLocaleLowerCase('nl-NL').replace(',', '.');
  const patterns: Array<[RegExp, PackageUnit, number]> = [
    [/(\d+(?:\.\d+)?)\s*(?:kg|kilo)\b/, 'g', 1000],
    [/(\d+(?:\.\d+)?)\s*(?:g|gram|gr)\b/, 'g', 1],
    [/(\d+(?:\.\d+)?)\s*(?:l|liter)\b/, 'ml', 1000],
    [/(\d+(?:\.\d+)?)\s*(?:ml|milliliter)\b/, 'ml', 1],
    [/(\d+(?:\.\d+)?)\s*(?:stuk|stuks)\b/, 'stuks', 1],
  ];
  const matches: Array<{ amount: number; unit: PackageUnit; label: string }> = [];
  for (const [pattern, unit, multiplier] of patterns) {
    const match = lower.match(pattern);
    if (match) matches.push({ amount: Number(match[1]) * multiplier, unit, label: unitQuantity });
  }
  if (matches.length > 0) return matches.find((match) => match.unit === desiredUnit) ?? matches[0];
  if (/\b1\s*stuk\b/.test(lower) || /\bstuk\b/.test(lower)) return { amount: 1, unit: 'stuks', label: unitQuantity };
  return null;
}

function packagePlanFor(item: ShoppingItem, article: PicnicArticle) {
  const needed = recipeAmountInComparableUnit(item);
  const pack = parsePackageAmount(article.unitQuantity, needed?.unit);
  if (!needed || !pack || needed.unit !== pack.unit || pack.amount <= 0) {
    return {
      picnicArticle: article,
      picnicCount: 1,
      picnicCoverage: article.unitQuantity ? `1 x ${article.unitQuantity}` : undefined,
      picnicWarning: undefined,
    };
  }

  const count = pack.amount >= needed.amount * 0.8 ? 1 : Math.ceil(needed.amount / pack.amount);
  const supplied = count * pack.amount;
  const overshootRatio = supplied / needed.amount;
  const warning = overshootRatio > 2
    ? `Let op: ${count} verpakkingen is ruim meer dan nodig (${Math.round(overshootRatio * 10) / 10}x).`
    : undefined;

  return {
    picnicArticle: article,
    picnicCount: Math.max(1, count),
    picnicCoverage: `${Math.max(1, count)} x ${pack.label}`,
    picnicWarning: warning,
  };
}

interface Props {
  items: ShoppingItem[];
  picnicToken: string | null;
  onItemsChange: (items: ShoppingItem[]) => void;
}

export default function ShoppingList({ items, picnicToken, onItemsChange }: Props) {
  const [addingAll, setAddingAll] = useState(false);
  const [clearingCart, setClearingCart] = useState(false);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [picnicError, setPicnicError] = useState('');
  const latestItemsRef = useRef(items);

  useEffect(() => {
    latestItemsRef.current = items;
  }, [items]);

  function updateItems(updater: (current: ShoppingItem[]) => ShoppingItem[]) {
    const nextItems = updater(latestItemsRef.current);
    latestItemsRef.current = nextItems;
    onItemsChange(nextItems);
    return nextItems;
  }

  const toBuy = items.filter((i) => !i.pantry);
  const selectedToBuy = toBuy.filter((i) => i.enabled !== false);
  const pantryItems = items.filter((i) => i.pantry);

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABEL[cat] ?? cat,
    items: toBuy.filter((i) => i.category === cat),
  })).filter((g) => g.items.length > 0);

  async function searchPicnic(item: ShoppingItem) {
    if (!picnicToken) return;
    setPicnicError('');
    updateItems((current) => current.map((i) => (i.name === item.name ? { ...i, searching: true } : i)));
    const res = await fetch(`/api/picnic/search?q=${encodeURIComponent(item.display)}&category=${encodeURIComponent(item.category)}&preference=${encodeURIComponent(item.productPreference ?? '')}&force=1&llmCheck=1`, {
      headers: { 'x-picnic-auth': picnicToken },
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      setPicnicError(data.error ?? 'Zoeken bij Picnic mislukt.');
      updateItems((current) => current.map((i) => (i.name === item.name ? { ...i, searching: false, notFound: true } : i)));
      return;
    }
    const nextItems = updateItems((current) => current.map((i) => {
      if (i.name !== item.name) return i;
      const candidates = data.articles ?? [];
      const article: PicnicArticle | undefined = candidates[0];
      const existingSelection = i.picnicArticle && candidates.some((candidate: PicnicArticle) => candidate.id === i.picnicArticle?.id)
        ? i.picnicArticle
        : article;
      const packagePlan = existingSelection ? packagePlanFor(i, existingSelection) : {};
      return {
        ...i,
        searching: false,
        ...packagePlan,
        picnicCandidates: candidates,
        enabled: i.enabled !== false,
        notFound: !existingSelection,
      };
    }));
    return nextItems;
  }

  async function searchAllProducts() {
    if (!picnicToken) return;
    setAddingAll(true);
    setPicnicError('');
    for (const item of selectedToBuy) {
      await searchPicnic(item);
      await new Promise((r) => setTimeout(r, 250));
    }
    setAddingAll(false);
  }

  function setItemEnabled(item: ShoppingItem, enabled: boolean) {
    updateItems((current) => current.map((i) => i.name === item.name ? { ...i, enabled } : i));
  }

  function selectCandidate(item: ShoppingItem, articleId: string) {
    const article = item.picnicCandidates?.find((candidate) => candidate.id === articleId);
    if (!article) return;
    updateItems((current) => current.map((i) => i.name === item.name ? { ...i, ...packagePlanFor(i, article), enabled: true, notFound: false } : i));
  }

  async function addToCart(item: ShoppingItem) {
    if (!picnicToken || !item.picnicArticle) return;
    setPicnicError('');
    const res = await fetch('/api/picnic/cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-picnic-auth': picnicToken },
      body: JSON.stringify({ articleId: item.picnicArticle.id, count: item.picnicCount ?? 1 }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setPicnicError(data.error?.message ?? data.error ?? 'Toevoegen aan Picnic mislukt.');
      return;
    }
    setAddedIds((prev) => new Set([...prev, item.name]));
  }

  async function searchAndAddAll() {
    if (!picnicToken) return;
    setAddingAll(true);
    setPicnicError('');
    for (const item of selectedToBuy) {
      if (!item.picnicArticle) continue;
      await addToCart(item);
      await new Promise((r) => setTimeout(r, 250));
    }
    setAddingAll(false);
  }

  async function clearCart() {
    if (!picnicToken) return;
    setClearingCart(true);
    setPicnicError('');
    const res = await fetch('/api/picnic/cart', {
      method: 'DELETE',
      headers: { 'x-picnic-auth': picnicToken },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setPicnicError(data.error?.message ?? data.error ?? 'Picnic-mandje leegmaken mislukt.');
      setClearingCart(false);
      return;
    }
    setAddedIds(new Set());
    setClearingCart(false);
  }

  if (items.length === 0) return null;

  return (
    <div className="space-y-6">
      {/* Picnic action bar */}
      {picnicToken && (
        <div className="flex flex-col gap-4 rounded-2xl bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-blue-900">Verbonden met Picnic</p>
            <p className="text-sm text-blue-700">
              {addingAll ? 'Bezig...' : 'Zoek eerst Picnic-producten, pas keuzes aan, stuur daarna selectie naar je mandje.'}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={clearCart}
              disabled={clearingCart || addingAll}
              className="btn-secondary whitespace-nowrap"
            >
              {clearingCart ? 'Leegmaken...' : 'Mandje leegmaken'}
            </button>
            <button
              onClick={searchAllProducts}
              disabled={addingAll || clearingCart}
              className="btn-secondary whitespace-nowrap"
            >
              {addingAll ? 'Zoeken...' : 'Zoek producten'}
            </button>
            <button
              onClick={searchAndAddAll}
              disabled={addingAll || clearingCart || !selectedToBuy.some((item) => item.picnicArticle)}
              className="btn-primary bg-blue-600 hover:bg-blue-700 whitespace-nowrap"
            >
              Naar mandje
            </button>
          </div>
        </div>
      )}

      {picnicError && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">❌ {picnicError}</p>
      )}

      {/* Shopping items */}
      {grouped.map((group) => (
        <div key={group.category}>
          <h3 className="mb-3 font-semibold text-stone-700">{group.label}</h3>
          <div className="card divide-y divide-stone-50">
            {group.items.map((item) => (
              <div key={item.name} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-stone-800">
                    {item.totalAmount} {item.unit} {item.display}
                  </p>
                  {item.recipeIds.length > 1 && (
                    <p className="text-xs text-emerald-600">← gebruikt in {item.recipeIds.length} recepten</p>
                  )}
                  <label className="mt-2 flex items-center gap-2 text-xs text-stone-500">
                    <input
                      type="checkbox"
                      checked={item.enabled !== false}
                      onChange={(e) => setItemEnabled(item, e.target.checked)}
                      className="h-4 w-4 rounded accent-orange-500"
                    />
                    meenemen naar Picnic
                  </label>
                  {item.picnicCandidates && item.picnicCandidates.length > 0 && (
                    <select
                      value={item.picnicArticle?.id ?? ''}
                      onChange={(e) => selectCandidate(item, e.target.value)}
                      disabled={item.enabled === false}
                      className="mt-2 w-full rounded-lg border border-stone-200 px-3 py-1.5 text-xs text-stone-700 disabled:opacity-50"
                    >
                      {item.picnicCandidates.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name} - €{(candidate.price / 100).toFixed(2)}
                          {candidate.unitQuantity ? ` - ${candidate.unitQuantity}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  {item.picnicCoverage && (
                    <p className="mt-1 text-xs text-stone-400">
                      Aantal: {item.picnicCoverage}
                    </p>
                  )}
                  {item.picnicWarning && (
                    <p className="mt-1 text-xs text-amber-600">{item.picnicWarning}</p>
                  )}
                  {item.picnicArticle && !item.picnicCandidates?.length && (
                    <p className="text-xs text-stone-400 truncate">
                      ✓ Geselecteerd: {item.picnicArticle.name} — €{(item.picnicArticle.price / 100).toFixed(2)}
                      {item.picnicArticle.unitQuantity ? ` · ${item.picnicArticle.unitQuantity}` : ''}
                    </p>
                  )}
                  {item.notFound && (
                    <p className="text-xs text-red-400">Niet gevonden op Picnic</p>
                  )}
                </div>

                {picnicToken && (
                  <div className="flex shrink-0 gap-2">
                    {!item.picnicArticle && !item.notFound && (
                      <button
                        onClick={() => searchPicnic(item)}
                        disabled={item.searching}
                        className="rounded-full border border-stone-200 px-3 py-1 text-xs text-stone-600 hover:bg-stone-50 disabled:opacity-50"
                      >
                        {item.searching ? '🔍…' : '🔍 Zoek'}
                      </button>
                    )}
                    {item.picnicArticle && item.enabled !== false && !addedIds.has(item.name) && (
                      <button
                        onClick={() => addToCart(item)}
                        className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-200"
                      >
                        + Voeg {item.picnicCount && item.picnicCount > 1 ? `${item.picnicCount} toe` : 'toe'}
                      </button>
                    )}
                    {addedIds.has(item.name) && (
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                        ✓ Toegevoegd
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Pantry items (greyed out) */}
      {pantryItems.length > 0 && (
        <details className="text-sm text-stone-400">
          <summary className="cursor-pointer select-none font-medium">
            🏠 Heb je al in huis ({pantryItems.length} items)
          </summary>
          <ul className="mt-2 space-y-1 pl-4">
            {pantryItems.map((i) => (
              <li key={i.name}>
                {i.totalAmount} {i.unit} {i.display}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
