import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";

export const runtime = "nodejs";

async function ensureCandidateInformationTable() {
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

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      category?: unknown;
      sub_category?: unknown;
      fields?: unknown;
    };
    const fields = body.fields && typeof body.fields === "object" && !Array.isArray(body.fields) ? body.fields : {};
    const candidateData = {
      category: typeof body.category === "string" ? body.category : null,
      sub_category: typeof body.sub_category === "string" ? body.sub_category : null,
      fields,
    };
    const candidateName = typeof (fields as Record<string, unknown>)["Candidate Name"] === "string"
      ? String((fields as Record<string, unknown>)["Candidate Name"])
      : "Candidate";

    await ensureCandidateInformationTable();
    const result = await databasePool.query(
      `
        INSERT INTO "Candidate Information" (record_type, name, column_type, candidate_data)
        VALUES ('candidate', $1, 'Candidate', $2)
        RETURNING id, record_type, name, column_type, candidate_data, date
      `,
      [candidateName || "Candidate", JSON.stringify(candidateData)],
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error("Failed to save candidate", error);
    return NextResponse.json({ error: "Unable to save candidate" }, { status: 500 });
  }
}

export async function GET() {
  try {
    await ensureCandidateInformationTable();
    const result = await databasePool.query(
      `
        SELECT id, name, candidate_data, status, date
        FROM "Candidate Information"
        WHERE record_type = 'candidate'
        ORDER BY id DESC
      `
    );
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to fetch candidates", error);
    return NextResponse.json({ error: "Unable to fetch candidates" }, { status: 500 });
  }
}
