import { TYPE_BADGE_CLASSES, TYPE_LABEL, type RecipeType } from '@/shared/labels';
import { cn } from './cn';

export interface RecipeTypeBadgeProps {
  type: RecipeType;
  className?: string;
}

/** Recipe-type pill. Palette defined once in src/shared/labels.ts (badge tokens). */
export function RecipeTypeBadge({ type, className }: RecipeTypeBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-semibold',
        TYPE_BADGE_CLASSES[type],
        className
      )}
    >
      {TYPE_LABEL[type]}
    </span>
  );
}
