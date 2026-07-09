import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Hello Picnic',
  description: 'Slimme maaltijdplanner voor het gezin — weekmenu, boodschappen en agenda in één.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/icon-192.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#067A46',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={inter.variable}>
      <body className="min-h-screen bg-background font-sans text-ink antialiased">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
