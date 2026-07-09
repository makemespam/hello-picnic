import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from './cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className, id, ...props },
  ref
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <label htmlFor={inputId} className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink">
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        className={cn(
          'h-5 w-5 shrink-0 rounded-sm border-ink/30 text-primary accent-primary disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      />
      {label}
    </label>
  );
});
