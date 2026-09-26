import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";

export const runtime = "nodejs";

type AssessmentPayload = {
  id?: unknown;
  examination?: unknown;
  name?: unknown;
  start_date?: unknown;
  end_date?: unknown;
  total_time?: unknown;
  last_login?: unknown;
  question_category?: unknown;
  sub_category?: unknown;
  topic?: unknown;
  question_language?: unknown;
  sections?: unknown;
};

async function ensureAssessmentTable() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment (
      id SERIAL PRIMARY KEY,
      examination TEXT NOT NULL,
      name TEXT NOT NULL,
      start_date TIMESTAMPTZ,
      end_date TIMESTAMPTZ,
      total_time INTEGER,
      last_login INTEGER,
      question_category TEXT,
      sub_category TEXT,
      topic TEXT,
      question_language TEXT,
      sections JSONB NOT NULL DEFAULT '[]'::jsonb,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

const optionalText = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const optionalInteger = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
};
const optionalDate = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export async function GET() {
  try {
    await ensureAssessmentTable();
    const result = await databasePool.query(`
      SELECT id, examination, name, start_date, end_date, total_time, last_login,
             question_category, sub_category, topic, question_language, sections,
             status, created_at
      FROM assessment
      ORDER BY created_at DESC, id DESC
    `);
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to load assessments", error);
    return NextResponse.json({ error: "Unable to load assessments" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as AssessmentPayload;

    if (Array.isArray((body as AssessmentPayload & { rows?: unknown }).rows)) {
      const rows = (body as AssessmentPayload & { rows: unknown[] }).rows;
      if (rows.length === 0 || rows.length > 500) {
        return NextResponse.json({ error: "Upload between 1 and 500 assessments at a time" }, { status: 400 });
      }

      const rowErrors: string[] = [];
      const preparedRows: Array<{
        examination: string;
        name: string;
        startDate: string | null;
        endDate: string | null;
        totalTime: number | null;
        lastLogin: number | null;
        questionCategory: string | null;
        subCategory: string | null;
        topic: string | null;
        questionLanguage: string | null;
        sections: unknown[];
      }> = [];

      for (const [index, rawRow] of rows.entries()) {
        const rowNumber = index + 2;
        if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
          rowErrors.push(`Row ${rowNumber}: invalid row data.`);
          continue;
        }
        const row = rawRow as AssessmentPayload;
        const examination = optionalText(row.examination);
        const name = optionalText(row.name);
        const startDateText = optionalText(row.start_date);
        const endDateText = optionalText(row.end_date);
        const totalTimeText = optionalText(row.total_time);
        const lastLoginText = optionalText(row.last_login);
        const startDate = optionalDate(startDateText);
        const endDate = optionalDate(endDateText);
        const totalTime = optionalInteger(totalTimeText);
        const lastLogin = optionalInteger(lastLoginText);
        let sections: unknown[] = [];

        if (!examination) rowErrors.push(`Row ${rowNumber}: Examination is required.`);
        if (!name) rowErrors.push(`Row ${rowNumber}: Name is required.`);
        if (startDateText && !startDate) rowErrors.push(`Row ${rowNumber}: Start Date is invalid.`);
        if (endDateText && !endDate) rowErrors.push(`Row ${rowNumber}: End Date is invalid.`);
        if (totalTimeText && (totalTime === null || totalTime < 1)) rowErrors.push(`Row ${rowNumber}: Total Time must be a positive whole number.`);
        if (lastLoginText && (lastLogin === null || lastLogin < 1)) rowErrors.push(`Row ${rowNumber}: Last Login Time must be a positive whole number.`);

        if (Array.isArray(row.sections)) {
          sections = row.sections;
        } else if (typeof row.sections === "string" && row.sections.trim()) {
          try {
            const parsedSections: unknown = JSON.parse(row.sections);
            if (!Array.isArray(parsedSections)) throw new Error("Sections JSON must be an array.");
            sections = parsedSections;
          } catch {
            rowErrors.push(`Row ${rowNumber}: Sections JSON must be a valid JSON array.`);
          }
        }

        preparedRows.push({
          examination: examination ?? "",
          name: name ?? "",
          startDate,
          endDate,
          totalTime,
          lastLogin,
          questionCategory: optionalText(row.question_category),
          subCategory: optionalText(row.sub_category),
          topic: optionalText(row.topic),
          questionLanguage: optionalText(row.question_language),
          sections,
        });
      }

      if (rowErrors.length > 0) {
        return NextResponse.json({ error: "Some rows need correction. No assessments were imported.", row_errors: rowErrors }, { status: 400 });
      }

      await ensureAssessmentTable();
      const client = await databasePool.connect();
      let transactionStarted = false;
      try {
        await client.query("BEGIN");
        transactionStarted = true;
        const insertedRows = [];
        for (const row of preparedRows) {
          const result = await client.query(`
            INSERT INTO assessment (
              examination, name, start_date, end_date, total_time, last_login,
              question_category, sub_category, topic, question_language, sections
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
            RETURNING id, examination, name, start_date, end_date, total_time, last_login,
                      question_category, sub_category, topic, question_language, sections,
                      status, created_at
          `, [
            row.examination,
            row.name,
            row.startDate,
            row.endDate,
            row.totalTime,
            row.lastLogin,
            row.questionCategory,
            row.subCategory,
            row.topic,
            row.questionLanguage,
            JSON.stringify(row.sections),
          ]);
          insertedRows.push(result.rows[0]);
        }
        await client.query("COMMIT");
        transactionStarted = false;
        return NextResponse.json({ imported: insertedRows.length, assessments: insertedRows }, { status: 201 });
      } catch (error) {
        if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }

    const examination = optionalText(body.examination);
    const name = optionalText(body.name);
    if (!examination || !name) {
      return NextResponse.json({ error: "Examination and assessment name are required" }, { status: 400 });
    }

    const sections = Array.isArray(body.sections) ? body.sections : [];
    await ensureAssessmentTable();
    const result = await databasePool.query(`
      INSERT INTO assessment (
        examination, name, start_date, end_date, total_time, last_login,
        question_category, sub_category, topic, question_language, sections
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
      RETURNING id, examination, name, start_date, end_date, total_time, last_login,
                question_category, sub_category, topic, question_language, sections,
                status, created_at
    `, [
      examination,
      name,
      optionalDate(body.start_date),
      optionalDate(body.end_date),
      optionalInteger(body.total_time),
      optionalInteger(body.last_login),
      optionalText(body.question_category),
      optionalText(body.sub_category),
      optionalText(body.topic),
      optionalText(body.question_language),
      JSON.stringify(sections),
    ]);

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error("Failed to create assessment", error);
    return NextResponse.json({ error: "Unable to create assessment" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as AssessmentPayload;
    const id = Number(body.id);
    const examination = optionalText(body.examination);
    const name = optionalText(body.name);
    if (!Number.isInteger(id) || id <= 0 || !examination || !name) {
      return NextResponse.json({ error: "A valid assessment id, examination, and name are required" }, { status: 400 });
    }

    const sections = Array.isArray(body.sections) ? body.sections : [];
    await ensureAssessmentTable();
    const result = await databasePool.query(`
      UPDATE assessment
      SET examination = $1, name = $2, start_date = $3, end_date = $4,
          total_time = $5, last_login = $6, question_category = $7,
          sub_category = $8, topic = $9, question_language = $10, sections = $11::jsonb
      WHERE id = $12
      RETURNING id, examination, name, start_date, end_date, total_time, last_login,
                question_category, sub_category, topic, question_language, sections,
                status, created_at
    `, [
      examination,
      name,
      optionalDate(body.start_date),
      optionalDate(body.end_date),
      optionalInteger(body.total_time),
      optionalInteger(body.last_login),
      optionalText(body.question_category),
      optionalText(body.sub_category),
      optionalText(body.topic),
      optionalText(body.question_language),
      JSON.stringify(sections),
      id,
    ]);

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error("Failed to update assessment", error);
    return NextResponse.json({ error: "Unable to update assessment" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { id?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "A valid assessment id is required" }, { status: 400 });
    }

    await ensureAssessmentTable();
    const result = await databasePool.query("DELETE FROM assessment WHERE id = $1", [id]);
    if (!result.rowCount) {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete assessment", error);
    return NextResponse.json({ error: "Unable to delete assessment" }, { status: 500 });
  }
}
