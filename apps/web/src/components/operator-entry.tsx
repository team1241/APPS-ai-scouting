import { auth } from "@clerk/nextjs/server";
import { OperatorNavLink } from "@/components/site-header";
import { operatorAccess } from "@/lib/operator";

// Header entry to operator tools. The backend decides who is an operator;
// signed-out visitors and non-operators get nothing.
export async function OperatorEntry() {
  const { userId } = await auth();
  if (!userId) return null;
  const access = await operatorAccess();
  if (!access || access === "denied") return null;
  return <OperatorNavLink waiting={access.waiting} />;
}
