import { PageHeader } from '@/components/PageHeader';
import { getCostSummary } from '@/server/services/costService';
import { KostenDashboard } from './_components/KostenDashboard';

// Server Component: reads the initial ('week') summary via the service directly, the
// same pattern as /meer/instellingen (docs/ARCHITECTURE.md §1 "Services are
// unit-testable without HTTP"). The range toggle re-fetches via GET /api/costs.
export default async function KostenPage() {
  const summary = await getCostSummary('week');

  return (
    <div>
      <PageHeader title="Kosten" description="AI-gebruik en kosten per taak en per model (docs/ARCHITECTURE.md §5)." />
      <KostenDashboard initial={summary} />
    </div>
  );
}
