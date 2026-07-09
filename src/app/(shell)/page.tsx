import { EmptyState } from '@/components/EmptyState';

export default function VandaagPage() {
  return (
    <EmptyState
      illustration="🍽️"
      title="Nog geen etentje gepland"
      description="Zodra je een weekmenu hebt, zie je hier wat jullie vanavond eten."
      action={{ label: 'Naar weekplan', href: '/plan' }}
    />
  );
}
