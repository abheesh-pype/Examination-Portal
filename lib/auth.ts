import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";

const SESSION_COOKIE = "ums_exam_session";
const SESSION_LIFETIME_SECONDS = 60 * 60 * 12;

type Session = {
  tokenHash: string;
  subjectType: "user" | "candidate";
  subjectId: number;
  expiresAt: Date;
};

export type AuthenticatedUser = {
  id: number;
  role: string;
  isAdmin: boolean;
};

export type AuthenticatedCandidate = {
  id: number;
  candidateId: string;
  dateOfBirth: string;
};

export type ApiAuthorization =
  | { ok: true; public?: boolean; user?: AuthenticatedUser; candidate?: AuthenticatedCandidate }
  | { ok: false; response: NextResponse };

let sessionTableReady: Promise<void> | null = null;

async function ensureSessionTable() {
  if (!sessionTableReady) {
    sessionTableReady = databasePool.query(`
      CREATE TABLE IF NOT EXISTS ums_auth_sessions (
        token_hash CHAR(64) PRIMARY KEY,
        subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'candidate')),
        subject_id INTEGER NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(async () => {
      await databasePool.query(`
        CREATE TABLE IF NOT EXISTS roles (
          id SERIAL PRIMARY KEY,
          role_name TEXT NOT NULL,
          administrator_access BOOLEAN NOT NULL DEFAULT FALSE,
          dashboard BOOLEAN NOT NULL DEFAULT FALSE,
          permissions JSONB NOT NULL DEFAULT '{}',
          status BOOLEAN NOT NULL DEFAULT TRUE,
          created_on TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    });
  }
  try {
    await sessionTableReady;
  } catch (error) {
    sessionTableReady = null;
    throw error;
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function getSessionToken(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    return cookie.slice(separator + 1).trim();
  }
  return "";
}

export async function createSession(subjectType: Session["subjectType"], subjectId: number) {
  await ensureSessionTable();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_SECONDS * 1000);
  await databasePool.query(`
    INSERT INTO ums_auth_sessions (token_hash, subject_type, subject_id, expires_at)
    VALUES ($1, $2, $3, $4)
  `, [sha256(token), subjectType, subjectId, expiresAt]);
  return token;
}

export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_LIFETIME_SECONDS,
  });
}

export async function revokeSession(request: Request) {
  const token = getSessionToken(request);
  if (!token) return;
  await ensureSessionTable();
  await databasePool.query("DELETE FROM ums_auth_sessions WHERE token_hash = $1", [sha256(token)]);
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

function unauthorized(message = "Authentication is required.") {
  return {
    ok: false as const,
    response: NextResponse.json({ error: message }, { status: 401 }),
  };
}

function forbidden(message = "You are not authorized to access this resource.") {
  return {
    ok: false as const,
    response: NextResponse.json({ error: message }, { status: 403 }),
  };
}

function normalizeDate(value: string) {
  const prefix = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (!prefix) return "";
  const date = new Date(`${prefix[1]}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === prefix[1]
    ? prefix[1]
    : "";
}

async function resolveSession(request: Request): Promise<Session | null> {
  const token = getSessionToken(request);
  if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) return null;
  await ensureSessionTable();
  const result = await databasePool.query(`
    SELECT token_hash, subject_type, subject_id, expires_at
    FROM ums_auth_sessions
    WHERE token_hash = $1 AND expires_at > NOW()
  `, [sha256(token)]);
  if (!result.rowCount) return null;
  const row = result.rows[0];
  if (row.subject_type !== "user" && row.subject_type !== "candidate") return null;
  return {
    tokenHash: String(row.token_hash),
    subjectType: row.subject_type,
    subjectId: Number(row.subject_id),
    expiresAt: new Date(row.expires_at),
  };
}

async function resolveUser(subjectId: number): Promise<AuthenticatedUser | null> {
  const result = await databasePool.query(`
    SELECT users.id, users.role,
           COALESCE(roles.administrator_access, FALSE) AS administrator_access
    FROM users
    LEFT JOIN roles ON LOWER(BTRIM(roles.role_name)) = LOWER(BTRIM(users.role)) AND roles.status = TRUE
    WHERE users.id = $1 AND users.status = TRUE
    LIMIT 1
  `, [subjectId]);
  if (!result.rowCount) return null;
  const role = String(result.rows[0].role ?? "").trim();
  return {
    id: Number(result.rows[0].id),
    role,
    isAdmin: role.toLocaleLowerCase().includes("admin") || Boolean(result.rows[0].administrator_access),
  };
}

async function resolveCandidate(subjectId: number): Promise<AuthenticatedCandidate | null> {
  const result = await databasePool.query(`
    SELECT id, candidate_data
    FROM "Candidate Information"
    WHERE id = $1 AND record_type = 'candidate' AND status = TRUE
  `, [subjectId]);
  if (!result.rowCount) return null;
  const data = result.rows[0].candidate_data as { fields?: Record<string, unknown> } | null;
  const fields = data?.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return null;
  const candidateIdEntry = Object.entries(fields).find(([name, value]) =>
    /^candidate id(?:\s*\([^)]*\))?$/i.test(name.trim())
    && typeof value === "string"
    && /^\d{6}$/.test(value.trim()),
  );
  const dateEntry = Object.entries(fields).find(([name, value]) =>
    /^(dob|date of birth|birth date)(?:\s*\([^)]*\))?$/i.test(name.trim())
    && typeof value === "string"
    && value.trim(),
  );
  const candidateId = candidateIdEntry ? String(candidateIdEntry[1]).trim() : "";
  const dateOfBirth = dateEntry ? normalizeDate(String(dateEntry[1])) : "";
  if (!candidateId || !dateOfBirth) return null;
  return { id: Number(result.rows[0].id), candidateId, dateOfBirth };
}

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === "GET" || request.method === "HEAD") return {};
  try {
    const value: unknown = await request.clone().json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  return request.headers.get("sec-fetch-site") !== "cross-site";
}

function isStudentRoute(path: string) {
  return path === "/api/candidates/student-dashboard"
    || path === "/api/candidates/student-exam"
    || path === "/api/candidates/student-exam/submit"
    || path === "/api/candidates/student-exam/proctor"
    || path === "/api/assessment-results";
}

export async function authorizeApiRequest(request: Request): Promise<ApiAuthorization> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const body = await requestBody(request);

  if (method !== "GET" && method !== "HEAD" && !assertSameOrigin(request)) {
    return forbidden("Cross-origin requests are not allowed.");
  }

  if ((path === "/api/users/login" || path === "/api/candidates/login") && method === "POST") {
    return { ok: true, public: true };
  }
  if (path === "/api/auth/logout" && method === "POST") {
    return { ok: true, public: true };
  }

  const session = await resolveSession(request);
  if (!session) return unauthorized();

  if (path === "/api/auth/session" && method === "GET") {
    if (session.subjectType === "user") {
      const user = await resolveUser(session.subjectId);
      return user ? { ok: true, user } : unauthorized();
    }
    const candidate = await resolveCandidate(session.subjectId);
    return candidate ? { ok: true, candidate } : unauthorized();
  }

  if ((isStudentRoute(path) && (path !== "/api/assessment-results" || method === "POST"))
    || (path === "/api/candidates/student-exam/live-feed" && body.side === "candidate")) {
    if (session.subjectType !== "candidate") return forbidden("A student session is required.");
    const candidate = await resolveCandidate(session.subjectId);
    if (!candidate) return unauthorized("The student session is no longer valid.");
    if ((body.candidateId !== undefined
        && (typeof body.candidateId !== "string" || body.candidateId.trim() !== candidate.candidateId))
      || (body.dateOfBirth !== undefined
        && (typeof body.dateOfBirth !== "string" || normalizeDate(body.dateOfBirth) !== candidate.dateOfBirth))) {
      return forbidden("Student credentials do not match the authenticated student.");
    }
    if (path.endsWith("/live-feed")
      && body.candidateRecordId !== undefined
      && Number(body.candidateRecordId) !== candidate.id) {
      return forbidden("The live-feed candidate does not match the authenticated student.");
    }
    return { ok: true, candidate };
  }

  if (path === "/api/candidate-permissions" && method === "GET") {
    if (session.subjectType === "user") {
      const user = await resolveUser(session.subjectId);
      return user ? { ok: true, user } : unauthorized();
    }
    const candidate = await resolveCandidate(session.subjectId);
    return candidate ? { ok: true, candidate } : unauthorized();
  }

  if (session.subjectType !== "user") return forbidden("A staff account is required.");
  const user = await resolveUser(session.subjectId);
  if (!user) return unauthorized("The account is inactive or no longer exists.");

  for (const key of ["accountUserId", "viewerUserId", "invigilatorUserId"]) {
    const queryValue = url.searchParams.get(key);
    if (queryValue !== null && Number(queryValue) !== user.id) return forbidden("Account identity must match the active session.");
    if (body[key] !== undefined && Number(body[key]) !== user.id) return forbidden("Account identity must match the active session.");
  }

  if (path === "/api/assessment-evaluations") {
    const normalizedRole = user.role.toLocaleLowerCase();
    if (!user.isAdmin && normalizedRole !== "evaluator") return forbidden("Only administrators and evaluators can access assessment evaluations.");
    return { ok: true, user };
  }
  if (path === "/api/assessment-invigilate-candidates"
    || path === "/api/assessment-invigilate-activity"
    || path === "/api/assessment-invigilate-restart"
    || (path === "/api/candidates/student-exam/live-feed" && body.side === "staff")) {
    if (!user.isAdmin && user.role.toLocaleLowerCase() !== "invigilator") {
      return forbidden("Only administrators and invigilators can access invigilation data.");
    }
    return { ok: true, user };
  }
  if (path === "/api/candidate-permissions" && method === "PUT") {
    if (!user.isAdmin) return forbidden("Only administrators can update candidate permissions.");
    return { ok: true, user };
  }
  if (path === "/api/roles" && method === "GET") return { ok: true, user };
  if (path === "/api/assessment-results" && method === "GET") {
    if (!user.isAdmin) return forbidden("Only administrators can view all assessment results.");
    return { ok: true, user };
  }
  if (path === "/api/assessment-results" && method === "POST") {
    return forbidden("Assessment results are available only to the authenticated student.");
  }

  if (!user.isAdmin) return forbidden("Only administrators can access this API.");
  return { ok: true, user };
}

export function unauthorizedApiResponse(message = "Authentication is required.") {
  return NextResponse.json({ error: message }, { status: 401 });
}
