import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { authorizeApiRequest } from "@/lib/auth";

export const runtime = "nodejs";

const proctorKeys = [
  "noFace",
  "okay",
  "multipleFaces",
  "personChanges",
  "motionEvents",
  "cameraBlocked",
  "tabChanges",
  "fullscreenDisabled",
] as const;

type ProctorCounts = Record<(typeof proctorKeys)[number], number>;

let proctorTablesReady: Promise<void> | null = null;

async function ensureProctorTables() {
  if (!proctorTablesReady) {
    proctorTablesReady = (async () => {
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
        CREATE TABLE IF NOT EXISTS assessment_candidate_proctor_state (
          assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
          candidate_id INTEGER NOT NULL REFERENCES "Candidate Information"(id) ON DELETE CASCADE,
          counts JSONB NOT NULL DEFAULT '{}'::jsonb,
          last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
        CREATE TABLE IF NOT EXISTS assessment_candidate_direct_assignment (
          assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
          candidate_id INTEGER NOT NULL REFERENCES "Candidate Information"(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (assessment_id, candidate_id)
        )
      `);
    })();
  }
  try {
    await proctorTablesReady;
  } catch (error) {
    proctorTablesReady = null;
    throw error;
  }
}

function isValidCounts(value: unknown): value is ProctorCounts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const counts = value as Record<string, unknown>;
  return proctorKeys.every((key) =>
    Number.isInteger(counts[key])
    && Number(counts[key]) >= 0
    && Number(counts[key]) <= 1_000_000,
  );
}

export async function PUT(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as {
      assessmentId?: unknown;
      counts?: unknown;
    };
    const assessmentId = Number(body.assessmentId);
    if (!Number.isInteger(assessmentId)
      || assessmentId <= 0
      || !isValidCounts(body.counts)) {
      return NextResponse.json({ error: "A valid assessment and monitoring counts are required." }, { status: 400 });
    }

    await ensureProctorTables();
    const candidateResult = await databasePool.query(`
      SELECT id, candidate_data
      FROM "Candidate Information"
      WHERE id = $1 AND record_type = 'candidate' AND status = TRUE
    `, [authorization.candidate?.id ?? 0]);
    const candidate = candidateResult.rows[0];
    if (!candidate) {
      return NextResponse.json({ error: "Student credentials could not be verified." }, { status: 401 });
    }

    const candidateData = candidate.candidate_data as {
      category?: string | null;
      sub_category?: string | null;
    } | null;
    const assignment = await databasePool.query(`
      SELECT EXISTS (
        SELECT 1
        FROM assessment_candidate_sub_category AS assignment
        JOIN candidate_sub_category AS candidate_group
          ON candidate_group.id = assignment.candidate_sub_category_id
        JOIN assessment
          ON assessment.id = assignment.assessment_id AND assessment.status = TRUE
        WHERE assignment.assessment_id = $1
          AND candidate_group.status = TRUE
          AND candidate_group.category = $2
          AND candidate_group.candidate_sub_category = $3
      ) OR EXISTS (
        SELECT 1
        FROM assessment_candidate_direct_assignment AS direct_assignment
        JOIN assessment ON assessment.id = direct_assignment.assessment_id AND assessment.status = TRUE
        WHERE direct_assignment.assessment_id = $1
          AND direct_assignment.candidate_id = $4
      ) AS is_assigned
      LIMIT 1
    `, [assessmentId, candidateData?.category ?? "", candidateData?.sub_category ?? "", candidate.id]);
    if (!assignment.rows[0]?.is_assigned) {
      return NextResponse.json({ error: "This student is not assigned to the assessment." }, { status: 403 });
    }

    await databasePool.query(`
      INSERT INTO assessment_candidate_proctor_state (assessment_id, candidate_id, counts, last_seen)
      VALUES ($1, $2, $3::jsonb, NOW())
      ON CONFLICT (assessment_id, candidate_id)
      DO UPDATE SET counts = EXCLUDED.counts, last_seen = NOW()
    `, [assessmentId, candidate.id, JSON.stringify(body.counts)]);

    return NextResponse.json({ updated: true });
  } catch (error) {
    console.error("Failed to update student proctor activity", error);
    return NextResponse.json({ error: "Unable to update student proctor activity." }, { status: 500 });
  }
}
