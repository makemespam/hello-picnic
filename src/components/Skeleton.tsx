import { cn } from './cn';

/** Base skeleton block. Every operation > 300ms gets one of these (docs/DESIGN_PRINCIPLES.md §1.5). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-ink/10', className)} />;
}

/** Mirrors RecipeCard's shape — used in recepten/weekplan grid loading states. */
export function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-lg border border-ink/10 bg-surface shadow-sm">
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-4 w-3/4" />
        <div className="flex items-center justify-between pt-1">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
    </div>
  );
}

/** Rows of icon + two lines — used for shopping/settings-style lists. */
export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col divide-y divide-ink/10 rounded-lg border border-ink/10 bg-surface">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Hero photo + title + meta chips + body lines — used for recipe/plan detail loading. */
export function SkeletonDetail() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="aspect-video w-full" />
      <Skeleton className="h-7 w-2/3" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}
