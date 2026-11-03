import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { databasePool } from "@/lib/db";
import {
  acquireCandidateIdLock, generateUniqueCandidateId, getCandidateIdFieldName, isCandidateIdFieldName, loadExistingCandidateIds,
} from "@/lib/candidate-ids";
import { ensureIntegrationSchema, UMS_ASSIGNMENT_SOURCE } from "@/lib/integrations/m2m";
import { hashPassword } from "@/lib/password";
import type { AssessmentUpsert, ProvisionedStudent, StaffPayload } from "@/lib/integrations/payload";

export type ProvisionResult = {
  created: boolean;
  candidateId: string;
  status: "active" | "inactive";
  assigned: number;
  unmappedAssessmentIds: string[];
};

/** Tables are created lazily, like the rest of this codebase. */
export const ensureIntegrationTables = ensureIntegrationSchema;

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

async function getEmailFieldName(client: PoolClient, fields: Record<string, unknown>) {
  const existing = Object.keys(fields).find((name) => /e-?mail/i.test(name));
  if (existing) return existing;
  const definitions = (await client.query(
    `SELECT name, column_type FROM "Candidate Information" WHERE record_type = 'field' AND status = TRUE ORDER BY date ASC, id ASC`,
  )).rows as { name: string; column_type: string }[];
  return definitions.find((field) => field.column_type === "Email")?.name
    ?? definitions.find((field) => /e-?mail/i.test(field.name))?.name
    ?? "Email";
}

/**
 * Resolves an external assessment id to a portal assessment: explicit map first, then assessment.external_assessment_id,
 * else a unique exact (examination, name) match among assessments no institution has claimed yet.
 */
async function resolveAssessment(client: PoolClient, tenantId: string, a: ProvisionedStudent["assessments"][number]) {
  const mapped = await client.query(
    `SELECT m.assessment_id FROM integration_assessment_map m JOIN assessment s ON s.id = m.assessment_id AND s.status = TRUE
     WHERE m.tenant_id = $1 AND m.external_assessment_id = $2`, [tenantId, a.externalAssessmentId]);
  if (mapped.rowCount) return Number(mapped.rows[0].assessment_id);
  const published = await client.query(
    "SELECT id FROM assessment WHERE tenant_id = $1 AND external_assessment_id = $2", [tenantId, a.externalAssessmentId]);
  if (published.rowCount) return Number(published.rows[0].id);
  const found = await client.query(
    `SELECT id FROM assessment WHERE status = TRUE AND external_assessment_id IS NULL AND LOWER(BTRIM(name)) = LOWER($1) AND LOWER(BTRIM(examination)) = LOWER($2)`,
    [a.name, a.examination]);
  if (found.rowCount !== 1) return null;
  const id = Number(found.rows[0].id);
  await client.query(
    `INSERT INTO integration_assessment_map (tenant_id, external_assessment_id, assessment_id) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, external_assessment_id) DO NOTHING`, [tenantId, a.externalAssessmentId, id]);
  await client.query("UPDATE assessment SET tenant_id = $1, external_assessment_id = $2 WHERE id = $3", [tenantId, a.externalAssessmentId, id]);
  return id;
}

/** Idempotent upsert on (tenant_id, external_student_id), inside the caller's transaction. Safe to retry. */
export async function provisionStudentInTransaction(client: PoolClient, student: ProvisionedStudent, idempotencyKey?: string): Promise<ProvisionResult> {
  await acquireCandidateIdLock(client);

  const link = (await client.query(
    "SELECT candidate_row_id, last_idempotency_key, last_result FROM integration_students WHERE tenant_id = $1 AND external_student_id = $2 FOR UPDATE",
    [student.tenantId, student.externalStudentId])).rows[0];
  if (link && idempotencyKey && link.last_idempotency_key === idempotencyKey && link.last_result) {
    return { ...(link.last_result as ProvisionResult), created: false };
  }

  await ensureCategory(client, student.category, student.subCategory);
  const active = student.status === "active";
  const idFieldName = await getCandidateIdFieldName(client);

  const byColumns = link ? undefined : (await client.query(
    `SELECT id FROM "Candidate Information" WHERE record_type = 'candidate' AND tenant_id = $1 AND external_student_id = $2`,
    [student.tenantId, student.externalStudentId])).rows[0];
  let rowId: number | null = link ? Number(link.candidate_row_id) : byColumns ? Number(byColumns.id) : null;
  const existing = rowId
    ? (await client.query(`SELECT candidate_data FROM "Candidate Information" WHERE id = $1 AND record_type = 'candidate' FOR UPDATE`, [rowId])).rows[0]
    : undefined;
  const created = !existing;
  const fields: Record<string, unknown> = { ...(existing?.candidate_data?.fields ?? {}) };
  if (!Object.entries(fields).some(([name, value]) => isCandidateIdFieldName(name) && typeof value === "string" && /^\d{6}$/.test(value))) {
    fields[idFieldName] = generateUniqueCandidateId(await loadExistingCandidateIds(client));
  }
  const nameField = Object.keys(fields).find((name) => /^candidate name(?:\s*\([^)]*\))?$/i.test(name.trim())) ?? "Candidate Name";
  fields[nameField] = student.name;
  const emailField = await getEmailFieldName(client, fields);
  if (student.email) fields[emailField] = student.email;
  else delete fields[emailField];
  const data = JSON.stringify({ ...(existing?.candidate_data ?? {}), category: student.category, sub_category: student.subCategory, fields });

  if (existing) {
    await client.query(
      `UPDATE "Candidate Information" SET name = $2, status = $3, candidate_data = $4::jsonb, tenant_id = $5, external_student_id = $6 WHERE id = $1`,
      [rowId, student.name, active, data, student.tenantId, student.externalStudentId]);
  } else {
    rowId = Number((await client.query(
      `INSERT INTO "Candidate Information" (record_type, name, column_type, status, candidate_data, tenant_id, external_student_id)
       VALUES ('candidate', $1, 'Candidate', $2, $3::jsonb, $4, $5) RETURNING id`,
      [student.name, active, data, student.tenantId, student.externalStudentId])).rows[0].id);
  }
  const candidateId = String(Object.entries(fields).find(([name, value]) => isCandidateIdFieldName(name) && typeof value === "string")?.[1] ?? "");

  // Assignments: remove what this integration applied before, then apply the current set.
  // Assignments made in the portal (source IS NULL) are never removed.
  const assessmentTable = await hasTable(client, "assessment");
  if (assessmentTable) await ensureDirectAssignmentTable(client);

  const applied = new Map<string, number | null>();
  for (const a of student.assessments) applied.set(a.externalAssessmentId, assessmentTable ? await resolveAssessment(client, student.tenantId, a) : null);
  const keep = new Set([...applied.values()].filter((v): v is number => v !== null));
  if (assessmentTable) {
    await client.query(
      "DELETE FROM assessment_candidate_direct_assignment WHERE candidate_id = $1 AND source = $2 AND NOT (assessment_id = ANY($3::int[]))",
      [rowId, UMS_ASSIGNMENT_SOURCE, [...keep]]);
  }
  await client.query("DELETE FROM integration_student_assessments WHERE tenant_id = $1 AND external_student_id = $2", [student.tenantId, student.externalStudentId]);
  for (const a of student.assessments) {
    const assessmentId = applied.get(a.externalAssessmentId) ?? null;
    await client.query(
      `INSERT INTO integration_student_assessments (tenant_id, external_student_id, external_assessment_id, name, examination, applied_assessment_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [student.tenantId, student.externalStudentId, a.externalAssessmentId, a.name, a.examination, assessmentId]);
    if (assessmentId !== null) {
      await client.query(
        "INSERT INTO assessment_candidate_direct_assignment (assessment_id, candidate_id, source) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [assessmentId, rowId, UMS_ASSIGNMENT_SOURCE]);
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
  return result;
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
    await client.query("UPDATE assessment SET tenant_id = NULL, external_assessment_id = NULL WHERE tenant_id = $1 AND external_assessment_id = $2 AND id <> $3", [tenantId, externalAssessmentId, assessmentId]);
    await client.query("UPDATE assessment SET tenant_id = $1, external_assessment_id = $2 WHERE id = $3 AND external_assessment_id IS NULL", [tenantId, externalAssessmentId, assessmentId]);
    // Re-point students, dropping the previous assignment this integration had applied.
    const rows = (await client.query(
      `SELECT sa.external_student_id, sa.applied_assessment_id, s.candidate_row_id
       FROM integration_student_assessments sa JOIN integration_students s USING (tenant_id, external_student_id)
       WHERE sa.tenant_id = $1 AND sa.external_assessment_id = $2`, [tenantId, externalAssessmentId])).rows;
    for (const row of rows) {
      if (row.applied_assessment_id !== null && Number(row.applied_assessment_id) !== assessmentId) {
        await client.query("DELETE FROM assessment_candidate_direct_assignment WHERE candidate_id = $1 AND assessment_id = $2 AND source = $3", [row.candidate_row_id, row.applied_assessment_id, UMS_ASSIGNMENT_SOURCE]);
      }
      await client.query(
        "UPDATE integration_student_assessments SET applied_assessment_id = $4 WHERE tenant_id = $1 AND external_student_id = $2 AND external_assessment_id = $3",
        [tenantId, row.external_student_id, externalAssessmentId, assessmentId]);
      await client.query("INSERT INTO assessment_candidate_direct_assignment (assessment_id, candidate_id, source) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [assessmentId, row.candidate_row_id, UMS_ASSIGNMENT_SOURCE]);
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

export const LAUNCH_TICKET_TTL_SECONDS = 90;
const hashTicket = (ticket: string) => createHash("sha256").update(ticket).digest("hex");

async function insertLaunchTicket(tenantId: string, externalId: string, kind: "student" | "staff", subjectId: number, clientId: string | null) {
  await databasePool.query("DELETE FROM integration_launch_tickets WHERE expires_at < NOW() - INTERVAL '1 day'");
  const ticket = randomBytes(32).toString("base64url");
  const inserted = await databasePool.query(
    `INSERT INTO integration_launch_tickets (token_hash, tenant_id, external_student_id, kind, subject_type, subject_id, client_id, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, NOW() + make_interval(secs => $8)) RETURNING expires_at`,
    [hashTicket(ticket), tenantId, externalId, kind, kind === "staff" ? "user" : "candidate", subjectId, clientId, LAUNCH_TICKET_TTL_SECONDS]);
  return { ticket, expiresAt: new Date(inserted.rows[0].expires_at as string | Date) };
}

/** One-time sign-in ticket for a provisioned, active student. Only the hash is stored. Returns null if the student is unknown/inactive. */
export async function createLaunchTicket(tenantId: string, externalStudentId: string, clientId: string | null = null) {
  await ensureIntegrationTables();
  const student = await databasePool.query(
    `SELECT c.id FROM "Candidate Information" c LEFT JOIN integration_students s ON s.candidate_row_id = c.id
     WHERE c.record_type = 'candidate' AND c.status = TRUE
       AND ((c.tenant_id = $1 AND c.external_student_id = $2) OR (s.tenant_id = $1 AND s.external_student_id = $2))`, [tenantId, externalStudentId]);
  if (!student.rowCount) return null;
  return insertLaunchTicket(tenantId, externalStudentId, "student", Number(student.rows[0].id), clientId);
}

/** Atomically consumes a ticket (single use, unexpired). Returns who to sign in, or null. */
export async function redeemLaunchTicket(ticket: string): Promise<{ kind: "student" | "staff"; id: number } | null> {
  await ensureIntegrationTables();
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(ticket)) return null;
  const used = await databasePool.query(
    `UPDATE integration_launch_tickets SET used_at = NOW()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() RETURNING tenant_id, external_student_id, kind, subject_id`, [hashTicket(ticket)]);
  if (!used.rowCount) return null;
  const { tenant_id: tenantId, external_student_id: externalId, kind, subject_id: subjectId } = used.rows[0];
  if (kind === "staff") {
    const staff = await databasePool.query(
      `SELECT u.id FROM users u LEFT JOIN integration_staff s ON s.user_row_id = u.id
       WHERE u.status = TRUE AND (u.id = $1 OR (s.tenant_id = $2 AND s.external_user_id = $3))`, [subjectId, tenantId, externalId]);
    return staff.rowCount ? { kind: "staff", id: Number(staff.rows[0].id) } : null;
  }
  // Tickets issued before subject_id existed are resolved through the student link.
  const row = await databasePool.query(
    `SELECT c.id FROM "Candidate Information" c LEFT JOIN integration_students s ON s.candidate_row_id = c.id
     WHERE c.record_type = 'candidate' AND c.status = TRUE AND (c.id = $1 OR (s.tenant_id = $2 AND s.external_student_id = $3))`, [subjectId, tenantId, externalId]);
  return row.rowCount ? { kind: "student", id: Number(row.rows[0].id) } : null;
}

// ---- staff (e.g. a university's Academic Admin) ----

/** Former restricted role (authoring only). Still enforced for any account that holds it; new sign-ins are upgraded. */
export const INTEGRATION_STAFF_ROLE = "UMS Academic Staff";

/**
 * Role given to institution admins (Academic Admin, Organization Admin) who sign in from the institution system.
 * They have full administrator access, like a portal administrator. Invigilators and evaluators are not provisioned
 * here: they sign in to the portal directly with their own credentials.
 */
export const INTEGRATION_ADMIN_ROLE = "UMS Administrator";

export class StaffConflictError extends Error {}
export class StaffInactiveError extends Error {}
export class UnknownRoleError extends Error {}

async function ensureRolesTables() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id SERIAL PRIMARY KEY, role_name TEXT NOT NULL, administrator_access BOOLEAN NOT NULL DEFAULT FALSE, dashboard BOOLEAN NOT NULL DEFAULT FALSE,
      permissions JSONB NOT NULL DEFAULT '{}', status BOOLEAN NOT NULL DEFAULT TRUE, created_on TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
}

type RoleQueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rowCount: number | null; rows: any[] }> };

/** The administrator role used for UMS admins: created on first use so a fresh portal always offers it. */
async function ensureAdminRole(client: RoleQueryClient) {
  const role = await client.query("SELECT id FROM roles WHERE role_name = $1 ORDER BY id LIMIT 1", [INTEGRATION_ADMIN_ROLE]);
  if (role.rowCount) {
    await client.query("UPDATE roles SET administrator_access = TRUE, dashboard = TRUE, status = TRUE WHERE id = $1", [role.rows[0].id]);
  } else {
    await client.query("INSERT INTO roles (role_name, administrator_access, dashboard, permissions) VALUES ($1, TRUE, TRUE, '{}'::jsonb)", [INTEGRATION_ADMIN_ROLE]);
  }
}

const BUILT_IN_ROLES = ["Evaluator", "Invigilator"];

/** Portal roles the institution system may assign to its users (active roles, never the former restricted one). */
export async function listAssignableRoles() {
  await ensureRolesTables();
  await ensureAdminRole(databasePool);
  const result = await databasePool.query(
    `SELECT BTRIM(role_name) AS name, administrator_access FROM roles
     WHERE status = TRUE AND BTRIM(role_name) <> '' AND BTRIM(role_name) <> $1 ORDER BY administrator_access DESC, role_name`, [INTEGRATION_STAFF_ROLE]);
  const seen = new Set<string>();
  // Evaluator and Invigilator are built into the portal (matched by name), so they are always assignable.
  const rows = [...result.rows, ...BUILT_IN_ROLES.map((name) => ({ name, administrator_access: false }))];
  return rows
    .filter((row) => !seen.has(String(row.name).toLowerCase()) && seen.add(String(row.name).toLowerCase()))
    .map((row) => ({ name: String(row.name), administrator_access: Boolean(row.administrator_access) }));
}

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
    await ensureAdminRole(client);
    // The role is chosen in the institution system and must be an active portal role; without one, the administrator role.
    let roleName = INTEGRATION_ADMIN_ROLE;
    if (staff.role) {
      const wanted = await client.query(
        "SELECT BTRIM(role_name) AS name FROM roles WHERE LOWER(BTRIM(role_name)) = LOWER($1) AND status = TRUE AND BTRIM(role_name) <> $2 ORDER BY id LIMIT 1",
        [staff.role, INTEGRATION_STAFF_ROLE]);
      const builtIn = BUILT_IN_ROLES.find((name) => name.toLowerCase() === staff.role!.toLowerCase());
      if (!wanted.rowCount && !builtIn) throw new UnknownRoleError(`The Exam Portal has no active role named "${staff.role}"`);
      roleName = wanted.rowCount ? String(wanted.rows[0].name) : builtIn!;
    }
    const link = (await client.query(
      `SELECT u.id, u.status, s.revoked_at FROM users u LEFT JOIN integration_staff s ON s.user_row_id = u.id
       WHERE (s.tenant_id = $1 AND s.external_user_id = $2) OR (u.tenant_id = $1 AND u.external_user_id = $2)
       LIMIT 1`, [staff.tenantId, staff.externalUserId])).rows[0] as { id: number; status: boolean; revoked_at: Date | null } | undefined;
    const clash = await client.query("SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2", [staff.email, link ? link.id : 0]);
    if (clash.rowCount) throw new StaffConflictError("A portal account with this email already exists");
    let userId: number;
    if (link) {
      // A deactivated account stays deactivated. The institution system decides the role when it names one;
      // otherwise a role set in the portal is kept, except the former restricted role, which becomes the administrator role.
      // An account the institution system revoked comes back with this sign-in; one a portal administrator deactivated does not.
      if (!link.status && !link.revoked_at) throw new StaffInactiveError("The linked portal account has been deactivated");
      userId = Number(link.id);
      await client.query(
        `UPDATE users SET status = TRUE, name = $2, email = $3, verified = TRUE, tenant_id = $4, external_user_id = $5,
           role = CASE WHEN $8::boolean OR BTRIM(role) = $6 THEN $7 ELSE role END WHERE id = $1`,
        [userId, staff.name, staff.email, staff.tenantId, staff.externalUserId, INTEGRATION_STAFF_ROLE, roleName, Boolean(staff.role)]);
    } else {
      userId = Number((await client.query(
        "INSERT INTO users (name, email, password, role, mobile, status, verified, tenant_id, external_user_id) VALUES ($1,$2,$3,$4,'-',TRUE,TRUE,$5,$6) RETURNING id",
        [staff.name, staff.email, unusablePassword, roleName, staff.tenantId, staff.externalUserId])).rows[0].id);
    }
    await client.query(
      `INSERT INTO integration_staff (tenant_id, external_user_id, user_row_id) VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id, external_user_id) DO UPDATE SET user_row_id = EXCLUDED.user_row_id`, [staff.tenantId, staff.externalUserId, userId]);
    await client.query("UPDATE integration_staff SET updated_at = NOW(), revoked_at = NULL WHERE user_row_id = $1", [userId]);
    await client.query("COMMIT");
    return userId;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Withdraws a staff member's portal access: deactivates the linked account and ends its sessions, so a tab that is
 * already open stops working too. A later sign-in authorised by the institution system reactivates it.
 */
export async function revokeStaff(tenantId: string, externalUserId: string) {
  await ensureIntegrationTables();
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    const link = (await client.query("SELECT user_row_id FROM integration_staff WHERE tenant_id = $1 AND external_user_id = $2", [tenantId, externalUserId])).rows[0];
    if (!link) { await client.query("ROLLBACK"); return false; }
    await client.query("UPDATE users SET status = FALSE WHERE id = $1", [link.user_row_id]);
    await client.query("DELETE FROM ums_auth_sessions WHERE subject_type = 'user' AND subject_id = $1", [link.user_row_id]);
    await client.query("UPDATE integration_staff SET revoked_at = NOW(), updated_at = NOW() WHERE tenant_id = $1 AND external_user_id = $2", [tenantId, externalUserId]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function createStaffLaunchTicket(tenantId: string, externalUserId: string, userId: number, clientId: string | null = null) {
  await ensureIntegrationTables();
  return insertLaunchTicket(tenantId, externalUserId, "staff", userId, clientId);
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
      `SELECT s.id AS assessment_id FROM assessment s
       LEFT JOIN integration_assessment_map m ON m.assessment_id = s.id AND m.tenant_id = $1 AND m.external_assessment_id = $2
       WHERE m.assessment_id IS NOT NULL OR (s.tenant_id = $1 AND s.external_assessment_id = $2)
       ORDER BY m.assessment_id IS NULL LIMIT 1`, [a.tenantId, a.externalAssessmentId])).rows[0];
    let assessmentId: number;
    let created = false;
    if (mapped) {
      assessmentId = Number(mapped.assessment_id);
      await client.query(
        "UPDATE assessment SET examination = $2, name = $3, start_date = $4, end_date = $5, total_time = COALESCE($6, total_time), status = $7 WHERE id = $1",
        [assessmentId, a.examination, a.name, a.startDate, a.endDate, a.totalTime, a.active]);
      await client.query("UPDATE assessment SET tenant_id = $2, external_assessment_id = $3 WHERE id = $1 AND external_assessment_id IS NULL", [assessmentId, a.tenantId, a.externalAssessmentId]);
    } else {
      created = true;
      assessmentId = Number((await client.query(
        "INSERT INTO assessment (examination, name, start_date, end_date, total_time, status, tenant_id, external_assessment_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
        [a.examination, a.name, a.startDate, a.endDate, a.totalTime, a.active, a.tenantId, a.externalAssessmentId])).rows[0].id);
    }
    await client.query(
      `INSERT INTO integration_assessment_map (tenant_id, external_assessment_id, assessment_id) VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id, external_assessment_id) DO UPDATE SET assessment_id = EXCLUDED.assessment_id`, [a.tenantId, a.externalAssessmentId, assessmentId]);
    await client.query("COMMIT");
    return { assessmentId, created };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
