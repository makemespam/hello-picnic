'use client';

// One "Uit jullie keuken" card (docs/DESIGN_PRINCIPLES.md §5: "photo, teaser, one-tap
// zet in weekplan"). Photo/title link to the recipe detail; the CTA button is a
// separate action so tapping it never also navigates away mid-request.
import Link from 'next/link';
import { PhotoFrame } from '@/components/PhotoFrame';
import { RecipeTypeBadge } from '@/components/RecipeTypeBadge';
import { TYPE_LABEL } from '@/shared/labels';
import type { SuggestionListItemDto } from '@/shared/dto';

export interface SuggestionCardProps {
  item: SuggestionListItemDto;
  busy: boolean;
  onAdd: () => void;
}

/** docs/workpackages/WP-13-proactive-suggestions.md §4: "teaser line or type+time fallback". */
function teaserOrFallback(item: SuggestionListItemDto): string {
  if (item.teaser) return item.teaser;
  return `${TYPE_LABEL[item.recipe.type]} · ${item.recipe.timeMin} min`;
}

export function SuggestionCard({ item, busy, onAdd }: SuggestionCardProps) {
  const { recipe } = item;
  return (
    <div
      data-testid="suggestion-card"
      data-recipe-title={recipe.title}
      className="flex h-full flex-col overflow-hidden rounded-lg border border-ink/10 bg-surface shadow-sm transition-shadow hover:shadow-md"
    >
      <Link href={`/recepten/${recipe.id}`} className="block">
        <PhotoFrame src={recipe.photoUrl} alt={recipe.title} aspect="4:3" blurDataUrl={recipe.blurDataUrl} />
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <RecipeTypeBadge type={recipe.type} />
        <Link href={`/recepten/${recipe.id}`} className="line-clamp-2 text-base font-bold text-ink hover:underline">
          {recipe.title}
        </Link>
        <p className="line-clamp-2 flex-1 text-sm text-ink-muted">{teaserOrFallback(item)}</p>
        <button
          type="button"
          disabled={busy}
          onClick={onAdd}
          className="mt-1 inline-flex h-10 items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Bezig…' : '→ Zet in weekplan'}
        </button>
      </div>
    </div>
  );
}
