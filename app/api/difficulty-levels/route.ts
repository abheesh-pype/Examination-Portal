import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { authorizeApiRequest } from "@/lib/auth";

export const runtime = "nodejs";

async function ensureDifficultyLevelTable() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS "Difficulty_level" (
      id SERIAL PRIMARY KEY,
      "Difficulty_level" TEXT NOT NULL,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function GET(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    await ensureDifficultyLevelTable();
    const result = await databasePool.query('SELECT id, "Difficulty_level", status, created_at FROM "Difficulty_level" ORDER BY created_at DESC, id DESC');
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to load difficulty levels", error);
    return NextResponse.json({ error: "Unable to load difficulty levels" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as { Difficulty_level?: unknown };
    const difficultyLevel = typeof body.Difficulty_level === "string" ? body.Difficulty_level.trim() : "";
    if (!difficultyLevel) return NextResponse.json({ error: "Difficulty level is required" }, { status: 400 });

    await ensureDifficultyLevelTable();
    const result = await databasePool.query('INSERT INTO "Difficulty_level" ("Difficulty_level") VALUES ($1) RETURNING id, "Difficulty_level", status, created_at', [difficultyLevel]);
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error("Failed to create difficulty level", error);
    return NextResponse.json({ error: "Unable to create difficulty level" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as { id?: unknown; Difficulty_level?: unknown; status?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "A valid id is required" }, { status: 400 });

    const updates: string[] = [];
    const values: unknown[] = [];
    if (typeof body.Difficulty_level === "string" && body.Difficulty_level.trim()) {
      values.push(body.Difficulty_level.trim());
      updates.push(`"Difficulty_level" = $${values.length}`);
    }
    if (typeof body.status === "boolean") {
      values.push(body.status);
      updates.push(`status = $${values.length}`);
    }
    if (!updates.length) return NextResponse.json({ error: "A difficulty level field is required" }, { status: 400 });

    values.push(id);
    const result = await databasePool.query(`UPDATE "Difficulty_level" SET ${updates.join(", ")} WHERE id = $${values.length} RETURNING id, "Difficulty_level", status, created_at`, values);
    if (!result.rowCount) return NextResponse.json({ error: "Difficulty level not found" }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error("Failed to update difficulty level", error);
    return NextResponse.json({ error: "Unable to update difficulty level" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as { id?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "A valid id is required" }, { status: 400 });

    const result = await databasePool.query('DELETE FROM "Difficulty_level" WHERE id = $1', [id]);
    if (!result.rowCount) return NextResponse.json({ error: "Difficulty level not found" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete difficulty level", error);
    return NextResponse.json({ error: "Unable to delete difficulty level" }, { status: 500 });
  }
}
