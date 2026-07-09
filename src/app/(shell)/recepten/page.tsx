import { EmptyState } from '@/components/EmptyState';

export default function ReceptenPage() {
  return (
    <EmptyState
      illustration="📖"
      title="Nog geen recepten"
      description="Scan straks jullie HelloFresh-kaarten of voeg recepten handmatig toe — je bibliotheek verschijnt hier."
      action={{ label: 'Ga naar Meer', href: '/meer' }}
    />
  );
}
