import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { handleIntegrationRequest, readJsonObject } from "@/lib/integration-handler";
import {
  ensureIntegrationSchema,
  integrationError,
  runIdempotent,
  sha256Hex,
} from "@/lib/integrations/m2m";
import { validateStudentPayload } from "@/lib/integrations/payload";
import { provisionStudentInTransaction } from "@/lib/integrations/store";

export const runtime = "nodejs";

const ROUTE = "/api/integrations/v1/students";

// Machine-to-machine receiver. Authenticated only by an OAuth bearer token (see authorizeIntegrationRequest);
// it never uses or accepts browser sessions or cookies.
export async function POST(request: Request) {
  return handleIntegrationRequest(request, async (client) => {
    const { text, body } = await readJsonObject(request);
    if (!body) return integrationError(400, "invalid_request", "The request body must be a JSON object.");
    const student = validateStudentPayload(body);

    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || undefined;
    if (idempotencyKey && idempotencyKey.length > 255) {
      return integrationError(400, "invalid_request", "Idempotency-Key must be at most 255 characters.");
    }

    await ensureIntegrationSchema();
    const db = await databasePool.connect();
    let transactionStarted = false;
    try {
      await db.query("BEGIN");
      transactionStarted = true;
      const outcome = await runIdempotent(
        db,
        { clientId: client.clientId, route: ROUTE, key: idempotencyKey ?? null, requestHash: sha256Hex(text) },
        async () => {
          const result = await provisionStudentInTransaction(db, student, idempotencyKey);
          return {
            status: result.created ? 201 : 200,
            body: {
              ok: true,
              result: result.created ? "created" : "updated",
              external_student_id: student.externalStudentId,
              candidate_id: result.candidateId,
              status: result.status,
              assigned_assessments: result.assigned,
              unmapped_assessments: result.unmappedAssessmentIds,
            },
          };
        },
      );
      await db.query("COMMIT");
      transactionStarted = false;
      return NextResponse.json(outcome.body, { status: outcome.status });
    } catch (error) {
      if (transactionStarted) await db.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      db.release();
    }
  });
}
