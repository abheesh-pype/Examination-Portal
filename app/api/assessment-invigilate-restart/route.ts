import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth";
import { databasePool } from "@/lib/db";
import { ensureExamAttemptTableOnce, finalizeAttempt, type AttemptRow } from "@/lib/exam-attempts";

export const runtime = "nodejs";

async function ensureRestartAssignmentTable() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment_candidate_invigilator (
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES "Candidate Information"(id) ON DELETE CASCADE,
      invigilator_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (assessment_id, candidate_id)
    )
  `);
}

export async function POST(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    if (!authorization.user) {
      return NextResponse.json({ error: "A staff account is required to restart an examination." }, { status: 403 });
    }

    const body = await request.json() as { assessmentId?: unknown; candidateId?: unknown };
    const assessmentId = Number(body.assessmentId);
    const candidateId = Number(body.candidateId);
    if (!Number.isInteger(assessmentId) || assessmentId <= 0
      || !Number.isInteger(candidateId) || candidateId <= 0) {
      return NextResponse.json({ error: "Valid assessment and candidate ids are required." }, { status: 400 });
    }

    await ensureRestartAssignmentTable();
    await ensureExamAttemptTableOnce();
    const client = await databasePool.connect();
    let transactionStarted = false;
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [assessmentId, candidateId]);

      if (!authorization.user.isAdmin) {
        const assignment = await client.query(`
          SELECT 1
          FROM assessment_candidate_invigilator
          WHERE assessment_id = $1
            AND candidate_id = $2
            AND invigilator_user_id = $3
        `, [assessmentId, candidateId, authorization.user.id]);
        if (!assignment.rowCount) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return NextResponse.json({ error: "You are not assigned to invigilate this candidate." }, { status: 403 });
        }
      }

      const result = await client.query(`
        SELECT id, assessment_id, candidate_id, status, answers, questions_snapshot,
               selfie_photo, id_photo, started_at, deadline_at, submitted_at
        FROM assessment_candidate_attempts
        WHERE assessment_id = $1 AND candidate_id = $2
        FOR UPDATE
      `, [assessmentId, candidateId]);
      const attempt = result.rows[0] as AttemptRow | undefined;
      if (!attempt) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "This candidate has not started the examination." }, { status: 404 });
      }
      if (attempt.status !== "in_progress") {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "Only an in-progress examination can be restarted." }, { status: 409 });
      }

      const timing = await client.query(`
        SELECT NOW() AS server_time,
               GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (deadline_at - NOW()))))::int AS remaining_seconds
        FROM assessment_candidate_attempts
        WHERE id = $1
      `, [attempt.id]);
      const remainingSeconds = Number(timing.rows[0].remaining_seconds);
      if (remainingSeconds <= 0) {
        const submittedAt = await finalizeAttempt(client, attempt, "expired");
        await client.query("COMMIT");
        transactionStarted = false;
        return NextResponse.json({
          error: "The examination time has expired; its saved answers were finalized instead of restarting.",
          submitted_at: submittedAt,
        }, { status: 409 });
      }

      const restarted = await client.query(`
        UPDATE assessment_candidate_attempts
        SET answers = '{}'::jsonb,
            started_at = GREATEST(NOW(), started_at + INTERVAL '1 millisecond')
        WHERE id = $1 AND status = 'in_progress'
        RETURNING started_at, deadline_at
      `, [attempt.id]);
      await client.query("COMMIT");
      transactionStarted = false;
      return NextResponse.json({
        restarted: true,
        started_at: restarted.rows[0].started_at,
        deadline_at: restarted.rows[0].deadline_at,
        remaining_seconds: remainingSeconds,
      });
    } catch (error) {
      if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Failed to restart candidate examination", error);
    return NextResponse.json({ error: "Unable to restart this candidate's examination." }, { status: 500 });
  }
}
