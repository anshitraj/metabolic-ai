import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// The console is public to read (the business's economy is open), so there is
// no route guard. Customer actions are authorised in each API route handler.
// This proxy only attaches a request id for tracing.
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  if (!headers.get("x-request-id")) headers.set("x-request-id", crypto.randomUUID());
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/api/:path*"],
};
