import Link from 'next/link';
import { Alert } from '@/components/Alert';

// "Meer" bundles Instellingen, Kosten, Agenda-koppeling, Scannen
// (docs/DESIGN_PRINCIPLES.md §4). Agenda-koppeling and Scannen land in later work
// packages; Instellingen and Kosten are live as of WP-05.
const MENU_ITEMS = [
  { href: '/meer/instellingen', emoji: '🧑‍🍳', title: 'Instellingen', description: 'Gezinsvoorkeuren, AI-modellen per taak en inloggegevens voor Picnic/Bring.' },
  { href: '/meer/kosten', emoji: '💶', title: 'Kosten', description: 'AI-gebruik en kosten per taak en per model.' },
  { href: '/meer/scannen', emoji: '📷', title: 'Scannen', description: "Upload foto's van HelloFresh-kaarten en zet ze om in bibliotheekrecepten." },
];

export default function MeerPage() {
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Meer" className="flex flex-col divide-y divide-ink/10 rounded-lg border border-ink/10 bg-surface shadow-sm">
        {MENU_ITEMS.map((item) => (
          <Link key={item.href} href={item.href} className="flex items-center gap-4 px-5 py-4 hover:bg-ink/5">
            <span aria-hidden="true" className="text-2xl">
              {item.emoji}
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">{item.title}</p>
              <p className="text-xs text-ink-muted">{item.description}</p>
            </div>
          </Link>
        ))}
      </nav>

      {/* PWA fallback voor wie geen Android-toestel heeft voor de sideloaded app —
          docs/workpackages/WP-14 §3. De iPhone-app is er niet (Apple staat geen
          sideloaden toe zonder ontwikkelaarsaccount); "Zet op beginscherm" via Safari
          geeft dezelfde app-ervaring (eigen icoon, geen browserbalk, offline-shell). */}
      <Alert variant="info" title="App installeren">
        <p>
          Zet Hello Picnic op je beginscherm voor een eigen app-icoon en een volledig scherm zonder
          browserbalk — geen appstore nodig.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="font-semibold text-ink">iPhone (Safari)</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4">
              <li>Open deze site in Safari (niet Chrome — het deelmenu werkt alleen in Safari).</li>
              <li>
                Tik op het deelicoon <span aria-hidden="true">⬆️</span> onderin.
              </li>
              <li>Kies &ldquo;Zet op beginscherm&rdquo; en tik op &ldquo;Voeg toe&rdquo;.</li>
            </ol>
          </div>
          <div>
            <p className="font-semibold text-ink">Android (Chrome)</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4">
              <li>Open deze site in Chrome.</li>
              <li>
                Tik op het menu <span aria-hidden="true">⋮</span> rechtsboven.
              </li>
              <li>Kies &ldquo;App installeren&rdquo; (of &ldquo;Zet op startscherm&rdquo;) en bevestig.</li>
            </ol>
            <p className="mt-1 text-ink-muted">
              Liever het echte app-icoon uit de Play-achtige installatie? Vraag om het sideloaded APK-bestand
              — zie <code>deploy/ANDROID.md</code>.
            </p>
          </div>
        </div>
      </Alert>
    </div>
  );
}
