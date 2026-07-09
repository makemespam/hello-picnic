import Link from 'next/link';
import type { RecipeType } from '@/shared/labels';
import { PhotoFrame } from './PhotoFrame';
import { RecipeTypeBadge } from './RecipeTypeBadge';
import { Stars } from './Stars';

export interface RecipeCardData {
  id: string | number;
  title: string;
  photoUrl?: string | null;
  blurDataUrl?: string | null;
  type: RecipeType;
  timeMin: number;
  rating: number;
}

export interface RecipeCardProps {
  recipe: RecipeCardData;
  /** Link target — omit to render a non-interactive card. */
  href?: string;
  className?: string;
}

/** Photo-first recipe card: photo top (4:3), title, type badge, time, rating stars. */
export function RecipeCard({ recipe, href, className }: RecipeCardProps) {
  const body = (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-ink/10 bg-surface shadow-sm transition-shadow hover:shadow-md">
      <PhotoFrame src={recipe.photoUrl} alt={recipe.title} aspect="4:3" blurDataUrl={recipe.blurDataUrl} />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <RecipeTypeBadge type={recipe.type} />
        <h3 className="line-clamp-2 text-base font-bold text-ink">{recipe.title}</h3>
        <div className="mt-auto flex items-center justify-between pt-1">
          <span className="text-xs text-ink-muted">{recipe.timeMin} min</span>
          <Stars value={recipe.rating} size="sm" />
        </div>
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className={`block rounded-lg ${className ?? ''}`}>
        {body}
      </Link>
    );
  }

  return <div className={className}>{body}</div>;
}
