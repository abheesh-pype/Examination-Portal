import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth";
import { databasePool } from "@/lib/db";
import { ensureExamAttemptTableOnce } from "@/lib/exam-attempts";
import { ensureExamTimelineTable, recordExamTimelineEvent } from "@/lib/exam-timeline";

export const runtime = "nodejs";

async function ensureSubmissionTable() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment_candidate_submissions (
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES "Candidate Information"(id) ON DELETE CASCADE,
      answers JSONB NOT NULL DEFAULT '{}'::jsonb,
      questions_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
      selfie_photo TEXT NOT NULL,
      id_photo TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      evaluated_at TIMESTAMPTZ,
      obtained_mark NUMERIC,
      manual_marks JSONB NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (assessment_id, candidate_id)
    )
  `);
  await databasePool.query(`
    ALTER TABLE assessment_candidate_submissions
    ADD COLUMN IF NOT EXISTS questions_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
}

export async function POST(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    if (!authorization.user?.isAdmin) {
      return NextResponse.json({ error: "Only administrators can end a candidate's examination." }, { status: 403 });
    }

    const body = await request.json() as { assessmentId?: unknown; candidateId?: unknown };
    const assessmentId = Number(body.assessmentId);
    const candidateId = Number(body.candidateId);
    if (!Number.isInteger(assessmentId) || assessmentId <= 0
      || !Number.isInteger(candidateId) || candidateId <= 0) {
      return NextResponse.json({ error: "Valid assessment and candidate ids are required." }, { status: 400 });
    }

    await ensureExamAttemptTableOnce();
    await ensureExamTimelineTable();
    await ensureSubmissionTable();
    const client = await databasePool.connect();
    let transactionStarted = false;
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [assessmentId, candidateId]);
      const result = await client.query(`
        SELECT id, status
        FROM assessment_candidate_attempts
        WHERE assessment_id = $1 AND candidate_id = $2
        FOR UPDATE
      `, [assessmentId, candidateId]);
      const attempt = result.rows[0] as { id: number; status: string } | undefined;
      if (!attempt) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "This candidate has not started the examination." }, { status: 404 });
      }
      if (attempt.status !== "in_progress") {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "Only an in-progress examination can be ended." }, { status: 409 });
      }

      await client.query(
        "DELETE FROM assessment_candidate_submissions WHERE assessment_id = $1 AND candidate_id = $2",
        [assessmentId, candidateId],
      );
      await client.query("DELETE FROM assessment_candidate_attempts WHERE id = $1", [attempt.id]);
      await recordExamTimelineEvent(client, assessmentId, candidateId, "exam_quit", "invigilator");
      await client.query("COMMIT");
      transactionStarted = false;
      return NextResponse.json({ quit: true });
    } catch (error) {
      if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Failed to end candidate examination", error);
    return NextResponse.json({ error: "Unable to end this candidate's examination." }, { status: 500 });
  }
}
