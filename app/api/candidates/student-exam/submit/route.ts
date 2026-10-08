import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { authorizeApiRequest } from "@/lib/auth";
import {
  ensureExamAttemptTableOnce,
  finalizeAttempt,
  type AttemptRow,
  validateAttemptAnswer,
} from "@/lib/exam-attempts";

export const runtime = "nodejs";

async function createSubmissionTables() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment (
      id SERIAL PRIMARY KEY,
      examination TEXT NOT NULL,
      name TEXT NOT NULL,
      start_date TIMESTAMPTZ,
      end_date TIMESTAMPTZ,
      total_time INTEGER,
      last_login INTEGER,
      question_category TEXT,
      sub_category TEXT,
      topic TEXT,
      question_language TEXT,
      sections JSONB NOT NULL DEFAULT '[]'::jsonb,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS "Candidate Information" (
      id SERIAL PRIMARY KEY,
      record_type TEXT NOT NULL DEFAULT 'field',
      name TEXT NOT NULL,
      column_type TEXT NOT NULL,
      is_dependent BOOLEAN NOT NULL DEFAULT FALSE,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      is_required BOOLEAN NOT NULL DEFAULT FALSE,
      min_value NUMERIC,
      max_value NUMERIC,
      options JSONB,
      dependent_on TEXT,
      date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      candidate_data JSONB
    )
  `);
  await databasePool.query('ALTER TABLE "Candidate Information" ADD COLUMN IF NOT EXISTS record_type TEXT NOT NULL DEFAULT \'field\'');
  await databasePool.query('ALTER TABLE "Candidate Information" ADD COLUMN IF NOT EXISTS candidate_data JSONB');
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
  await ensureExamAttemptTableOnce();
}

let submissionTablesPromise: Promise<void> | undefined;

function ensureSubmissionTables() {
  if (!submissionTablesPromise) {
    submissionTablesPromise = createSubmissionTables().catch((error: unknown) => {
      submissionTablesPromise = undefined;
      throw error;
    });
  }
  return submissionTablesPromise;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function POST(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as { assessmentId?: unknown; answers?: unknown; attemptStartedAt?: unknown };
    const assessmentId = Number(body.assessmentId);
    if (!Number.isInteger(assessmentId) || assessmentId <= 0
      || typeof body.attemptStartedAt !== "string"
      || !Number.isFinite(Date.parse(body.attemptStartedAt))) {
      return NextResponse.json({ error: "A valid assessment is required." }, { status: 400 });
    }

    await ensureSubmissionTables();
    const candidateId = authorization.candidate?.id ?? 0;
    const client = await databasePool.connect();
    let transactionStarted = false;
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [assessmentId, candidateId]);
      const result = await client.query(`
        SELECT id, assessment_id, candidate_id, status, answers, questions_snapshot,
               selfie_photo, id_photo, started_at, deadline_at, submitted_at,
               deadline_at <= NOW() AS deadline_passed
        FROM assessment_candidate_attempts
        WHERE assessment_id = $1 AND candidate_id = $2
        FOR UPDATE
      `, [assessmentId, candidateId]);
      const attempt = result.rows[0] as (AttemptRow & { deadline_passed: boolean }) | undefined;
      if (!attempt) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "No active examination attempt was found." }, { status: 404 });
      }
      if (new Date(attempt.started_at).getTime() !== Date.parse(body.attemptStartedAt)) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "This examination was restarted. Reload the current attempt before submitting." }, { status: 409 });
      }
      if (attempt.status !== "in_progress") {
        await client.query("COMMIT");
        transactionStarted = false;
        return NextResponse.json({
          submitted: true,
          already_submitted: true,
          submitted_at: attempt.submitted_at,
          status: attempt.status,
        });
      }

      const finalAnswers = { ...attempt.answers };
      if (body.answers !== undefined) {
        if (!isRecord(body.answers)) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return NextResponse.json({ error: "Submitted answers must be an object." }, { status: 400 });
        }
        const attemptQuestions = new Map(attempt.questions_snapshot.map((question) => [question.id, question]));
        for (const [questionIdText, answer] of Object.entries(body.answers)) {
          const questionId = Number(questionIdText);
          if (!/^[1-9]\d*$/.test(questionIdText) || !Number.isSafeInteger(questionId)) {
            await client.query("ROLLBACK");
            transactionStarted = false;
            return NextResponse.json({ error: "A submitted answer has an invalid question ID." }, { status: 400 });
          }
          const question = attemptQuestions.get(questionId);
          if (!question) {
            await client.query("ROLLBACK");
            transactionStarted = false;
            return NextResponse.json({ error: "A submitted answer does not belong to this attempt." }, { status: 400 });
          }
          const answerError = validateAttemptAnswer(question, answer);
          if (answerError) {
            await client.query("ROLLBACK");
            transactionStarted = false;
            return NextResponse.json({ error: answerError }, { status: 400 });
          }
          finalAnswers[questionIdText] = answer;
        }
      }

      const status = attempt.deadline_passed ? "expired" : "submitted";
      const submittedAt = await finalizeAttempt(client, attempt, status, finalAnswers);
      if (!submittedAt) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "This examination attempt has already been finalized." }, { status: 409 });
      }
      await client.query("COMMIT");
      transactionStarted = false;
      return NextResponse.json({
        submitted: true,
        submitted_at: submittedAt,
        expired: status === "expired",
      });
    } catch (error) {
      if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Failed to finalize student examination attempt", error);
    return NextResponse.json({ error: "Unable to submit your assessment." }, { status: 500 });
  }
}
