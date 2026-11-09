import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { OperatorNavigation } from "@/components/operator-navigation";
import { operatorAccess } from "@/lib/operator";

// The layout stays mounted while operators move between pages, so the
// operator navigation does not reload. Each page still checks access itself.
export default async function OperatorLayout({ children }: { children: ReactNode }) {
  const access = await operatorAccess();
  if (access === "denied") notFound();
  return (
    <>
      {access === null ? null : <OperatorNavigation waiting={access.waiting} />}
      {children}
    </>
  );
}
