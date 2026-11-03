import { NextResponse } from "next/server";
import { handleIntegrationRequest, readJsonObject } from "@/lib/integration-handler";
import { integrationError } from "@/lib/integrations/m2m";
import { revokeStaff } from "@/lib/integrations/store";

export const runtime = "nodejs";

// The institution system withdrew a person's access: deactivate their portal account and end its sessions.
export async function POST(request: Request) {
  return handleIntegrationRequest(request, async (client) => {
    const { body } = await readJsonObject(request);
    const externalUserId = typeof body?.external_user_id === "string" ? body.external_user_id.trim() : "";
    if (!externalUserId || externalUserId.length > 100) return integrationError(400, "invalid_request", "external_user_id is required.");
    const revoked = await revokeStaff(client.tenantId, externalUserId);
    return NextResponse.json({ ok: true, revoked }, { headers: { "Cache-Control": "no-store" } });
  });
}
