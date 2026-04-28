'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/', label: 'Home' },
  { href: '/plan', label: 'Weekplan' },
  { href: '/instellingen', label: 'Instellingen' },
];

export default function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 border-b border-stone-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold text-orange-500 text-xl">
          <span>🛒</span>
          <span>Hello Picnic</span>
        </Link>
        <div className="flex items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                pathname === l.href
                  ? 'bg-orange-50 text-orange-600'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
