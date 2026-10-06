import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { authorizeApiRequest } from "@/lib/auth";

export const runtime = "nodejs";

async function ensureCandidateSubCategoryTable() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS candidate_sub_category (
      id SERIAL PRIMARY KEY,
      candidate_sub_category TEXT NOT NULL,
      category TEXT NOT NULL,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function GET(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    await ensureCandidateSubCategoryTable();
    const result = await databasePool.query("SELECT id, candidate_sub_category, category, status, created_at FROM candidate_sub_category ORDER BY created_at DESC, id DESC");
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to load candidate sub-categories", error);
    return NextResponse.json({ error: "Unable to load candidate sub-categories" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as { candidate_sub_category?: unknown; category?: unknown };
    const subCategory = typeof body.candidate_sub_category === "string" ? body.candidate_sub_category.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";
    if (!subCategory || !category) return NextResponse.json({ error: "Candidate sub-category and category are required" }, { status: 400 });

    await ensureCandidateSubCategoryTable();
    const result = await databasePool.query("INSERT INTO candidate_sub_category (candidate_sub_category, category) VALUES ($1, $2) RETURNING id, candidate_sub_category, category, status, created_at", [subCategory, category]);
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error("Failed to create candidate sub-category", error);
    return NextResponse.json({ error: "Unable to create candidate sub-category" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as { id?: unknown; candidate_sub_category?: unknown; category?: unknown; status?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "A valid id is required" }, { status: 400 });

    const updates: string[] = [];
    const values: unknown[] = [];
    if (typeof body.candidate_sub_category === "string" && body.candidate_sub_category.trim()) {
      values.push(body.candidate_sub_category.trim());
      updates.push(`candidate_sub_category = $${values.length}`);
    }
    if (typeof body.category === "string" && body.category.trim()) {
      values.push(body.category.trim());
      updates.push(`category = $${values.length}`);
    }
    if (typeof body.status === "boolean") {
      values.push(body.status);
      updates.push(`status = $${values.length}`);
    }
    if (!updates.length) return NextResponse.json({ error: "A candidate sub-category field is required" }, { status: 400 });

    values.push(id);
    const result = await databasePool.query(`UPDATE candidate_sub_category SET ${updates.join(", ")} WHERE id = $${values.length} RETURNING id, candidate_sub_category, category, status, created_at`, values);
    if (!result.rowCount) return NextResponse.json({ error: "Candidate sub-category not found" }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error("Failed to update candidate sub-category", error);
    return NextResponse.json({ error: "Unable to update candidate sub-category" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as { id?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "A valid id is required" }, { status: 400 });

    const result = await databasePool.query("DELETE FROM candidate_sub_category WHERE id = $1", [id]);
    if (!result.rowCount) return NextResponse.json({ error: "Candidate sub-category not found" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete candidate sub-category", error);
    return NextResponse.json({ error: "Unable to delete candidate sub-category" }, { status: 500 });
  }
}
