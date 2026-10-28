import { NextResponse } from "next/server";
import { authorizeTenantRequest, integrationErrorResponse } from "@/lib/integrations/request";
import { validateAssessmentPayload } from "@/lib/integrations/payload";
import { upsertIntegrationAssessment } from "@/lib/integrations/store";

export const runtime = "nodejs";

// Idempotent upsert of an assessment shell (name, examination, window, duration) from the institution system.
// Questions and sections are then authored in the portal by the institution's staff.
export async function PUT(request: Request) {
  try {
    const { body } = await authorizeTenantRequest(request, "assessments:write");
    const assessment = validateAssessmentPayload(body);
    const { assessmentId, created } = await upsertIntegrationAssessment(assessment);
    return NextResponse.json({
      ok: true, result: created ? "created" : "updated", external_assessment_id: assessment.externalAssessmentId,
      assessment_id: assessmentId, status: assessment.active ? "active" : "inactive",
    }, { status: created ? 201 : 200 });
  } catch (error) {
    return integrationErrorResponse(error, "Failed to upsert integration assessment");
  }
}
