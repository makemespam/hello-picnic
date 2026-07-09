import { notFound } from 'next/navigation';
import { getRecipe } from '@/server/services/recipeService';
import { ReceptDetailView } from './_components/ReceptDetailView';

interface ReceptDetailPageProps {
  params: Promise<{ id: string }>;
}

// Server Component: reads the recipe via the service directly (docs/ARCHITECTURE.md §1),
// hands the plain DTO to the client view for the interactive bits (scaling stepper,
// cook-mode, rating/favorite/archive).
export default async function ReceptDetailPage({ params }: ReceptDetailPageProps) {
  const { id } = await params;
  const recipeId = Number(id);
  if (!Number.isInteger(recipeId) || recipeId <= 0) notFound();

  const recipe = await getRecipe(recipeId);
  if (!recipe) notFound();

  return <ReceptDetailView recipe={recipe} />;
}
