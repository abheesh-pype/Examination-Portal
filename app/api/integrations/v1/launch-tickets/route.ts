import { NextResponse } from "next/server";
import { IntegrationError, loadTenants, verifyBearerToken } from "@/lib/integrations/tokens";
import { peekTenantId } from "@/lib/integrations/payload";
import { createLaunchTicket, LAUNCH_TICKET_TTL_SECONDS } from "@/lib/integrations/store";
import { loadIssuerConfig, publicKeySet } from "@/lib/integrations/issuer";

export const runtime = "nodejs";

const LAUNCH_SCOPE = "students:launch";

// Machine-to-machine: the institution system (after authenticating the student itself) asks for a single-use,
// 60-second link that signs that provisioned student in. The student never types credentials here.
export async function POST(request: Request) {
  try {
    const { tenants } = loadTenants();
    const publicUrl = (process.env.PORTAL_PUBLIC_URL ?? process.env.INTEGRATION_ISSUER_URL ?? "").trim().replace(/\/$/, "");
    if (tenants.length === 0 || !publicUrl) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });

    let body: { tenant_id?: unknown; external_student_id?: unknown };
    try { body = JSON.parse(await request.text()); } catch { return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 }); }
    const tenant = tenants.find((entry) => entry.tenantId === peekTenantId(body));
    if (!tenant) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });

    const issuer = tenant.builtin ? loadIssuerConfig() : null;
    if (tenant.builtin && !issuer) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
    const localKeys = issuer ? await publicKeySet(issuer) : null;
    await verifyBearerToken(request.headers.get("authorization"), tenant, localKeys ? () => localKeys : undefined, LAUNCH_SCOPE);

    const externalStudentId = typeof body.external_student_id === "string" ? body.external_student_id.trim() : "";
    if (!externalStudentId || externalStudentId.length > 100) return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
    const ticket = await createLaunchTicket(tenant.tenantId, externalStudentId);
    if (!ticket) return NextResponse.json({ ok: false, error: "student_not_found", message: "Student is not provisioned or is inactive" }, { status: 404 });
    return NextResponse.json({ ok: true, launch_url: `${publicUrl}/api/auth/launch?ticket=${ticket}`, expires_in: LAUNCH_TICKET_TTL_SECONDS });
  } catch (error) {
    if (error instanceof IntegrationError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, {
        status: error.status, headers: error.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined,
      });
    }
    console.error("Failed to create launch ticket", error);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
