import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { handleIntegrationRequest, readJsonObject } from "@/lib/integration-handler";
import {
  createLaunchTicket,
  ensureIntegrationSchema,
  getPortalOrigin,
  integrationError,
} from "@/lib/integrations";

export const runtime = "nodejs";

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

    await ensureIntegrationSchema();
    const candidate = await databasePool.query(`
      SELECT id
      FROM "Candidate Information"
      WHERE record_type = 'candidate' AND status = TRUE
        AND tenant_id = $1 AND external_student_id = $2
    `, [client.tenantId, externalStudentId]);
    if (!candidate.rowCount) {
      return integrationError(404, "student_not_found", "The student has not been provisioned or is inactive.");
    }

    const db = await databasePool.connect();
    try {
      const { ticket, expiresAt } = await createLaunchTicket(db, client, "candidate", Number(candidate.rows[0].id));
      return NextResponse.json({
        ok: true,
        launch_url: `${origin}/launch?ticket=${ticket}`,
        expires_at: expiresAt.toISOString(),
      }, { headers: { "Cache-Control": "no-store" } });
    } finally {
      db.release();
    }
  });
}
