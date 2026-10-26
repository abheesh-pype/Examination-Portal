import { NextResponse } from "next/server";
import { loadTenants } from "@/lib/integrations/tokens";
import { createLimiter, loadIssuerConfig, parseClientAuth, signAccessToken, TOKEN_TTL_SECONDS, verifySecret } from "@/lib/integrations/issuer";
import { findIntegrationClient } from "@/lib/integrations/store";

export const runtime = "nodejs";

const limiter = createLimiter();
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };
const oauthError = (status: number, error: string, description?: string, headers: Record<string, string> = {}) =>
  NextResponse.json({ error, ...(description ? { error_description: description } : {}) }, { status, headers: { ...NO_STORE, ...headers } });

// OAuth 2.0 client-credentials grant for machine clients (e.g. UMS). Issues short-lived RS256 JWTs that the
// provisioning endpoint verifies with the matching public key.
export async function POST(request: Request) {
  try {
    const config = loadIssuerConfig();
    if (!config) return oauthError(503, "temporarily_unavailable", "Token issuer is not configured");

    const form = new URLSearchParams(await request.text());
    if (form.get("grant_type") !== "client_credentials") return oauthError(400, "unsupported_grant_type");
    const credentials = parseClientAuth(request.headers.get("authorization"), form);
    if (!credentials) return oauthError(401, "invalid_client", undefined, { "WWW-Authenticate": 'Basic realm="token"' });

    const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    const limitKey = `${ip}|${credentials.clientId}`;
    if (limiter.blocked(limitKey)) return oauthError(429, "temporarily_unavailable", "Too many failed attempts");

    const client = await findIntegrationClient(credentials.clientId);
    if (!verifySecret(credentials.secret, client?.secret_hash) || !client) {
      limiter.fail(limitKey);
      return oauthError(401, "invalid_client", undefined, { "WWW-Authenticate": 'Basic realm="token"' });
    }
    limiter.clear(limitKey);

    // The tenant must still be configured as a built-in tenant: removing it revokes all its clients.
    if (!loadTenants().tenants.some((tenant) => tenant.builtin && tenant.tenantId === client.tenant_id)) {
      return oauthError(401, "invalid_client");
    }
    const audience = form.get("audience");
    if (audience && audience !== config.audience) return oauthError(400, "invalid_target", "Unknown audience");

    const allowed = client.scopes.split(" ").filter(Boolean);
    const requested = (form.get("scope") ?? "").split(" ").filter(Boolean);
    if (requested.some((scope) => !allowed.includes(scope))) return oauthError(400, "invalid_scope");
    const granted = (requested.length ? requested : allowed).join(" ");

    const accessToken = await signAccessToken(config, { clientId: client.client_id, tenantId: client.tenant_id, scope: granted });
    return NextResponse.json({ access_token: accessToken, token_type: "Bearer", expires_in: TOKEN_TTL_SECONDS, scope: granted }, { headers: NO_STORE });
  } catch (error) {
    console.error("Token endpoint failed", error);
    return oauthError(500, "server_error");
  }
}
