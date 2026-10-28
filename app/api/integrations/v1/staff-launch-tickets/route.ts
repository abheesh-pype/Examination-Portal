import { NextResponse } from "next/server";
import { authorizeTenantRequest, integrationErrorResponse } from "@/lib/integrations/request";
import { validateStaffPayload } from "@/lib/integrations/payload";
import { createStaffLaunchTicket, LAUNCH_TICKET_TTL_SECONDS, provisionStaff, StaffConflictError } from "@/lib/integrations/store";

export const runtime = "nodejs";

// The institution system (after authenticating its own staff member, e.g. an Academic Admin) asks for a single-use,
// 60-second link that signs that person into the portal with the restricted "UMS Academic Staff" role.
export async function POST(request: Request) {
  try {
    const publicUrl = (process.env.PORTAL_PUBLIC_URL ?? process.env.INTEGRATION_ISSUER_URL ?? "").trim().replace(/\/$/, "");
    if (!publicUrl) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
    const { tenant, body } = await authorizeTenantRequest(request, "staff:launch");
    const staff = validateStaffPayload(body);
    await provisionStaff(staff);
    const ticket = await createStaffLaunchTicket(tenant.tenantId, staff.externalUserId);
    return NextResponse.json({ ok: true, launch_url: `${publicUrl}/api/auth/launch?ticket=${ticket}`, expires_in: LAUNCH_TICKET_TTL_SECONDS });
  } catch (error) {
    if (error instanceof StaffConflictError) {
      return NextResponse.json({ ok: false, error: "account_conflict", message: error.message }, { status: 409 });
    }
    return integrationErrorResponse(error, "Failed to create staff launch ticket");
  }
}
