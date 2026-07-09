import Link from 'next/link';
import { Alert } from './Alert';

/**
 * Bring re-login banner (docs/workpackages/WP-11-bring-v2.md §3), mirroring
 * PicnicReloginBanner: shown when a Bring call fails with `BringAuthExpired` — i.e.
 * the stored token 401'd AND the one-shot refresh couldn't repair it, or no list/token
 * is configured at all.
 */
export function BringReloginBanner({ className }: { className?: string }) {
  return (
    <Alert
      variant="warning"
      title="Bring-verbinding werkt niet"
      className={className}
      action={
        <Link href="/meer/instellingen" className="text-sm font-semibold text-warning underline underline-offset-2">
          Opnieuw verbinden bij Instellingen
        </Link>
      }
    >
      Verbind je Bring-account (en kies een lijst) om je boodschappen te kunnen versturen.
    </Alert>
  );
}
