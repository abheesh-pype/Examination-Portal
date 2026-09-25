import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";

export const runtime = "nodejs";

async function ensureQuestionCategoryTable() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS question_category (
      id SERIAL PRIMARY KEY,
      q_category TEXT NOT NULL,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function GET() {
  try {
    await ensureQuestionCategoryTable();
    const result = await databasePool.query(
      "SELECT id, q_category, status, created_at FROM question_category ORDER BY created_at DESC, id DESC",
    );
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to load question categories", error);
    return NextResponse.json({ error: "Unable to load question categories" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { q_category?: unknown };
    const qCategory = typeof body.q_category === "string" ? body.q_category.trim() : "";

    if (!qCategory) {
      return NextResponse.json({ error: "Category name is required" }, { status: 400 });
    }

    await ensureQuestionCategoryTable();
    const result = await databasePool.query(
      "INSERT INTO question_category (q_category) VALUES ($1) RETURNING id, q_category, status, created_at",
      [qCategory],
    );
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error("Failed to create question category", error);
    return NextResponse.json({ error: "Unable to create question category" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id?: unknown; status?: unknown; q_category?: unknown };
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

    if (typeof body.q_category === "string" && body.q_category.trim()) {
      values.push(body.q_category.trim());
      updates.push(`q_category = $${values.length}`);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "A status or category name is required" }, { status: 400 });
    }

    values.push(id);
    const result = await databasePool.query(
      `UPDATE question_category SET ${updates.join(", ")} WHERE id = $${values.length} RETURNING id, q_category, status, created_at`,
      values,
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error("Failed to update question category", error);
    return NextResponse.json({ error: "Unable to update question category" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { id?: unknown };
    const id = Number(body.id);

    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "A valid id is required" }, { status: 400 });
    }

    const result = await databasePool.query("DELETE FROM question_category WHERE id = $1", [id]);

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete question category", error);
    return NextResponse.json({ error: "Unable to delete question category" }, { status: 500 });
  }
}
