"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="mx-auto max-w-3xl space-y-4 px-6 py-12">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p>We couldn’t load this page. Please try again.</p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
