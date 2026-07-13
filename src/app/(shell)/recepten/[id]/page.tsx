import { notFound } from 'next/navigation';
import { getImageModelById, getDefaultImageModel } from '@/server/integrations/ai/models';
import { getRecipe } from '@/server/services/recipeService';
import { getAiModelOverrides } from '@/server/services/settingsService';
import { ReceptDetailView } from './_components/ReceptDetailView';

interface ReceptDetailPageProps {
  params: Promise<{ id: string }>;
}

// Server Component: reads the recipe via the service directly (docs/ARCHITECTURE.md §1),
// hands the plain DTO to the client view for the interactive bits (scaling stepper,
// cook-mode, rating/favorite/archive, dish-photo generate/toggle). Also resolves the
// active image model's per-photo price server-side (docs/workpackages/WP-07-photo-
// pipeline.md §5: cost-confirm dialog) — same registry-resolution the AI layer itself
// uses, just for display, so the client component never imports src/server/*.
export default async function ReceptDetailPage({ params }: ReceptDetailPageProps) {
  const { id } = await params;
  const recipeId = Number(id);
  if (!Number.isInteger(recipeId) || recipeId <= 0) notFound();

  const [recipe, overrides] = await Promise.all([getRecipe(recipeId), getAiModelOverrides()]);
  if (!recipe) notFound();

  const imageModel = (overrides.image ? getImageModelById(overrides.image) : undefined) ?? getDefaultImageModel();
  const photoPriceCents = imageModel?.pricePerImageCents ?? null;

  return <ReceptDetailView recipe={recipe} photoPriceCents={photoPriceCents} />;
}
