import { cn } from './cn';

export interface CostBadgeProps {
  /** Amount in eurocents (matches llm_calls.cost_cents / basket totals). */
  cents: number;
  className?: string;
}

/** Dutch-formatted € chip (docs/DESIGN_PRINCIPLES.md §6: "€ 61,40"). */
export function CostBadge({ cents, className }: CostBadgeProps) {
  const formatted = (cents / 100).toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' });
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-ink/10 bg-ink/5 px-2.5 py-1 text-xs font-semibold text-ink',
        className
      )}
    >
      {formatted}
    </span>
  );
}
