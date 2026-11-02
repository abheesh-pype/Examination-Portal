import { NextResponse } from "next/server";
import { calculateResult } from "@/lib/assessment-marks";
import { isCandidateIdFieldName } from "@/lib/candidate-ids";
import { databasePool } from "@/lib/db";
import { handleIntegrationRequest } from "@/lib/integration-handler";
import { ensureIntegrationSchema, integrationError } from "@/lib/integrations";

export const runtime = "nodejs";

function getCandidateCode(candidateData: unknown) {
  const fields = candidateData && typeof candidateData === "object" && !Array.isArray(candidateData)
    ? (candidateData as { fields?: unknown }).fields
    : null;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return null;
  const entry = Object.entries(fields).find(([name, value]) =>
    isCandidateIdFieldName(name) && typeof value === "string" && /^\d{6}$/.test(value.trim()));
  return entry ? String(entry[1]).trim() : null;
}

export async function GET(request: Request) {
  return handleIntegrationRequest(request, async (client) => {
    const searchParams = new URL(request.url).searchParams;
    const externalAssessmentId = searchParams.get("external_assessment_id")?.trim() ?? "";
    if (!externalAssessmentId || externalAssessmentId.length > 128) {
      return integrationError(400, "invalid_request", "external_assessment_id is required.");
    }
    const sinceText = searchParams.get("since")?.trim();
    const since = sinceText ? new Date(sinceText) : null;
    if (since && Number.isNaN(since.getTime())) {
      return integrationError(400, "invalid_request", "since must be an ISO 8601 date-time.");
    }

    await ensureIntegrationSchema();
    const assessment = await databasePool.query(`
      SELECT id
      FROM assessment
      WHERE tenant_id = $1 AND external_assessment_id = $2
    `, [client.tenantId, externalAssessmentId]);
    if (!assessment.rowCount) {
      return integrationError(404, "assessment_not_found", "No assessment is published with that external_assessment_id.");
    }

    // Only marks leave the portal: no answers, photos or free-form candidate fields.
    const result = await databasePool.query(`
      SELECT assessment.sections,
             assessment.pass_mark,
             candidate.external_student_id,
             candidate.candidate_data,
             submission.answers,
             submission.questions_snapshot,
             submission.manual_marks,
             submission.evaluated_at
      FROM assessment_candidate_submissions AS submission
      JOIN assessment ON assessment.id = submission.assessment_id
      JOIN "Candidate Information" AS candidate
        ON candidate.id = submission.candidate_id
       AND candidate.record_type = 'candidate'
       AND candidate.tenant_id = $1
       AND candidate.external_student_id IS NOT NULL
      WHERE assessment.id = $2
        AND assessment.results_published = TRUE
        AND submission.evaluated_at IS NOT NULL
        AND ($3::timestamptz IS NULL OR submission.evaluated_at >= $3::timestamptz)
      ORDER BY submission.evaluated_at ASC, candidate.id ASC
    `, [client.tenantId, Number(assessment.rows[0].id), since?.toISOString() ?? null]);

    return NextResponse.json({
      ok: true,
      results: result.rows.map((row) => {
        const marks = calculateResult(row.sections, row.questions_snapshot, row.answers, row.manual_marks);
        const passMark = row.pass_mark === null || row.pass_mark === undefined ? null : Number(row.pass_mark);
        return {
          external_assessment_id: externalAssessmentId,
          external_student_id: String(row.external_student_id),
          candidate_id: getCandidateCode(row.candidate_data),
          obtained_mark: marks.obtainedMark,
          negative_mark: marks.negativeMark,
          total_mark: marks.totalMark,
          pass_mark: passMark,
          passed: passMark === null ? null : marks.obtainedMark >= passMark,
          evaluated_at: new Date(row.evaluated_at).toISOString(),
        };
      }),
    });
  });
}
