import { NextResponse } from "next/server";
import { optionalDate, validateAssessmentConfiguration } from "@/lib/assessment-validation";
import { databasePool } from "@/lib/db";
import { handleIntegrationRequest, readJsonObject } from "@/lib/integration-handler";
import { ensureIntegrationSchema, integrationError } from "@/lib/integrations";

export const runtime = "nodejs";

type AssessmentInput = {
  externalAssessmentId: string;
  name: string;
  examination: string;
  startDate: string | null;
  endDate: string | null;
  totalTime: number | null;
  active: boolean;
};

function parseAssessment(body: Record<string, unknown>): AssessmentInput | string[] {
  const errors: string[] = [];
  const text = (value: unknown, maxLength: number) =>
    typeof value === "string" && value.trim() && value.trim().length <= maxLength ? value.trim() : null;
  const externalAssessmentId = text(body.external_assessment_id, 128);
  const name = text(body.name, 300);
  const examination = text(body.examination, 300);
  if (!externalAssessmentId) errors.push("external_assessment_id must be a non-empty string of at most 128 characters.");
  if (!name) errors.push("name is required.");
  if (!examination) errors.push("examination is required.");
  if (body.status !== "active" && body.status !== "inactive") errors.push('status must be "active" or "inactive".');

  for (const key of ["start_date", "end_date"] as const) {
    const value = body[key];
    if (value !== undefined && value !== null && (typeof value !== "string" || !optionalDate(value))) {
      errors.push(`${key} must be an ISO 8601 date-time.`);
    }
  }
  const totalTime = body.total_time;
  if (totalTime !== undefined && totalTime !== null
    && (typeof totalTime !== "number" || !Number.isInteger(totalTime) || totalTime < 1)) {
    errors.push("total_time must be a positive whole number of minutes.");
  }
  // Reuse the portal's own assessment rules (for example end_date after start_date).
  errors.push(...validateAssessmentConfiguration({
    start_date: body.start_date,
    end_date: body.end_date,
    total_time: typeof totalTime === "number" ? String(totalTime) : undefined,
  }));

  if (errors.length) return [...new Set(errors)];
  return {
    externalAssessmentId: externalAssessmentId!,
    name: name!,
    examination: examination!,
    startDate: optionalDate(body.start_date),
    endDate: optionalDate(body.end_date),
    totalTime: typeof totalTime === "number" ? totalTime : null,
    active: body.status === "active",
  };
}

export async function PUT(request: Request) {
  return handleIntegrationRequest(request, async (client) => {
    const { body } = await readJsonObject(request);
    if (!body) return integrationError(400, "invalid_request", "The request body must be a JSON object.");
    const input = parseAssessment(body);
    if (Array.isArray(input)) return integrationError(422, "invalid_assessment", input.join(" "));

    await ensureIntegrationSchema();
    const db = await databasePool.connect();
    let transactionStarted = false;
    try {
      await db.query("BEGIN");
      transactionStarted = true;
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`ums-assessment\n${client.tenantId}\n${input.externalAssessmentId}`]);
      // Sections, questions and marks stay authored in the portal and are never overwritten here.
      const updated = await db.query(`
        UPDATE assessment
        SET name = $3, examination = $4, start_date = $5, end_date = $6, total_time = $7, status = $8
        WHERE tenant_id = $1 AND external_assessment_id = $2
        RETURNING id
      `, [client.tenantId, input.externalAssessmentId, input.name, input.examination,
        input.startDate, input.endDate, input.totalTime, input.active]);
      let assessmentId: number;
      let status = 200;
      if (updated.rowCount) {
        assessmentId = Number(updated.rows[0].id);
      } else {
        const inserted = await db.query(`
          INSERT INTO assessment (examination, name, start_date, end_date, total_time, sections, status, tenant_id, external_assessment_id)
          VALUES ($1, $2, $3, $4, $5, '[]'::jsonb, $6, $7, $8)
          RETURNING id
        `, [input.examination, input.name, input.startDate, input.endDate, input.totalTime, input.active,
          client.tenantId, input.externalAssessmentId]);
        assessmentId = Number(inserted.rows[0].id);
        status = 201;
      }
      await db.query("COMMIT");
      transactionStarted = false;
      return NextResponse.json({
        ok: true,
        assessment_id: assessmentId,
        external_assessment_id: input.externalAssessmentId,
      }, { status });
    } catch (error) {
      if (transactionStarted) await db.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      db.release();
    }
  });
}
