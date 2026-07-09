import { cn } from './cn';

export interface StepperListProps {
  steps: string[];
  activeIndex?: number;
  className?: string;
}

/** Numbered cooking-step list (cook mode). */
export function StepperList({ steps, activeIndex, className }: StepperListProps) {
  return (
    <ol className={cn('flex flex-col gap-4', className)}>
      {steps.map((step, i) => {
        const active = activeIndex === i;
        return (
          <li key={i} className="flex gap-3">
            <span
              aria-hidden="true"
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                active ? 'bg-primary text-white' : 'bg-primary-soft text-primary'
              )}
            >
              {i + 1}
            </span>
            <p className={cn('pt-1 text-base leading-relaxed', active ? 'font-medium text-ink' : 'text-ink-muted')}>
              {step}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
