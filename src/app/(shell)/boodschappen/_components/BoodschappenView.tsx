'use client';

// Boodschappen screen (docs/DESIGN_PRINCIPLES.md §5): grouped list with Dutch category
// headers, candidate switcher Sheet, sticky basket-total footer with per-item send
// progress, "Mandje leegmaken" with confirm. Orchestrates the resolve/send/toggle/switch
// round trips against /api/shopping/* — shoppingService itself is server-only.
//
// Provider-aware (docs/workpackages/WP-11-bring-v2.md §3): with `list.provider ===
// 'bring'` the resolve button, prices, candidates, promo chips, basket total and
// "Mandje leegmaken" all disappear — the footer becomes a plain "Naar Bring (N items)"
// and items send as name+quantity strings with the same per-item status pattern.
import { useMemo, useState } from 'react';
import { Alert } from '@/components/Alert';
import { BringReloginBanner } from '@/components/BringReloginBanner';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { PicnicReloginBanner } from '@/components/PicnicReloginBanner';
import { ProgressList, type ProgressItemData } from '@/components/ProgressList';
import { INGREDIENT_CATEGORIES, INGREDIENT_CATEGORY_LABEL } from '@/shared/labels';
import type { ShoppingItemDto, ShoppingListDto, ShoppingResolveResultDto, ShoppingSendResultDto } from '@/shared/shopping';
import { CandidateSheet } from './CandidateSheet';
import { formatEuro } from './formatEuro';
import { ShoppingItemRow } from './ShoppingItemRow';

export interface BoodschappenViewProps {
  planId: number;
  initialList: ShoppingListDto | null;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T }> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, body };
}

function groupByCategory(items: ShoppingItemDto[]): Array<{ category: string; label: string; items: ShoppingItemDto[] }> {
  return INGREDIENT_CATEGORIES.map((category) => ({
    category,
    label: INGREDIENT_CATEGORY_LABEL[category],
    items: items.filter((item) => !item.pantry && item.category === category),
  })).filter((group) => group.items.length > 0);
}

export function BoodschappenView({ planId, initialList }: BoodschappenViewProps) {
  const [list, setList] = useState(initialList);
  const [resolving, setResolving] = useState(false);
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authExpired, setAuthExpired] = useState(false);
  const [busyItemId, setBusyItemId] = useState<number | null>(null);
  const [sheetItemId, setSheetItemId] = useState<number | null>(null);
  const [sendProgress, setSendProgress] = useState<ProgressItemData[] | null>(null);

  const items = list?.items ?? [];
  const provider = list?.provider ?? 'picnic';
  const providerLabel = provider === 'bring' ? 'Bring' : 'Picnic';
  const groups = useMemo(() => groupByCategory(list?.items ?? []), [list]);
  const pantryItems = items.filter((item) => item.pantry);
  const unresolvedCount = items.filter((item) => !item.pantry && item.enabled && item.article === null).length;
  const sheetItem = items.find((item) => item.id === sheetItemId) ?? null;

  async function refresh() {
    const { ok, body } = await fetchJson<ShoppingListDto>(`/api/shopping/${planId}`);
    if (ok) setList(body);
  }

  async function handleResolve() {
    setResolving(true);
    setError(null);
    setAuthExpired(false);
    try {
      const { ok, status, body } = await fetchJson<ShoppingResolveResultDto & { message?: string }>(`/api/shopping/${planId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!ok) {
        if (status === 401) setAuthExpired(true);
        else setError(body.message ?? 'Producten koppelen is niet gelukt.');
        return;
      }
      setList(body.list);
    } finally {
      setResolving(false);
    }
  }

  async function handleSend() {
    setSending(true);
    setError(null);
    setAuthExpired(false);
    // Honest async (docs/DESIGN_PRINCIPLES.md §1.5): show every eligible item as "Bezig"
    // immediately, then flip each to its real result once the batch response returns.
    // Bring needs no resolved article — every enabled, non-pantry item is eligible.
    setSendProgress(
      items
        .filter((item) => item.enabled && !item.pantry && item.status !== 'added' && (provider === 'bring' || item.article !== null))
        .map((item) => ({
          id: String(item.id),
          label: provider === 'bring' ? item.display : (item.article?.name ?? item.display),
          status: 'active',
        }))
    );
    try {
      const { ok, status, body } = await fetchJson<ShoppingSendResultDto & { message?: string }>(`/api/shopping/${planId}/send`, { method: 'POST' });
      if (!ok) {
        if (status === 401) setAuthExpired(true);
        else setError(body.message ?? `Versturen naar ${providerLabel} is niet gelukt.`);
        setSendProgress(null);
        return;
      }
      setList(body.list);
      setSendProgress(
        body.results.map((result) => {
          const item = body.list.items.find((i) => i.id === result.id);
          const picnicLabel = item?.article?.name ?? item?.display ?? `Item ${result.id}`;
          return {
            id: String(result.id),
            label: provider === 'bring' ? (item?.display ?? `Item ${result.id}`) : picnicLabel,
            status: result.status === 'added' ? 'done' : 'error',
            detail: result.status === 'added' ? 'Toegevoegd' : (result.error ?? 'Mislukt'),
          };
        })
      );
    } finally {
      setSending(false);
    }
  }

  async function handleClearCart() {
    if (!window.confirm('Weet je zeker dat je het Picnic-mandje wilt leegmaken?')) return;
    setClearing(true);
    setError(null);
    setAuthExpired(false);
    try {
      const { ok, status, body } = await fetchJson<ShoppingListDto & { message?: string }>(`/api/shopping/${planId}/send`, { method: 'DELETE' });
      if (!ok) {
        if (status === 401) setAuthExpired(true);
        else setError(body.message ?? 'Mandje leegmaken is niet gelukt.');
        return;
      }
      setList(body);
      setSendProgress(null);
    } finally {
      setClearing(false);
    }
  }

  async function handleToggle(item: ShoppingItemDto, enabled: boolean) {
    // Optimistic update: the checkbox is a controlled input, so without this it would
    // render (still-checked, disabled) for one tick after the click — until the PATCH
    // response arrives — which reads as "the click did nothing" (and confuses the
    // browser's own :indeterminate-free native toggling).
    setList((current) => (current ? { ...current, items: current.items.map((i) => (i.id === item.id ? { ...i, enabled } : i)) } : current));
    setBusyItemId(item.id);
    try {
      const { ok, body } = await fetchJson<ShoppingItemDto>(`/api/shopping/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (ok) setList((current) => (current ? { ...current, items: current.items.map((i) => (i.id === item.id ? body : i)) } : current));
      await refresh(); // totals depend on the whole list, cheapest correct refresh
    } finally {
      setBusyItemId(null);
    }
  }

  async function handleSwitchCandidate(articleId: string) {
    if (!sheetItem) return;
    setBusyItemId(sheetItem.id);
    try {
      const { ok, body } = await fetchJson<ShoppingItemDto>(`/api/shopping/items/${sheetItem.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId }),
      });
      if (ok) {
        setList((current) => (current ? { ...current, items: current.items.map((i) => (i.id === sheetItem.id ? body : i)) } : current));
        await refresh();
      }
      setSheetItemId(null);
    } finally {
      setBusyItemId(null);
    }
  }

  if (!list || items.length === 0) {
    return (
      <EmptyState
        illustration="🛒"
        title="Nog geen boodschappenlijst"
        description="Rond een weekmenu af en je boodschappenlijst verschijnt hier automatisch."
        action={{ label: 'Naar weekplan', href: '/plan' }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-28">
      <PageHeader
        title="Boodschappen"
        description={`Jullie weekmenu, klaar om naar ${providerLabel} te sturen.`}
        action={
          // Bring skips the resolve pipeline entirely (docs/workpackages/WP-11 §3).
          provider === 'picnic' ? (
            <button
              type="button"
              onClick={handleResolve}
              disabled={resolving}
              className="inline-flex h-11 items-center justify-center rounded-full border border-ink/15 px-5 text-sm font-semibold text-ink hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {resolving ? 'Producten koppelen…' : unresolvedCount > 0 ? `Producten koppelen (${unresolvedCount})` : 'Opnieuw koppelen'}
            </button>
          ) : undefined
        }
      />

      {authExpired && (provider === 'bring' ? <BringReloginBanner /> : <PicnicReloginBanner />)}
      {error && <Alert variant="danger">{error}</Alert>}

      <div className="flex flex-col gap-6">
        {groups.map((group) => (
          <div key={group.category}>
            <h3 className="mb-2 text-sm font-semibold text-ink-muted">{group.label}</h3>
            <div className="divide-y divide-ink/10 rounded-lg border border-ink/10 bg-surface shadow-sm">
              {group.items.map((item) => (
                <ShoppingItemRow
                  key={item.id}
                  item={item}
                  provider={provider}
                  busy={busyItemId === item.id}
                  onToggle={(enabled) => handleToggle(item, enabled)}
                  onOpenCandidates={() => setSheetItemId(item.id)}
                />
              ))}
            </div>
          </div>
        ))}

        {pantryItems.length > 0 && (
          <details className="text-sm text-ink-muted">
            <summary className="cursor-pointer select-none font-medium">Al in huis ({pantryItems.length} items)</summary>
            <ul className="mt-2 space-y-1 pl-4">
              {pantryItems.map((item) => (
                <li key={item.id}>
                  {item.totalAmount} {item.unit} {item.display}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {sendProgress && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink-muted">Versturen naar {providerLabel}</h3>
          <ProgressList items={sendProgress} />
        </div>
      )}

      <div className="sticky bottom-[calc(56px+env(safe-area-inset-bottom))] flex flex-col gap-2 rounded-lg border border-ink/10 bg-surface p-4 shadow-xl md:static md:bottom-auto">
        {provider === 'picnic' && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-muted">Totaal ({list.itemCount} items)</span>
            <span className="text-base font-bold text-ink">{formatEuro(list.totalPriceCents)}</span>
          </div>
        )}
        <div className="flex gap-2">
          {provider === 'picnic' && (
            <button
              type="button"
              onClick={handleClearCart}
              disabled={clearing || sending}
              className="inline-flex h-11 flex-1 items-center justify-center rounded-full border border-ink/15 px-4 text-sm font-semibold text-ink hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {clearing ? 'Bezig…' : 'Mandje leegmaken'}
            </button>
          )}
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || list.itemCount === 0}
            className="inline-flex h-11 flex-[2] items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending
              ? 'Bezig met versturen…'
              : provider === 'bring'
                ? `Naar Bring (${list.itemCount} items)`
                : `Naar Picnic (${list.itemCount} items · ${formatEuro(list.totalPriceCents)})`}
          </button>
        </div>
      </div>

      {provider === 'picnic' && (
        <CandidateSheet item={sheetItem} busy={busyItemId === sheetItem?.id} onClose={() => setSheetItemId(null)} onSelect={handleSwitchCandidate} />
      )}
    </div>
  );
}
