import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth";
import { loadTenants } from "@/lib/integrations/tokens";
import { mapAssessment } from "@/lib/integrations/store";

export const runtime = "nodejs";

// Administrator override for the automatic (examination + name) match of an external assessment id.
export async function PUT(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    if (!authorization.user?.isAdmin) return NextResponse.json({ error: "Only administrators can map assessments." }, { status: 403 });

    const body = await request.json() as { tenant_id?: unknown; external_assessment_id?: unknown; assessment_id?: unknown };
    const tenantId = typeof body.tenant_id === "string" ? body.tenant_id.trim() : "";
    const externalId = typeof body.external_assessment_id === "string" || typeof body.external_assessment_id === "number" ? String(body.external_assessment_id).trim() : "";
    const assessmentId = Number(body.assessment_id);
    if (!loadTenants().tenants.some((tenant) => tenant.tenantId === tenantId)) return NextResponse.json({ error: "Unknown tenant." }, { status: 404 });
    if (!externalId || externalId.length > 100 || !Number.isInteger(assessmentId) || assessmentId <= 0) {
      return NextResponse.json({ error: "tenant_id, external_assessment_id and a valid assessment_id are required." }, { status: 400 });
    }
    const result = await mapAssessment(tenantId, externalId, assessmentId);
    if (!result) return NextResponse.json({ error: "Assessment not found or inactive." }, { status: 404 });
    return NextResponse.json({ ok: true, updated_students: result.updatedStudents });
  } catch (error) {
    console.error("Failed to map integration assessment", error);
    return NextResponse.json({ error: "Unable to save the mapping." }, { status: 500 });
  }
}
