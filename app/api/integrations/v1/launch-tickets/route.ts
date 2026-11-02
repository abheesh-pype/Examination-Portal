import { NextResponse } from "next/server";
import { handleIntegrationRequest, readJsonObject } from "@/lib/integration-handler";
import { getPortalOrigin, integrationError } from "@/lib/integrations/m2m";
import { createLaunchTicket, LAUNCH_TICKET_TTL_SECONDS } from "@/lib/integrations/store";

export const runtime = "nodejs";

// Machine-to-machine: the institution system (after authenticating the student itself) asks for a single-use
// link that signs that provisioned student in. The student never types credentials here.
export async function POST(request: Request) {
  return handleIntegrationRequest(request, async (client) => {
    const { body } = await readJsonObject(request);
    if (!body) return integrationError(400, "invalid_request", "The request body must be a JSON object.");
    const externalStudentId = typeof body.external_student_id === "string" ? body.external_student_id.trim() : "";
    if (!externalStudentId || externalStudentId.length > 128) {
      return integrationError(422, "invalid_request", "external_student_id must be a non-empty string of at most 128 characters.");
    }
    const origin = getPortalOrigin(request);
    if (!origin) {
      return integrationError(503, "portal_url_not_configured", "PORTAL_PUBLIC_URL must be set to the portal's HTTPS origin.");
    }

    const created = await createLaunchTicket(client.tenantId, externalStudentId, client.clientId);
    if (!created) {
      return integrationError(404, "student_not_found", "The student has not been provisioned or is inactive.");
    }
    return NextResponse.json({
      ok: true,
      launch_url: `${origin}/launch?ticket=${created.ticket}`,
      expires_at: created.expiresAt.toISOString(),
      expires_in: LAUNCH_TICKET_TTL_SECONDS,
    }, { headers: { "Cache-Control": "no-store" } });
  });
}
