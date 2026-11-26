import { NextResponse } from "next/server";
import { handleIntegrationRequest } from "@/lib/integration-handler";
import { loadCandidateForm } from "@/lib/integrations/store";

export const runtime = "nodejs";

// The Add Candidate form as defined in the portal, so the institution system can show the same fields and choices.
export async function GET(request: Request) {
  return handleIntegrationRequest(request, async (client) => {
    const externalStudentId = new URL(request.url).searchParams.get("external_student_id")?.trim().slice(0, 100) ?? "";
    return NextResponse.json(
      { ok: true, ...await loadCandidateForm(client.tenantId, externalStudentId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
