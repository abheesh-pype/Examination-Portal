import { NextResponse } from "next/server";
import { IntegrationError, loadTenants, verifyBearerToken, type TenantConfig } from "@/lib/integrations/tokens";
import type { JWTPayload } from "jose";
import { PayloadError } from "@/lib/integrations/payload";
import { loadIssuerConfig, publicKeySet } from "@/lib/integrations/issuer";

/** Verifies a JWT bearer token (with `scope`) against the tenant it names. Unknown tenant and bad token are indistinguishable to the caller. */
export async function verifyTenantToken(authorization: string, tenantId: string, scope: string): Promise<{ tenant: TenantConfig; payload: JWTPayload }> {
  const { tenants } = loadTenants();
  if (tenants.length === 0) throw new IntegrationError(503, "not_configured", "Integrations are not configured");
  const tenant = tenants.find((entry) => entry.tenantId === tenantId);
  if (!tenant) throw new IntegrationError(401, "unauthorized", "Invalid or expired token");
  const issuer = tenant.builtin ? loadIssuerConfig() : null;
  if (tenant.builtin && !issuer) throw new IntegrationError(503, "not_configured", "Token issuer is not configured");
  const localKeys = issuer ? await publicKeySet(issuer) : null;
  const payload = await verifyBearerToken(authorization, tenant, localKeys ? () => localKeys : undefined, scope);
  return { tenant, payload };
}

export function integrationErrorResponse(error: unknown, label: string) {
  if (error instanceof IntegrationError) {
    return NextResponse.json({ ok: false, error: error.code, error_description: error.message, message: error.message }, {
      status: error.status, headers: error.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined,
    });
  }
  if (error instanceof PayloadError) return NextResponse.json({ ok: false, error: "invalid_payload", error_description: error.message, message: error.message }, { status: error.status });
  console.error(label, error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}
