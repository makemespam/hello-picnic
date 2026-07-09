import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { RecipeCard } from '@/components/RecipeCard';
import { listRecipes } from '@/server/services/recipeService';
import { recipeQuerySchema } from '@/shared/recipes';
import { ReceptenFilterBar } from './_components/ReceptenFilterBar';

interface ReceptenPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Server Component: reads the library via the service directly (docs/ARCHITECTURE.md
// §1 "Services are unit-testable without HTTP"; same pattern as instellingen/page.tsx).
// Filters are URL search params (see ReceptenFilterBar) so this page re-renders
// server-side on every filter change — no client-side fetch duplicate of listRecipes().
export default async function ReceptenPage({ searchParams }: ReceptenPageProps) {
  const raw = await searchParams;
  const flat = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const parsed = recipeQuerySchema.safeParse(flat);
  const query = parsed.success ? parsed.data : recipeQuerySchema.parse({});

  const recipes = await listRecipes(query);
  const hasActiveFilter = Boolean(query.type || query.text || query.minRating !== undefined || query.favorite !== undefined);

  return (
    <div>
      <PageHeader
        title="Recepten"
        description="Jullie bibliotheek — foto's van HelloFresh-kaarten en zelfgemaakte recepten."
        action={
          <Link
            href="/recepten/nieuw"
            className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover"
          >
            + Nieuw recept
          </Link>
        }
      />

      <ReceptenFilterBar initialType={query.type} initialText={query.text} initialSort={query.sort} initialFavorite={query.favorite} />

      {recipes.length === 0 ? (
        hasActiveFilter ? (
          <EmptyState
            illustration="🔍"
            title="Geen recepten gevonden"
            description="Probeer een andere zoekterm of een ander filter."
          />
        ) : (
          <EmptyState
            illustration="📖"
            title="Nog geen recepten"
            description="Voeg je eerste recept handmatig toe. Kaarten scannen komt in een latere update."
            action={{ label: 'Voeg recept toe', href: '/recepten/nieuw' }}
          />
        )
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {recipes.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} href={`/recepten/${recipe.id}`} />
          ))}
        </div>
      )}
    </div>
  );
}
