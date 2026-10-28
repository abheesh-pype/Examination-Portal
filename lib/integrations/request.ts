import { NextResponse } from "next/server";
import { IntegrationError, loadTenants, verifyBearerToken, type TenantConfig } from "@/lib/integrations/tokens";
import { PayloadError, peekTenantId } from "@/lib/integrations/payload";
import { loadIssuerConfig, publicKeySet } from "@/lib/integrations/issuer";

const MAX_BODY_BYTES = 1_000_000;

/** Parses the JSON body, selects the tenant it names, and verifies the bearer token (with `scope`) against that tenant. */
export async function authorizeTenantRequest(request: Request, scope: string): Promise<{ tenant: TenantConfig; body: unknown }> {
  const { tenants } = loadTenants();
  if (tenants.length === 0) throw new IntegrationError(503, "not_configured", "Integrations are not configured");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new IntegrationError(413, "payload_too_large", "Payload too large");
  let body: unknown;
  try { body = JSON.parse(await request.text()); } catch { throw new PayloadError(400, "Body must be JSON"); }

  // Unknown tenant and bad token are indistinguishable to the caller.
  const tenant = tenants.find((entry) => entry.tenantId === peekTenantId(body));
  if (!tenant) throw new IntegrationError(401, "unauthorized", "Invalid or expired token");
  const issuer = tenant.builtin ? loadIssuerConfig() : null;
  if (tenant.builtin && !issuer) throw new IntegrationError(503, "not_configured", "Token issuer is not configured");
  const localKeys = issuer ? await publicKeySet(issuer) : null;
  await verifyBearerToken(request.headers.get("authorization"), tenant, localKeys ? () => localKeys : undefined, scope);
  return { tenant, body };
}

export function integrationErrorResponse(error: unknown, label: string) {
  if (error instanceof IntegrationError) {
    return NextResponse.json({ ok: false, error: error.code, message: error.message }, {
      status: error.status, headers: error.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined,
    });
  }
  if (error instanceof PayloadError) return NextResponse.json({ ok: false, error: "invalid_payload", message: error.message }, { status: error.status });
  console.error(label, error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}
