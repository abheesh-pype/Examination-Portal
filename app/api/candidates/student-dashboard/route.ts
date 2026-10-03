import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";

export const runtime = "nodejs";

async function ensureStudentScheduleTables() {
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

function isCandidateIdFieldName(name: string) {
  return /^candidate id(?:\s*\([^)]*\))?$/i.test(name.trim());
}

function getCandidateId(fields: Record<string, unknown>) {
  const entry = Object.entries(fields).find(([name, value]) =>
    isCandidateIdFieldName(name) && typeof value === "string" && /^\d{6}$/.test(value.trim()),
  );
  return entry ? String(entry[1]).trim() : "";
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { candidateId?: unknown; dateOfBirth?: unknown };
    const candidateId = typeof body.candidateId === "string" ? body.candidateId.trim() : "";
    const dateOfBirth = typeof body.dateOfBirth === "string" ? body.dateOfBirth.trim() : "";
    if (!/^\d{6}$/.test(candidateId) || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      return NextResponse.json({ error: "Valid student credentials are required." }, { status: 401 });
    }

    await ensureStudentScheduleTables();
    const candidateResult = await databasePool.query(`
      SELECT id, candidate_data
      FROM "Candidate Information"
      WHERE record_type = 'candidate' AND status = TRUE
      ORDER BY id ASC
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
      return NextResponse.json({ assessments: [] });
    }

    const assessments = await databasePool.query(`
      SELECT assessment.id, assessment.examination, assessment.name,
             assessment.start_date, assessment.end_date, assessment.total_time,
             assessment.last_login, assessment.sections,
             (submission.submitted_at IS NOT NULL) AS has_submitted
      FROM assessment
      JOIN assessment_candidate_sub_category AS assignment
        ON assignment.assessment_id = assessment.id
      JOIN candidate_sub_category AS sub_category
        ON sub_category.id = assignment.candidate_sub_category_id
      LEFT JOIN assessment_candidate_submissions AS submission
        ON submission.assessment_id = assessment.id
       AND submission.candidate_id = $3
      WHERE assessment.status = TRUE
        AND sub_category.status = TRUE
        AND sub_category.category = $1
        AND sub_category.candidate_sub_category = $2
      ORDER BY assessment.start_date ASC NULLS LAST, assessment.id ASC
    `, [candidateData.category, candidateData.sub_category, candidate.id]);

    return NextResponse.json({
      assessments: assessments.rows.map((assessment) => {
        const sections = Array.isArray(assessment.sections) ? assessment.sections : [];
        const totalQuestions = sections.reduce((total: number, section: unknown) => {
          if (!section || typeof section !== "object") return total;
          const questionCount = Number((section as { question_count?: unknown }).question_count);
          return total + (Number.isFinite(questionCount) ? questionCount : 0);
        }, 0);
        const totalMarks = sections.reduce((total: number, section: unknown) => {
          if (!section || typeof section !== "object") return total;
          const questionCount = Number((section as { question_count?: unknown }).question_count);
          const correctMark = Number((section as { correct_mark?: unknown }).correct_mark);
          return total + (Number.isFinite(questionCount) && Number.isFinite(correctMark) ? questionCount * correctMark : 0);
        }, 0);
        return {
          id: assessment.id,
          examination: assessment.examination,
          name: assessment.name,
          start_date: assessment.start_date,
          end_date: assessment.end_date,
          total_time: assessment.total_time,
          last_login: assessment.last_login,
          total_questions: totalQuestions,
          total_marks: totalMarks,
          has_submitted: Boolean(assessment.has_submitted),
        };
      }),
    });
  } catch (error) {
    console.error("Failed to load student dashboard", error);
    return NextResponse.json({ error: "Unable to load student dashboard." }, { status: 500 });
  }
}
