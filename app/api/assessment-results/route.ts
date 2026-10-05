import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";

export const runtime = "nodejs";

type ResultQuestion = {
  id: unknown;
  question_type?: unknown;
  section?: unknown;
  correct_answer?: unknown;
  correct_mark?: unknown;
  wrong_mark?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function ensureAssessmentResultTables() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment (
      id SERIAL PRIMARY KEY,
      examination TEXT NOT NULL,
      name TEXT NOT NULL,
      start_date TIMESTAMPTZ,
      end_date TIMESTAMPTZ,
      sections JSONB NOT NULL DEFAULT '[]'::jsonb
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      mobile TEXT NOT NULL,
      status BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS "Candidate Information" (
      id SERIAL PRIMARY KEY,
      record_type TEXT NOT NULL DEFAULT 'field',
      name TEXT NOT NULL,
      column_type TEXT NOT NULL,
      status BOOLEAN NOT NULL DEFAULT TRUE,
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
  await databasePool.query(`
    ALTER TABLE assessment_candidate_submissions
    ADD COLUMN IF NOT EXISTS manual_marks JSONB NOT NULL DEFAULT '{}'::jsonb
  `);
}

function normalizeAnswer(value: unknown): string | string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim().toLocaleLowerCase()).sort();
  }
  return value === null || value === undefined ? "" : String(value).trim().toLocaleLowerCase();
}

function answersEqual(first: unknown, second: unknown) {
  const normalizedFirst = normalizeAnswer(first);
  const normalizedSecond = normalizeAnswer(second);
  if (Array.isArray(normalizedFirst) && Array.isArray(normalizedSecond)) {
    return normalizedFirst.length === normalizedSecond.length
      && normalizedFirst.every((value, index) => value === normalizedSecond[index]);
  }
  return !Array.isArray(normalizedFirst)
    && !Array.isArray(normalizedSecond)
    && normalizedFirst === normalizedSecond;
}

function hasAnswer(value: unknown) {
  return Array.isArray(value)
    ? value.some((item) => typeof item === "string" && item.trim())
    : typeof value === "string" && value.trim().length > 0;
}

function getQuestionMarks(sections: unknown, question: ResultQuestion) {
  const snapshotCorrectMark = Number(question.correct_mark);
  const snapshotWrongMark = Number(question.wrong_mark);
  const sectionName = typeof question.section === "string" ? question.section.trim().toLocaleLowerCase() : "";
  const section = Array.isArray(sections)
    ? sections.find((candidate) => isRecord(candidate)
      && typeof candidate.name === "string"
      && candidate.name.trim().toLocaleLowerCase() === sectionName)
    : undefined;

  if (!isRecord(section)) {
    return {
      correctMark: Number.isFinite(snapshotCorrectMark) && snapshotCorrectMark > 0 ? snapshotCorrectMark : 0,
      wrongMark: Number.isFinite(snapshotWrongMark) && snapshotWrongMark <= 0 ? snapshotWrongMark : 0,
    };
  }

  const configuredCorrectMark = Number(section.correct_mark);
  const configuredWrongMark = Number(section.wrong_mark);
  return {
    correctMark: Number.isFinite(configuredCorrectMark) && configuredCorrectMark >= 0
      ? configuredCorrectMark
      : Number.isFinite(snapshotCorrectMark) && snapshotCorrectMark > 0 ? snapshotCorrectMark : 0,
    wrongMark: Number.isFinite(configuredWrongMark) && configuredWrongMark <= 0
      ? configuredWrongMark
      : Number.isFinite(snapshotWrongMark) && snapshotWrongMark <= 0 ? snapshotWrongMark : 0,
  };
}

function calculateResult(
  sections: unknown,
  questionsSnapshot: unknown,
  answers: unknown,
  manualMarks: unknown,
) {
  const safeAnswers = isRecord(answers) ? answers : {};
  const safeManualMarks = isRecord(manualMarks) ? manualMarks : {};
  const questions = Array.isArray(questionsSnapshot) ? questionsSnapshot.filter(isRecord) : [];
  let obtainedMark = 0;
  let negativeMark = 0;
  let snapshotMaximumMark = 0;

  for (const question of questions as ResultQuestion[]) {
    const marks = getQuestionMarks(sections, question);
    snapshotMaximumMark += marks.correctMark;
    const questionId = String(question.id);
    const answer = safeAnswers[questionId];
    const manualQuestion = /manual|passage/i.test(String(question.question_type ?? ""));

    if (manualQuestion) {
      const manualMark = Number(safeManualMarks[questionId]);
      if (Number.isFinite(manualMark)) {
        obtainedMark += Math.min(Math.max(manualMark, 0), marks.correctMark);
      }
      continue;
    }

    if (!hasAnswer(answer)) continue;
    if (question.correct_answer !== null && question.correct_answer !== undefined
      && answersEqual(answer, question.correct_answer)) {
      obtainedMark += marks.correctMark;
    } else {
      obtainedMark += marks.wrongMark;
      negativeMark += marks.wrongMark;
    }
  }

  if (Array.isArray(sections)) {
    const configuredMaximumMark = sections.reduce((total, section) => {
      if (!isRecord(section)) return total;
      const questionCount = Number(section.question_count);
      const correctMark = Number(section.correct_mark);
      return Number.isFinite(questionCount) && questionCount > 0
        && Number.isFinite(correctMark) && correctMark >= 0
        ? total + questionCount * correctMark
        : total;
    }, 0);
    if (configuredMaximumMark > 0) snapshotMaximumMark = configuredMaximumMark;
  }

  return { obtainedMark, negativeMark, totalMark: snapshotMaximumMark };
}

function getCandidateField(fields: Record<string, unknown>, pattern: RegExp) {
  const entry = Object.entries(fields).find(([name, value]) =>
    pattern.test(name.trim()) && typeof value === "string" && value.trim(),
  );
  return entry ? String(entry[1]).trim() : "";
}

function getCandidateCode(fields: Record<string, unknown>) {
  return getCandidateField(fields, /^candidate id(?:\s*\([^)]*\))?$/i);
}

export async function GET(request: Request) {
  try {
    await ensureAssessmentResultTables();
    const accountUserId = Number(new URL(request.url).searchParams.get("accountUserId"));
    if (!Number.isInteger(accountUserId) || accountUserId <= 0) {
      return NextResponse.json({ error: "A valid administrator account is required." }, { status: 400 });
    }

    const userResult = await databasePool.query(
      "SELECT role FROM users WHERE id = $1 AND status = TRUE",
      [accountUserId],
    );
    if (!userResult.rowCount || !String(userResult.rows[0].role ?? "").toLocaleLowerCase().includes("admin")) {
      return NextResponse.json({ error: "Only administrators can view assessment results." }, { status: 403 });
    }

    const result = await databasePool.query(`
      SELECT assessment.id AS assessment_id,
             assessment.name AS assessment_name,
             assessment.examination,
             assessment.start_date AS assessment_start_date,
             assessment.end_date AS assessment_end_date,
             assessment.sections,
             candidate.id AS candidate_id,
             candidate.name AS candidate_name,
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
      WHERE submission.evaluated_at IS NOT NULL
      ORDER BY submission.evaluated_at DESC, assessment.name, candidate.name
    `);

    return NextResponse.json({
      results: result.rows.map((row) => {
        const candidateData = isRecord(row.candidate_data) ? row.candidate_data : {};
        const candidateFields = isRecord(candidateData.fields) ? candidateData.fields : {};
        const candidateDetails = Object.fromEntries(
          Object.entries(candidateFields).filter(([name, value]) =>
            !/^candidate id(?:\s*\([^)]*\))?$/i.test(name.trim())
            && !/^candidate name(?:\s*\([^)]*\))?$/i.test(name.trim())
            && value !== null
            && value !== undefined
            && String(value).trim() !== "",
          ),
        );
        const marks = calculateResult(row.sections, row.questions_snapshot, row.answers, row.manual_marks);

        return {
          assessment_id: Number(row.assessment_id),
          assessment_name: String(row.assessment_name ?? ""),
          examination: String(row.examination ?? ""),
          assessment_start_date: row.assessment_start_date,
          assessment_end_date: row.assessment_end_date,
          candidate_id: Number(row.candidate_id),
          candidate_code: getCandidateCode(candidateFields),
          candidate_name: getCandidateField(candidateFields, /^candidate name(?:\s*\([^)]*\))?$/i)
            || String(row.candidate_name ?? "Candidate"),
          candidate_category: typeof candidateData.category === "string" ? candidateData.category : "",
          candidate_sub_category: typeof candidateData.sub_category === "string" ? candidateData.sub_category : "",
          candidate_details: candidateDetails,
          obtained_mark: marks.obtainedMark,
          negative_mark: marks.negativeMark,
          total_mark: marks.totalMark,
          evaluated_at: row.evaluated_at,
        };
      }),
    });
  } catch (error) {
    console.error("Failed to load assessment results", error);
    return NextResponse.json({ error: "Unable to load assessment results." }, { status: 500 });
  }
}
