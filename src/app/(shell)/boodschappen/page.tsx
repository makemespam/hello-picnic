import { EmptyState } from '@/components/EmptyState';

export default function BoodschappenPage() {
  return (
    <EmptyState
      illustration="🛒"
      title="Nog geen boodschappenlijst"
      description="Rond een weekmenu af en je boodschappenlijst verschijnt hier automatisch, klaar om naar Picnic te sturen."
      action={{ label: 'Naar weekplan', href: '/plan' }}
    />
  );
}
