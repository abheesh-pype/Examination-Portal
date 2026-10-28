import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { databasePool } from "@/lib/db";
import {
  acquireCandidateIdLock, generateUniqueCandidateId, getCandidateIdFieldName, isCandidateIdFieldName, loadExistingCandidateIds,
} from "@/lib/candidate-ids";
import { hashPassword } from "@/lib/password";
import type { AssessmentUpsert, ProvisionedStudent, StaffPayload } from "@/lib/integrations/payload";

export type ProvisionResult = {
  created: boolean;
  candidateId: string;
  status: "active" | "inactive";
  assigned: number;
  unmappedAssessmentIds: string[];
};

let tablesReady: Promise<void> | null = null;

/** Tables are created lazily, like the rest of this codebase. No foreign keys: referenced tables are created lazily too. */
export function ensureIntegrationTables() {
  tablesReady ??= (async () => {
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
      CREATE TABLE IF NOT EXISTS integration_clients (
        client_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        secret_hash TEXT NOT NULL,
        scopes TEXT NOT NULL DEFAULT 'students:write students:launch staff:launch assessments:write',
        status BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await databasePool.query(`
      CREATE TABLE IF NOT EXISTS integration_launch_tickets (
        token_hash CHAR(64) PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        external_student_id TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await databasePool.query("ALTER TABLE integration_launch_tickets ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'student'");
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
  })().catch((error) => { tablesReady = null; throw error; });
  return tablesReady;
}

const hasTable = async (client: PoolClient, name: string) =>
  Boolean((await client.query("SELECT to_regclass($1) AS t", [name])).rows[0].t);

async function ensureDirectAssignmentTable(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS assessment_candidate_direct_assignment (
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES "Candidate Information"(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (assessment_id, candidate_id)
    )
  `);
}

async function ensureCategory(client: PoolClient, category: string, subCategory: string) {
  if (!category) return;
  await client.query(`CREATE TABLE IF NOT EXISTS candidate_category (id SERIAL PRIMARY KEY, candidate_category TEXT NOT NULL, status BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await client.query(`CREATE TABLE IF NOT EXISTS candidate_sub_category (id SERIAL PRIMARY KEY, candidate_sub_category TEXT NOT NULL, category TEXT NOT NULL, status BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await client.query(`INSERT INTO candidate_category (candidate_category) SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM candidate_category WHERE candidate_category = $1)`, [category]);
  if (subCategory) {
    await client.query(`INSERT INTO candidate_sub_category (candidate_sub_category, category) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM candidate_sub_category WHERE candidate_sub_category = $1 AND category = $2)`, [subCategory, category]);
  }
}

/** Resolves an external assessment id to a portal assessment: explicit map first, else a unique exact (examination, name) match. */
async function resolveAssessment(client: PoolClient, tenantId: string, a: ProvisionedStudent["assessments"][number]) {
  const mapped = await client.query(
    `SELECT m.assessment_id FROM integration_assessment_map m JOIN assessment s ON s.id = m.assessment_id AND s.status = TRUE
     WHERE m.tenant_id = $1 AND m.external_assessment_id = $2`, [tenantId, a.externalAssessmentId]);
  if (mapped.rowCount) return Number(mapped.rows[0].assessment_id);
  const found = await client.query(
    `SELECT id FROM assessment WHERE status = TRUE AND LOWER(BTRIM(name)) = LOWER($1) AND LOWER(BTRIM(examination)) = LOWER($2)`,
    [a.name, a.examination]);
  if (found.rowCount !== 1) return null;
  const id = Number(found.rows[0].id);
  await client.query(
    `INSERT INTO integration_assessment_map (tenant_id, external_assessment_id, assessment_id) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, external_assessment_id) DO NOTHING`, [tenantId, a.externalAssessmentId, id]);
  return id;
}

/** Idempotent upsert on (tenant_id, external_student_id). Safe to retry; one transaction. */
export async function provisionStudent(student: ProvisionedStudent, idempotencyKey?: string): Promise<ProvisionResult> {
  await ensureIntegrationTables();
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    await acquireCandidateIdLock(client);

    const link = (await client.query(
      "SELECT candidate_row_id, last_idempotency_key, last_result FROM integration_students WHERE tenant_id = $1 AND external_student_id = $2 FOR UPDATE",
      [student.tenantId, student.externalStudentId])).rows[0];
    if (link && idempotencyKey && link.last_idempotency_key === idempotencyKey && link.last_result) {
      await client.query("COMMIT");
      return { ...(link.last_result as ProvisionResult), created: false };
    }

    await ensureCategory(client, student.category, student.subCategory);
    const active = student.status === "active";
    const emailField = (await client.query(
      `SELECT name FROM "Candidate Information" WHERE record_type = 'field' AND column_type = 'Email' AND status = TRUE ORDER BY date ASC, id ASC LIMIT 1`)).rows[0]?.name as string | undefined;
    const idFieldName = await getCandidateIdFieldName(client);

    let rowId: number | null = link ? Number(link.candidate_row_id) : null;
    const existing = rowId
      ? (await client.query(`SELECT candidate_data FROM "Candidate Information" WHERE id = $1 AND record_type = 'candidate' FOR UPDATE`, [rowId])).rows[0]
      : undefined;
    let created = false;
    const fields: Record<string, unknown> = { ...(existing?.candidate_data?.fields ?? {}) };
    if (!existing) {
      created = true;
      fields[idFieldName] = generateUniqueCandidateId(await loadExistingCandidateIds(client));
    }
    fields["Candidate Name"] = student.name;
    if (emailField && student.email) fields[emailField] = student.email;
    const data = JSON.stringify({ ...(existing?.candidate_data ?? {}), category: student.category, sub_category: student.subCategory, fields });

    if (existing) {
      await client.query(`UPDATE "Candidate Information" SET name = $2, status = $3, candidate_data = $4::jsonb WHERE id = $1`, [rowId, student.name, active, data]);
    } else {
      rowId = Number((await client.query(
        `INSERT INTO "Candidate Information" (record_type, name, column_type, status, candidate_data) VALUES ('candidate', $1, 'Candidate', $2, $3::jsonb) RETURNING id`,
        [student.name, active, data])).rows[0].id);
    }
    const candidateId = String(Object.entries(fields).find(([name, value]) => isCandidateIdFieldName(name) && typeof value === "string")?.[1] ?? "");

    // Assignments: remove what this integration applied before, then apply the current set.
    const previous = (await client.query(
      "SELECT external_assessment_id, applied_assessment_id FROM integration_student_assessments WHERE tenant_id = $1 AND external_student_id = $2",
      [student.tenantId, student.externalStudentId])).rows as { external_assessment_id: string; applied_assessment_id: number | null }[];
    const assessmentTable = await hasTable(client, "assessment");
    if (assessmentTable) await ensureDirectAssignmentTable(client);

    const applied = new Map<string, number | null>();
    for (const a of student.assessments) applied.set(a.externalAssessmentId, assessmentTable ? await resolveAssessment(client, student.tenantId, a) : null);
    const keep = new Set([...applied.values()].filter((v): v is number => v !== null));
    const stale = previous.map((p) => p.applied_assessment_id).filter((id): id is number => id !== null && !keep.has(id));
    if (stale.length) {
      await client.query("DELETE FROM assessment_candidate_direct_assignment WHERE candidate_id = $1 AND assessment_id = ANY($2::int[])", [rowId, stale]);
    }
    await client.query("DELETE FROM integration_student_assessments WHERE tenant_id = $1 AND external_student_id = $2", [student.tenantId, student.externalStudentId]);
    for (const a of student.assessments) {
      const assessmentId = applied.get(a.externalAssessmentId) ?? null;
      await client.query(
        `INSERT INTO integration_student_assessments (tenant_id, external_student_id, external_assessment_id, name, examination, applied_assessment_id) VALUES ($1,$2,$3,$4,$5,$6)`,
        [student.tenantId, student.externalStudentId, a.externalAssessmentId, a.name, a.examination, assessmentId]);
      if (assessmentId !== null) {
        await client.query(
          "INSERT INTO assessment_candidate_direct_assignment (assessment_id, candidate_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [assessmentId, rowId]);
      }
    }

    const result: ProvisionResult = {
      created, candidateId, status: student.status, assigned: keep.size,
      unmappedAssessmentIds: [...applied.entries()].filter(([, v]) => v === null).map(([k]) => k),
    };
    await client.query(
      `INSERT INTO integration_students (tenant_id, external_student_id, candidate_row_id, email, last_idempotency_key, last_result, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW())
       ON CONFLICT (tenant_id, external_student_id) DO UPDATE SET candidate_row_id = EXCLUDED.candidate_row_id, email = EXCLUDED.email,
         last_idempotency_key = EXCLUDED.last_idempotency_key, last_result = EXCLUDED.last_result, updated_at = NOW()`,
      [student.tenantId, student.externalStudentId, rowId, student.email, idempotencyKey ?? null, JSON.stringify(result)]);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Admin override: map an external assessment id to a portal assessment and apply it to already-provisioned students. */
export async function mapAssessment(tenantId: string, externalAssessmentId: string, assessmentId: number) {
  await ensureIntegrationTables();
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    await acquireCandidateIdLock(client);
    if (!(await hasTable(client, "assessment"))) { await client.query("ROLLBACK"); return null; }
    const exists = await client.query("SELECT 1 FROM assessment WHERE id = $1 AND status = TRUE", [assessmentId]);
    if (!exists.rowCount) { await client.query("ROLLBACK"); return null; }
    await ensureDirectAssignmentTable(client);
    await client.query(
      `INSERT INTO integration_assessment_map (tenant_id, external_assessment_id, assessment_id) VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id, external_assessment_id) DO UPDATE SET assessment_id = EXCLUDED.assessment_id`, [tenantId, externalAssessmentId, assessmentId]);
    // Re-point students, dropping the previous assignment this integration had applied.
    const rows = (await client.query(
      `SELECT sa.external_student_id, sa.applied_assessment_id, s.candidate_row_id
       FROM integration_student_assessments sa JOIN integration_students s USING (tenant_id, external_student_id)
       WHERE sa.tenant_id = $1 AND sa.external_assessment_id = $2`, [tenantId, externalAssessmentId])).rows;
    for (const row of rows) {
      if (row.applied_assessment_id !== null && Number(row.applied_assessment_id) !== assessmentId) {
        await client.query("DELETE FROM assessment_candidate_direct_assignment WHERE candidate_id = $1 AND assessment_id = $2", [row.candidate_row_id, row.applied_assessment_id]);
      }
      await client.query(
        "UPDATE integration_student_assessments SET applied_assessment_id = $4 WHERE tenant_id = $1 AND external_student_id = $2 AND external_assessment_id = $3",
        [tenantId, row.external_student_id, externalAssessmentId, assessmentId]);
      await client.query("INSERT INTO assessment_candidate_direct_assignment (assessment_id, candidate_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [assessmentId, row.candidate_row_id]);
    }
    await client.query("COMMIT");
    return { updatedStudents: rows.length };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Resolves the student for a verified OIDC identity. A known (issuer, sub) wins; otherwise the first
 * sign-in links by the tenant's link claim, which must match exactly one provisioned student's email.
 */
export async function resolveOidcStudent(tenantId: string, issuer: string, subject: string, linkValue: string | null) {
  await ensureIntegrationTables();
  const known = await databasePool.query(
    `SELECT s.candidate_row_id FROM integration_identities i JOIN integration_students s
       ON s.tenant_id = i.tenant_id AND s.external_student_id = i.external_student_id
     WHERE i.issuer = $1 AND i.subject = $2 AND i.tenant_id = $3`, [issuer, subject, tenantId]);
  const activeRow = async (id: number) => (await databasePool.query(
    `SELECT id FROM "Candidate Information" WHERE id = $1 AND record_type = 'candidate' AND status = TRUE`, [id])).rowCount ? id : null;
  if (known.rowCount) return activeRow(Number(known.rows[0].candidate_row_id));
  if (!linkValue) return null;
  const matches = await databasePool.query(
    "SELECT external_student_id, candidate_row_id FROM integration_students WHERE tenant_id = $1 AND LOWER(email) = LOWER($2)", [tenantId, linkValue]);
  if (matches.rowCount !== 1) return null; // none, or ambiguous: never guess
  const id = await activeRow(Number(matches.rows[0].candidate_row_id));
  if (id === null) return null;
  await databasePool.query(
    "INSERT INTO integration_identities (issuer, subject, tenant_id, external_student_id) VALUES ($1,$2,$3,$4) ON CONFLICT (issuer, subject) DO NOTHING",
    [issuer, subject, tenantId, matches.rows[0].external_student_id]);
  return id;
}

/** True when the candidate row is managed by an integration (no DOB-based credentials required). */
export async function isIntegrationManaged(candidateRowId: number) {
  const result = await databasePool.query("SELECT to_regclass('integration_students') AS t");
  if (!result.rows[0].t) return false;
  return Boolean((await databasePool.query("SELECT 1 FROM integration_students WHERE candidate_row_id = $1", [candidateRowId])).rowCount);
}

export async function findIntegrationClient(clientId: string) {
  await ensureIntegrationTables();
  const result = await databasePool.query(
    "SELECT client_id, tenant_id, secret_hash, scopes FROM integration_clients WHERE client_id = $1 AND status = TRUE", [clientId]);
  return result.rows[0] as { client_id: string; tenant_id: string; secret_hash: string; scopes: string } | undefined;
}

export const LAUNCH_TICKET_TTL_SECONDS = 60;
const hashTicket = (ticket: string) => createHash("sha256").update(ticket).digest("hex");

/** One-time sign-in ticket for a provisioned, active student. Only the hash is stored. Returns null if the student is unknown/inactive. */
export async function createLaunchTicket(tenantId: string, externalStudentId: string) {
  await ensureIntegrationTables();
  const student = await databasePool.query(
    `SELECT 1 FROM integration_students s JOIN "Candidate Information" c ON c.id = s.candidate_row_id AND c.record_type = 'candidate' AND c.status = TRUE
     WHERE s.tenant_id = $1 AND s.external_student_id = $2`, [tenantId, externalStudentId]);
  if (!student.rowCount) return null;
  await databasePool.query("DELETE FROM integration_launch_tickets WHERE expires_at < NOW() - INTERVAL '1 day'");
  const ticket = randomBytes(32).toString("base64url");
  await databasePool.query(
    "INSERT INTO integration_launch_tickets (token_hash, tenant_id, external_student_id, expires_at) VALUES ($1,$2,$3, NOW() + make_interval(secs => $4))",
    [hashTicket(ticket), tenantId, externalStudentId, LAUNCH_TICKET_TTL_SECONDS]);
  return ticket;
}

/** Atomically consumes a ticket (single use, unexpired). Returns who to sign in, or null. */
export async function redeemLaunchTicket(ticket: string): Promise<{ kind: "student" | "staff"; id: number } | null> {
  await ensureIntegrationTables();
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(ticket)) return null;
  const used = await databasePool.query(
    `UPDATE integration_launch_tickets SET used_at = NOW()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() RETURNING tenant_id, external_student_id, kind`, [hashTicket(ticket)]);
  if (!used.rowCount) return null;
  const { tenant_id: tenantId, external_student_id: externalId, kind } = used.rows[0];
  if (kind === "staff") {
    const staff = await databasePool.query(
      `SELECT u.id FROM integration_staff s JOIN users u ON u.id = s.user_row_id AND u.status = TRUE
       WHERE s.tenant_id = $1 AND s.external_user_id = $2`, [tenantId, externalId]);
    return staff.rowCount ? { kind: "staff", id: Number(staff.rows[0].id) } : null;
  }
  const row = await databasePool.query(
    `SELECT c.id FROM integration_students s JOIN "Candidate Information" c ON c.id = s.candidate_row_id AND c.record_type = 'candidate' AND c.status = TRUE
     WHERE s.tenant_id = $1 AND s.external_student_id = $2`, [tenantId, externalId]);
  return row.rowCount ? { kind: "student", id: Number(row.rows[0].id) } : null;
}

// ---- staff (e.g. a university's Academic Admin) ----

/** Role given to institution staff. The name deliberately has no "admin": the portal treats such roles as non-admin. */
export const INTEGRATION_STAFF_ROLE = "UMS Academic Staff";

const staffPermissions = () => {
  const edit = { view: 1, create: 1, edit: 1, delete: 0, status: 1 };
  return Object.fromEntries([
    "Questions", "Assessments", "Settings:Assessments:Examinations",
    "Settings:Questions:Categories", "Settings:Questions:Sub-Categories", "Settings:Questions:Topics",
    "Settings:Questions:Difficulty Levels", "Settings:Questions:Languages",
  ].map((section) => [section, section === "Questions" ? { ...edit, delete: 1 } : edit]));
};

export class StaffConflictError extends Error {}

/**
 * Creates/updates the portal account for an institution staff member. Never adopts a pre-existing portal account:
 * if the email already belongs to someone else, the request is refused.
 */
export async function provisionStaff(staff: StaffPayload) {
  await ensureIntegrationTables();
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL, mobile TEXT NOT NULL,
      status BOOLEAN NOT NULL DEFAULT TRUE, verified BOOLEAN NOT NULL DEFAULT FALSE, created_on TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id SERIAL PRIMARY KEY, role_name TEXT NOT NULL, administrator_access BOOLEAN NOT NULL DEFAULT FALSE, dashboard BOOLEAN NOT NULL DEFAULT FALSE,
      permissions JSONB NOT NULL DEFAULT '{}', status BOOLEAN NOT NULL DEFAULT TRUE, created_on TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  const unusablePassword = await hashPassword(randomBytes(32).toString("hex")); // staff sign in only through the institution system
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(741923602)");
    const role = await client.query("SELECT id FROM roles WHERE role_name = $1 ORDER BY id LIMIT 1", [INTEGRATION_STAFF_ROLE]);
    if (role.rowCount) {
      await client.query("UPDATE roles SET administrator_access = FALSE, dashboard = TRUE, permissions = $2::jsonb, status = TRUE WHERE id = $1", [role.rows[0].id, JSON.stringify(staffPermissions())]);
    } else {
      await client.query("INSERT INTO roles (role_name, administrator_access, dashboard, permissions) VALUES ($1, FALSE, TRUE, $2::jsonb)", [INTEGRATION_STAFF_ROLE, JSON.stringify(staffPermissions())]);
    }
    const link = (await client.query(
      "SELECT user_row_id FROM integration_staff WHERE tenant_id = $1 AND external_user_id = $2 FOR UPDATE", [staff.tenantId, staff.externalUserId])).rows[0];
    let userId: number;
    if (link) {
      userId = Number(link.user_row_id);
      const clash = await client.query("SELECT 1 FROM users WHERE LOWER(email) = $1 AND id <> $2", [staff.email, userId]);
      await client.query(
        `UPDATE users SET name = $2, role = $3, status = TRUE, verified = TRUE${clash.rowCount ? "" : ", email = $4"} WHERE id = $1`,
        clash.rowCount ? [userId, staff.name, INTEGRATION_STAFF_ROLE] : [userId, staff.name, INTEGRATION_STAFF_ROLE, staff.email]);
    } else {
      const existing = await client.query("SELECT 1 FROM users WHERE LOWER(email) = $1", [staff.email]);
      if (existing.rowCount) throw new StaffConflictError("A portal account with this email already exists");
      userId = Number((await client.query(
        "INSERT INTO users (name, email, password, role, mobile, status, verified) VALUES ($1,$2,$3,$4,'-',TRUE,TRUE) RETURNING id",
        [staff.name, staff.email, unusablePassword, INTEGRATION_STAFF_ROLE])).rows[0].id);
      await client.query("INSERT INTO integration_staff (tenant_id, external_user_id, user_row_id) VALUES ($1,$2,$3)", [staff.tenantId, staff.externalUserId, userId]);
    }
    await client.query("UPDATE integration_staff SET updated_at = NOW() WHERE user_row_id = $1", [userId]);
    await client.query("COMMIT");
    return userId;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function createStaffLaunchTicket(tenantId: string, externalUserId: string) {
  await ensureIntegrationTables();
  const ticket = randomBytes(32).toString("base64url");
  await databasePool.query(
    "INSERT INTO integration_launch_tickets (token_hash, tenant_id, external_student_id, kind, expires_at) VALUES ($1,$2,$3,'staff', NOW() + make_interval(secs => $4))",
    [hashTicket(ticket), tenantId, externalUserId, LAUNCH_TICKET_TTL_SECONDS]);
  return ticket;
}

/** True for portal users that came from an institution system: their API access is limited to question/assessment authoring. */
export async function isIntegrationStaffUser(userId: number) {
  await ensureIntegrationTables();
  return Boolean((await databasePool.query("SELECT 1 FROM integration_staff WHERE user_row_id = $1", [userId])).rowCount);
}

// ---- assessments pushed from the institution system ----

/** Idempotent upsert on (tenant_id, external_assessment_id). Only the shell is managed here; questions are authored in the portal. */
export async function upsertIntegrationAssessment(a: AssessmentUpsert) {
  await ensureIntegrationTables();
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment (
      id SERIAL PRIMARY KEY, examination TEXT NOT NULL, name TEXT NOT NULL, start_date TIMESTAMPTZ, end_date TIMESTAMPTZ,
      total_time INTEGER, last_login INTEGER, question_category TEXT, sub_category TEXT, topic TEXT, question_language TEXT,
      sections JSONB NOT NULL DEFAULT '[]'::jsonb, status BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), pass_mark NUMERIC
    )`);
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(741923603)");
    const mapped = (await client.query(
      `SELECT m.assessment_id FROM integration_assessment_map m JOIN assessment s ON s.id = m.assessment_id
       WHERE m.tenant_id = $1 AND m.external_assessment_id = $2`, [a.tenantId, a.externalAssessmentId])).rows[0];
    let assessmentId: number;
    let created = false;
    if (mapped) {
      assessmentId = Number(mapped.assessment_id);
      await client.query(
        "UPDATE assessment SET examination = $2, name = $3, start_date = $4, end_date = $5, total_time = COALESCE($6, total_time), status = $7 WHERE id = $1",
        [assessmentId, a.examination, a.name, a.startDate, a.endDate, a.totalTime, a.active]);
    } else {
      created = true;
      assessmentId = Number((await client.query(
        "INSERT INTO assessment (examination, name, start_date, end_date, total_time, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        [a.examination, a.name, a.startDate, a.endDate, a.totalTime, a.active])).rows[0].id);
      await client.query(
        `INSERT INTO integration_assessment_map (tenant_id, external_assessment_id, assessment_id) VALUES ($1,$2,$3)
         ON CONFLICT (tenant_id, external_assessment_id) DO UPDATE SET assessment_id = EXCLUDED.assessment_id`, [a.tenantId, a.externalAssessmentId, assessmentId]);
    }
    await client.query("COMMIT");
    return { assessmentId, created };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
