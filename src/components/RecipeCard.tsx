import Link from 'next/link';
import type { Recipe } from '@/lib/types';

const GRADIENTS: Record<string, string> = {
  vega: 'from-emerald-50 to-green-100',
  vis: 'from-blue-50 to-cyan-100',
};

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: 'Makkelijk',
  medium: 'Gemiddeld',
  hard: 'Uitdagend',
};

interface Props {
  recipe: Recipe;
  day?: number;
  onApprove?: (recipe: Recipe) => void;
  onReplace?: (recipe: Recipe) => void;
  replacing?: boolean;
}

export default function RecipeCard({ recipe, day, onApprove, onReplace, replacing }: Props) {
  return (
    <div className="card overflow-hidden flex flex-col">
      {/* Hero */}
      <div className={`bg-gradient-to-br ${GRADIENTS[recipe.type]} flex items-center justify-center py-10 text-6xl`}>
        {recipe.emoji}
      </div>

      <div className="flex flex-col gap-2 p-4 flex-1">
        {/* Day + type */}
        <div className="flex items-center gap-2">
          {day !== undefined && (
            <span className="text-xs font-semibold uppercase tracking-wide text-stone-400">
              Dag {day}
            </span>
          )}
          {recipe.libraryNumber && (
            <span className="text-xs font-semibold uppercase text-stone-400">
              #{recipe.libraryNumber}
            </span>
          )}
          {recipe.type === 'vega' ? (
            <span className="badge-vega">🌿 Vega</span>
          ) : (
            <span className="badge-vis">🐟 Vis</span>
          )}
          {recipe.usedPromotion && (
            <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-800">
              🏷️ Aanbieding
            </span>
          )}
          {recipe.status === 'approved' && (
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
              Goedgekeurd
            </span>
          )}
        </div>

        <h3 className="font-bold text-stone-900 leading-snug">{recipe.title}</h3>
        <p className="text-sm text-stone-500 line-clamp-2 flex-1">{recipe.description}</p>

        {/* Meta */}
        <div className="flex items-center gap-3 text-xs text-stone-500 mt-1">
          <span>⏱ {recipe.time} min</span>
          <span className="badge-easy">{DIFFICULTY_LABEL[recipe.difficulty]}</span>
        </div>

        <Link
          href={`/recept/${recipe.id}`}
          className="mt-2 rounded-full border border-stone-200 py-1.5 text-center text-sm font-medium text-stone-700 transition hover:bg-stone-50"
        >
          Bekijk recept →
        </Link>

        {(onApprove || onReplace) && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {onApprove && (
              <button
                onClick={() => onApprove(recipe)}
                disabled={recipe.status === 'approved'}
                className="rounded-full bg-emerald-100 px-3 py-1.5 text-sm font-semibold text-emerald-700 disabled:opacity-50"
              >
                Akkoord
              </button>
            )}
            {onReplace && (
              <button
                onClick={() => onReplace(recipe)}
                disabled={replacing}
                className="rounded-full bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-700 disabled:opacity-50"
              >
                {replacing ? 'Vervangen...' : 'Alternatief'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
