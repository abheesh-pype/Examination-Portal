import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";

export const runtime = "nodejs";

type AssessmentPayload = {
  examination?: unknown;
  name?: unknown;
  start_date?: unknown;
  end_date?: unknown;
  total_time?: unknown;
  last_login?: unknown;
  question_category?: unknown;
  sub_category?: unknown;
  topic?: unknown;
  question_language?: unknown;
  sections?: unknown;
};

async function ensureAssessmentTable() {
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
}

const optionalText = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const optionalInteger = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
};
const optionalDate = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export async function GET() {
  try {
    await ensureAssessmentTable();
    const result = await databasePool.query(`
      SELECT id, examination, name, start_date, end_date, total_time, last_login,
             question_category, sub_category, topic, question_language, sections,
             status, created_at
      FROM assessment
      ORDER BY created_at DESC, id DESC
    `);
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to load assessments", error);
    return NextResponse.json({ error: "Unable to load assessments" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as AssessmentPayload;
    const examination = optionalText(body.examination);
    const name = optionalText(body.name);
    if (!examination || !name) {
      return NextResponse.json({ error: "Examination and assessment name are required" }, { status: 400 });
    }

    const sections = Array.isArray(body.sections) ? body.sections : [];
    await ensureAssessmentTable();
    const result = await databasePool.query(`
      INSERT INTO assessment (
        examination, name, start_date, end_date, total_time, last_login,
        question_category, sub_category, topic, question_language, sections
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
      RETURNING id, examination, name, start_date, end_date, total_time, last_login,
                question_category, sub_category, topic, question_language, sections,
                status, created_at
    `, [
      examination,
      name,
      optionalDate(body.start_date),
      optionalDate(body.end_date),
      optionalInteger(body.total_time),
      optionalInteger(body.last_login),
      optionalText(body.question_category),
      optionalText(body.sub_category),
      optionalText(body.topic),
      optionalText(body.question_language),
      JSON.stringify(sections),
    ]);

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error("Failed to create assessment", error);
    return NextResponse.json({ error: "Unable to create assessment" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { id?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "A valid assessment id is required" }, { status: 400 });
    }

    await ensureAssessmentTable();
    const result = await databasePool.query("DELETE FROM assessment WHERE id = $1", [id]);
    if (!result.rowCount) {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete assessment", error);
    return NextResponse.json({ error: "Unable to delete assessment" }, { status: 500 });
  }
}
