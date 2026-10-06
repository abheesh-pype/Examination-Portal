import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { getExamCamPermission } from "@/lib/candidate-permissions";
import { authorizeApiRequest } from "@/lib/auth";
import { ensureExamAttemptTable, finalizeExpiredAttemptsForCandidate } from "@/lib/exam-attempts";

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

export async function POST(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    await ensureStudentScheduleTables();
    await ensureExamAttemptTable();
    await finalizeExpiredAttemptsForCandidate(authorization.candidate?.id ?? 0);
    const candidateResult = await databasePool.query(`
      SELECT id, candidate_data
      FROM "Candidate Information"
      WHERE id = $1 AND record_type = 'candidate' AND status = TRUE
    `, [authorization.candidate?.id ?? 0]);
    const candidate = candidateResult.rows[0];

    if (!candidate) {
      return NextResponse.json({ error: "Student credentials could not be verified." }, { status: 401 });
    }

    const examCamPermissionActive = await getExamCamPermission();
    const candidateData = candidate.candidate_data as {
      category?: string | null;
      sub_category?: string | null;
    } | null;
    if (!candidateData?.category || !candidateData.sub_category) {
      return NextResponse.json({ assessments: [], exam_cam_permission_active: examCamPermissionActive });
    }

    const assessments = await databasePool.query(`
      SELECT assessment.id, assessment.examination, assessment.name,
             assessment.start_date, assessment.end_date, assessment.total_time,
             assessment.last_login, assessment.sections,
             (submission.submitted_at IS NOT NULL) AS has_submitted,
             (attempt.status = 'in_progress' AND attempt.deadline_at > NOW()) AS has_active_attempt,
             (assessment.start_date > NOW()) AS is_upcoming,
             (
               assessment.start_date IS NOT NULL
               AND assessment.start_date <= NOW()
               AND (assessment.end_date IS NULL OR assessment.end_date > NOW())
               AND (
                 assessment.last_login IS NULL
                 OR assessment.last_login <= 0
                 OR assessment.start_date + assessment.last_login * INTERVAL '1 minute' > NOW()
               )
               AND (assessment.total_time > 0 OR assessment.end_date IS NOT NULL)
             ) AS can_start
      FROM assessment
      JOIN assessment_candidate_sub_category AS assignment
        ON assignment.assessment_id = assessment.id
      JOIN candidate_sub_category AS sub_category
        ON sub_category.id = assignment.candidate_sub_category_id
      LEFT JOIN assessment_candidate_submissions AS submission
        ON submission.assessment_id = assessment.id
       AND submission.candidate_id = $3
      LEFT JOIN assessment_candidate_attempts AS attempt
        ON attempt.assessment_id = assessment.id
       AND attempt.candidate_id = $3
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
          has_active_attempt: Boolean(assessment.has_active_attempt),
          is_upcoming: Boolean(assessment.is_upcoming),
          can_start: Boolean(assessment.can_start),
        };
      }),
      exam_cam_permission_active: examCamPermissionActive,
    });
  } catch (error) {
    console.error("Failed to load student dashboard", error);
    return NextResponse.json({ error: "Unable to load student dashboard." }, { status: 500 });
  }
}
