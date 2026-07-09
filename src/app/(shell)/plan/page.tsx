import { EmptyState } from '@/components/EmptyState';

export default function WeekplanPage() {
  return (
    <EmptyState
      illustration="📅"
      title="Nog geen weekmenu"
      description="Stel binnenkort je eerste weekmenu samen uit jullie receptenbibliotheek."
      action={{ label: 'Bekijk recepten', href: '/recepten' }}
    />
  );
}
