import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { databasePool } from "@/lib/db";
import { decodeJwt } from "jose";
import { hashPassword, verifyPassword } from "@/lib/password";
import { IntegrationError, loadTenants } from "@/lib/integrations/tokens";
import { verifySecret } from "@/lib/integrations/issuer";
import { verifyTenantToken } from "@/lib/integrations/request";

export const INTEGRATION_AUDIENCE = "exam-portal-api";
export const ACCESS_TOKEN_LIFETIME_SECONDS = 60 * 60;
export const UMS_ASSIGNMENT_SOURCE = "ums";

export const integrationScopes = [
  "students:write",
  "students:launch",
  "staff:launch",
  "assessments:write",
  "results:read",
] as const;

const MAX_BODY_BYTES = 1_000_000;

const integrationRouteScopes: Record<string, string> = {
  "POST /api/integrations/v1/students": "students:write",
  "POST /api/integrations/v1/launch-tickets": "students:launch",
  "POST /api/integrations/v1/staff-launch-tickets": "staff:launch",
  "GET /api/integrations/v1/roles": "staff:launch",
  "POST /api/integrations/v1/staff-revocations": "staff:launch",
  "POST /api/integrations/v1/staff-passwords": "staff:launch",
  "PUT /api/integrations/v1/assessments": "assessments:write",
  "GET /api/integrations/v1/results": "results:read",
};

export type IntegrationClient = {
  clientId: string;
  tenantId: string;
  scopes: string[];
};

export type IntegrationAuthorization =
  | { ok: true; client: IntegrationClient }
  | { ok: false; response: NextResponse };

let integrationSchemaReady: Promise<void> | null = null;

async function initializeIntegrationSchema() {
  await databasePool.query(`
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
  await databasePool.query(`
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
  await databasePool.query("ALTER TABLE integration_clients ADD COLUMN IF NOT EXISTS id SERIAL");
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS integration_access_tokens (
      token_hash CHAR(64) PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES integration_clients(client_id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL,
      scopes TEXT[] NOT NULL DEFAULT '{}',
      audience TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await databasePool.query(`
    CREATE INDEX IF NOT EXISTS integration_access_tokens_expiry_idx
    ON integration_access_tokens (expires_at)
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS integration_launch_tickets (
      token_hash CHAR(64) PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  for (const definition of ["subject_type TEXT", "subject_id INTEGER", "client_id TEXT", "external_student_id TEXT", "kind TEXT NOT NULL DEFAULT 'student'"]) {
    await databasePool.query(`ALTER TABLE integration_launch_tickets ADD COLUMN IF NOT EXISTS ${definition}`);
  }
  for (const column of ["subject_type", "subject_id", "client_id", "external_student_id"]) {
    await databasePool.query(`ALTER TABLE integration_launch_tickets ALTER COLUMN ${column} DROP NOT NULL`);
  }
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS integration_students (
      tenant_id TEXT NOT NULL,
      external_student_id TEXT NOT NULL,
      candidate_row_id INTEGER NOT NULL,
      email TEXT,
      last_idempotency_key TEXT,
      last_result JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, external_student_id)
    )
  `);
  await databasePool.query("CREATE UNIQUE INDEX IF NOT EXISTS integration_students_candidate_idx ON integration_students (candidate_row_id)");
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS integration_student_assessments (
      tenant_id TEXT NOT NULL,
      external_student_id TEXT NOT NULL,
      external_assessment_id TEXT NOT NULL,
      name TEXT NOT NULL,
      examination TEXT NOT NULL DEFAULT '',
      applied_assessment_id INTEGER,
      PRIMARY KEY (tenant_id, external_student_id, external_assessment_id)
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS integration_assessment_map (
      tenant_id TEXT NOT NULL,
      external_assessment_id TEXT NOT NULL,
      assessment_id INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, external_assessment_id)
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS integration_staff (
      tenant_id TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      user_row_id INTEGER NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, external_user_id)
    )
  `);
  await databasePool.query("CREATE UNIQUE INDEX IF NOT EXISTS integration_staff_user_idx ON integration_staff (user_row_id)");
  // Set when the institution system withdrew access; the next sign-in it authorises reactivates the account.
  await databasePool.query("ALTER TABLE integration_staff ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ");
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS integration_identities (
      issuer TEXT NOT NULL,
      subject TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      external_student_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (issuer, subject)
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS integration_idempotency_keys (
      client_id TEXT NOT NULL,
      route TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash CHAR(64) NOT NULL,
      status_code INTEGER NOT NULL,
      response_body JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (client_id, route, idempotency_key)
    )
  `);

  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      mobile TEXT NOT NULL,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      verified BOOLEAN NOT NULL DEFAULT FALSE,
      created_on TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await databasePool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id TEXT");
  await databasePool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS external_user_id TEXT");
  await databasePool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_external_user_idx
    ON users (tenant_id, external_user_id)
    WHERE external_user_id IS NOT NULL
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
      date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      candidate_data JSONB
    )
  `);
  await databasePool.query('ALTER TABLE "Candidate Information" ADD COLUMN IF NOT EXISTS record_type TEXT NOT NULL DEFAULT \'field\'');
  await databasePool.query('ALTER TABLE "Candidate Information" ADD COLUMN IF NOT EXISTS candidate_data JSONB');
  await databasePool.query('ALTER TABLE "Candidate Information" ADD COLUMN IF NOT EXISTS tenant_id TEXT');
  await databasePool.query('ALTER TABLE "Candidate Information" ADD COLUMN IF NOT EXISTS external_student_id TEXT');
  await databasePool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS candidate_information_tenant_external_student_idx
    ON "Candidate Information" (tenant_id, external_student_id)
    WHERE external_student_id IS NOT NULL
  `);

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
  await databasePool.query("ALTER TABLE assessment ADD COLUMN IF NOT EXISTS pass_mark NUMERIC");
  await databasePool.query("ALTER TABLE assessment ADD COLUMN IF NOT EXISTS results_published BOOLEAN NOT NULL DEFAULT FALSE");
  await databasePool.query("ALTER TABLE assessment ADD COLUMN IF NOT EXISTS tenant_id TEXT");
  await databasePool.query("ALTER TABLE assessment ADD COLUMN IF NOT EXISTS external_assessment_id TEXT");
  await databasePool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS assessment_tenant_external_assessment_idx
    ON assessment (tenant_id, external_assessment_id)
    WHERE external_assessment_id IS NOT NULL
  `);

  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment_candidate_direct_assignment (
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES "Candidate Information"(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (assessment_id, candidate_id)
    )
  `);
  // NULL means the assignment was made in the portal; 'ums' marks rows owned by the UMS sync.
  await databasePool.query("ALTER TABLE assessment_candidate_direct_assignment ADD COLUMN IF NOT EXISTS source TEXT");

  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment_candidate_submissions (
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES "Candidate Information"(id) ON DELETE CASCADE,
      answers JSONB NOT NULL DEFAULT '{}'::jsonb,
      questions_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      evaluated_at TIMESTAMPTZ,
      obtained_mark NUMERIC,
      manual_marks JSONB NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (assessment_id, candidate_id)
    )
  `);
  await databasePool.query(`
    ALTER TABLE assessment_candidate_submissions
    ADD COLUMN IF NOT EXISTS questions_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
  await databasePool.query(`
    ALTER TABLE assessment_candidate_submissions
    ADD COLUMN IF NOT EXISTS manual_marks JSONB NOT NULL DEFAULT '{}'::jsonb
  `);

  // Students and assessments recorded only in the link tables also get the external-id columns.
  await databasePool.query(`
    UPDATE "Candidate Information" AS candidate
    SET tenant_id = link.tenant_id, external_student_id = link.external_student_id
    FROM integration_students AS link
    WHERE candidate.id = link.candidate_row_id AND candidate.external_student_id IS NULL
  `);
  await databasePool.query(`
    UPDATE assessment
    SET tenant_id = map.tenant_id, external_assessment_id = map.external_assessment_id
    FROM integration_assessment_map AS map
    WHERE assessment.id = map.assessment_id
      AND assessment.external_assessment_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM assessment AS holder
        WHERE holder.tenant_id = map.tenant_id AND holder.external_assessment_id = map.external_assessment_id
      )
  `);
  // One time only: afterwards a NULL source reliably means the assignment was made in the portal.
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS candidate_data_migrations (
      migration_key TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const sourceBackfill = await databasePool.query(`
    INSERT INTO candidate_data_migrations (migration_key)
    VALUES ('integration_assignment_source_backfill_v1')
    ON CONFLICT (migration_key) DO NOTHING
    RETURNING migration_key
  `);
  if (sourceBackfill.rowCount) {
    await databasePool.query(`
      UPDATE assessment_candidate_direct_assignment AS assignment
      SET source = 'ums'
      FROM integration_student_assessments AS applied
      JOIN integration_students AS student USING (tenant_id, external_student_id)
      WHERE assignment.candidate_id = student.candidate_row_id
        AND assignment.assessment_id = applied.applied_assessment_id
        AND assignment.source IS NULL
    `);
  }
}

export async function ensureIntegrationSchema() {
  if (!integrationSchemaReady) {
    integrationSchemaReady = initializeIntegrationSchema().catch((error: unknown) => {
      integrationSchemaReady = null;
      throw error;
    });
  }
  await integrationSchemaReady;
}

export function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function integrationError(status: number, error: string, description: string, headers?: HeadersInit) {
  return NextResponse.json({ ok: false, error, error_description: description, message: description }, { status, headers });
}

export function logIntegrationCall(entry: {
  clientId: string | null;
  route: string;
  method: string;
  status: number;
  durationMs: number;
}) {
  // Deliberately limited to non-sensitive metadata: never tokens, secrets, or student data.
  console.info(JSON.stringify({
    event: "integration_call",
    client_id: entry.clientId,
    route: entry.route,
    method: entry.method,
    status: entry.status,
    duration_ms: entry.durationMs,
  }));
}

let dummySecretHash: Promise<string> | null = null;

/** Verifies client credentials in roughly constant time whether or not the client exists. */
export async function verifyClientCredentials(clientId: string, clientSecret: string): Promise<IntegrationClient | null> {
  await ensureIntegrationSchema();
  const result = await databasePool.query(`
    SELECT client_id, client_secret_hash, tenant_id, scopes
    FROM integration_clients
    WHERE client_id = $1 AND status = TRUE
  `, [clientId]);
  const row = result.rows[0] as { client_id: string; client_secret_hash: string; tenant_id: string; scopes: string[] } | undefined;
  if (!row || !row.client_secret_hash.startsWith("scrypt$")) {
    dummySecretHash ??= hashPassword(randomBytes(16).toString("hex"));
    await verifyPassword(clientSecret, await dummySecretHash);
    return null;
  }
  // Secrets from the earlier built-in issuer use a base64url salt and key instead of hex.
  const isHexHash = /^scrypt\$[\da-f]{32}\$[\da-f]{128}$/i.test(row.client_secret_hash);
  const valid = isHexHash
    ? await verifyPassword(clientSecret, row.client_secret_hash)
    : verifySecret(clientSecret, row.client_secret_hash);
  if (!valid) return null;
  return { clientId: row.client_id, tenantId: row.tenant_id, scopes: row.scopes ?? [] };
}

export async function issueAccessToken(client: IntegrationClient, scopes: string[]) {
  await ensureIntegrationSchema();
  const token = randomBytes(32).toString("base64url");
  await databasePool.query(
    "DELETE FROM integration_access_tokens WHERE expires_at < NOW() - INTERVAL '1 day'",
  );
  await databasePool.query(`
    INSERT INTO integration_access_tokens (token_hash, client_id, tenant_id, scopes, audience, expires_at)
    VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(secs => $6))
  `, [sha256Hex(token), client.clientId, client.tenantId, scopes, INTEGRATION_AUDIENCE, ACCESS_TOKEN_LIFETIME_SECONDS]);
  return token;
}

function invalidToken(description: string) {
  return {
    ok: false as const,
    response: integrationError(401, "invalid_token", description, {
      "WWW-Authenticate": `Bearer realm="${INTEGRATION_AUDIENCE}", error="invalid_token"`,
    }),
  };
}

function insufficientScope(requiredScope: string | undefined) {
  return {
    ok: false as const,
    response: integrationError(403, "insufficient_scope", `The access token requires the ${requiredScope ?? "matching"} scope.`, {
      "WWW-Authenticate": `Bearer realm="${INTEGRATION_AUDIENCE}", error="insufficient_scope", scope="${requiredScope ?? ""}"`,
    }),
  };
}

/** Picks the tenant whose keys verify a JWT. The value is only a hint: the signature check decides. */
function tenantHintFromJwt(token: string) {
  try {
    const claims = decodeJwt(token);
    if (typeof claims.tenant_id === "string") return claims.tenant_id;
    return loadTenants().tenants.find((tenant) => tenant.issuer === claims.iss)?.tenantId ?? "";
  } catch {
    return "";
  }
}

/**
 * Bearer-token authorization for /api/integrations/v1/*. Accepts this portal's opaque tokens and JWTs
 * from the built-in issuer or a tenant's own identity provider (INTEGRATION_TENANTS).
 */
export async function authorizeIntegrationRequest(
  request: Request,
  path: string,
  method: string,
  body: Record<string, unknown>,
): Promise<IntegrationAuthorization> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return { ok: false, response: integrationError(413, "payload_too_large", "The request body is too large.") };
  }
  const authorizationHeader = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+([A-Za-z0-9._~+/-]+=*)$/i.exec(authorizationHeader);
  if (!match) return invalidToken("A bearer access token is required.");

  await ensureIntegrationSchema();
  const result = await databasePool.query(`
    SELECT token.client_id, token.tenant_id, token.scopes, token.audience
    FROM integration_access_tokens AS token
    JOIN integration_clients AS client
      ON client.client_id = token.client_id
     AND client.status = TRUE
    WHERE token.token_hash = $1 AND token.expires_at > NOW()
  `, [sha256Hex(match[1])]);
  const row = result.rows[0] as { client_id: string; tenant_id: string; scopes: string[]; audience: string } | undefined;
  const requiredScope = integrationRouteScopes[`${method} ${path}`];
  const isRead = method === "GET" || method === "HEAD";
  const queryTenantId = new URL(request.url).searchParams.get("tenant_id");

  if (!row && match[1].split(".").length === 3) {
    if (!requiredScope) return insufficientScope(requiredScope);
    const tenantId = isRead ? queryTenantId ?? tenantHintFromJwt(match[1]) : body.tenant_id;
    if (typeof tenantId !== "string" || !tenantId.trim()) {
      return { ok: false, response: integrationError(400, "invalid_request", "tenant_id is required.") };
    }
    try {
      const { tenant, payload } = await verifyTenantToken(authorizationHeader, tenantId.trim(), requiredScope);
      return {
        ok: true,
        client: { clientId: payload.sub ?? `tenant:${tenant.tenantId}`, tenantId: tenant.tenantId, scopes: [requiredScope] },
      };
    } catch (error) {
      if (!(error instanceof IntegrationError)) throw error;
      return error.status === 401
        ? invalidToken(error.message)
        : { ok: false, response: integrationError(error.status, error.code, error.message) };
    }
  }
  if (!row || row.audience !== INTEGRATION_AUDIENCE) {
    return invalidToken("The access token is invalid or has expired.");
  }
  const client: IntegrationClient = { clientId: row.client_id, tenantId: row.tenant_id, scopes: row.scopes ?? [] };

  if (!requiredScope || !client.scopes.includes(requiredScope)) return insufficientScope(requiredScope);

  const tenantId = isRead ? queryTenantId ?? client.tenantId : body.tenant_id;
  if (typeof tenantId !== "string" || !tenantId.trim()) {
    return { ok: false, response: integrationError(400, "invalid_request", "tenant_id is required.") };
  }
  if (tenantId !== client.tenantId) {
    return { ok: false, response: integrationError(403, "tenant_mismatch", "tenant_id does not match the authenticated client.") };
  }
  return { ok: true, client };
}

/** Returns the portal's public HTTPS origin, used for launch URLs and post-launch redirects. */
export function getPortalOrigin(request: Request) {
  const configured = process.env.PORTAL_PUBLIC_URL?.trim() || process.env.INTEGRATION_ISSUER_URL?.trim();
  let url: URL;
  try {
    url = new URL(configured || request.url);
  } catch {
    return null;
  }
  const isLocalHttp = process.env.NODE_ENV !== "production"
    && url.protocol === "http:"
    && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLocalHttp) return null;
  if (url.username || url.password) return null;
  return url.origin;
}

type StoredResponse = { status: number; body: Record<string, unknown> };

/**
 * Runs `operation` at most once per client + route + Idempotency-Key, inside the caller's
 * transaction. A repeated key with the same request body returns the stored response.
 */
export async function runIdempotent(
  db: PoolClient,
  options: { clientId: string; route: string; key: string | null; requestHash: string },
  operation: () => Promise<StoredResponse>,
): Promise<StoredResponse> {
  if (!options.key) return operation();
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${options.clientId}\n${options.route}\n${options.key}`]);
  await db.query(`
    DELETE FROM integration_idempotency_keys
    WHERE client_id = $1 AND route = $2 AND created_at < NOW() - INTERVAL '24 hours'
  `, [options.clientId, options.route]);
  const stored = await db.query(`
    SELECT request_hash, status_code, response_body
    FROM integration_idempotency_keys
    WHERE client_id = $1 AND route = $2 AND idempotency_key = $3
  `, [options.clientId, options.route, options.key]);
  if (stored.rowCount) {
    const row = stored.rows[0] as { request_hash: string; status_code: number; response_body: Record<string, unknown> };
    if (row.request_hash !== options.requestHash) {
      return {
        status: 422,
        body: { ok: false, error: "idempotency_key_reused", error_description: "This Idempotency-Key was already used with a different request body." },
      };
    }
    return { status: Number(row.status_code), body: row.response_body };
  }

  const outcome = await operation();
  if (outcome.status < 300) {
    await db.query(`
      INSERT INTO integration_idempotency_keys (client_id, route, idempotency_key, request_hash, status_code, response_body)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `, [options.clientId, options.route, options.key, options.requestHash, outcome.status, JSON.stringify(outcome.body)]);
  }
  return outcome;
}
