import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { matchesAssessmentQuestionType } from "@/lib/question-types";

export const runtime = "nodejs";

const photoPattern = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

async function ensureSubmissionTables() {
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
}

function getCandidateId(fields: Record<string, unknown>) {
  const entry = Object.entries(fields).find(([name, value]) =>
    /^candidate id(?:\s*\([^)]*\))?$/i.test(name.trim())
    && typeof value === "string"
    && /^\d{6}$/.test(value.trim()),
  );
  return entry ? String(entry[1]).trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function matches(value: unknown, selected: unknown) {
  if (typeof selected !== "string" || !selected.trim()) return true;
  return typeof value === "string" && value.trim().toLocaleLowerCase() === selected.trim().toLocaleLowerCase();
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      candidateId?: unknown;
      dateOfBirth?: unknown;
      assessmentId?: unknown;
      answers?: unknown;
      selfiePhoto?: unknown;
      idPhoto?: unknown;
      startedAt?: unknown;
    };
    const candidateId = typeof body.candidateId === "string" ? body.candidateId.trim() : "";
    const dateOfBirth = typeof body.dateOfBirth === "string" ? body.dateOfBirth.trim() : "";
    const assessmentId = Number(body.assessmentId);
    const startedAt = typeof body.startedAt === "string" ? new Date(body.startedAt) : null;
    if (!/^\d{6}$/.test(candidateId)
      || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)
      || !Number.isInteger(assessmentId)
      || assessmentId <= 0
      || !isRecord(body.answers)
      || !startedAt
      || Number.isNaN(startedAt.getTime())
      || startedAt.getTime() > Date.now() + 5 * 60_000) {
      return NextResponse.json({ error: "Valid student credentials, assessment, answers, and start time are required." }, { status: 400 });
    }

    const selfiePhoto = typeof body.selfiePhoto === "string" ? body.selfiePhoto : "";
    const idPhoto = typeof body.idPhoto === "string" ? body.idPhoto : "";
    if (!photoPattern.test(selfiePhoto) || !photoPattern.test(idPhoto)
      || selfiePhoto.length > 2_000_000 || idPhoto.length > 2_000_000) {
      return NextResponse.json({ error: "Both check-in photos must be valid JPEG images under 1.5 MB." }, { status: 400 });
    }
    for (const [questionId, answer] of Object.entries(body.answers)) {
      if (!/^\d+$/.test(questionId)
        || !(typeof answer === "string" || (Array.isArray(answer) && answer.every((item) => typeof item === "string")))
        || (typeof answer === "string" ? answer.length > 20_000 : answer.some((item) => item.length > 2_000))) {
        return NextResponse.json({ error: "One or more submitted answers are invalid." }, { status: 400 });
      }
    }

    await ensureSubmissionTables();
    const candidateResult = await databasePool.query(`
      SELECT id, candidate_data
      FROM "Candidate Information"
      WHERE record_type = 'candidate' AND status = TRUE
    `);
    const candidate = candidateResult.rows.find((row) => {
      const data = row.candidate_data as { fields?: Record<string, unknown> } | null;
      if (!data?.fields || getCandidateId(data.fields) !== candidateId) return false;
      const dobField = Object.entries(data.fields).find(([name, value]) =>
        /^(dob|date of birth|birth date)(\s*\([^)]*\))?$/i.test(name.trim())
        && typeof value === "string"
        && value.trim(),
      );
      return dobField ? String(dobField[1]).slice(0, 10) === dateOfBirth : false;
    });
    if (!candidate) {
      return NextResponse.json({ error: "Student credentials could not be verified." }, { status: 401 });
    }

    const candidateData = candidate.candidate_data as {
      category?: string | null;
      sub_category?: string | null;
    } | null;
    if (!candidateData?.category || !candidateData.sub_category) {
      return NextResponse.json({ error: "This student is not assigned to the assessment." }, { status: 403 });
    }

    const assignment = await databasePool.query(`
      SELECT 1
      FROM assessment_candidate_sub_category AS assignment
      JOIN candidate_sub_category AS candidate_group
        ON candidate_group.id = assignment.candidate_sub_category_id
      JOIN assessment
        ON assessment.id = assignment.assessment_id AND assessment.status = TRUE
      WHERE assignment.assessment_id = $1
        AND candidate_group.status = TRUE
        AND candidate_group.category = $2
        AND candidate_group.candidate_sub_category = $3
      LIMIT 1
    `, [assessmentId, candidateData.category, candidateData.sub_category]);
    if (!assignment.rowCount) {
      return NextResponse.json({ error: "This student is not assigned to the assessment." }, { status: 403 });
    }

    const assessmentResult = await databasePool.query(`
      SELECT question_category, sub_category, topic, question_language, sections
      FROM assessment WHERE id = $1 AND status = TRUE
    `, [assessmentId]);
    if (!assessmentResult.rowCount) {
      return NextResponse.json({ error: "Assessment not found or inactive." }, { status: 404 });
    }
    const assessment = assessmentResult.rows[0];
    const questionResult = await databasePool.query(`
      SELECT id, question_type, question, category, sub_category, topic, language, details
      FROM questions WHERE status = TRUE
      ORDER BY created_at DESC, id DESC
    `);
    const matchedQuestions = questionResult.rows.filter((question) =>
      matches(question.category, assessment.question_category)
      && matches(question.sub_category, assessment.sub_category)
      && matches(question.topic, assessment.topic)
      && matches(question.language, assessment.question_language),
    );
    const allowedQuestionIds = new Set(matchedQuestions.map((question) => Number(question.id)));
    const configuredSections = Array.isArray(assessment.sections)
      ? assessment.sections as Array<Record<string, unknown>>
      : [];
    const sections = configuredSections.length ? configuredSections : [{}];
    const assignedQuestionIds = new Set<number>();
    const questionSnapshot: Array<Record<string, unknown>> = [];
    for (const [index, section] of sections.entries()) {
      const sectionName = typeof section.name === "string" && section.name.trim()
        ? section.name.trim()
        : `Section ${String.fromCharCode(65 + index)}`;
      const questionType = typeof section.question_type === "string" ? section.question_type : "";
      const questionCount = Number(section.question_count);
      const limit = Number.isInteger(questionCount) && questionCount > 0 ? questionCount : Number.POSITIVE_INFINITY;
      const correctMark = Number(section.correct_mark);
      const wrongMark = Number(section.wrong_mark);
      const selected = matchedQuestions
        .filter((question) => !assignedQuestionIds.has(Number(question.id))
          && matchesAssessmentQuestionType(question.question_type, questionType))
        .slice(0, limit);
      for (const question of selected) {
        const id = Number(question.id);
        assignedQuestionIds.add(id);
        const details = isRecord(question.details) ? question.details : {};
        questionSnapshot.push({
          id,
          question_type: String(question.question_type),
          question: String(question.question),
          section: sectionName,
          options: Array.isArray(details.options) ? details.options.filter((option: unknown): option is string => typeof option === "string") : [],
          correct_answer: details.answer ?? null,
          correct_mark: Number.isFinite(correctMark) ? correctMark : 0,
          wrong_mark: Number.isFinite(wrongMark) && wrongMark <= 0 ? wrongMark : 0,
          passage: typeof details.passage === "string" && details.passage ? details.passage : null,
        });
      }
    }
    for (const question of matchedQuestions) {
      const id = Number(question.id);
      if (assignedQuestionIds.has(id)) continue;
      const details = isRecord(question.details) ? question.details : {};
      questionSnapshot.push({
        id,
        question_type: String(question.question_type),
        question: String(question.question),
        section: "Other Questions",
        options: Array.isArray(details.options) ? details.options.filter((option: unknown): option is string => typeof option === "string") : [],
        correct_answer: details.answer ?? null,
        correct_mark: 0,
        wrong_mark: 0,
        passage: typeof details.passage === "string" && details.passage ? details.passage : null,
      });
    }
    for (const questionId of Object.keys(body.answers).map(Number)) {
      if (!allowedQuestionIds.has(questionId)) {
        return NextResponse.json({ error: "Submitted answers include a question outside this assessment." }, { status: 400 });
      }
    }

    const saved = await databasePool.query(`
      INSERT INTO assessment_candidate_submissions (
        assessment_id, candidate_id, answers, questions_snapshot, selfie_photo, id_photo, started_at
      )
      VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)
      ON CONFLICT (assessment_id, candidate_id)
      DO UPDATE SET
        answers = EXCLUDED.answers,
        questions_snapshot = EXCLUDED.questions_snapshot,
        selfie_photo = EXCLUDED.selfie_photo,
        id_photo = EXCLUDED.id_photo,
        submitted_at = NOW()
      WHERE assessment_candidate_submissions.evaluated_at IS NULL
      RETURNING submitted_at
    `, [assessmentId, candidate.id, JSON.stringify(body.answers), JSON.stringify(questionSnapshot), selfiePhoto, idPhoto, startedAt.toISOString()]);
    if (!saved.rowCount) {
      return NextResponse.json({ error: "This exam has already been evaluated and can no longer be resubmitted." }, { status: 409 });
    }
    return NextResponse.json({ submitted: true, submitted_at: saved.rows[0].submitted_at });
  } catch (error) {
    console.error("Failed to save student assessment submission", error);
    return NextResponse.json({ error: "Unable to save your assessment submission." }, { status: 500 });
  }
}
