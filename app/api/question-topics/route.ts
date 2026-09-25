import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";

export const runtime = "nodejs";

async function ensureQuestionTopicsTable() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS question_topics (
      id SERIAL PRIMARY KEY,
      topic TEXT NOT NULL,
      q_s_category TEXT NOT NULL,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function GET() {
  try {
    await ensureQuestionTopicsTable();
    const result = await databasePool.query(
      "SELECT id, topic, q_s_category, status, created_at FROM question_topics ORDER BY created_at DESC, id DESC",
    );
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to load question topics", error);
    return NextResponse.json({ error: "Unable to load question topics" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { topic?: unknown; q_s_category?: unknown };
    const topic = typeof body.topic === "string" ? body.topic.trim() : "";
    const subCategory = typeof body.q_s_category === "string" ? body.q_s_category.trim() : "";

    if (!topic || !subCategory) {
      return NextResponse.json({ error: "Topic and sub-category are required" }, { status: 400 });
    }

    await ensureQuestionTopicsTable();
    const result = await databasePool.query(
      "INSERT INTO question_topics (topic, q_s_category) VALUES ($1, $2) RETURNING id, topic, q_s_category, status, created_at",
      [topic, subCategory],
    );
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error("Failed to create question topic", error);
    return NextResponse.json({ error: "Unable to create question topic" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id?: unknown; topic?: unknown; q_s_category?: unknown; status?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "A valid id is required" }, { status: 400 });

    const updates: string[] = [];
    const values: unknown[] = [];
    if (typeof body.topic === "string" && body.topic.trim()) {
      values.push(body.topic.trim());
      updates.push(`topic = $${values.length}`);
    }
    if (typeof body.q_s_category === "string" && body.q_s_category.trim()) {
      values.push(body.q_s_category.trim());
      updates.push(`q_s_category = $${values.length}`);
    }
    if (typeof body.status === "boolean") {
      values.push(body.status);
      updates.push(`status = $${values.length}`);
    }
    if (updates.length === 0) return NextResponse.json({ error: "A topic field is required" }, { status: 400 });

    values.push(id);
    const result = await databasePool.query(
      `UPDATE question_topics SET ${updates.join(", ")} WHERE id = $${values.length} RETURNING id, topic, q_s_category, status, created_at`,
      values,
    );
    if (result.rowCount === 0) return NextResponse.json({ error: "Topic not found" }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error("Failed to update question topic", error);
    return NextResponse.json({ error: "Unable to update question topic" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { id?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "A valid id is required" }, { status: 400 });

    const result = await databasePool.query("DELETE FROM question_topics WHERE id = $1", [id]);
    if (result.rowCount === 0) return NextResponse.json({ error: "Topic not found" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete question topic", error);
    return NextResponse.json({ error: "Unable to delete question topic" }, { status: 500 });
  }
}
