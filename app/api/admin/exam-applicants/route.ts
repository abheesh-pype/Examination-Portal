import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth";
import { databasePool } from "@/lib/db";

export const runtime = "nodejs";

async function ensureApplicantTables() {
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
}

export async function GET(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    if (!authorization.user?.isAdmin) {
      return NextResponse.json({ error: "Only administrators can view exam applicants." }, { status: 403 });
    }

    await ensureApplicantTables();
    const result = await databasePool.query(`
      SELECT DISTINCT
        COALESCE(candidate_fields.candidate_id, 'ID ' || candidate.id::text) AS candidate_id,
        COALESCE(candidate_fields.candidate_name, candidate.name) AS candidate_name,
        BTRIM(COALESCE(candidate.candidate_data->>'category', '')) AS candidate_category,
        BTRIM(COALESCE(candidate.candidate_data->>'sub_category', '')) AS candidate_sub_category,
        COALESCE(candidate_fields.candidate_email, '') AS candidate_email,
        COALESCE(candidate_fields.candidate_department, '') AS candidate_department,
        assessment.name AS assessment_name,
        COALESCE(assessment.question_category, '') AS test_category,
        COALESCE(assessment.sub_category, '') AS test_sub_category,
        candidate.status AS active_status
      FROM assessment
      JOIN assessment_candidate_sub_category AS assessment_assignment
        ON assessment_assignment.assessment_id = assessment.id
      JOIN candidate_sub_category AS assigned_group
        ON assigned_group.id = assessment_assignment.candidate_sub_category_id
       AND assigned_group.status = TRUE
      JOIN "Candidate Information" AS candidate
        ON candidate.record_type = 'candidate'
       AND BTRIM(COALESCE(candidate.candidate_data->>'category', '')) = BTRIM(assigned_group.category)
       AND BTRIM(COALESCE(candidate.candidate_data->>'sub_category', '')) = BTRIM(assigned_group.candidate_sub_category)
      CROSS JOIN LATERAL (
        SELECT
          MAX(value) FILTER (WHERE key ~* '^candidate id(?:\\s*\\([^)]*\\))?$') AS candidate_id,
          MAX(value) FILTER (WHERE key ~* '^candidate name(?:\\s*\\([^)]*\\))?$') AS candidate_name,
          MAX(value) FILTER (WHERE key ~* '(e-?mail)') AS candidate_email,
          MAX(value) FILTER (WHERE key ~* '(department|dept)') AS candidate_department
        FROM jsonb_each_text(
          CASE
            WHEN jsonb_typeof(candidate.candidate_data->'fields') = 'object'
            THEN candidate.candidate_data->'fields'
            ELSE '{}'::jsonb
          END
        )
      ) AS candidate_fields
      WHERE assessment.status = TRUE
        AND (
          COALESCE(
            assessment.end_date,
            CASE
              WHEN assessment.start_date IS NOT NULL AND assessment.total_time > 0
              THEN assessment.start_date + assessment.total_time * INTERVAL '1 minute'
              ELSE NULL
            END
          ) IS NULL
          OR COALESCE(
            assessment.end_date,
            CASE
              WHEN assessment.start_date IS NOT NULL AND assessment.total_time > 0
              THEN assessment.start_date + assessment.total_time * INTERVAL '1 minute'
              ELSE NULL
            END
          ) > NOW()
        )
      ORDER BY assessment.name, candidate_name, candidate_id
    `);
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to load exam applicants", error);
    return NextResponse.json({ error: "Unable to load exam applicants." }, { status: 500 });
  }
}
