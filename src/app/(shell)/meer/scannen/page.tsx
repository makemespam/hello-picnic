// Scannen page (docs/DESIGN_PRINCIPLES.md §5: "drop/camera grid -> pairing view ->
// extraction progress list -> review form per card -> Opslaan in bibliotheek",
// docs/workpackages/WP-08-card-scanning.md). Server Component reads the scan board
// directly via the service (same "pages read services directly for SSR" pattern as
// boodschappen/page.tsx, recepten/page.tsx); ScannenView drives every mutation via
// /api/scans/*.
import { listScanBoard } from '@/server/services/scanService';
import { ScannenView } from './_components/ScannenView';

// The board mutates via uploads/pairing/extraction/review, none of which are captured
// by a per-request input that would otherwise force dynamic rendering — same fix as
// src/app/(shell)/boodschappen/page.tsx (see that file for the longer explanation).
export const dynamic = 'force-dynamic';

export default async function ScannenPage() {
  const board = await listScanBoard();
  return <ScannenView initialBoard={board} />;
}
