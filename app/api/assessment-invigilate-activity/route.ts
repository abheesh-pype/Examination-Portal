import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";

export const runtime = "nodejs";

const countKeys = [
  "noFace",
  "okay",
  "multipleFaces",
  "personChanges",
  "motionEvents",
  "cameraBlocked",
  "tabChanges",
  "fullscreenDisabled",
] as const;

type ProctorCounts = Record<(typeof countKeys)[number], number>;

let invigilationActivityTablesReady = false;

function readCounts(value: unknown): ProctorCounts {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return Object.fromEntries(countKeys.map((key) => {
    const count = Number(input[key]);
    return [key, Number.isInteger(count) && count >= 0 ? count : 0];
  })) as ProctorCounts;
}

async function ensureInvigilationActivityTables() {
  if (invigilationActivityTablesReady) return;
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
    CREATE TABLE IF NOT EXISTS assessment_candidate_invigilator (
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES "Candidate Information"(id) ON DELETE CASCADE,
      invigilator_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (assessment_id, candidate_id)
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
    CREATE TABLE IF NOT EXISTS assessment_candidate_proctor_state (
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES "Candidate Information"(id) ON DELETE CASCADE,
      counts JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (assessment_id, candidate_id)
    )
  `);
  await databasePool.query(`
    CREATE INDEX IF NOT EXISTS assessment_candidate_invigilator_lookup_idx
    ON assessment_candidate_invigilator (assessment_id, invigilator_user_id)
  `);
  invigilationActivityTablesReady = true;
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const assessmentId = Number(params.get("assessmentId"));
    const accountUserId = Number(params.get("accountUserId") ?? params.get("invigilatorUserId"));
    if (!Number.isInteger(assessmentId) || assessmentId <= 0
      || !Number.isInteger(accountUserId) || accountUserId <= 0) {
      return NextResponse.json({ error: "Valid assessment and account ids are required." }, { status: 400 });
    }

    await ensureInvigilationActivityTables();
    const userResult = await databasePool.query(`
      SELECT id, role FROM users
      WHERE id = $1 AND status = TRUE
    `, [accountUserId]);
    if (!userResult.rowCount) {
      return NextResponse.json({ error: "An active account is required to view monitoring activity." }, { status: 403 });
    }
    const role = String(userResult.rows[0].role ?? "").trim().toLocaleLowerCase();
    const isAdmin = role.includes("admin");
    const isInvigilator = role === "invigilator";
    if (!isAdmin && !isInvigilator) {
      return NextResponse.json({ error: "Only administrators and assigned invigilators can view monitoring activity." }, { status: 403 });
    }

    await databasePool.query(`
      DELETE FROM assessment_candidate_proctor_state
      WHERE assessment_id = $1
        AND last_seen < NOW() - INTERVAL '30 seconds'
    `, [assessmentId]);
    const activityResult = await databasePool.query(`
      SELECT DISTINCT ON (candidate.id)
             candidate.id AS candidate_id,
             candidate.name AS candidate_name,
             candidate.candidate_data,
             state.counts,
             state.last_seen,
             invigilator.name AS invigilator_name
      FROM "Candidate Information" AS candidate
      LEFT JOIN assessment_candidate_invigilator AS assignment
        ON assignment.assessment_id = $1
        AND assignment.candidate_id = candidate.id
      LEFT JOIN users AS invigilator
        ON invigilator.id = assignment.invigilator_user_id
      LEFT JOIN candidate_sub_category AS candidate_group
        ON candidate_group.status = TRUE
        AND candidate_group.category = BTRIM(COALESCE(candidate.candidate_data->>'category', ''))
        AND candidate_group.candidate_sub_category = BTRIM(COALESCE(candidate.candidate_data->>'sub_category', ''))
      LEFT JOIN assessment_candidate_sub_category AS cohort_assignment
        ON cohort_assignment.assessment_id = $1
        AND cohort_assignment.candidate_sub_category_id = candidate_group.id
      LEFT JOIN assessment_candidate_proctor_state AS state
        ON state.assessment_id = $1
        AND state.candidate_id = candidate.id
        AND state.last_seen >= NOW() - INTERVAL '30 seconds'
      WHERE candidate.record_type = 'candidate'
        AND (
          ($3::boolean AND cohort_assignment.assessment_id IS NOT NULL)
          OR (NOT $3::boolean AND assignment.invigilator_user_id = $2)
        )
      ORDER BY candidate.id, state.last_seen DESC NULLS LAST
    `, [assessmentId, accountUserId, isAdmin]);

    const candidates = activityResult.rows.map((row) => ({
      candidate_id: Number(row.candidate_id),
      candidate_name: String(row.candidate_name),
      candidate_data: row.candidate_data,
      counts: readCounts(row.counts),
      last_seen: row.last_seen,
      is_live: row.last_seen !== null,
      invigilator_name: row.invigilator_name ? String(row.invigilator_name) : null,
    }));
    const totals = candidates.reduce((sum, candidate) => {
      for (const key of countKeys) sum[key] += candidate.counts[key];
      return sum;
    }, readCounts({}));

    return NextResponse.json({
      assessment_id: assessmentId,
      account_user_id: accountUserId,
      viewer_role: isAdmin ? "admin" : "invigilator",
      live_candidates: candidates.filter((candidate) => candidate.is_live).length,
      assigned_candidates: candidates.length,
      totals,
      candidates,
    });
  } catch (error) {
    console.error("Failed to load invigilator proctor activity", error);
    return NextResponse.json({ error: "Unable to load invigilator proctor activity." }, { status: 500 });
  }
}
