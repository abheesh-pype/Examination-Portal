import { NextResponse } from "next/server";
import { handleIntegrationRequest } from "@/lib/integration-handler";
import { loadAssessmentForm } from "@/lib/integrations/store";

export const runtime = "nodejs";

// The assessment form's choices as defined in the portal, plus what is stored for this assessment, if anything.
export async function GET(request: Request) {
  return handleIntegrationRequest(request, async (client) => {
    const externalAssessmentId = new URL(request.url).searchParams.get("external_assessment_id")?.trim().slice(0, 100) ?? "";
    return NextResponse.json(
      { ok: true, ...await loadAssessmentForm(client.tenantId, externalAssessmentId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
