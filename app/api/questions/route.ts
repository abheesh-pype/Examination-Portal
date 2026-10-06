import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { authorizeApiRequest } from "@/lib/auth";

export const runtime = "nodejs";

type QuestionPayload = {
  id?: unknown;
  rows?: unknown;
  question_type?: unknown;
  question?: unknown;
  category?: unknown;
  sub_category?: unknown;
  topic?: unknown;
  difficulty_level?: unknown;
  language?: unknown;
  details?: unknown;
  status?: unknown;
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

export async function GET(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
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
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as QuestionPayload;
    if (Array.isArray(body.rows)) {
      if (body.rows.length === 0 || body.rows.length > 1000) {
        return NextResponse.json({ error: "Upload between 1 and 1000 questions at a time" }, { status: 400 });
      }

      const validQuestionTypes = new Set([
        "Single Choice", "Multiple Choice", "Fill in the Blank", "True/False", "Yes/No",
        "Agree/Disagree", "Good/Bad", "Manual Evaluation", "Passage Type",
      ]);
      const rowErrors: string[] = [];
      const preparedRows: Array<{
        questionType: string;
        question: string;
        category: string | null;
        subCategory: string | null;
        topic: string | null;
        difficultyLevel: string | null;
        language: string | null;
        details: Record<string, unknown>;
      }> = [];

      for (const [index, rawRow] of body.rows.entries()) {
        const rowNumber = index + 2;
        if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
          rowErrors.push(`Row ${rowNumber}: invalid row data.`);
          continue;
        }
        const row = rawRow as QuestionPayload;
        const questionType = optionalText(row.question_type);
        const question = optionalText(row.question);
        let details: Record<string, unknown> = {};

        if (!questionType || !validQuestionTypes.has(questionType)) {
          rowErrors.push(`Row ${rowNumber}: choose a valid Question Type.`);
        }
        if (!question) rowErrors.push(`Row ${rowNumber}: Question is required.`);
        if (typeof row.details === "string" && row.details.trim()) {
          try {
            const parsedDetails: unknown = JSON.parse(row.details);
            if (!parsedDetails || typeof parsedDetails !== "object" || Array.isArray(parsedDetails)) {
              throw new Error("Details JSON must be an object.");
            }
            details = parsedDetails as Record<string, unknown>;
          } catch {
            rowErrors.push(`Row ${rowNumber}: Details JSON must be a valid JSON object.`);
          }
        } else if (row.details && typeof row.details === "object" && !Array.isArray(row.details)) {
          details = row.details as Record<string, unknown>;
        }

        preparedRows.push({
          questionType: questionType ?? "",
          question: question ?? "",
          category: optionalText(row.category),
          subCategory: optionalText(row.sub_category),
          topic: optionalText(row.topic),
          difficultyLevel: optionalText(row.difficulty_level),
          language: optionalText(row.language),
          details,
        });
      }

      if (rowErrors.length > 0) {
        return NextResponse.json({ error: "Some rows need correction. No questions were imported.", row_errors: rowErrors }, { status: 400 });
      }

      await ensureQuestionsTable();
      const client = await databasePool.connect();
      let transactionStarted = false;
      try {
        await client.query("BEGIN");
        transactionStarted = true;
        const insertedRows = [];
        for (const row of preparedRows) {
          const result = await client.query(`
            INSERT INTO questions (
              question_type, question, category, sub_category, topic,
              difficulty_level, language, details
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
            RETURNING id, question_type, question, category, sub_category, topic,
                      difficulty_level, language, details, status, created_at
          `, [
            row.questionType,
            row.question,
            row.category,
            row.subCategory,
            row.topic,
            row.difficultyLevel,
            row.language,
            JSON.stringify(row.details),
          ]);
          insertedRows.push(result.rows[0]);
        }
        await client.query("COMMIT");
        transactionStarted = false;
        return NextResponse.json({ imported: insertedRows.length, questions: insertedRows }, { status: 201 });
      } catch (error) {
        if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }

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
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as QuestionPayload;
    const id = Number(body.id);

    if (typeof body.status === "boolean") {
      if (!Number.isInteger(id) || id <= 0) {
        return NextResponse.json({ error: "A valid question id is required" }, { status: 400 });
      }

      await ensureQuestionsTable();
      const statusResult = await databasePool.query(`
        UPDATE questions
        SET status = $1
        WHERE id = $2
        RETURNING id, question_type, question, category, sub_category, topic,
                  difficulty_level, language, details, status, created_at
      `, [body.status, id]);

      if (statusResult.rowCount === 0) {
        return NextResponse.json({ error: "Question not found" }, { status: 404 });
      }
      return NextResponse.json(statusResult.rows[0]);
    }

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
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
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