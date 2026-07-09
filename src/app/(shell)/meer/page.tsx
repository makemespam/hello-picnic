import { EmptyState } from '@/components/EmptyState';

export default function MeerPage() {
  return (
    <EmptyState
      illustration="⚙️"
      title="Instellingen, kosten en meer"
      description="Kostenoverzicht, agenda-koppeling en het scannen van receptkaarten volgen in latere work packages. Gezinsvoorkeuren, AI-modellen en inloggegevens kun je nu al instellen."
      action={{ label: 'Naar instellingen', href: '/meer/instellingen' }}
    />
  );
}
