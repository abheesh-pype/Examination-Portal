import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth";
import { databasePool } from "@/lib/db";

export const runtime = "nodejs";

async function ensureIndividualCandidateAssignments() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment_candidate_direct_assignment (
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES "Candidate Information"(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (assessment_id, candidate_id)
    )
  `);
}

export async function PUT(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    if (!authorization.user?.isAdmin) {
      return NextResponse.json({ error: "Only administrators can assign candidates to assessments." }, { status: 403 });
    }

    const body = await request.json() as { assessment_id?: unknown; candidate_ids?: unknown };
    const assessmentId = Number(body.assessment_id);
    if (!Number.isInteger(assessmentId) || assessmentId <= 0) {
      return NextResponse.json({ error: "A valid assessment id is required." }, { status: 400 });
    }
    if (!Array.isArray(body.candidate_ids)
      || body.candidate_ids.some((id) => !Number.isInteger(id) || Number(id) <= 0)) {
      return NextResponse.json({ error: "Candidate ids must be positive whole numbers." }, { status: 400 });
    }
    if (body.candidate_ids.length < 1 || body.candidate_ids.length > 1000) {
      return NextResponse.json({ error: "Upload between 1 and 1000 candidate assignments at a time." }, { status: 400 });
    }

    const candidateIds = [...new Set(body.candidate_ids as number[])];
    await ensureIndividualCandidateAssignments();
    const client = await databasePool.connect();
    let transactionStarted = false;
    try {
      await client.query("BEGIN");
      transactionStarted = true;

      const assessmentResult = await client.query(
        "SELECT id FROM assessment WHERE id = $1 AND status = TRUE FOR SHARE",
        [assessmentId],
      );
      if (!assessmentResult.rowCount) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "Assessment not found or inactive." }, { status: 404 });
      }

      const candidateResult = await client.query(`
        SELECT id
        FROM "Candidate Information"
        WHERE record_type = 'candidate'
          AND status = TRUE
          AND id = ANY($1::int[])
        FOR SHARE
      `, [candidateIds]);
      if (candidateResult.rowCount !== candidateIds.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "One or more candidates are missing or inactive." }, { status: 400 });
      }

      const assignmentResult = await client.query(`
        INSERT INTO assessment_candidate_direct_assignment (assessment_id, candidate_id)
        SELECT $1, selected_id FROM unnest($2::int[]) AS selected_id
        ON CONFLICT (assessment_id, candidate_id) DO NOTHING
      `, [assessmentId, candidateIds]);

      await client.query("COMMIT");
      transactionStarted = false;
      return NextResponse.json({
        assessment_id: assessmentId,
        assigned: candidateIds.length,
        newly_assigned: assignmentResult.rowCount ?? 0,
        candidate_ids: candidateIds,
      });
    } catch (error) {
      if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Failed to assign candidates directly to assessment", error);
    return NextResponse.json({ error: "Unable to assign candidates to this assessment." }, { status: 500 });
  }
}
