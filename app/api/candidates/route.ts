import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";

export const runtime = "nodejs";

async function ensureCandidateInformationTable() {
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
      date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      candidate_data JSONB
    )
  `);
  await databasePool.query('ALTER TABLE "Candidate Information" ADD COLUMN IF NOT EXISTS record_type TEXT NOT NULL DEFAULT \'field\'');
  await databasePool.query('ALTER TABLE "Candidate Information" ADD COLUMN IF NOT EXISTS candidate_data JSONB');
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      category?: unknown;
      sub_category?: unknown;
      fields?: unknown;
      rows?: unknown;
    };

    if (Array.isArray(body.rows)) {
      if (body.rows.length === 0 || body.rows.length > 1000) {
        return NextResponse.json({ error: "Upload between 1 and 1000 candidate rows at a time" }, { status: 400 });
      }

      await ensureCandidateInformationTable();
      const client = await databasePool.connect();
      let transactionStarted = false;
      try {
        await client.query("BEGIN");
        transactionStarted = true;
        await client.query(`
          CREATE TABLE IF NOT EXISTS candidate_category (
            id SERIAL PRIMARY KEY,
            candidate_category TEXT NOT NULL,
            status BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS candidate_sub_category (
            id SERIAL PRIMARY KEY,
            candidate_sub_category TEXT NOT NULL,
            category TEXT NOT NULL,
            status BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        const infoResult = await client.query(`
          SELECT name, column_type, is_required, min_value, max_value, options
          FROM "Candidate Information"
          WHERE record_type = 'field' AND status = TRUE
          ORDER BY date ASC, id ASC
        `);
        const categoryResult = await client.query("SELECT candidate_category FROM candidate_category WHERE status = TRUE");
        const subCategoryResult = await client.query("SELECT candidate_sub_category, category FROM candidate_sub_category WHERE status = TRUE");
        const categoryNames = new Set(categoryResult.rows.map((row) => String(row.candidate_category)));
        const subCategoryRows = subCategoryResult.rows as Array<{ candidate_sub_category: string; category: string }>;
        const preparedRows: Array<{ category: string; subCategory: string; fields: Record<string, string> }> = [];
        const rowErrors: string[] = [];

        for (const [index, rawRow] of body.rows.entries()) {
          const rowNumber = index + 2;
          if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
            rowErrors.push(`Row ${rowNumber}: invalid row data.`);
            continue;
          }
          const row = rawRow as Record<string, unknown>;
          const category = typeof row.category === "string" ? row.category.trim() : "";
          const subCategory = typeof row.sub_category === "string" ? row.sub_category.trim() : "";
          const rawFields = row.fields && typeof row.fields === "object" && !Array.isArray(row.fields)
            ? row.fields as Record<string, unknown>
            : {};
          const fields: Record<string, string> = {};

          if (!categoryNames.has(category)) rowErrors.push(`Row ${rowNumber}: choose a valid Category.`);
          if (!subCategoryRows.some((entry) => entry.candidate_sub_category === subCategory && entry.category === category)) {
            rowErrors.push(`Row ${rowNumber}: Sub-Category does not belong to the selected Category.`);
          }

          for (const field of infoResult.rows) {
            const value = String(rawFields[String(field.name)] ?? "").trim();
            fields[String(field.name)] = value;
            if (field.is_required && !value) {
              rowErrors.push(`Row ${rowNumber}: ${field.name} is required.`);
              continue;
            }
            if (!value) continue;

            if (field.column_type === "Number") {
              const numericValue = Number(value);
              if (!Number.isFinite(numericValue)) {
                rowErrors.push(`Row ${rowNumber}: ${field.name} must be a number.`);
              } else if (field.min_value != null && numericValue < Number(field.min_value)) {
                rowErrors.push(`Row ${rowNumber}: ${field.name} must be at least ${field.min_value}.`);
              } else if (field.max_value != null && numericValue > Number(field.max_value)) {
                rowErrors.push(`Row ${rowNumber}: ${field.name} must be no more than ${field.max_value}.`);
              }
            }
            if (field.column_type === "Email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
              rowErrors.push(`Row ${rowNumber}: ${field.name} must be a valid email address.`);
            }
            if (field.column_type === "Date" && Number.isNaN(Date.parse(value))) {
              rowErrors.push(`Row ${rowNumber}: ${field.name} must be a valid date.`);
            }
            if (field.column_type === "Dropdown") {
              const configuredOptions = Array.isArray(field.options)
                ? field.options
                : typeof field.options === "string"
                  ? field.options.split(",").map((option: string) => option.trim())
                  : [];
              const allowedOptions = configuredOptions.filter((option: unknown): option is string => typeof option === "string");
              if (!allowedOptions.includes(value)) rowErrors.push(`Row ${rowNumber}: ${field.name} must match a configured dropdown option.`);
            }
          }

          preparedRows.push({ category, subCategory, fields });
        }

        if (rowErrors.length > 0) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return NextResponse.json({ error: "Some rows need correction. No candidates were imported.", row_errors: rowErrors }, { status: 400 });
        }

        const insertedRows = [];
        for (const row of preparedRows) {
          const candidateName = row.fields["Candidate Name"] || "Candidate";
          const result = await client.query(`
            INSERT INTO "Candidate Information" (record_type, name, column_type, candidate_data)
            VALUES ('candidate', $1, 'Candidate', $2::jsonb)
            RETURNING id, name, candidate_data, status, date
          `, [candidateName, JSON.stringify({ category: row.category, sub_category: row.subCategory, fields: row.fields })]);
          insertedRows.push(result.rows[0]);
        }
        await client.query("COMMIT");
        transactionStarted = false;
        return NextResponse.json({ imported: insertedRows.length, candidates: insertedRows }, { status: 201 });
      } catch (error) {
        if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }

    const fields = body.fields && typeof body.fields === "object" && !Array.isArray(body.fields) ? body.fields : {};
    const candidateData = {
      category: typeof body.category === "string" ? body.category : null,
      sub_category: typeof body.sub_category === "string" ? body.sub_category : null,
      fields,
    };
    const candidateName = typeof (fields as Record<string, unknown>)["Candidate Name"] === "string"
      ? String((fields as Record<string, unknown>)["Candidate Name"])
      : "Candidate";

    await ensureCandidateInformationTable();
    const result = await databasePool.query(
      `
        INSERT INTO "Candidate Information" (record_type, name, column_type, candidate_data)
        VALUES ('candidate', $1, 'Candidate', $2)
        RETURNING id, record_type, name, column_type, candidate_data, date
      `,
      [candidateName || "Candidate", JSON.stringify(candidateData)],
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error("Failed to save candidate", error);
    return NextResponse.json({ error: "Unable to save candidate" }, { status: 500 });
  }
}

export async function GET() {
  try {
    await ensureCandidateInformationTable();
    const result = await databasePool.query(
      `
        SELECT id, name, candidate_data, status, date
        FROM "Candidate Information"
        WHERE record_type = 'candidate'
        ORDER BY id DESC
      `
    );
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to fetch candidates", error);
    return NextResponse.json({ error: "Unable to fetch candidates" }, { status: 500 });
  }
}
