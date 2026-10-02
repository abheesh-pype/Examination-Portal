import { NextResponse } from "next/server";
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
    await ensureAssignmentTables();
    const assessmentId = Number(new URL(request.url).searchParams.get("assessmentId"));
    if (!Number.isInteger(assessmentId) || assessmentId <= 0) {
      return NextResponse.json({ error: "A valid assessment id is required" }, { status: 400 });
    }

    const result = await databasePool.query(
      "SELECT candidate_sub_category_id FROM assessment_candidate_sub_category WHERE assessment_id = $1 ORDER BY candidate_sub_category_id",
      [assessmentId],
    );
    return NextResponse.json(result.rows.map((row) => Number(row.candidate_sub_category_id)));
  } catch (error) {
    console.error("Failed to load assessment candidate assignments", error);
    return NextResponse.json({ error: "Unable to load candidate assignments" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { assessment_id?: unknown; candidate_sub_category_ids?: unknown };
    const assessmentId = Number(body.assessment_id);
    if (!Number.isInteger(assessmentId) || assessmentId <= 0) {
      return NextResponse.json({ error: "A valid assessment id is required" }, { status: 400 });
    }
    if (!Array.isArray(body.candidate_sub_category_ids)
      || body.candidate_sub_category_ids.some((id) => !Number.isInteger(id) || Number(id) <= 0)) {
      return NextResponse.json({ error: "Candidate sub-category ids must be positive whole numbers" }, { status: 400 });
    }

    const subCategoryIds = [...new Set(body.candidate_sub_category_ids as number[])];
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

      if (subCategoryIds.length > 0) {
        const subCategoryResult = await client.query(
          "SELECT id FROM candidate_sub_category WHERE id = ANY($1::int[]) AND status = TRUE",
          [subCategoryIds],
        );
        if (subCategoryResult.rowCount !== subCategoryIds.length) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return NextResponse.json({ error: "One or more selected candidate sub-categories are unavailable" }, { status: 400 });
        }
      }

      await client.query("DELETE FROM assessment_candidate_sub_category WHERE assessment_id = $1", [assessmentId]);
      if (subCategoryIds.length > 0) {
        await client.query(
          `INSERT INTO assessment_candidate_sub_category (assessment_id, candidate_sub_category_id)
           SELECT $1, selected_id FROM unnest($2::int[]) AS selected_id`,
          [assessmentId, subCategoryIds],
        );
      }

      await client.query("COMMIT");
      transactionStarted = false;
      return NextResponse.json({ assessment_id: assessmentId, candidate_sub_category_ids: subCategoryIds });
    } catch (error) {
      if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Failed to save assessment candidate assignments", error);
    return NextResponse.json({ error: "Unable to save candidate assignments" }, { status: 500 });
  }
}
