import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { authorizeApiRequest } from "@/lib/auth";
import {
  attemptQuestionResponse,
  buildAttemptQuestionSet,
  ensureExamAttemptTableOnce,
  finalizeAttempt,
  type AttemptRow,
  validateAttemptAnswer,
} from "@/lib/exam-attempts";
import { ensureExamTimelineTable, recordExamTimelineEvent } from "@/lib/exam-timeline";

export const runtime = "nodejs";

const photoPattern = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

async function createStudentExamTables() {
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
    CREATE TABLE IF NOT EXISTS candidate_sub_category (
      id SERIAL PRIMARY KEY,
      candidate_sub_category TEXT NOT NULL,
      category TEXT NOT NULL,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment_candidate_sub_category (
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_sub_category_id INTEGER NOT NULL REFERENCES candidate_sub_category(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (assessment_id, candidate_sub_category_id)
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS questions (
      id SERIAL PRIMARY KEY,
      question_type TEXT NOT NULL,
      question TEXT NOT NULL,
      category TEXT,
      sub_category TEXT,
      topic TEXT,
      difficulty_level TEXT,
      language TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
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
  await ensureExamTimelineTable();
}

let studentExamTablesPromise: Promise<void> | undefined;

function ensureStudentExamTables() {
  if (!studentExamTablesPromise) {
    studentExamTablesPromise = createStudentExamTables().catch((error: unknown) => {
      studentExamTablesPromise = undefined;
      throw error;
    });
  }
  return studentExamTablesPromise;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function buildResponse(attempt: AttemptRow, serverTime: Date | string) {
  return {
    attempt_id: Number(attempt.id),
    assessment: { id: Number(attempt.assessment_id) },
    started_at: new Date(attempt.started_at).toISOString(),
    deadline_at: new Date(attempt.deadline_at).toISOString(),
    server_time: new Date(serverTime).toISOString(),
    answers: attempt.answers,
    sections: attemptQuestionResponse(attempt),
  };
}

export async function GET(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const assessmentId = Number(new URL(request.url).searchParams.get("assessmentId"));
    if (!Number.isInteger(assessmentId) || assessmentId <= 0) {
      return NextResponse.json({ error: "A valid assessment is required." }, { status: 400 });
    }
    await ensureStudentExamTables();
    const result = await databasePool.query(`
      SELECT attempt.started_at, attempt.deadline_at, attempt.answers, attempt.status, NOW() AS server_time,
             EXISTS (
               SELECT 1
               FROM assessment_candidate_timeline_events AS quit_event
               WHERE quit_event.assessment_id = attempt.assessment_id
                 AND quit_event.candidate_id = attempt.candidate_id
                 AND quit_event.source = 'invigilator'
                 AND quit_event.event_type IN ('exam_quit', 'exam_submitted')
                 AND quit_event.occurred_at >= attempt.started_at
             ) AS ended_by_admin
      FROM assessment_candidate_attempts AS attempt
      WHERE attempt.assessment_id = $1 AND attempt.candidate_id = $2
    `, [assessmentId, authorization.candidate?.id ?? 0]);
    if (!result.rowCount) {
      const quitResult = await databasePool.query(`
        SELECT EXISTS (
          SELECT 1
          FROM assessment_candidate_timeline_events
          WHERE assessment_id = $1 AND candidate_id = $2
            AND source = 'invigilator'
            AND event_type IN ('exam_quit', 'exam_submitted')
        ) AS ended_by_admin
      `, [assessmentId, authorization.candidate?.id ?? 0]);
      return NextResponse.json({
        ended_by_admin: Boolean(quitResult.rows[0]?.ended_by_admin),
        error: "No active examination attempt was found.",
      }, { status: 404 });
    }
    return NextResponse.json(result.rows[0], {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch (error) {
    console.error("Failed to check student examination attempt state", error);
    return NextResponse.json({ error: "Unable to check the examination attempt state." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as {
      assessmentId?: unknown;
      selfiePhoto?: unknown;
      idPhoto?: unknown;
    };
    const assessmentId = Number(body.assessmentId);
    if (!Number.isInteger(assessmentId) || assessmentId <= 0) {
      return NextResponse.json({ error: "A valid assessment is required." }, { status: 400 });
    }

    const selfiePhoto = typeof body.selfiePhoto === "string" ? body.selfiePhoto : "";
    const idPhoto = typeof body.idPhoto === "string" ? body.idPhoto : "";
    if ((selfiePhoto && (!photoPattern.test(selfiePhoto) || selfiePhoto.length > 2_000_000))
      || (idPhoto && (!photoPattern.test(idPhoto) || idPhoto.length > 2_000_000))) {
      return NextResponse.json({ error: "Check-in photos must be valid JPEG images under 1.5 MB." }, { status: 400 });
    }

    await ensureStudentExamTables();
    const candidateId = authorization.candidate?.id ?? 0;
    const client = await databasePool.connect();
    let transactionStarted = false;
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [assessmentId, candidateId]);

      const timeResult = await client.query("SELECT NOW() AS server_time");
      const serverTime = new Date(timeResult.rows[0].server_time);
      const now = serverTime.getTime();
      const candidateResult = await client.query(`
        SELECT id, candidate_data
        FROM "Candidate Information"
        WHERE id = $1 AND record_type = 'candidate' AND status = TRUE
      `, [candidateId]);
      const candidate = candidateResult.rows[0];
      if (!candidate) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "The student session is no longer valid." }, { status: 401 });
      }

      const candidateData = isRecord(candidate.candidate_data) ? candidate.candidate_data : {};
      const category = typeof candidateData.category === "string" ? candidateData.category : "";
      const subCategory = typeof candidateData.sub_category === "string" ? candidateData.sub_category : "";
      if (!category || !subCategory) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "This student is not assigned to the assessment." }, { status: 403 });
      }

      const assessmentResult = await client.query(`
        SELECT id, name, start_date, end_date, total_time, last_login,
               question_category, sub_category, topic, question_language, sections
        FROM assessment
        WHERE id = $1 AND status = TRUE
        FOR SHARE
      `, [assessmentId]);
      const assessment = assessmentResult.rows[0];
      if (!assessment) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "Assessment not found or inactive." }, { status: 404 });
      }

      const assignment = await client.query(`
        SELECT 1
        FROM assessment_candidate_sub_category AS assignment
        JOIN candidate_sub_category AS candidate_group
          ON candidate_group.id = assignment.candidate_sub_category_id
        WHERE assignment.assessment_id = $1
          AND candidate_group.status = TRUE
          AND candidate_group.category = $2
          AND candidate_group.candidate_sub_category = $3
        LIMIT 1
      `, [assessmentId, category, subCategory]);
      if (!assignment.rowCount) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "This student is not assigned to the assessment." }, { status: 403 });
      }

      const legacyAdminQuit = await client.query(`
        SELECT EXISTS (
          SELECT 1
          FROM assessment_candidate_submissions AS submission
          JOIN assessment_candidate_timeline_events AS quit_event
            ON quit_event.assessment_id = submission.assessment_id
           AND quit_event.candidate_id = submission.candidate_id
           AND quit_event.source = 'invigilator'
           AND quit_event.event_type = 'exam_submitted'
           AND quit_event.occurred_at >= submission.submitted_at
          WHERE submission.assessment_id = $1 AND submission.candidate_id = $2
        ) AS was_quit
      `, [assessmentId, candidate.id]);
      if (legacyAdminQuit.rows[0]?.was_quit) {
        await client.query(
          "DELETE FROM assessment_candidate_submissions WHERE assessment_id = $1 AND candidate_id = $2",
          [assessmentId, candidate.id],
        );
        await client.query(
          "DELETE FROM assessment_candidate_attempts WHERE assessment_id = $1 AND candidate_id = $2",
          [assessmentId, candidate.id],
        );
      }

      const attemptResult = await client.query(`
        SELECT id, assessment_id, candidate_id, status, answers, questions_snapshot,
               selfie_photo, id_photo, started_at, deadline_at, submitted_at
        FROM assessment_candidate_attempts
        WHERE assessment_id = $1 AND candidate_id = $2
        FOR UPDATE
      `, [assessmentId, candidate.id]);
      const existingAttempt = attemptResult.rows[0] as AttemptRow | undefined;
      if (existingAttempt) {
        if (existingAttempt.status !== "in_progress") {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return NextResponse.json({ error: "This examination attempt has already been submitted." }, { status: 409 });
        }
        if (new Date(existingAttempt.deadline_at).getTime() <= now) {
          await finalizeAttempt(client, existingAttempt, "expired");
          await client.query("COMMIT");
          transactionStarted = false;
          return NextResponse.json({ error: "The examination deadline has passed; your saved answers were submitted." }, { status: 409 });
        }
        await recordExamTimelineEvent(client, assessmentId, candidate.id, "exam_resumed", "candidate");
        await client.query("COMMIT");
        transactionStarted = false;
        return NextResponse.json(buildResponse(existingAttempt, serverTime));
      }

      const priorSubmission = await client.query(
        "SELECT 1 FROM assessment_candidate_submissions WHERE assessment_id = $1 AND candidate_id = $2 LIMIT 1",
        [assessmentId, candidate.id],
      );
      if (priorSubmission.rowCount) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "This examination has already been submitted." }, { status: 409 });
      }

      const startTime = assessment.start_date ? new Date(assessment.start_date).getTime() : Number.NaN;
      const endTime = assessment.end_date ? new Date(assessment.end_date).getTime() : Number.POSITIVE_INFINITY;
      const loginDeadline = assessment.last_login !== null && Number(assessment.last_login) > 0
        ? startTime + Number(assessment.last_login) * 60_000
        : Number.POSITIVE_INFINITY;
      if (!Number.isFinite(startTime) || now < startTime || now >= Math.min(endTime, loginDeadline)) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "This assessment is outside its permitted attendance window." }, { status: 403 });
      }

      const durationMinutes = Number(assessment.total_time);
      const deadlines = [
        Number.isFinite(durationMinutes) && durationMinutes > 0
          ? now + durationMinutes * 60_000
          : Number.POSITIVE_INFINITY,
        endTime,
      ].filter(Number.isFinite);
      if (!deadlines.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "This assessment must have a valid duration or end time." }, { status: 409 });
      }
      const deadline = Math.min(...deadlines);
      if (deadline <= now) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "This assessment has no remaining examination time." }, { status: 403 });
      }
      if (!photoPattern.test(selfiePhoto) || !photoPattern.test(idPhoto)
        || selfiePhoto.length > 2_000_000 || idPhoto.length > 2_000_000) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "Both check-in photos are required and must be valid JPEG images under 1.5 MB." }, { status: 400 });
      }

      const questionResult = await client.query(`
        SELECT id, question_type, question, difficulty_level, details
        FROM questions
        WHERE status = TRUE
          AND ($1::text IS NULL OR BTRIM($1::text) = '' OR LOWER(BTRIM(COALESCE(category, ''))) = LOWER(BTRIM($1::text)))
          AND ($2::text IS NULL OR BTRIM($2::text) = '' OR LOWER(BTRIM(COALESCE(sub_category, ''))) = LOWER(BTRIM($2::text)))
          AND ($3::text IS NULL OR BTRIM($3::text) = '' OR LOWER(BTRIM(COALESCE(topic, ''))) = LOWER(BTRIM($3::text)))
          AND ($4::text IS NULL OR BTRIM($4::text) = '' OR LOWER(BTRIM(COALESCE(language, ''))) = LOWER(BTRIM($4::text)))
        ORDER BY created_at DESC, id DESC
      `, [
        assessment.question_category,
        assessment.sub_category,
        assessment.topic,
        assessment.question_language,
      ]);
      let questionSet: ReturnType<typeof buildAttemptQuestionSet>;
      try {
        questionSet = buildAttemptQuestionSet(assessment.sections, questionResult.rows);
      } catch (error) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: error instanceof Error ? error.message : "Assessment question configuration is invalid." }, { status: 409 });
      }
      if (!questionSet.snapshot.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "This assessment has no active questions." }, { status: 409 });
      }

      const inserted = await client.query(`
        INSERT INTO assessment_candidate_attempts (
          assessment_id, candidate_id, status, answers, questions_snapshot,
          selfie_photo, id_photo, started_at, deadline_at
        )
        VALUES ($1, $2, 'in_progress', '{}'::jsonb, $3::jsonb, $4, $5, $6, $7)
        RETURNING id, assessment_id, candidate_id, status, answers, questions_snapshot,
                  selfie_photo, id_photo, started_at, deadline_at, submitted_at
      `, [
        assessmentId,
        candidate.id,
        JSON.stringify(questionSet.snapshot),
        selfiePhoto,
        idPhoto,
        serverTime,
        new Date(deadline).toISOString(),
      ]);
      const attempt = inserted.rows[0] as AttemptRow;
      await recordExamTimelineEvent(client, assessmentId, candidate.id, "exam_started", "candidate");
      await client.query("COMMIT");
      transactionStarted = false;
      return NextResponse.json(buildResponse(attempt, serverTime), { status: 201 });
    } catch (error) {
      if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Failed to start or restore student assessment", error);
    return NextResponse.json({ error: "Unable to start assessment." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as {
      assessmentId?: unknown;
      questionId?: unknown;
      answer?: unknown;
      attemptStartedAt?: unknown;
    };
    const assessmentId = Number(body.assessmentId);
    const questionId = Number(body.questionId);
    if (!Number.isInteger(assessmentId) || assessmentId <= 0
      || !Number.isInteger(questionId) || questionId <= 0
      || body.answer === undefined
      || typeof body.attemptStartedAt !== "string"
      || !Number.isFinite(Date.parse(body.attemptStartedAt))) {
      return NextResponse.json({ error: "A valid assessment, question, and answer are required." }, { status: 400 });
    }
    await ensureStudentExamTables();
    const client = await databasePool.connect();
    let transactionStarted = false;
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      const result = await client.query(`
        SELECT id, assessment_id, candidate_id, status, answers, questions_snapshot,
               selfie_photo, id_photo, started_at, deadline_at, submitted_at,
               deadline_at <= NOW() AS deadline_passed
        FROM assessment_candidate_attempts
        WHERE assessment_id = $1 AND candidate_id = $2
        FOR UPDATE
      `, [assessmentId, authorization.candidate?.id ?? 0]);
      const attempt = result.rows[0] as (AttemptRow & { deadline_passed: boolean }) | undefined;
      if (!attempt) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "No active examination attempt was found." }, { status: 404 });
      }
      if (new Date(attempt.started_at).getTime() !== Date.parse(body.attemptStartedAt)) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "This examination was restarted. Reload the current attempt before saving answers." }, { status: 409 });
      }
      if (attempt.status !== "in_progress" || attempt.deadline_passed) {
        if (attempt.status === "in_progress") {
          await finalizeAttempt(client, attempt, "expired");
          await client.query("COMMIT");
          transactionStarted = false;
        } else {
          await client.query("ROLLBACK");
          transactionStarted = false;
        }
        return NextResponse.json({ error: "This examination attempt is closed; answers can no longer be changed." }, { status: 409 });
      }
      const question = attempt.questions_snapshot.find((item) => Number(item.id) === questionId);
      if (!question) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "The question does not belong to this attempt." }, { status: 400 });
      }
      const answerError = validateAttemptAnswer(question, body.answer);
      if (answerError) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: answerError }, { status: 400 });
      }
      const answers = { ...attempt.answers, [String(questionId)]: body.answer };
      await client.query(
        "UPDATE assessment_candidate_attempts SET answers = $2::jsonb WHERE id = $1 AND status = 'in_progress'",
        [attempt.id, JSON.stringify(answers)],
      );
      await client.query("COMMIT");
      transactionStarted = false;
      return NextResponse.json({ saved: true });
    } catch (error) {
      if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Failed to save student examination answer", error);
    return NextResponse.json({ error: "Unable to save your answer." }, { status: 500 });
  }
}
