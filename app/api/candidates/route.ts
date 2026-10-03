import { NextResponse } from "next/server";
import { randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import { databasePool } from "@/lib/db";

export const runtime = "nodejs";

const candidateIdLockKey = 741923601;
const candidateIdMinimum = 100000;
const candidateIdRange = 900000;
const candidateIdBackfillKey = "candidate_id_six_digit_backfill_v1";

type CandidateRecord = {
  id: number;
  candidate_data: { fields?: Record<string, unknown> } | null;
};

function isCandidateIdFieldName(name: string) {
  return /^candidate id(?:\s*\([^)]*\))?$/i.test(name.trim());
}

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

async function acquireCandidateIdLock(client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock($1)", [candidateIdLockKey]);
}

async function getCandidateIdFieldName(client: PoolClient) {
  const result = await client.query(`
    SELECT name
    FROM "Candidate Information"
    WHERE record_type = 'field'
    ORDER BY date ASC, id ASC
  `);
  const fieldNames = (result.rows as Array<{ name: string }>).map((row) => row.name);
  return fieldNames.find((name) => name.trim().toLowerCase() === "candidate id")
    ?? fieldNames.find(isCandidateIdFieldName)
    ?? "Candidate ID";
}

function addCandidateIdsFromFields(existingIds: Set<string>, fields: Record<string, unknown>) {
  for (const [name, value] of Object.entries(fields)) {
    if (isCandidateIdFieldName(name) && typeof value === "string" && /^\d{6}$/.test(value)) {
      existingIds.add(value);
    }
  }
}

async function loadExistingCandidateIds(client: PoolClient) {
  const result = await client.query(`
    SELECT candidate_data
    FROM "Candidate Information"
    WHERE record_type = 'candidate'
  `);
  const existingIds = new Set<string>();
  for (const row of result.rows as Array<{ candidate_data: CandidateRecord["candidate_data"] }>) {
    addCandidateIdsFromFields(existingIds, row.candidate_data?.fields ?? {});
  }
  return existingIds;
}

function generateUniqueCandidateId(existingIds: Set<string>) {
  if (existingIds.size >= candidateIdRange) {
    throw new Error("Unable to generate a unique candidate ID: all six-digit IDs are in use.");
  }

  const start = randomInt(candidateIdMinimum, candidateIdMinimum + candidateIdRange);
  for (let offset = 0; offset < candidateIdRange; offset += 1) {
    const candidateId = String(candidateIdMinimum + ((start - candidateIdMinimum + offset) % candidateIdRange));
    if (!existingIds.has(candidateId)) {
      existingIds.add(candidateId);
      return candidateId;
    }
  }

  throw new Error("Unable to generate a unique candidate ID.");
}

async function backfillCandidateIds(client: PoolClient, candidateIdFieldName: string) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS candidate_data_migrations (
      migration_key TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const migrationResult = await client.query(
    "SELECT 1 FROM candidate_data_migrations WHERE migration_key = $1",
    [candidateIdBackfillKey],
  );
  if (migrationResult.rowCount) return;

  const candidateResult = await client.query(`
    SELECT id, candidate_data
    FROM "Candidate Information"
    WHERE record_type = 'candidate'
    ORDER BY id ASC
    FOR UPDATE
  `);
  const usedIds = new Set<string>();

  for (const candidate of candidateResult.rows as CandidateRecord[]) {
    const originalFields = candidate.candidate_data?.fields;
    const fields = originalFields && typeof originalFields === "object" && !Array.isArray(originalFields)
      ? { ...originalFields }
      : {};
    const candidateIdFields = Object.keys(fields).filter(isCandidateIdFieldName);
    if (!candidateIdFields.includes(candidateIdFieldName)) candidateIdFields.push(candidateIdFieldName);

    const existingId = candidateIdFields
      .map((fieldName) => fields[fieldName])
      .find((value): value is string => typeof value === "string" && /^\d{6}$/.test(value) && !usedIds.has(value));
    const candidateId = existingId ?? generateUniqueCandidateId(usedIds);
    usedIds.add(candidateId);

    let changed = !originalFields || typeof originalFields !== "object" || Array.isArray(originalFields);
    for (const fieldName of candidateIdFields) {
      if (fields[fieldName] !== candidateId) {
        fields[fieldName] = candidateId;
        changed = true;
      }
    }

    if (changed) {
      const candidateData = {
        ...(candidate.candidate_data ?? {}),
        fields,
      };
      await client.query(
        `UPDATE "Candidate Information" SET candidate_data = $2::jsonb WHERE id = $1`,
        [candidate.id, JSON.stringify(candidateData)],
      );
    }
  }

  await client.query(
    "INSERT INTO candidate_data_migrations (migration_key) VALUES ($1) ON CONFLICT (migration_key) DO NOTHING",
    [candidateIdBackfillKey],
  );
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
        await acquireCandidateIdLock(client);
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
            if (isCandidateIdFieldName(String(field.name))) continue;
            const value = String(field.name === "Candidate ID" ? "" : rawFields[String(field.name)] ?? "").trim();
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
        const candidateIdFieldName = await getCandidateIdFieldName(client);
        const existingCandidateIds = await loadExistingCandidateIds(client);
        for (const row of preparedRows) {
          row.fields[candidateIdFieldName] = generateUniqueCandidateId(existingCandidateIds);
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

    const fields = body.fields && typeof body.fields === "object" && !Array.isArray(body.fields)
      ? { ...(body.fields as Record<string, unknown>) }
      : {};
    await ensureCandidateInformationTable();
    const client = await databasePool.connect();
    let transactionStarted = false;
    let candidate: Record<string, unknown>;
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      await acquireCandidateIdLock(client);
      const existingCandidateIds = await loadExistingCandidateIds(client);
      const candidateIdFieldName = await getCandidateIdFieldName(client);
      fields[candidateIdFieldName] = generateUniqueCandidateId(existingCandidateIds);
      for (const fieldName of Object.keys(fields)) {
        if (isCandidateIdFieldName(fieldName)) fields[fieldName] = fields[candidateIdFieldName];
      }
      const candidateData = {
        category: typeof body.category === "string" ? body.category : null,
        sub_category: typeof body.sub_category === "string" ? body.sub_category : null,
        fields,
      };
      const candidateName = typeof fields["Candidate Name"] === "string"
        ? fields["Candidate Name"]
        : "Candidate";

      const result = await client.query(
        `
          INSERT INTO "Candidate Information" (record_type, name, column_type, candidate_data)
          VALUES ('candidate', $1, 'Candidate', $2)
          RETURNING id, record_type, name, column_type, candidate_data, date
        `,
        [candidateName || "Candidate", JSON.stringify(candidateData)],
      );
      candidate = result.rows[0];
      await client.query("COMMIT");
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    return NextResponse.json(candidate, { status: 201 });
  } catch (error) {
    console.error("Failed to save candidate", error);
    return NextResponse.json({ error: "Unable to save candidate" }, { status: 500 });
  }
}

export async function GET() {
  let client: PoolClient | undefined;
  let transactionStarted = false;
  try {
    await ensureCandidateInformationTable();
    client = await databasePool.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    await acquireCandidateIdLock(client);
    const candidateIdFieldName = await getCandidateIdFieldName(client);
    await backfillCandidateIds(client, candidateIdFieldName);
    const result = await client.query(
      `
        SELECT id, name, candidate_data, status, date
        FROM "Candidate Information"
        WHERE record_type = 'candidate'
        ORDER BY id DESC
      `
    );
    await client.query("COMMIT");
    transactionStarted = false;
    return NextResponse.json(result.rows);
  } catch (error) {
    if (client && transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to fetch candidates", error);
    return NextResponse.json({ error: "Unable to fetch candidates" }, { status: 500 });
  } finally {
    client?.release();
  }
}
