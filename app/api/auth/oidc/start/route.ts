import { NextResponse } from "next/server";
import { loadTenants } from "@/lib/integrations/tokens";
import { buildAuthorizationUrl, createTransaction, discover, sealTransaction, TX_COOKIE, TX_MAX_AGE_SECONDS } from "@/lib/integrations/oidc";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.OIDC_STATE_SECRET;
  const tenantId = new URL(request.url).searchParams.get("tenant") ?? "";
  const tenant = loadTenants().tenants.find((entry) => entry.tenantId === tenantId && entry.oidc);
  if (!secret || secret.length < 32 || !tenant?.oidc) return NextResponse.json({ error: "Single sign-on is not available." }, { status: 404 });
  try {
    const discovery = await discover(tenant.oidc.issuer);
    const tx = createTransaction(tenant.tenantId);
    const response = NextResponse.redirect(buildAuthorizationUrl(discovery, tenant.oidc, tx));
    response.cookies.set(TX_COOKIE, sealTransaction(tx, secret), {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/oidc", maxAge: TX_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    console.error("OIDC start failed", error);
    return NextResponse.json({ error: "The identity provider is unavailable." }, { status: 502 });
  }
}
