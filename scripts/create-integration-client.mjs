#!/usr/bin/env node
// Registers (or rotates the secret of) a machine client for a tenant, such as UMS calling the portal.
//
//   node scripts/create-integration-client.mjs --tenant-id institution-001 [--client-id ums-prod] \
//     [--scopes "students:write students:launch staff:launch assessments:write results:read"] [--rotate | --scopes-only]
//
// --tenant and --scope are accepted as aliases. The client secret is printed once and only its scrypt hash is stored.
// DATABASE_URL is read from the environment, falling back to .env.local.
import { randomBytes, scrypt } from "node:crypto";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import pg from "pg";

const knownScopes = ["students:write", "students:launch", "staff:launch", "assessments:write", "results:read"];
const scryptAsync = promisify(scrypt);

const optionAliases = { "--tenant": "tenant-id", "--tenant-id": "tenant-id", "--client-id": "client-id", "--scope": "scopes", "--scopes": "scopes" };

function readArguments(argv) {
  const options = { rotate: false, scopesOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--rotate") options.rotate = true;
    else if (argument === "--scopes-only") options.scopesOnly = true;
    else if (optionAliases[argument]) options[optionAliases[argument]] = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

async function hashSecret(secret) {
  // Same format as lib/password.ts so verifyPassword() accepts it.
  const salt = randomBytes(16);
  const key = await scryptAsync(secret, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function main() {
  const options = readArguments(process.argv.slice(2));
  const tenantId = options["tenant-id"]?.trim();
  if (!tenantId) throw new Error("--tenant-id is required.");
  const clientId = options["client-id"]?.trim() || `${tenantId}-client`;
  const scopes = [...new Set((options.scopes ?? knownScopes.join(" ")).split(/[\s,]+/).filter(Boolean))];
  if (!/^[A-Za-z0-9._-]{3,100}$/.test(clientId)) throw new Error("--client-id must be 3-100 of A-Z a-z 0-9 . _ -");
  const unknownScopes = scopes.filter((scope) => !knownScopes.includes(scope));
  if (unknownScopes.length) throw new Error(`Unknown scopes: ${unknownScopes.join(", ")}. Allowed: ${knownScopes.join(", ")}`);

  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS integration_clients (
        id SERIAL PRIMARY KEY,
        client_id TEXT NOT NULL UNIQUE,
        client_secret_hash TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        scopes TEXT[] NOT NULL DEFAULT '{}',
        status BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Databases created by the earlier built-in issuer have secret_hash and space-separated scopes.
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = current_schema() AND table_name = 'integration_clients' AND column_name = 'secret_hash') THEN
          ALTER TABLE integration_clients RENAME COLUMN secret_hash TO client_secret_hash;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = current_schema() AND table_name = 'integration_clients' AND column_name = 'scopes' AND data_type = 'text') THEN
          ALTER TABLE integration_clients ALTER COLUMN scopes DROP DEFAULT;
          ALTER TABLE integration_clients ALTER COLUMN scopes TYPE TEXT[] USING string_to_array(BTRIM(scopes), ' ');
          ALTER TABLE integration_clients ALTER COLUMN scopes SET DEFAULT '{}';
        END IF;
      END $$
    `);

    const existing = await pool.query("SELECT tenant_id FROM integration_clients WHERE client_id = $1", [clientId]);
    if (existing.rowCount && existing.rows[0].tenant_id !== tenantId) throw new Error(`Client ${clientId} belongs to another tenant.`);

    if (options.scopesOnly) {
      // Widen or narrow an existing client's scopes without touching its secret.
      if (!existing.rowCount) throw new Error(`Client ${clientId} does not exist for tenant ${tenantId}.`);
      await pool.query("UPDATE integration_clients SET scopes = $2 WHERE client_id = $1", [clientId, scopes]);
      console.log(`Scopes for ${clientId} are now: ${scopes.join(" ")}`);
      return;
    }
    if (options.rotate && !existing.rowCount) throw new Error(`No client named ${clientId} exists.`);
    if (!options.rotate && existing.rowCount) throw new Error(`Client ${clientId} already exists. Use --rotate to issue a new secret.`);

    const clientSecret = randomBytes(32).toString("base64url");
    const secretHash = await hashSecret(clientSecret);
    await pool.query(`
      INSERT INTO integration_clients (client_id, client_secret_hash, tenant_id, scopes)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (client_id) DO UPDATE SET client_secret_hash = EXCLUDED.client_secret_hash, scopes = EXCLUDED.scopes, status = TRUE
    `, [clientId, secretHash, tenantId, scopes]);
    if (options.rotate) {
      // Opaque tokens issued with the old secret stop working immediately.
      await pool.query("DELETE FROM integration_access_tokens WHERE client_id = $1", [clientId]).catch(() => undefined);
    }

    console.log("Client registered. Give these to the institution system (shown once):");
    console.log(`  UMS_TENANT_ID=${tenantId}`);
    console.log(`  EXAM_PORTAL_CLIENT_ID=${clientId}`);
    console.log(`  EXAM_PORTAL_CLIENT_SECRET=${clientSecret}`);
    console.log(`  EXAM_PORTAL_SCOPE=${scopes.join(" ")}`);
    console.log("\nStore the secret in the UMS secret manager now. It is not stored and cannot be shown again.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
