import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { getRecipe } from '@/server/services/recipeService';
import { RecipeEditorForm } from '../../_components/RecipeEditorForm';

interface BewerkenPageProps {
  params: Promise<{ id: string }>;
}

export default async function BewerkReceptPage({ params }: BewerkenPageProps) {
  const { id } = await params;
  const recipeId = Number(id);
  if (!Number.isInteger(recipeId) || recipeId <= 0) notFound();

  const recipe = await getRecipe(recipeId);
  if (!recipe) notFound();

  return (
    <div>
      <PageHeader title="Recept bewerken" description={recipe.title} />
      <RecipeEditorForm mode="edit" initial={recipe} />
    </div>
  );
}
