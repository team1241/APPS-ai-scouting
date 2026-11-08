import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authConfigured } from "@/lib/auth-config";

export default function Home() {
  return (
    <main
      id="main"
      className="mx-auto grid max-w-5xl gap-10 px-6 py-16 md:grid-cols-[1.1fr_1fr] md:items-start"
    >
      <section className="space-y-5">
        <h1 className="text-3xl font-semibold tracking-tight">
          Your team’s administration workspace.
        </h1>
        <p className="max-w-prose text-muted-foreground">
          Sign in to select your organization and manage team access as the administration tools
          become available.
        </p>
        <p className="text-sm text-muted-foreground">
          For approved adult administrators of Canadian teams. Scouts submit notes through Telegram.
        </p>
      </section>
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Administrator access</CardTitle>
          <CardDescription>
            Access is arranged through your team’s responsible adult lead.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm">
            Your team must approve your access before you sign in. You must be at least 18 and the
            age of majority where you live.
          </p>
          {authConfigured() ? (
            <Button asChild className="w-full">
              <Link href="/sign-in">Sign in to your workspace</Link>
            </Button>
          ) : (
            <p role="status" className="rounded-md bg-muted p-4 text-sm">
              Administration is being set up. Contact your team lead for access.
            </p>
          )}
          <Link href="/privacy" className="block text-sm text-primary underline underline-offset-4">
            How we handle your information
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
