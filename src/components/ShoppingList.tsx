'use client';

import { useState } from 'react';
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

interface Props {
  items: ShoppingItem[];
  picnicToken: string | null;
  onItemsChange: (items: ShoppingItem[]) => void;
}

export default function ShoppingList({ items, picnicToken, onItemsChange }: Props) {
  const [addingAll, setAddingAll] = useState(false);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [picnicError, setPicnicError] = useState('');

  const toBuy = items.filter((i) => !i.pantry);
  const pantryItems = items.filter((i) => i.pantry);

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABEL[cat] ?? cat,
    items: toBuy.filter((i) => i.category === cat),
  })).filter((g) => g.items.length > 0);

  async function searchPicnic(item: ShoppingItem) {
    if (!picnicToken) return;
    setPicnicError('');
    onItemsChange(
      items.map((i) => (i.name === item.name ? { ...i, searching: true } : i))
    );
    const res = await fetch(`/api/picnic/search?q=${encodeURIComponent(item.display)}&category=${encodeURIComponent(item.category)}&force=1`, {
      headers: { 'x-picnic-auth': picnicToken },
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      setPicnicError(data.error ?? 'Zoeken bij Picnic mislukt.');
      onItemsChange(items.map((i) => (i.name === item.name ? { ...i, searching: false, notFound: true } : i)));
      return;
    }
    const article: PicnicArticle | undefined = data.articles?.[0];
    onItemsChange(
      items.map((i) =>
        i.name === item.name
          ? { ...i, searching: false, picnicArticle: article, notFound: !article }
          : i
      )
    );
  }

  async function addToCart(item: ShoppingItem) {
    if (!picnicToken || !item.picnicArticle) return;
    setPicnicError('');
    const res = await fetch('/api/picnic/cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-picnic-auth': picnicToken },
      body: JSON.stringify({ articleId: item.picnicArticle.id, count: 1 }),
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
    for (const item of toBuy) {
      if (!item.picnicArticle) {
        // search first
        const res = await fetch(`/api/picnic/search?q=${encodeURIComponent(item.display)}&category=${encodeURIComponent(item.category)}&force=1`, {
          headers: { 'x-picnic-auth': picnicToken },
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          setPicnicError(data.error ?? 'Zoeken bij Picnic mislukt.');
          break;
        }
        const article: PicnicArticle | undefined = data.articles?.[0];
        if (article) {
          const addRes = await fetch('/api/picnic/cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-picnic-auth': picnicToken },
            body: JSON.stringify({ articleId: article.id, count: 1 }),
          });
          if (!addRes.ok) {
            const addData = await addRes.json().catch(() => ({}));
            setPicnicError(addData.error?.message ?? addData.error ?? 'Toevoegen aan Picnic mislukt.');
            break;
          }
          setAddedIds((prev) => new Set([...prev, item.name]));
          onItemsChange(items.map((i) => (i.name === item.name ? { ...i, picnicArticle: article } : i)));
        }
        await new Promise((r) => setTimeout(r, 300)); // gentle rate limiting
      } else {
        await addToCart(item);
      }
    }
    setAddingAll(false);
  }

  if (items.length === 0) return null;

  return (
    <div className="space-y-6">
      {/* Picnic action bar */}
      {picnicToken && (
        <div className="flex items-center justify-between rounded-2xl bg-blue-50 p-4">
          <div>
            <p className="font-semibold text-blue-900">Verbonden met Picnic</p>
            <p className="text-sm text-blue-700">
              {addingAll ? 'Bezig met toevoegen...' : 'Voeg alle boodschappen in één klik toe aan je Picnic-mandje.'}
            </p>
          </div>
          <button
            onClick={searchAndAddAll}
            disabled={addingAll}
            className="btn-primary bg-blue-600 hover:bg-blue-700 whitespace-nowrap"
          >
            {addingAll ? '⏳ Bezig...' : '🛒 Alles naar Picnic'}
          </button>
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
                  {item.picnicArticle && (
                    <p className="text-xs text-stone-400 truncate">
                      ✓ Goedkoopste: {item.picnicArticle.name} — €{(item.picnicArticle.price / 100).toFixed(2)}
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
                    {item.picnicArticle && !addedIds.has(item.name) && (
                      <button
                        onClick={() => addToCart(item)}
                        className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-200"
                      >
                        + Voeg toe
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
