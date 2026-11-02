import { PGlite } from "@electric-sql/pglite";

// An in-memory PostgreSQL (PGlite) exposed through the subset of the pg Pool API the app uses,
// so route handlers run real SQL without touching the configured DATABASE_URL.
const database = new PGlite();

type QueryResult = { rows: Record<string, unknown>[]; rowCount: number };

async function query(text: string, params: unknown[] = []): Promise<QueryResult> {
  const result = await database.query<Record<string, unknown>>(text, params);
  return { rows: result.rows, rowCount: result.rows.length || result.affectedRows || 0 };
}

export const pool = {
  query,
  async connect() {
    return { query, release() {} };
  },
};
