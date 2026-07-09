// Cost summary on the finalized plan view (docs/workpackages/WP-10-basket-optimizer.md
// §6: "€ total + €/portie vs TARGET_COST_PER_SERVING delta"). Pure presentational —
// the plan page computes the numbers server-side from shoppingService's totals.
import { CostBadge } from '@/components/CostBadge';

export interface CostSummary {
  totalCents: number;
  perServingCents: number;
  targetPerServingCents: number;
}

function formatEuro(cents: number): string {
  return (cents / 100).toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' });
}

export function CostSummaryPanel({ summary }: { summary: CostSummary }) {
  const deltaCents = summary.perServingCents - summary.targetPerServingCents;
  const withinTarget = deltaCents <= 0;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-ink/10 bg-surface p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-ink">Kosten van dit weekmenu</p>
        <p className="text-xs text-ink-muted">
          {formatEuro(summary.perServingCents)} per portie · streefwaarde {formatEuro(summary.targetPerServingCents)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <CostBadge cents={summary.totalCents} />
        <span className={withinTarget ? 'text-xs font-semibold text-success' : 'text-xs font-semibold text-warning'}>
          {withinTarget ? `€ ${(Math.abs(deltaCents) / 100).toFixed(2)} onder streefwaarde` : `€ ${(deltaCents / 100).toFixed(2)} boven streefwaarde`}
        </span>
      </div>
    </div>
  );
}
