import { NextResponse } from "next/server";
import { handleIntegrationRequest, readJsonObject } from "@/lib/integration-handler";
import { integrationError } from "@/lib/integrations/m2m";
import { setStaffPassword } from "@/lib/integrations/store";

export const runtime = "nodejs";

// A signed-in person in the institution system chose a password so they can also use the portal's own login page.
export async function POST(request: Request) {
  return handleIntegrationRequest(request, async (client) => {
    const { body } = await readJsonObject(request);
    const externalUserId = typeof body?.external_user_id === "string" ? body.external_user_id.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!externalUserId || externalUserId.length > 100) return integrationError(400, "invalid_request", "external_user_id is required.");
    if (password.length < 8 || password.length > 128) return integrationError(400, "invalid_password", "The password must be 8 to 128 characters.");
    const result = await setStaffPassword(client.tenantId, externalUserId, password);
    if (result === "not_found") return integrationError(404, "not_provisioned", "This person has no portal account yet.");
    if (result === "inactive") return integrationError(403, "user_inactive", "The portal account is deactivated.");
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}
