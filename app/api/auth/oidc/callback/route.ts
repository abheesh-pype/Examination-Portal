import { NextResponse } from "next/server";
import { createSession, setSessionCookie } from "@/lib/auth";
import { loadTenants } from "@/lib/integrations/tokens";
import { completeSignIn, discover, linkValue, openTransaction, TX_COOKIE } from "@/lib/integrations/oidc";
import { resolveOidcStudent } from "@/lib/integrations/store";

export const runtime = "nodejs";

function cookieValue(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

export async function GET(request: Request) {
  const secret = process.env.OIDC_STATE_SECRET;
  const url = new URL(request.url);
  const fail = (reason: string, base = url.origin) => {
    const response = NextResponse.redirect(new URL(`/?sso_error=${reason}`, base));
    response.cookies.set(TX_COOKIE, "", { path: "/api/auth/oidc", maxAge: 0 });
    return response;
  };
  if (!secret || secret.length < 32) return fail("unavailable");

  const tx = openTransaction(cookieValue(request, TX_COOKIE), secret);
  const tenant = tx && loadTenants().tenants.find((entry) => entry.tenantId === tx.tenantId && entry.oidc);
  if (!tx || !tenant?.oidc) return fail("expired");
  const base = new URL(tenant.oidc.redirectUri).origin;
  const code = url.searchParams.get("code");
  if (url.searchParams.get("state") !== tx.state || !code) return fail("denied", base);

  try {
    const discovery = await discover(tenant.oidc.issuer);
    const claims = await completeSignIn(code, tx, discovery, tenant.oidc);
    const candidateRowId = await resolveOidcStudent(tenant.tenantId, discovery.issuer, String(claims.sub), linkValue(claims, tenant.oidc.linkClaim));
    if (candidateRowId === null) return fail("not_enrolled", base);

    const response = NextResponse.redirect(new URL("/", base));
    setSessionCookie(response, await createSession("candidate", candidateRowId));
    response.cookies.set(TX_COOKIE, "", { path: "/api/auth/oidc", maxAge: 0 });
    return response;
  } catch (error) {
    console.error("OIDC sign-in failed", error);
    return fail("failed", base);
  }
}
