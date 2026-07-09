import { PageHeader } from '@/components/PageHeader';
import { RecipeEditorForm } from '../_components/RecipeEditorForm';

export default function NieuwReceptPage() {
  return (
    <div>
      <PageHeader title="Nieuw recept" description="Voeg handmatig een recept toe aan jullie bibliotheek." />
      <RecipeEditorForm mode="create" />
    </div>
  );
}
