'use client';

import { useRef } from 'react';
import { cn } from './cn';

export interface StarsProps {
  value: number;
  max?: number;
  size?: 'sm' | 'md';
  className?: string;
  /** Omit for a read-only display (recipe cards). Pass to make it an editable radiogroup. */
  onChange?: (value: number) => void;
  /** Accessible name for the editable radiogroup. */
  label?: string;
}

const SIZE_CLASS: Record<NonNullable<StarsProps['size']>, string> = {
  sm: 'text-base',
  md: 'text-2xl',
};

/**
 * Star rating. Read-only mode renders a single `role="img"` glyph (for dense lists like
 * RecipeCard). Editable mode renders an accessible `radiogroup` with roving tabindex and
 * arrow-key support, per docs/DESIGN_PRINCIPLES.md §7.
 */
export function Stars({ value, max = 5, size = 'sm', className, onChange, label = 'Beoordeling' }: StarsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const starClass = SIZE_CLASS[size];

  if (!onChange) {
    return (
      <span
        role="img"
        aria-label={`${value.toLocaleString('nl-NL')} van ${max} sterren`}
        className={cn('inline-flex items-center gap-0.5', className)}
      >
        {Array.from({ length: max }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={cn(starClass, i < Math.round(value) ? 'text-accent' : 'text-ink-muted/25')}
          >
            ★
          </span>
        ))}
      </span>
    );
  }

  const items = Array.from({ length: max }, (_, i) => i + 1);
  const focusableValue = value > 0 ? value : 1;

  const move = (next: number) => {
    const clamped = Math.min(max, Math.max(1, next));
    onChange(clamped);
    refs.current[clamped - 1]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex items-center gap-1', className)}>
      {items.map((n) => (
        <button
          key={n}
          ref={(el) => {
            refs.current[n - 1] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} van ${max} sterren`}
          tabIndex={n === focusableValue ? 0 : -1}
          className={cn('rounded-sm p-0.5', starClass, n <= value ? 'text-accent' : 'text-ink-muted/25')}
          onClick={() => onChange(n)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
              e.preventDefault();
              move(value + 1);
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
              e.preventDefault();
              move(value - 1);
            }
          }}
        >
          <span aria-hidden="true">★</span>
        </button>
      ))}
    </div>
  );
}
