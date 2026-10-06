import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { authorizeApiRequest } from "@/lib/auth";

export const runtime = "nodejs";

const defaultTypes = ["Choose", "Text", "Number", "Dropdown", "Date", "Email"];

async function ensureCandidateInfoTypeTable() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS candidate_info_type (
      id SERIAL PRIMARY KEY,
      "type" TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await databasePool.query(
    `INSERT INTO candidate_info_type ("type") VALUES ${defaultTypes.map((_, index) => `($${index + 1})`).join(", ")}
     ON CONFLICT ("type") DO NOTHING`,
    defaultTypes,
  );
}

export async function GET(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    await ensureCandidateInfoTypeTable();
    const result = await databasePool.query(
      'SELECT id, "type", created_at FROM candidate_info_type ORDER BY id ASC',
    );
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to load candidate info types", error);
    return NextResponse.json({ error: "Unable to load candidate info types" }, { status: 500 });
  }
}
