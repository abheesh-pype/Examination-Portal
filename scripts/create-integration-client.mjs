#!/usr/bin/env node
// Creates (or rotates the secret of) an OAuth client that UMS uses to call the portal.
//
//   node scripts/create-integration-client.mjs --client-id ums-prod --tenant-id institution-001 \
//     [--scopes "students:write students:launch staff:launch assessments:write results:read"] [--rotate]
//
// The client secret is printed once and only its scrypt hash is stored.
// DATABASE_URL is read from the environment, falling back to .env.local.
import { randomBytes, scrypt } from "node:crypto";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import pg from "pg";

const knownScopes = ["students:write", "students:launch", "staff:launch", "assessments:write", "results:read"];
const scryptAsync = promisify(scrypt);

function readArguments(argv) {
  const options = { rotate: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--rotate") options.rotate = true;
    else if (["--client-id", "--tenant-id", "--scopes"].includes(argument)) options[argument.slice(2)] = argv[++index];
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
  const clientId = options["client-id"]?.trim();
  const tenantId = options["tenant-id"]?.trim();
  const scopes = [...new Set((options.scopes ?? knownScopes.join(" ")).split(/[\s,]+/).filter(Boolean))];
  if (!clientId || !/^[A-Za-z0-9._-]{3,100}$/.test(clientId)) throw new Error("--client-id is required (3-100 of A-Z a-z 0-9 . _ -).");
  if (!tenantId) throw new Error("--tenant-id is required.");
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
    const clientSecret = randomBytes(32).toString("base64url");
    const secretHash = await hashSecret(clientSecret);
    const result = options.rotate
      ? await pool.query(`
          UPDATE integration_clients
          SET client_secret_hash = $2, tenant_id = $3, scopes = $4, status = TRUE
          WHERE client_id = $1
          RETURNING client_id
        `, [clientId, secretHash, tenantId, scopes])
      : await pool.query(`
          INSERT INTO integration_clients (client_id, client_secret_hash, tenant_id, scopes)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (client_id) DO NOTHING
          RETURNING client_id
        `, [clientId, secretHash, tenantId, scopes]);
    if (!result.rowCount) {
      throw new Error(options.rotate
        ? `No client named ${clientId} exists.`
        : `Client ${clientId} already exists. Use --rotate to issue a new secret.`);
    }
    if (options.rotate) {
      // Tokens issued with the old secret stop working immediately.
      await pool.query("DELETE FROM integration_access_tokens WHERE client_id = $1", [clientId]).catch(() => undefined);
    }

    console.log(`client_id:     ${clientId}`);
    console.log(`tenant_id:     ${tenantId}`);
    console.log(`scopes:        ${scopes.join(" ")}`);
    console.log(`client_secret: ${clientSecret}`);
    console.log("\nStore the secret in the UMS secret manager now. It is not stored and cannot be shown again.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
