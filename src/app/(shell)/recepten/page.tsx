import { countMissingPhotos, listRecipes } from '@/server/services/recipeService';
import { recipeQuerySchema } from '@/shared/recipes';
import { ReceptenLibraryView } from './_components/ReceptenLibraryView';

interface ReceptenPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Server Component: reads the library via the service directly (docs/ARCHITECTURE.md
// §1 "Services are unit-testable without HTTP"; same pattern as instellingen/page.tsx).
// Filters are URL search params (see ReceptenFilterBar) so this page re-renders
// server-side on every filter change; ReceptenLibraryView (client) then takes over for
// the shimmer-poll + backfill action (docs/workpackages/WP-07-photo-pipeline.md §8) —
// no client-side fetch duplicate of listRecipes() on first paint, just on later polls.
export default async function ReceptenPage({ searchParams }: ReceptenPageProps) {
  const raw = await searchParams;
  const flat = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const parsed = recipeQuerySchema.safeParse(flat);
  const query = parsed.success ? parsed.data : recipeQuerySchema.parse({});

  const [recipes, missingPhotoCount] = await Promise.all([listRecipes(query), countMissingPhotos()]);
  const hasActiveFilter = Boolean(query.type || query.text || query.minRating !== undefined || query.favorite !== undefined);

  const queryString = new URLSearchParams(
    Object.entries({ type: query.type, text: query.text, favorite: query.favorite?.toString(), sort: query.sort }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  ).toString();

  return (
    <ReceptenLibraryView
      initialRecipes={recipes}
      queryString={queryString}
      hasActiveFilter={hasActiveFilter}
      initialMissingPhotoCount={missingPhotoCount}
      filterBarProps={{ initialType: query.type, initialText: query.text, initialSort: query.sort, initialFavorite: query.favorite }}
    />
  );
}
