// Registers (or rotates the secret of) a machine client for a tenant. The secret is printed once and only its hash is stored.
//   DATABASE_URL=... node scripts/create-integration-client.mjs --tenant institution-001 [--client-id ums] [--scope students:write] [--rotate]
import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const tenant = option("tenant");
if (!tenant || !process.env.DATABASE_URL) {
  console.error("Usage: DATABASE_URL=... node scripts/create-integration-client.mjs --tenant <tenant_id> [--client-id <id>] [--scope \"students:write students:launch\"] [--rotate]");
  process.exit(1);
}
const clientId = option("client-id") ?? `${tenant}-client`;
const scope = option("scope") ?? "students:write students:launch";
const secret = randomBytes(32).toString("base64url");
const salt = randomBytes(16);
const hash = `scrypt$${salt.toString("base64url")}$${scryptSync(secret, salt, 32).toString("base64url")}`;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(`CREATE TABLE IF NOT EXISTS integration_clients (
    client_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, secret_hash TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT 'students:write students:launch', status BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const existing = await pool.query("SELECT tenant_id FROM integration_clients WHERE client_id = $1", [clientId]);
  if (existing.rowCount && !args.includes("--rotate")) {
    console.error(`Client "${clientId}" already exists. Pass --rotate to issue a new secret (the old one stops working).`);
    process.exit(1);
  }
  if (existing.rowCount && existing.rows[0].tenant_id !== tenant) {
    console.error(`Client "${clientId}" belongs to another tenant.`);
    process.exit(1);
  }
  await pool.query(
    `INSERT INTO integration_clients (client_id, tenant_id, secret_hash, scopes) VALUES ($1,$2,$3,$4)
     ON CONFLICT (client_id) DO UPDATE SET secret_hash = EXCLUDED.secret_hash, scopes = EXCLUDED.scopes, status = TRUE`,
    [clientId, tenant, hash, scope]);
  console.log("Client registered. Give these to the institution system (shown once):");
  console.log(`  EXAM_PORTAL_CLIENT_ID=${clientId}`);
  console.log(`  EXAM_PORTAL_CLIENT_SECRET=${secret}`);
} finally {
  await pool.end();
}
