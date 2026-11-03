import { NextResponse } from "next/server";
import { handleIntegrationRequest } from "@/lib/integration-handler";
import { listAssignableRoles } from "@/lib/integrations/store";

export const runtime = "nodejs";

// The portal roles the institution system can assign to its users (e.g. Administrator, Evaluator, Invigilator).
export async function GET(request: Request) {
  return handleIntegrationRequest(request, async () => NextResponse.json(
    { ok: true, roles: await listAssignableRoles() },
    { headers: { "Cache-Control": "no-store" } },
  ));
}
