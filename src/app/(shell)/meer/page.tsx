import Link from 'next/link';

// "Meer" bundles Instellingen, Kosten, Agenda-koppeling, Scannen
// (docs/DESIGN_PRINCIPLES.md §4). Agenda-koppeling and Scannen land in later work
// packages; Instellingen and Kosten are live as of WP-05.
const MENU_ITEMS = [
  { href: '/meer/instellingen', emoji: '🧑‍🍳', title: 'Instellingen', description: 'Gezinsvoorkeuren, AI-modellen per taak en inloggegevens voor Picnic/Bring.' },
  { href: '/meer/kosten', emoji: '💶', title: 'Kosten', description: 'AI-gebruik en kosten per taak en per model.' },
];

export default function MeerPage() {
  return (
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
  );
}
