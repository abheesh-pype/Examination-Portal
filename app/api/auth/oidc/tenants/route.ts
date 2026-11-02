import { NextResponse } from "next/server";
import { loadTenants } from "@/lib/integrations/tokens";

export const runtime = "nodejs";

// Public: which institutions offer single sign-on. Ids only; no endpoints or client details.
export async function GET() {
  const enabled = Boolean(process.env.OIDC_STATE_SECRET) && process.env.OIDC_STATE_SECRET!.length >= 32;
  const tenants = enabled ? loadTenants().tenants.filter((tenant) => tenant.oidc).map((tenant) => ({ tenant_id: tenant.tenantId })) : [];
  return NextResponse.json({ tenants });
}
