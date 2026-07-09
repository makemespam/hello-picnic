import { PageHeader } from '@/components/PageHeader';
import { DEFAULT_MODEL_BY_PURPOSE, getModelsForPurpose, type AiModel } from '@/server/integrations/ai/models';
import { getGoogleStatus } from '@/server/services/calendarService';
import { getConnectionStatus } from '@/server/services/picnicService';
import { getPublicSettings } from '@/server/services/settingsService';
import { AI_PURPOSES, type AiPurpose } from '@/shared/labels';
import { InstellingenForm } from './_components/InstellingenForm';

// Per-request data (settings/ledger) — never statically prerendered (same fix as /plan and /).
export const dynamic = 'force-dynamic';

// Server Component: reads the current settings via the service directly (no
// self-fetch round trip for the initial render — docs/ARCHITECTURE.md §1 "Services
// are unit-testable without HTTP"), and resolves the model registry server-side so
// the client component only ever receives plain serialized data, never an import
// from src/server/* (keeps the client/server module boundary explicit). The form's
// Save action still goes through the real PUT /api/settings route handler. Picnic's
// connection status (docs/workpackages/WP-09-picnic-client-v2.md §3) is resolved the
// same way — its live "is the stored token still good?" probe belongs on first paint,
// not behind an extra client round trip.
export default async function InstellingenPage() {
  const [settings, picnicStatus, googleStatus] = await Promise.all([getPublicSettings(), getConnectionStatus(), getGoogleStatus()]);
  const modelsByPurpose = Object.fromEntries(
    AI_PURPOSES.map((purpose) => [purpose, getModelsForPurpose(purpose)])
  ) as Record<AiPurpose, AiModel[]>;

  return (
    <div>
      <PageHeader
        title="Instellingen"
        description="Gezinsvoorkeuren, AI-modellen per taak en inloggegevens voor Picnic/Bring/Google Agenda."
      />
      <InstellingenForm
        initial={settings}
        modelsByPurpose={modelsByPurpose}
        defaultModelIdByPurpose={DEFAULT_MODEL_BY_PURPOSE}
        initialPicnicStatus={picnicStatus}
        initialGoogleStatus={googleStatus}
      />
    </div>
  );
}
