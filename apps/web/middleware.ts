import { NextRequest, NextResponse } from "next/server";

/**
 * Developer wall for the staging site (dev.thecookout.fun).
 *
 * The dev branch is where we build the real-money phases while the beta gathers
 * a community on X. `dev.` is a guessable subdomain, so the whole staging site
 * sits behind HTTP Basic Auth — a browser login prompt no crawler or passer-by
 * gets through.
 *
 * It is inert on production: the gate only engages when the request host starts
 * with `dev.` (e.g. dev.thecookout.fun) or when DEV_SITE_GATE=1 is set for the
 * deployment. www/apex production is never gated. Configure per environment in
 * Vercel:
 *   DEV_GATE_PASS  (required to unlock) — the developer password
 *   DEV_GATE_USER  (optional, default "dev") — the developer username
 *   DEV_SITE_GATE  (optional) — "1" forces the gate on regardless of host,
 *                  "0" forces it off. Leave unset to auto-detect by host.
 */

const GATE_USER = process.env.DEV_GATE_USER || "dev";
const GATE_PASS = process.env.DEV_GATE_PASS || "";
const REALM = 'Basic realm="The Cookout — dev", charset="UTF-8"';

function shouldGate(req: NextRequest): boolean {
  const flag = process.env.DEV_SITE_GATE;
  if (flag === "1") return true;
  if (flag === "0") return false;
  const host = (req.headers.get("host") || "").toLowerCase();
  return host.startsWith("dev.");
}

function challenge(body = "Developer access only."): NextResponse {
  return new NextResponse(body, {
    status: 401,
    headers: {
      "WWW-Authenticate": REALM,
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export function middleware(req: NextRequest): NextResponse {
  if (!shouldGate(req)) return NextResponse.next();

  // Fail closed but explain, so a misconfigured deploy is obvious (only the dev
  // team ever sees this — production is never gated).
  if (!GATE_PASS) {
    return challenge("Dev gate is on but DEV_GATE_PASS is not set for this deployment.");
  }

  const header = req.headers.get("authorization") || "";
  if (header.startsWith("Basic ")) {
    let decoded = "";
    try {
      decoded = atob(header.slice(6));
    } catch {
      return challenge("Malformed credentials.");
    }
    const sep = decoded.indexOf(":");
    const user = sep >= 0 ? decoded.slice(0, sep) : "";
    const pass = sep >= 0 ? decoded.slice(sep + 1) : "";
    if (user === GATE_USER && pass === GATE_PASS) {
      return NextResponse.next();
    }
  }
  return challenge();
}

export const config = {
  // Gate every page and route, but let Next internals and static assets through
  // so the login prompt paints correctly once authenticated.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|svg|gif|ico|webp|txt|xml|woff2?)$).*)",
  ],
};
