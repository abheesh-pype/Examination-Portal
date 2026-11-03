import { NextResponse } from "next/server";
import { handleIntegrationRequest, readJsonObject } from "@/lib/integration-handler";
import { getPortalOrigin, integrationError } from "@/lib/integrations/m2m";
import { validateStaffPayload } from "@/lib/integrations/payload";
import {
  createStaffLaunchTicket,
  LAUNCH_TICKET_TTL_SECONDS,
  provisionStaff,
  StaffConflictError,
  StaffInactiveError,
  UnknownRoleError,
} from "@/lib/integrations/store";

export const runtime = "nodejs";

// The institution system (after authenticating its own staff member, e.g. an Academic Admin) asks for a single-use
// link that signs that person into the portal with the "UMS Administrator" role.
export async function POST(request: Request) {
  return handleIntegrationRequest(request, async (client) => {
    const { body } = await readJsonObject(request);
    if (!body) return integrationError(400, "invalid_request", "The request body must be a JSON object.");
    const staff = validateStaffPayload(body);
    const origin = getPortalOrigin(request);
    if (!origin) {
      return integrationError(503, "portal_url_not_configured", "PORTAL_PUBLIC_URL must be set to the portal's HTTPS origin.");
    }

    try {
      const userId = await provisionStaff(staff);
      const { ticket } = await createStaffLaunchTicket(client.tenantId, staff.externalUserId, userId, client.clientId);
      return NextResponse.json({
        ok: true,
        launch_url: `${origin}/launch?ticket=${ticket}`,
        expires_in: LAUNCH_TICKET_TTL_SECONDS,
      }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof StaffConflictError) return integrationError(409, "email_conflict", error.message);
      if (error instanceof UnknownRoleError) return integrationError(400, "unknown_role", error.message);
      if (error instanceof StaffInactiveError) return integrationError(403, "user_inactive", error.message);
      throw error;
    }
  });
}
