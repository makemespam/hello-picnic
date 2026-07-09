'use client';

// Candidate switcher (docs/DESIGN_PRINCIPLES.md §5 "candidate switcher in a Sheet
// (top-5 with prices)"). Picking one calls back to BoodschappenView, which PATCHes
// /api/shopping/items/:id — the optimizer re-runs server-side and the item's
// coverage/price update from the response ("recalculates instantly").
import { Sheet } from '@/components/Sheet';
import type { ShoppingItemDto } from '@/shared/shopping';
import { formatEuro } from './formatEuro';

export interface CandidateSheetProps {
  item: ShoppingItemDto | null;
  busy: boolean;
  onClose: () => void;
  onSelect: (articleId: string) => void;
}

export function CandidateSheet({ item, busy, onClose, onSelect }: CandidateSheetProps) {
  return (
    <Sheet open={item !== null} onClose={onClose} title={item ? `Alternatieven voor ${item.display}` : 'Alternatieven'}>
      {item && (
        <ul className="flex flex-col divide-y divide-ink/10">
          {item.candidates.map((candidate) => {
            const chosen = candidate.id === item.article?.id;
            return (
              <li key={candidate.id} aria-label={candidate.name} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{candidate.name}</p>
                  {candidate.unitQuantity && <p className="text-xs text-ink-muted">{candidate.unitQuantity}</p>}
                  {/* text-warning (not text-accent, which fails AA contrast on white at this size — see ShoppingItemRow.tsx's promo chip comment). */}
                  {candidate.promoLabel && <p className="text-xs font-semibold text-warning">{candidate.promoLabel}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-semibold text-ink">{formatEuro(candidate.priceCents)}</span>
                  {chosen ? (
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">Gekozen</span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onSelect(candidate.id)}
                      className="rounded-full border border-ink/15 px-3 py-1 text-xs font-semibold text-ink hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Kies
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
