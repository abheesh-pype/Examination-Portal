import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";

export const runtime = "nodejs";

type QuestionPayload = {
  id?: unknown;
  question_type?: unknown;
  question?: unknown;
  category?: unknown;
  sub_category?: unknown;
  topic?: unknown;
  difficulty_level?: unknown;
  language?: unknown;
  details?: unknown;
};

async function ensureQuestionsTable() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS questions (
      id SERIAL PRIMARY KEY,
      question_type TEXT NOT NULL,
      question TEXT NOT NULL,
      category TEXT,
      sub_category TEXT,
      topic TEXT,
      difficulty_level TEXT,
      language TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

const optionalText = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

export async function GET() {
  try {
    await ensureQuestionsTable();
    const result = await databasePool.query(`
      SELECT id, question_type, question, category, sub_category, topic,
             difficulty_level, language, details, status, created_at
      FROM questions
      ORDER BY created_at DESC, id DESC
    `);
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to load questions", error);
    return NextResponse.json({ error: "Unable to load questions" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as QuestionPayload;
    const questionType = optionalText(body.question_type);
    const question = optionalText(body.question);
    if (!questionType || !question) {
      return NextResponse.json({ error: "Question type and question text are required" }, { status: 400 });
    }

    const details = body.details && typeof body.details === "object" && !Array.isArray(body.details)
      ? body.details
      : {};

    await ensureQuestionsTable();
    const result = await databasePool.query(`
      INSERT INTO questions (
        question_type, question, category, sub_category, topic,
        difficulty_level, language, details
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      RETURNING id, question_type, question, category, sub_category, topic,
                difficulty_level, language, details, status, created_at
    `, [
      questionType,
      question,
      optionalText(body.category),
      optionalText(body.sub_category),
      optionalText(body.topic),
      optionalText(body.difficulty_level),
      optionalText(body.language),
      JSON.stringify(details),
    ]);

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error("Failed to create question", error);
    return NextResponse.json({ error: "Unable to create question" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as QuestionPayload;
    const id = Number(body.id);
    const questionType = optionalText(body.question_type);
    const question = optionalText(body.question);
    if (!Number.isInteger(id) || id <= 0 || !questionType || !question) {
      return NextResponse.json({ error: "A valid question id, type, and text are required" }, { status: 400 });
    }

    const details = body.details && typeof body.details === "object" && !Array.isArray(body.details)
      ? body.details
      : {};

    await ensureQuestionsTable();
    const result = await databasePool.query(`
      UPDATE questions
      SET question_type = $1, question = $2, category = $3, sub_category = $4,
          topic = $5, difficulty_level = $6, language = $7, details = $8::jsonb
      WHERE id = $9
      RETURNING id, question_type, question, category, sub_category, topic,
                difficulty_level, language, details, status, created_at
    `, [
      questionType,
      question,
      optionalText(body.category),
      optionalText(body.sub_category),
      optionalText(body.topic),
      optionalText(body.difficulty_level),
      optionalText(body.language),
      JSON.stringify(details),
      id,
    ]);

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error("Failed to update question", error);
    return NextResponse.json({ error: "Unable to update question" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { id?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "A valid question id is required" }, { status: 400 });
    }

    await ensureQuestionsTable();
    const result = await databasePool.query("DELETE FROM questions WHERE id = $1", [id]);
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete question", error);
    return NextResponse.json({ error: "Unable to delete question" }, { status: 500 });
  }
}