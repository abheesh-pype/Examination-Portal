import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { authorizeApiRequest } from "@/lib/auth";

export const runtime = "nodejs";

async function ensureCandidateCategoryTable() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS candidate_category (
      id SERIAL PRIMARY KEY,
      candidate_category TEXT NOT NULL,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function GET(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    await ensureCandidateCategoryTable();
    const result = await databasePool.query("SELECT id, candidate_category, status, created_at FROM candidate_category ORDER BY created_at DESC, id DESC");
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to load candidate categories", error);
    return NextResponse.json({ error: "Unable to load candidate categories" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as { candidate_category?: unknown };
    const category = typeof body.candidate_category === "string" ? body.candidate_category.trim() : "";
    if (!category) return NextResponse.json({ error: "Candidate category is required" }, { status: 400 });

    await ensureCandidateCategoryTable();
    const result = await databasePool.query("INSERT INTO candidate_category (candidate_category) VALUES ($1) RETURNING id, candidate_category, status, created_at", [category]);
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error("Failed to create candidate category", error);
    return NextResponse.json({ error: "Unable to create candidate category" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as { id?: unknown; candidate_category?: unknown; status?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "A valid id is required" }, { status: 400 });

    const updates: string[] = [];
    const values: unknown[] = [];
    if (typeof body.candidate_category === "string" && body.candidate_category.trim()) {
      values.push(body.candidate_category.trim());
      updates.push(`candidate_category = $${values.length}`);
    }
    if (typeof body.status === "boolean") {
      values.push(body.status);
      updates.push(`status = $${values.length}`);
    }
    if (!updates.length) return NextResponse.json({ error: "A candidate category field is required" }, { status: 400 });

    values.push(id);
    const result = await databasePool.query(`UPDATE candidate_category SET ${updates.join(", ")} WHERE id = $${values.length} RETURNING id, candidate_category, status, created_at`, values);
    if (!result.rowCount) return NextResponse.json({ error: "Candidate category not found" }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error("Failed to update candidate category", error);
    return NextResponse.json({ error: "Unable to update candidate category" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as { id?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "A valid id is required" }, { status: 400 });

    const result = await databasePool.query("DELETE FROM candidate_category WHERE id = $1", [id]);
    if (!result.rowCount) return NextResponse.json({ error: "Candidate category not found" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete candidate category", error);
    return NextResponse.json({ error: "Unable to delete candidate category" }, { status: 500 });
  }
}
