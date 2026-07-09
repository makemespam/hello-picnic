// Boodschappen page (docs/ARCHITECTURE.md §1 "Pages never call integrations directly" —
// this Server Component reads via the service layer directly, same pattern as
// plan/page.tsx and recepten/page.tsx). Client interaction (resolve/send/toggle/switch
// round trips) lives in BoodschappenView.
import { EmptyState } from '@/components/EmptyState';
import { getLatestFinalizedPlan } from '@/server/services/planService';
import { getShoppingList } from '@/server/services/shoppingService';
import { BoodschappenView } from './_components/BoodschappenView';

// The latest finalized plan's shopping list mutates constantly via the /api/shopping/*
// routes and carries no per-request input that would otherwise force dynamic rendering —
// same fix as src/app/(shell)/plan/page.tsx, see that file for the longer explanation.
export const dynamic = 'force-dynamic';

export default async function BoodschappenPage() {
  const plan = await getLatestFinalizedPlan();

  if (!plan) {
    return (
      <EmptyState
        illustration="🛒"
        title="Nog geen boodschappenlijst"
        description="Rond een weekmenu af en je boodschappenlijst verschijnt hier automatisch, klaar om naar Picnic te sturen."
        action={{ label: 'Naar weekplan', href: '/plan' }}
      />
    );
  }

  const list = await getShoppingList(plan.id);

  return <BoodschappenView planId={plan.id} initialList={list} />;
}
