import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { authorizeApiRequest } from "@/lib/auth";

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
    CREATE TABLE IF NOT EXISTS assessment_candidate_direct_assignment (
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES "Candidate Information"(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (assessment_id, candidate_id)
    )
  `);
}

export async function GET(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const params = new URL(request.url).searchParams;
    const assessmentId = Number(params.get("assessmentId"));
    const accountUserId = authorization.user?.id ?? 0;
    if (!Number.isInteger(assessmentId) || assessmentId <= 0
      || !Number.isInteger(accountUserId) || accountUserId <= 0) {
      return NextResponse.json({ error: "Valid assessment and account ids are required" }, { status: 400 });
    }

    await ensureInvigilationTables();
    const userResult = await databasePool.query(
      `SELECT users.id, users.role,
              COALESCE(roles.administrator_access, FALSE) AS administrator_access
       FROM users
       LEFT JOIN roles ON LOWER(BTRIM(roles.role_name)) = LOWER(BTRIM(users.role)) AND roles.status = TRUE
       WHERE users.id = $1 AND users.status = TRUE`,
      [accountUserId],
    );
    if (!userResult.rowCount) {
      return NextResponse.json({ error: "An active account is required to view assessment candidates." }, { status: 403 });
    }
    const role = String(userResult.rows[0].role ?? "").trim().toLocaleLowerCase();
    const isInvigilator = role === "invigilator";
    const isAdmin = !isInvigilator && (role.includes("admin") || Boolean(userResult.rows[0].administrator_access));
    if (!isAdmin && !isInvigilator) {
      return NextResponse.json({ error: "Only administrators and assigned invigilators can view assessment candidates." }, { status: 403 });
    }

    const assessmentResult = await databasePool.query("SELECT id FROM assessment WHERE id = $1", [assessmentId]);
    if (!assessmentResult.rowCount) return NextResponse.json({ error: "Assessment not found" }, { status: 404 });

    const result = await databasePool.query(`
      SELECT DISTINCT ON (candidate.id)
        candidate.id AS candidate_id,
        candidate.name AS candidate_name,
        candidate.candidate_data,
        BTRIM(COALESCE(candidate.candidate_data->>'category', '')) AS category,
        BTRIM(COALESCE(candidate.candidate_data->>'sub_category', '')) AS sub_category,
        candidate.status AS candidate_status,
        invigilator.name AS invigilator_name
      FROM "Candidate Information" AS candidate
      LEFT JOIN assessment_candidate_invigilator AS assignment
        ON assignment.assessment_id = $1 AND assignment.candidate_id = candidate.id
      LEFT JOIN users AS invigilator
        ON invigilator.id = assignment.invigilator_user_id
      LEFT JOIN candidate_sub_category AS candidate_group
        ON candidate_group.status = TRUE
        AND candidate_group.category = BTRIM(COALESCE(candidate.candidate_data->>'category', ''))
        AND candidate_group.candidate_sub_category = BTRIM(COALESCE(candidate.candidate_data->>'sub_category', ''))
      LEFT JOIN assessment_candidate_sub_category AS cohort_assignment
        ON cohort_assignment.assessment_id = $1
        AND cohort_assignment.candidate_sub_category_id = candidate_group.id
      LEFT JOIN assessment_candidate_direct_assignment AS direct_assignment
        ON direct_assignment.assessment_id = $1
        AND direct_assignment.candidate_id = candidate.id
      WHERE candidate.record_type = 'candidate'
        AND (
          ($3::boolean AND cohort_assignment.assessment_id IS NOT NULL)
          OR ($3::boolean AND direct_assignment.candidate_id IS NOT NULL)
          OR (NOT $3::boolean AND assignment.invigilator_user_id = $2)
        )
      ORDER BY candidate.id
    `, [assessmentId, accountUserId, isAdmin]);

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to load candidates for assessment invigilation", error);
    return NextResponse.json({ error: "Unable to load assessment candidates" }, { status: 500 });
  }
}
