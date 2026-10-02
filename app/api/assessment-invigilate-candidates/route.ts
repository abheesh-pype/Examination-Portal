import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";

export const runtime = "nodejs";

async function ensureInvigilationTables() {
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
    CREATE TABLE IF NOT EXISTS assessment_candidate_invigilator (
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES "Candidate Information"(id) ON DELETE CASCADE,
      invigilator_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (assessment_id, candidate_id)
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
}

export async function GET(request: Request) {
  try {
    const assessmentId = Number(new URL(request.url).searchParams.get("assessmentId"));
    if (!Number.isInteger(assessmentId) || assessmentId <= 0) {
      return NextResponse.json({ error: "A valid assessment id is required" }, { status: 400 });
    }

    await ensureInvigilationTables();
    const assessmentResult = await databasePool.query(
      "SELECT id FROM assessment WHERE id = $1",
      [assessmentId],
    );
    if (!assessmentResult.rowCount) {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }

    const result = await databasePool.query(`
      SELECT
        candidate.id AS candidate_id,
        candidate.name AS candidate_name,
        candidate.candidate_data,
        BTRIM(COALESCE(candidate.candidate_data->>'category', '')) AS category,
        BTRIM(COALESCE(candidate.candidate_data->>'sub_category', '')) AS sub_category,
        candidate.status AS candidate_status,
        invigilator.name AS invigilator_name
      FROM assessment_candidate_invigilator AS assignment
      JOIN "Candidate Information" AS candidate
        ON candidate.id = assignment.candidate_id
        AND candidate.record_type = 'candidate'
      JOIN users AS invigilator
        ON invigilator.id = assignment.invigilator_user_id
      WHERE assignment.assessment_id = $1
      ORDER BY candidate.id
    `, [assessmentId]);

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to load candidates for assessment invigilation", error);
    return NextResponse.json({ error: "Unable to load assessment candidates" }, { status: 500 });
  }
}
