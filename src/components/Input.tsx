import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from './cn';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-11 w-full rounded-md border border-ink/15 bg-surface px-3 text-sm text-ink placeholder:text-ink-muted/70 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
});
