import { NextResponse } from "next/server";
import { createSession, setSessionCookie } from "@/lib/auth";
import { getPortalOrigin } from "@/lib/integrations/m2m";
import { redeemLaunchTicket } from "@/lib/integrations/store";
import { consumeRateLimit, getClientAddress, rateLimitRules } from "@/lib/rate-limit";

export const runtime = "nodejs";

// The ticket is a bearer credential in the URL: keep it out of caches and Referer headers.
const launchHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

function launchError(status: number, error: string, description: string) {
  return NextResponse.json({ ok: false, error, error_description: description }, { status, headers: launchHeaders });
}

export async function GET(request: Request) {
  try {
    const rateLimited = consumeRateLimit(`launch:${getClientAddress(request)}`, rateLimitRules.launchPerIp);
    if (rateLimited) return rateLimited;

    const ticket = new URL(request.url).searchParams.get("ticket") ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) {
      return launchError(400, "invalid_request", "A launch ticket is required.");
    }
    const origin = getPortalOrigin(request);
    if (!origin) return launchError(503, "portal_url_not_configured", "The portal's public URL is not configured.");

    const subject = await redeemLaunchTicket(ticket);
    if (!subject) {
      return launchError(401, "invalid_ticket", "This sign-in link is invalid, expired or has already been used.");
    }

    const sessionToken = await createSession(subject.kind === "staff" ? "user" : "candidate", subject.id);
    // Students and staff share /dashboard; the page shows the right portal for the session.
    const response = NextResponse.redirect(new URL("/dashboard", origin), { status: 302, headers: launchHeaders });
    setSessionCookie(response, sessionToken);
    return response;
  } catch (error) {
    console.error("Failed to redeem launch ticket", { name: error instanceof Error ? error.name : "Error" });
    return launchError(500, "server_error", "Unable to sign in right now.");
  }
}
