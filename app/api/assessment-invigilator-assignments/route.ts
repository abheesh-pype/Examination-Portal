import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { authorizeApiRequest } from "@/lib/auth";

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
    await ensureAssignmentTables();
    const assessmentId = Number(new URL(request.url).searchParams.get("assessmentId"));
    if (!Number.isInteger(assessmentId) || assessmentId <= 0) {
      return NextResponse.json({ error: "A valid assessment id is required" }, { status: 400 });
    }

    const result = await databasePool.query(`
      SELECT assignment.candidate_id, assignment.invigilator_user_id,
             candidate.name AS candidate_name, candidate.candidate_data,
             candidate.status AS candidate_status,
             invigilator.name AS invigilator_name, invigilator.email AS invigilator_email
      FROM assessment_candidate_invigilator AS assignment
      JOIN "Candidate Information" AS candidate ON candidate.id = assignment.candidate_id
      JOIN users AS invigilator ON invigilator.id = assignment.invigilator_user_id
      WHERE assignment.assessment_id = $1
      ORDER BY candidate.id
    `, [assessmentId]);
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to load assessment invigilator assignments", error);
    return NextResponse.json({ error: "Unable to load invigilator assignments" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as { assessment_id?: unknown; assignments?: unknown; merge?: unknown };
    const assessmentId = Number(body.assessment_id);
    if (!Number.isInteger(assessmentId) || assessmentId <= 0) {
      return NextResponse.json({ error: "A valid assessment id is required" }, { status: 400 });
    }
    if (!Array.isArray(body.assignments) || body.assignments.some((item) =>
      !item || typeof item !== "object" || Array.isArray(item)
      || !Number.isInteger((item as { candidate_id?: unknown }).candidate_id)
      || Number((item as { candidate_id: number }).candidate_id) <= 0
      || !Number.isInteger((item as { invigilator_user_id?: unknown }).invigilator_user_id)
      || Number((item as { invigilator_user_id: number }).invigilator_user_id) <= 0
    )) {
      return NextResponse.json({ error: "Assignments must contain valid candidate and invigilator ids" }, { status: 400 });
    }
    if (body.merge !== undefined && typeof body.merge !== "boolean") {
      return NextResponse.json({ error: "The merge option must be a boolean" }, { status: 400 });
    }
    if (body.merge === true && body.assignments.length > 1000) {
      return NextResponse.json({ error: "Upload a maximum of 1000 candidate assignments at a time" }, { status: 400 });
    }

    const assignments = body.assignments as Array<{ candidate_id: number; invigilator_user_id: number }>;
    const uniqueAssignments = [...new Map(assignments.map((item) => [item.candidate_id, item])).values()];
    await ensureAssignmentTables();
    const client = await databasePool.connect();
    let transactionStarted = false;
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      const assessmentResult = await client.query("SELECT id FROM assessment WHERE id = $1", [assessmentId]);
      if (!assessmentResult.rowCount) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
      }

      const candidateIds = [...new Set(uniqueAssignments.map((item) => item.candidate_id))];
      const invigilatorIds = [...new Set(uniqueAssignments.map((item) => item.invigilator_user_id))];
      if (candidateIds.length > 0) {
        const candidateResult = await client.query(
          `SELECT id FROM "Candidate Information" WHERE record_type = 'candidate' AND status = TRUE AND id = ANY($1::int[])`,
          [candidateIds],
        );
        if (candidateResult.rowCount !== candidateIds.length) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return NextResponse.json({ error: "One or more selected candidates are unavailable" }, { status: 400 });
        }
      }
      if (invigilatorIds.length > 0) {
        const invigilatorResult = await client.query(
          "SELECT id FROM users WHERE status = TRUE AND LOWER(BTRIM(role)) = 'invigilator' AND id = ANY($1::int[])",
          [invigilatorIds],
        );
        if (invigilatorResult.rowCount !== invigilatorIds.length) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return NextResponse.json({ error: "Select an active invigilator account" }, { status: 400 });
        }
      }

      if (uniqueAssignments.length > 0) {
        if (body.merge === true) {
          await client.query(`
            INSERT INTO assessment_candidate_invigilator (assessment_id, candidate_id, invigilator_user_id)
            SELECT $1, rows.candidate_id, rows.invigilator_user_id
            FROM jsonb_to_recordset($2::jsonb) AS rows(candidate_id INTEGER, invigilator_user_id INTEGER)
            ON CONFLICT (assessment_id, candidate_id)
            DO UPDATE SET invigilator_user_id = EXCLUDED.invigilator_user_id
          `, [assessmentId, JSON.stringify(uniqueAssignments)]);
        } else {
          await client.query("DELETE FROM assessment_candidate_invigilator WHERE assessment_id = $1", [assessmentId]);
          await client.query(`
            INSERT INTO assessment_candidate_invigilator (assessment_id, candidate_id, invigilator_user_id)
            SELECT $1, rows.candidate_id, rows.invigilator_user_id
            FROM jsonb_to_recordset($2::jsonb) AS rows(candidate_id INTEGER, invigilator_user_id INTEGER)
          `, [assessmentId, JSON.stringify(uniqueAssignments)]);
        }
      } else if (body.merge !== true) {
        await client.query("DELETE FROM assessment_candidate_invigilator WHERE assessment_id = $1", [assessmentId]);
      }
      await client.query("COMMIT");
      transactionStarted = false;
      return NextResponse.json({ assessment_id: assessmentId, assignments: uniqueAssignments });
    } catch (error) {
      if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Failed to save assessment invigilator assignments", error);
    return NextResponse.json({ error: "Unable to save invigilator assignments" }, { status: 500 });
  }
}
