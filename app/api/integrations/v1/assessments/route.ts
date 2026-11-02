import { NextResponse } from "next/server";
import { validateAssessmentConfiguration } from "@/lib/assessment-validation";
import { handleIntegrationRequest, readJsonObject } from "@/lib/integration-handler";
import { integrationError } from "@/lib/integrations/m2m";
import { validateAssessmentPayload } from "@/lib/integrations/payload";
import { upsertIntegrationAssessment } from "@/lib/integrations/store";

export const runtime = "nodejs";

// Idempotent upsert of an assessment shell (name, examination, window, duration) from the institution system.
// Questions and sections are then authored in the portal by the institution's staff.
export async function PUT(request: Request) {
  return handleIntegrationRequest(request, async () => {
    const { body } = await readJsonObject(request);
    if (!body) return integrationError(400, "invalid_request", "The request body must be a JSON object.");
    const assessment = validateAssessmentPayload(body);
    // Reuse the portal's own assessment rules on top of the payload checks.
    const configurationErrors = validateAssessmentConfiguration({
      start_date: assessment.startDate ?? undefined,
      end_date: assessment.endDate ?? undefined,
      total_time: assessment.totalTime === null ? undefined : String(assessment.totalTime),
    });
    if (configurationErrors.length) return integrationError(422, "invalid_assessment", configurationErrors.join(" "));

    const { assessmentId, created } = await upsertIntegrationAssessment(assessment);
    return NextResponse.json({
      ok: true,
      result: created ? "created" : "updated",
      assessment_id: assessmentId,
      external_assessment_id: assessment.externalAssessmentId,
      status: assessment.active ? "active" : "inactive",
    }, { status: created ? 201 : 200 });
  });
}
