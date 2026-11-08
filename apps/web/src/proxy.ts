import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const protectedRoute = createRouteMatcher(["/admin(.*)"]);
const clerk = clerkMiddleware(
  async (auth, request) => {
    if (protectedRoute(request)) await auth.protect();
  },
  { signInUrl: "/sign-in" },
);

export default function proxy(...args: Parameters<typeof clerk>) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) {
    if (protectedRoute(args[0])) return NextResponse.redirect(new URL("/", args[0].url));
    return NextResponse.next();
  }
  return clerk(...args);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
