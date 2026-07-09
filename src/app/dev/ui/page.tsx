import { notFound } from 'next/navigation';
import { DevUiBottomNav, DevUiShowcase } from './_components/DevUiShowcase';

export const metadata = {
  title: 'Hello Picnic — /dev/ui',
};

/**
 * Dev-only component showcase (WP-02 acceptance criteria). Returns a real 404 in
 * production so this never ships as a reachable route.
 */
export default function DevUiPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return (
    <>
      <DevUiShowcase />
      <DevUiBottomNav />
    </>
  );
}
