import Link from "next/link";
export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-3xl space-y-4 px-6 py-12">
      <h1 className="text-2xl font-semibold">Workspace unavailable</h1>
      <p>Check your current access or choose another organization.</p>
      <Link href="/admin" className="text-primary underline">
        Choose an organization
      </Link>
    </main>
  );
}
