import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getDocsExternalUrl } from "@/server/env";

// When DOCS_EXTERNAL_URL is set, redirect the bundled /docs route to the
// externally hosted documentation. Read at request time so the same image works
// with or without the variable set.
export function middleware(request: NextRequest) {
  const docsUrl = getDocsExternalUrl();
  if (!docsUrl) {
    return NextResponse.next();
  }

  // The matcher guarantees the path begins with /docs; map the remaining suffix
  // onto the external site and preserve any query string.
  const suffix = request.nextUrl.pathname.slice("/docs".length);
  return NextResponse.redirect(`${docsUrl}${suffix}${request.nextUrl.search}`);
}

export const config = {
  matcher: ["/docs", "/docs/:path*"],
};
