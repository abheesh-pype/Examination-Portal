import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { authorizeApiRequest } from "@/lib/auth";

export const runtime = "nodejs";

async function ensureLanguageTable() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS "Language" (
      id SERIAL PRIMARY KEY,
      q_language TEXT NOT NULL,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function GET(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    await ensureLanguageTable();
    const result = await databasePool.query('SELECT id, q_language, status, created_at FROM "Language" ORDER BY created_at DESC, id DESC');
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to load languages", error);
    return NextResponse.json({ error: "Unable to load languages" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as { q_language?: unknown };
    const language = typeof body.q_language === "string" ? body.q_language.trim() : "";
    if (!language) return NextResponse.json({ error: "Language is required" }, { status: 400 });

    await ensureLanguageTable();
    const result = await databasePool.query('INSERT INTO "Language" (q_language) VALUES ($1) RETURNING id, q_language, status, created_at', [language]);
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error("Failed to create language", error);
    return NextResponse.json({ error: "Unable to create language" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as { id?: unknown; q_language?: unknown; status?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "A valid id is required" }, { status: 400 });

    const updates: string[] = [];
    const values: unknown[] = [];
    if (typeof body.q_language === "string" && body.q_language.trim()) {
      values.push(body.q_language.trim());
      updates.push(`q_language = $${values.length}`);
    }
    if (typeof body.status === "boolean") {
      values.push(body.status);
      updates.push(`status = $${values.length}`);
    }
    if (!updates.length) return NextResponse.json({ error: "A language field is required" }, { status: 400 });

    values.push(id);
    const result = await databasePool.query(`UPDATE "Language" SET ${updates.join(", ")} WHERE id = $${values.length} RETURNING id, q_language, status, created_at`, values);
    if (!result.rowCount) return NextResponse.json({ error: "Language not found" }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error("Failed to update language", error);
    return NextResponse.json({ error: "Unable to update language" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as { id?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "A valid id is required" }, { status: 400 });

    const result = await databasePool.query('DELETE FROM "Language" WHERE id = $1', [id]);
    if (!result.rowCount) return NextResponse.json({ error: "Language not found" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete language", error);
    return NextResponse.json({ error: "Unable to delete language" }, { status: 500 });
  }
}
