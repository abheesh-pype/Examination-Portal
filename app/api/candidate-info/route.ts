import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";

export const runtime = "nodejs";

async function ensureCandidateInfoTable() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS candidate_info_type (
      id SERIAL PRIMARY KEY,
      "type" TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await databasePool.query(
    `INSERT INTO candidate_info_type ("type") VALUES ('Choose'), ('Text'), ('Number'), ('Dropdown'), ('Date'), ('Email') ON CONFLICT ("type") DO NOTHING`,
  );

  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS "Candidate_Info" (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      column_type TEXT NOT NULL,
      is_dependent BOOLEAN NOT NULL DEFAULT FALSE,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      is_required BOOLEAN NOT NULL DEFAULT FALSE,
      min_value NUMERIC,
      max_value NUMERIC,
      options JSONB,
      dependent_on TEXT,
      date TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS "Candidate Information" (
      id SERIAL PRIMARY KEY,
      record_type TEXT NOT NULL DEFAULT 'field',
      name TEXT NOT NULL,
      column_type TEXT NOT NULL,
      is_dependent BOOLEAN NOT NULL DEFAULT FALSE,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      is_required BOOLEAN NOT NULL DEFAULT FALSE,
      min_value NUMERIC,
      max_value NUMERIC,
      options JSONB,
      dependent_on TEXT,
      date TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await databasePool.query('ALTER TABLE "Candidate Information" ADD COLUMN IF NOT EXISTS record_type TEXT NOT NULL DEFAULT \'field\'');
  await databasePool.query('ALTER TABLE "Candidate Information" ADD COLUMN IF NOT EXISTS candidate_data JSONB');

  await databasePool.query(`
    INSERT INTO "Candidate Information" (name, column_type, is_dependent, status, is_required, min_value, max_value, options, dependent_on, date)
    SELECT source.name, source.column_type, source.is_dependent, source.status, source.is_required, source.min_value, source.max_value, source.options, source.dependent_on, source.date
    FROM "Candidate_Info" AS source
    WHERE NOT EXISTS (
      SELECT 1 FROM "Candidate Information" AS target
      WHERE target.name = source.name AND target.column_type = source.column_type
    )
  `);

  const countResult = await databasePool.query('SELECT COUNT(*)::int AS count FROM "Candidate_Info"');
  if (countResult.rows[0].count === 0) {
    await databasePool.query(`
      INSERT INTO "Candidate_Info" (name, column_type, is_dependent, status, is_required)
      VALUES
        ('Candidate ID', 'Text', FALSE, TRUE, TRUE),
        ('Candidate Name', 'Text', FALSE, TRUE, TRUE),
        ('Candidate Email', 'Email', FALSE, TRUE, TRUE)
    `);
  }

  const dateOfBirthField = await databasePool.query(`
    SELECT name
    FROM "Candidate Information"
    WHERE record_type = 'field'
      AND LOWER(TRIM(name)) ~ '^(dob|date of birth|birth date)([[:space:]]*\\([^)]*\\))?$'
    LIMIT 1
  `);
  if (dateOfBirthField.rowCount === 0) {
    await databasePool.query(`
      INSERT INTO "Candidate Information" (record_type, name, column_type, status, is_required)
      VALUES ('field', 'Date of Birth', 'Date', TRUE, TRUE)
    `);
  }
}

export async function GET() {
  try {
    await ensureCandidateInfoTable();
    const result = await databasePool.query(
      "SELECT id, name, column_type, is_dependent, status, is_required, min_value, max_value, options, dependent_on, date FROM \"Candidate Information\" WHERE record_type = 'field' ORDER BY date DESC, id DESC"
    );
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to load candidate info", error);
    return NextResponse.json({ error: "Unable to load candidate info" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      name?: unknown;
      column_type?: unknown;
      is_dependent?: unknown;
      status?: unknown;
      is_required?: unknown;
      min_value?: unknown;
      max_value?: unknown;
      options?: unknown;
      dependent_on?: unknown;
      date?: unknown;
    };

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const columnType = typeof body.column_type === "string" ? body.column_type.trim() : "";
    if (!name || !columnType) {
      return NextResponse.json({ error: "Name and column type are required" }, { status: 400 });
    }

    await ensureCandidateInfoTable();
    const result = await databasePool.query(
      `
        INSERT INTO "Candidate Information" (record_type, name, column_type, is_dependent, status, is_required, min_value, max_value, options, dependent_on, date)
        VALUES ('field', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, name, column_type, is_dependent, status, is_required, min_value, max_value, options, dependent_on, date
      `,
      [
        name,
        columnType,
        typeof body.is_dependent === "boolean" ? body.is_dependent : false,
        typeof body.status === "boolean" ? body.status : true,
        typeof body.is_required === "boolean" ? body.is_required : false,
        body.min_value ?? null,
        body.max_value ?? null,
        body.options ?? null,
        typeof body.dependent_on === "string" ? body.dependent_on.trim() || null : null,
        body.date ?? new Date(),
      ]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error("Failed to create candidate info", error);
    return NextResponse.json({ error: "Unable to create candidate info" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as {
      id?: unknown;
      name?: unknown;
      column_type?: unknown;
      is_dependent?: unknown;
      status?: unknown;
      is_required?: unknown;
      min_value?: unknown;
      max_value?: unknown;
      options?: unknown;
      dependent_on?: unknown;
      date?: unknown;
    };

    const id = Number(body.id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "A valid id is required" }, { status: 400 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (typeof body.name === "string" && body.name.trim()) {
      values.push(body.name.trim());
      updates.push(`name = $${values.length}`);
    }
    if (typeof body.column_type === "string" && body.column_type.trim()) {
      values.push(body.column_type.trim());
      updates.push(`column_type = $${values.length}`);
    }
    if (typeof body.is_dependent === "boolean") {
      values.push(body.is_dependent);
      updates.push(`is_dependent = $${values.length}`);
    }
    if (typeof body.status === "boolean") {
      values.push(body.status);
      updates.push(`status = $${values.length}`);
    }
    if (typeof body.is_required === "boolean") {
      values.push(body.is_required);
      updates.push(`is_required = $${values.length}`);
    }
    if (body.min_value !== undefined) {
      values.push(body.min_value);
      updates.push(`min_value = $${values.length}`);
    }
    if (body.max_value !== undefined) {
      values.push(body.max_value);
      updates.push(`max_value = $${values.length}`);
    }
    if (body.options !== undefined) {
      values.push(body.options);
      updates.push(`options = $${values.length}`);
    }
    if (typeof body.dependent_on === "string") {
      values.push(body.dependent_on.trim() || null);
      updates.push(`dependent_on = $${values.length}`);
    }
    if (body.date !== undefined) {
      values.push(body.date);
      updates.push(`date = $${values.length}`);
    }

    if (!updates.length) {
      return NextResponse.json({ error: "At least one field is required to update" }, { status: 400 });
    }

    values.push(id);
    const result = await databasePool.query(
      `UPDATE "Candidate Information" SET ${updates.join(", ")} WHERE record_type = 'field' AND id = $${values.length} RETURNING id, name, column_type, is_dependent, status, is_required, min_value, max_value, options, dependent_on, date`,
      values
    );

    if (!result.rowCount) {
      return NextResponse.json({ error: "Candidate info not found" }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error("Failed to update candidate info", error);
    return NextResponse.json({ error: "Unable to update candidate info" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { id?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "A valid id is required" }, { status: 400 });
    }

    const result = await databasePool.query('DELETE FROM "Candidate Information" WHERE record_type = \'field\' AND id = $1', [id]);
    if (!result.rowCount) {
      return NextResponse.json({ error: "Candidate info not found" }, { status: 404 });
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete candidate info", error);
    return NextResponse.json({ error: "Unable to delete candidate info" }, { status: 500 });
  }
}
