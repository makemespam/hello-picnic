import { cn } from './cn';

export interface RadioCardProps {
  name: string;
  value: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  className?: string;
}

/** Card-styled radio option (used for picking servings/dagen/wensen-style choices). */
export function RadioCard({ name, value, label, description, checked, onChange, disabled, className }: RadioCardProps) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors',
        checked ? 'border-primary bg-primary-soft' : 'border-ink/15 bg-surface hover:border-ink/30',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-1 h-4 w-4 shrink-0 accent-primary"
      />
      <span>
        <span className="block text-sm font-semibold text-ink">{label}</span>
        {description && <span className="block text-xs text-ink-muted">{description}</span>}
      </span>
    </label>
  );
}
