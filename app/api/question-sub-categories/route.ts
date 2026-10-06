import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { authorizeApiRequest } from "@/lib/auth";

export const runtime = "nodejs";

async function ensureQuestionSubCategoryTable() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS question_sub_category (
      id SERIAL PRIMARY KEY,
      q_s_category TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      status BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function GET(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    await ensureQuestionSubCategoryTable();
    const result = await databasePool.query(
      "SELECT id, q_s_category, category, status, created_at FROM question_sub_category ORDER BY created_at DESC, id DESC",
    );
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to load question sub-categories", error);
    return NextResponse.json({ error: "Unable to load question sub-categories" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as { q_s_category?: unknown; category?: unknown };
    const subCategory = typeof body.q_s_category === "string" ? body.q_s_category.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";

    if (!subCategory || !category) {
      return NextResponse.json({ error: "Sub-category and category are required" }, { status: 400 });
    }

    await ensureQuestionSubCategoryTable();
    const result = await databasePool.query(
      "INSERT INTO question_sub_category (q_s_category, category) VALUES ($1, $2) RETURNING id, q_s_category, category, status, created_at",
      [subCategory, category],
    );
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error("Failed to create question sub-category", error);
    return NextResponse.json({ error: "Unable to create question sub-category" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as { id?: unknown; status?: unknown; q_s_category?: unknown; category?: unknown };
    const id = Number(body.id);

    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "A valid id is required" }, { status: 400 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    if (typeof body.status === "boolean") {
      values.push(body.status);
      updates.push(`status = $${values.length}`);
    }
    if (typeof body.q_s_category === "string" && body.q_s_category.trim()) {
      values.push(body.q_s_category.trim());
      updates.push(`q_s_category = $${values.length}`);
    }
    if (typeof body.category === "string" && body.category.trim()) {
      values.push(body.category.trim());
      updates.push(`category = $${values.length}`);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "A category field is required" }, { status: 400 });
    }

    values.push(id);
    const result = await databasePool.query(
      `UPDATE question_sub_category SET ${updates.join(", ")} WHERE id = $${values.length} RETURNING id, q_s_category, category, status, created_at`,
      values,
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Sub-category not found" }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error("Failed to update question sub-category", error);
    return NextResponse.json({ error: "Unable to update question sub-category" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as { id?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "A valid id is required" }, { status: 400 });
    }

    const result = await databasePool.query("DELETE FROM question_sub_category WHERE id = $1", [id]);
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Sub-category not found" }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete question sub-category", error);
    return NextResponse.json({ error: "Unable to delete question sub-category" }, { status: 500 });
  }
}
