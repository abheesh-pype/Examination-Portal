import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not configured");
}

type GlobalWithDatabasePool = typeof globalThis & {
  databasePool?: Pool;
};

const globalWithDatabasePool = globalThis as GlobalWithDatabasePool;

export const databasePool = globalWithDatabasePool.databasePool ?? new Pool({
  connectionString: databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

if (process.env.NODE_ENV !== "production") {
  globalWithDatabasePool.databasePool = databasePool;
}
