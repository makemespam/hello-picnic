export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="text-6xl" role="img" aria-label="Bord met bestek">
        🍽️
      </span>
      <h1 className="text-3xl font-bold">Hello Picnic v2</h1>
      <p className="text-ink-muted">
        Het fundament staat. De app-schil, het weekmenu en de rest volgen per werkpakket —
        zie <code className="rounded-sm bg-primary-soft px-1.5 py-0.5 text-sm">docs/REBUILD_PLAN.md</code>.
      </p>
    </main>
  );
}
