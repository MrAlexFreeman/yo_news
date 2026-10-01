import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Basic Auth gate for the editorial area.
 *
 * Next.js 16 renamed the `middleware` file convention to `proxy`; `middleware.ts`
 * is deprecated. The function below is the same hook under the current name.
 *
 * Scope: this is a first lock on the door, not a real identity system. It stops
 * the CMS from being reachable by anyone who guesses /admin — which matters a
 * lot more now that the editor can publish to the public site and to VK. It does
 * not give per-editor accounts, sessions or audit trails; see the handover notes
 * for what to add before a real newsroom uses it.
 */

/**
 * HTTP headers must be ByteStrings (latin-1). A Cyrillic realm throws
 * "Cannot convert argument to a ByteString" and turns the guard into a 500, so
 * the banner stays ASCII.
 */
const REALM = "Vestnik Editorial";

/** Constant-time compare that tolerates length mismatches. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function unauthorized(): NextResponse {
  return new NextResponse("Требуется авторизация", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
      "Cache-Control": "no-store",
    },
  });
}

export function proxy(request: NextRequest) {
  const user = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;

  // Fail closed: with no credentials configured the CMS must not be reachable.
  // This matters in dev, where .env may be missing — an open door would be worse.
  if (!user || !password) {
    return new NextResponse("Админка не сконфигурирована", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) {
    return unauthorized();
  }

  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
  } catch {
    return unauthorized();
  }

  const separator = decoded.indexOf(":");
  if (separator === -1) {
    return unauthorized();
  }

  const candidateUser = decoded.slice(0, separator);
  const candidatePassword = decoded.slice(separator + 1);

  if (
    !safeEqual(candidateUser, user) ||
    !safeEqual(candidatePassword, password)
  ) {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
