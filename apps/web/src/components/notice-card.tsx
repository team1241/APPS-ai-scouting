"use client";

import { Card } from "@heroui/react";
import type { ReactNode } from "react";

// A card for page-level states (unavailable, no access). Server pages use this
// instead of the compound Card, which cannot be composed from a server component.
export function NoticeCard({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card>
      <Card.Header>
        <Card.Title>{title}</Card.Title>
        <Card.Description>{description}</Card.Description>
      </Card.Header>
      {children ? <Card.Footer>{children}</Card.Footer> : null}
    </Card>
  );
}
