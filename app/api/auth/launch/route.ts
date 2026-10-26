import { NextResponse } from "next/server";
import { createSession, setSessionCookie } from "@/lib/auth";
import { redeemLaunchTicket } from "@/lib/integrations/store";

export const runtime = "nodejs";

// Redeems a single-use launch ticket and starts the student's session. The ticket is consumed even if the
// redirect target fails, and the response is never cached or leaked through the Referer header.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = (process.env.PORTAL_PUBLIC_URL ?? process.env.INTEGRATION_ISSUER_URL ?? url.origin).trim().replace(/\/$/, "");
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  try {
    const candidateRowId = await redeemLaunchTicket(url.searchParams.get("ticket") ?? "");
    if (candidateRowId === null) return NextResponse.redirect(new URL("/?sso_error=expired", base), { headers });
    const response = NextResponse.redirect(new URL("/", base), { headers });
    setSessionCookie(response, await createSession("candidate", candidateRowId));
    return response;
  } catch (error) {
    console.error("Launch ticket redemption failed", error);
    return NextResponse.redirect(new URL("/?sso_error=failed", base), { headers });
  }
}
