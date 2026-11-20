"use client";

import { Button } from "@heroui/react";
import { PageBody, PageHeading } from "@/components/page-heading";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main">
      <PageHeading description="We couldn’t load this page. Please try again.">
        Something went wrong
      </PageHeading>
      <PageBody>
        <Button onPress={reset}>Try again</Button>
      </PageBody>
    </main>
  );
}
