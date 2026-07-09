import Link from 'next/link';
import { Alert } from './Alert';

/**
 * Re-login banner (docs/workpackages/WP-09-picnic-client-v2.md §2/§5): shown wherever a
 * Picnic call fails with `PicnicAuthExpired`/`Picnic2FARequired` instead of failing
 * silently — the settings connect card (this WP) and WP-10's shopping screens both use
 * this same component so the message and the "ga naar Instellingen" action stay
 * consistent everywhere Picnic can go stale mid-session.
 */
export function PicnicReloginBanner({ className }: { className?: string }) {
  return (
    <Alert
      variant="warning"
      title="Picnic-sessie verlopen"
      className={className}
      action={
        <Link href="/meer/instellingen" className="text-sm font-semibold text-warning underline underline-offset-2">
          Opnieuw verbinden bij Instellingen
        </Link>
      }
    >
      Je Picnic-verbinding is verlopen. Log opnieuw in om je boodschappenlijst te vullen.
    </Alert>
  );
}
