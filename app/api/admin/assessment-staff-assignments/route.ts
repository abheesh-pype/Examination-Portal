import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth";
import { databasePool } from "@/lib/db";

export const runtime = "nodejs";

async function ensureAssignmentTables() {
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
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      mobile TEXT NOT NULL,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      verified BOOLEAN NOT NULL DEFAULT FALSE,
      created_on TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    if (!authorization.user?.isAdmin) {
      return NextResponse.json({ error: "Only administrators can view assessment staff assignments." }, { status: 403 });
    }

    const role = new URL(request.url).searchParams.get("role");
    if (role !== "invigilator" && role !== "evaluator") {
      return NextResponse.json({ error: "Choose either evaluator or invigilator assignments." }, { status: 400 });
    }

    await ensureAssignmentTables();
    const assignmentTable = role === "evaluator"
      ? "assessment_candidate_evaluator"
      : "assessment_candidate_invigilator";
    const staffIdColumn = role === "evaluator" ? "evaluator_user_id" : "invigilator_user_id";
    const result = await databasePool.query(`
      SELECT DISTINCT
        assessment.id AS assessment_id,
        assessment.name AS assessment_name,
        assessment.start_date AS assessment_date,
        staff.name AS assigned_staff,
        staff.email AS assigned_staff_email,
        COALESCE(NULLIF(BTRIM(candidate_fields.assigned_student), ''), candidate.name) AS assigned_student,
        BTRIM(COALESCE(candidate.candidate_data->>'category', '')) AS student_category,
        BTRIM(COALESCE(candidate.candidate_data->>'sub_category', '')) AS student_sub_category
      FROM ${assignmentTable} AS assignment
      JOIN assessment ON assessment.id = assignment.assessment_id
      JOIN users AS staff ON staff.id = assignment.${staffIdColumn}
      JOIN "Candidate Information" AS candidate
        ON candidate.id = assignment.candidate_id
       AND candidate.record_type = 'candidate'
       AND candidate.status = TRUE
      CROSS JOIN LATERAL (
        SELECT MAX(value) FILTER (WHERE key ~* '^candidate name(?:\\s*\\([^)]*\\))?$') AS assigned_student
        FROM jsonb_each_text(
          CASE
            WHEN jsonb_typeof(candidate.candidate_data->'fields') = 'object'
            THEN candidate.candidate_data->'fields'
            ELSE '{}'::jsonb
          END
        )
      ) AS candidate_fields
      ORDER BY assessment.start_date DESC NULLS LAST,
               assessment.name,
               staff.name,
               student_category,
               student_sub_category,
               assigned_student
    `);
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to load assessment staff assignments", error);
    return NextResponse.json({ error: "Unable to load assessment staff assignments." }, { status: 500 });
  }
}
