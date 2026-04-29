import Link from 'next/link';

const routes = [
  { href: '/', label: 'Home' },
  { href: '/plan', label: 'Weekplan' },
  { href: '/overzicht', label: 'Overzicht' },
  { href: '/bibliotheek', label: 'Bibliotheek' },
  { href: '/instellingen', label: 'Instellingen' },
];

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 py-16 text-center">
      <div>
        <p className="text-sm font-semibold uppercase text-stone-400">404</p>
        <h1 className="mt-2 text-3xl font-extrabold text-stone-900">Pagina niet gevonden</h1>
        <p className="mt-2 text-stone-500">
          Deze route bestaat niet in Hello Picnic. Kies een bestaande pagina hieronder.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {routes.map((route) => (
          <Link key={route.href} href={route.href} className="btn-secondary">
            {route.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
