import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from './cn';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 3, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(
          'w-full rounded-md border border-ink/15 bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted/70 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      />
    );
  }
);
