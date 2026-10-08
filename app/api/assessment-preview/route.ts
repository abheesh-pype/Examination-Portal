import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth";
import { databasePool } from "@/lib/db";

export const runtime = "nodejs";

async function ensurePreviewTables() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment_candidate_evaluator (
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES "Candidate Information"(id) ON DELETE CASCADE,
      evaluator_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (assessment_id, candidate_id)
    )
  `);
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

export async function GET(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;

    const assessmentId = Number(new URL(request.url).searchParams.get("assessmentId"));
    if (!Number.isInteger(assessmentId) || assessmentId <= 0) {
      return NextResponse.json({ error: "A valid assessment id is required." }, { status: 400 });
    }

    await ensurePreviewTables();
    const result = await databasePool.query(`
      SELECT question.id, question.question_type, question.question,
             question.category, question.sub_category, question.topic,
             question.difficulty_level, question.language, question.status,
             jsonb_build_object(
               'options', COALESCE(question.details->'options', '[]'::jsonb)
             ) AS details
      FROM assessment
      JOIN questions AS question
        ON question.status = TRUE
       AND (NULLIF(BTRIM(assessment.question_category), '') IS NULL
         OR LOWER(BTRIM(COALESCE(question.category, ''))) = LOWER(BTRIM(assessment.question_category)))
       AND (NULLIF(BTRIM(assessment.sub_category), '') IS NULL
         OR LOWER(BTRIM(COALESCE(question.sub_category, ''))) = LOWER(BTRIM(assessment.sub_category)))
       AND (NULLIF(BTRIM(assessment.topic), '') IS NULL
         OR LOWER(BTRIM(COALESCE(question.topic, ''))) = LOWER(BTRIM(assessment.topic)))
       AND (NULLIF(BTRIM(assessment.question_language), '') IS NULL
         OR LOWER(BTRIM(COALESCE(question.language, ''))) = LOWER(BTRIM(assessment.question_language)))
      WHERE assessment.id = $1
        AND (
          $3::boolean
          OR EXISTS (
            SELECT 1 FROM assessment_candidate_evaluator AS assignment
            WHERE assignment.assessment_id = assessment.id
              AND assignment.evaluator_user_id = $2
          )
          OR EXISTS (
            SELECT 1 FROM assessment_candidate_invigilator AS assignment
            WHERE assignment.assessment_id = assessment.id
              AND assignment.invigilator_user_id = $2
          )
        )
      ORDER BY question.created_at DESC, question.id DESC
    `, [assessmentId, authorization.user?.id ?? 0, authorization.user?.isAdmin ?? false]);

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to load assessment preview questions", error);
    return NextResponse.json({ error: "Unable to load assessment preview." }, { status: 500 });
  }
}
