import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";

export const runtime = "nodejs";

async function ensureAssessmentTypeTable() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS "Assessment_Type" (
      id SERIAL PRIMARY KEY,
      assessment_name TEXT NOT NULL,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function GET() {
  try {
    await ensureAssessmentTypeTable();
    const result = await databasePool.query('SELECT id, assessment_name, status, created_at FROM "Assessment_Type" ORDER BY created_at DESC, id DESC');
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to load assessment types", error);
    return NextResponse.json({ error: "Unable to load assessment types" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { assessment_name?: unknown };
    const assessmentName = typeof body.assessment_name === "string" ? body.assessment_name.trim() : "";
    if (!assessmentName) return NextResponse.json({ error: "Assessment type is required" }, { status: 400 });

    await ensureAssessmentTypeTable();
    const result = await databasePool.query('INSERT INTO "Assessment_Type" (assessment_name) VALUES ($1) RETURNING id, assessment_name, status, created_at', [assessmentName]);
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error("Failed to create assessment type", error);
    return NextResponse.json({ error: "Unable to create assessment type" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id?: unknown; assessment_name?: unknown; status?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "A valid id is required" }, { status: 400 });

    const updates: string[] = [];
    const values: unknown[] = [];
    if (typeof body.assessment_name === "string" && body.assessment_name.trim()) {
      values.push(body.assessment_name.trim());
      updates.push(`assessment_name = $${values.length}`);
    }
    if (typeof body.status === "boolean") {
      values.push(body.status);
      updates.push(`status = $${values.length}`);
    }
    if (!updates.length) return NextResponse.json({ error: "An assessment type field is required" }, { status: 400 });

    values.push(id);
    const result = await databasePool.query(`UPDATE "Assessment_Type" SET ${updates.join(", ")} WHERE id = $${values.length} RETURNING id, assessment_name, status, created_at`, values);
    if (!result.rowCount) return NextResponse.json({ error: "Assessment type not found" }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error("Failed to update assessment type", error);
    return NextResponse.json({ error: "Unable to update assessment type" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { id?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "A valid id is required" }, { status: 400 });

    const result = await databasePool.query('DELETE FROM "Assessment_Type" WHERE id = $1', [id]);
    if (!result.rowCount) return NextResponse.json({ error: "Assessment type not found" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete assessment type", error);
    return NextResponse.json({ error: "Unable to delete assessment type" }, { status: 500 });
  }
}
