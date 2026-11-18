import { NextResponse, type NextRequest } from "next/server";

/**
 * Analytics goes to PostHog through the `/ingest` rewrite in next.config.ts,
 * and a rewrite to another host passes the request on with its headers. The
 * browser sends this origin its cookies, which include the buyer's session and
 * the seller's (that one is set for every trybutter.ai host). Both are logins
 * in themselves, and PostHog needs neither to take an event, so they are taken
 * off before the request is passed on.
 */
export function proxy(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.delete("cookie");
  headers.delete("authorization");
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/ingest/:path*"],
};
