'use client';

// One boodschappenlijst row (docs/DESIGN_PRINCIPLES.md §5): thumbnail (placeholder —
// no verified Picnic image CDN URL exists yet, flagged in the PR), chosen product name,
// pack coverage ("2 × 500 g"), price, promo chip, overshoot warning icon, cross-recipe
// breakdown line, enable checkbox, "Alternatieven" opens the candidate Sheet.
//
// With provider 'bring' (docs/workpackages/WP-11-bring-v2.md §3) the row simplifies to
// name + quantity + breakdown + checkbox: no prices, no candidates, no promo chips, no
// optimizer coverage/warnings — none of that exists on the Bring path.
import { Checkbox } from '@/components/Checkbox';
import type { ShoppingProvider } from '@/shared/settings';
import type { ShoppingItemDto } from '@/shared/shopping';
import { formatEuro } from './formatEuro';

export interface ShoppingItemRowProps {
  item: ShoppingItemDto;
  provider: ShoppingProvider;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onOpenCandidates: () => void;
}

const PROVIDER_LABEL: Record<ShoppingProvider, string> = { picnic: 'Picnic', bring: 'Bring' };

export function ShoppingItemRow({ item, provider, busy, onToggle, onOpenCandidates }: ShoppingItemRowProps) {
  const picnic = provider === 'picnic';
  const hasPromo = picnic && (item.freePackCount > 0 || (item.article?.promoLabel && item.article.priceCents > 0));

  return (
    <div role="group" aria-label={item.display} className="flex items-start gap-3 px-4 py-3">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-primary-soft text-xl" aria-hidden="true">
        🛒
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{picnic ? (item.article?.name ?? item.display) : item.display}</p>
            <p className="text-xs text-ink-muted">
              {item.totalAmount} {item.unit} {item.display}
            </p>
          </div>
          {picnic && item.priceCents !== null && <span className="shrink-0 text-sm font-semibold text-ink">{formatEuro(item.priceCents)}</span>}
        </div>

        {picnic && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
            {item.coverageLabel && <span>{item.coverageLabel}</span>}
            {hasPromo && item.article?.promoLabel && (
              // Solid accent background + text-ink (not text-accent, which fails AA contrast
              // at this size against any accent-tinted background — same fix Alert.tsx
              // documents: accent as a fill/border, never as small text on a light tint).
              <span className="inline-flex items-center rounded-full bg-accent px-2 py-0.5 font-semibold text-ink">{item.article.promoLabel}</span>
            )}
            {item.warning && (
              <span className="inline-flex items-center gap-1 text-warning">
                <span aria-hidden="true">⚠️</span>
                {item.warning}
              </span>
            )}
          </div>
        )}

        {item.breakdown && <p className="mt-1 text-xs text-ink-muted">{item.breakdown}</p>}

        <div className="mt-2 flex items-center justify-between gap-2">
          <Checkbox
            label={`Meenemen naar ${PROVIDER_LABEL[provider]}`}
            checked={item.enabled}
            disabled={busy}
            onChange={(e) => onToggle(e.target.checked)}
          />
          {picnic && item.candidates.length > 1 && (
            <button type="button" onClick={onOpenCandidates} className="text-xs font-semibold text-primary underline underline-offset-2">
              Alternatieven
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
