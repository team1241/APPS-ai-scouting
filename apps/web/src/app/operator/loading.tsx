export default function Loading() {
  return (
    <main id="main" className="mx-auto max-w-3xl px-6 py-12" aria-busy="true">
      <p role="status">Loading…</p>
      <div className="mt-6 h-28 rounded-lg bg-muted motion-safe:animate-pulse" />
    </main>
  );
}
