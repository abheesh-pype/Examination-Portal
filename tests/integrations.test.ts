import { createHash, generateKeyPairSync, randomBytes, scryptSync } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { pool } = await import("./helpers/pglite-pool");
  return { databasePool: pool };
});

import { POST as tokenPost } from "@/app/api/integrations/oauth/token/route";
import { POST as studentsPost } from "@/app/api/integrations/v1/students/route";
import { POST as launchTicketsPost } from "@/app/api/integrations/v1/launch-tickets/route";
import { GET as rolesGet } from "@/app/api/integrations/v1/roles/route";
import { POST as staffRevocationsPost } from "@/app/api/integrations/v1/staff-revocations/route";
import { POST as staffLaunchTicketsPost } from "@/app/api/integrations/v1/staff-launch-tickets/route";
import { PUT as assessmentsPut } from "@/app/api/integrations/v1/assessments/route";
import { GET as resultsGet } from "@/app/api/integrations/v1/results/route";
import { GET as launchGet } from "@/app/launch/route";
import { GET as sessionGet } from "@/app/api/auth/session/route";
import { GET as assessmentsAdminGet } from "@/app/api/assessments/route";
import { GET as usersGet } from "@/app/api/users/route";
import { GET as authLaunchGet } from "@/app/api/auth/launch/route";
import { PUT as assessmentMappingsPut } from "@/app/api/integrations/v1/assessment-mappings/route";
import { POST as candidateLoginPost } from "@/app/api/candidates/login/route";
import { createSession } from "@/lib/auth";
import { databasePool } from "@/lib/db";
import { ensureIntegrationSchema } from "@/lib/integrations/m2m";
import { hashPassword } from "@/lib/password";
import { resetRateLimits } from "@/lib/rate-limit";

const ORIGIN = "http://localhost:3000";
const PORTAL_URL = "https://exam.example.edu";
const TENANT = "institution-001";
const CLIENT_ID = "ums.client-1";
// Includes characters that must be form-urlencoded inside the Basic credentials.
const CLIENT_SECRET = "s3cr+t/=:x and space";
const ALL_SCOPES = ["students:write", "students:launch", "staff:launch", "assessments:write", "results:read"];

const LEGACY_CLIENT_ID = "legacy-issuer-client";
const LEGACY_SECRET = "legacy-issuer-secret";

const logLines: string[] = [];

function basicAuth(clientId: string, clientSecret: string) {
  const encode = (value: string) => encodeURIComponent(value).replace(/%20/g, "+");
  return `Basic ${Buffer.from(`${encode(clientId)}:${encode(clientSecret)}`).toString("base64")}`;
}

function tokenRequest(form: Record<string, string>, authorization = basicAuth(CLIENT_ID, CLIENT_SECRET), contentType = "application/x-www-form-urlencoded") {
  return new Request(`${ORIGIN}/api/integrations/oauth/token`, {
    method: "POST",
    headers: { authorization, "content-type": contentType },
    body: new URLSearchParams(form).toString(),
  });
}

async function getToken(scope?: string) {
  const response = await tokenPost(tokenRequest({ grant_type: "client_credentials", ...(scope ? { scope } : {}) }));
  expect(response.status).toBe(200);
  return (await response.json()).access_token as string;
}

function apiRequest(method: string, path: string, options: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const text = options.body === undefined ? undefined : typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  return {
    text,
    request: new Request(`${ORIGIN}${path}`, {
      method,
      headers: {
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(text ? { "content-type": "application/json" } : {}),
        ...options.headers,
      },
      body: text,
    }),
  };
}

function studentPayload(overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: TENANT,
    external_student_id: "ENR-2026-0001",
    candidate_id: "ENR-2026-0001",
    name: "Asha Nair",
    email: "asha@example.edu",
    category: "B.Sc Computer Science",
    sub_category: "",
    status: "active",
    assigned_assessments: [
      { ums_assessment_id: "EXAM-1", name: "Algorithms", examination: "Semester 3" },
      { ums_assessment_id: "EXAM-404", name: "Unknown", examination: "Semester 3" },
    ],
    ...overrides,
  };
}

async function postStudent(token: string, payload: Record<string, unknown>, idempotencyKey?: string) {
  const text = JSON.stringify(payload);
  const { request } = apiRequest("POST", "/api/integrations/v1/students", {
    token,
    body: text,
    headers: { "idempotency-key": idempotencyKey ?? createHash("sha256").update(text).digest("hex") },
  });
  return studentsPost(request);
}

async function putAssessment(token: string, overrides: Record<string, unknown> = {}) {
  const { request } = apiRequest("PUT", "/api/integrations/v1/assessments", {
    token,
    body: {
      tenant_id: TENANT,
      external_assessment_id: "EXAM-1",
      name: "Algorithms",
      examination: "Semester 3",
      start_date: "2026-11-10T09:00:00.000Z",
      end_date: "2026-11-10T12:00:00.000Z",
      total_time: 90,
      status: "active",
      ...overrides,
    },
  });
  return assessmentsPut(request);
}

function cookieFrom(response: Response) {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = /ums_exam_session=([^;]+)/.exec(setCookie);
  return match ? `ums_exam_session=${match[1]}` : "";
}

beforeAll(async () => {
  process.env.PORTAL_PUBLIC_URL = PORTAL_URL;
  vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => { logLines.push(args.map(String).join(" ")); });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { logLines.push(args.map((arg) => JSON.stringify(arg)).join(" ")); });
  const legacySalt = randomBytes(16);
  await databasePool.query(`
    CREATE TABLE integration_clients (
      client_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, secret_hash TEXT NOT NULL,
      scopes TEXT NOT NULL DEFAULT 'students:write students:launch staff:launch assessments:write',
      status BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await databasePool.query("INSERT INTO integration_clients (client_id, tenant_id, secret_hash, scopes) VALUES ($1, $2, $3, $4)", [
    LEGACY_CLIENT_ID, TENANT,
    `scrypt$${legacySalt.toString("base64url")}$${scryptSync(LEGACY_SECRET, legacySalt, 32).toString("base64url")}`,
    "students:write results:read",
  ]);
  await databasePool.query(`
    CREATE TABLE integration_launch_tickets (
      token_hash CHAR(64) PRIMARY KEY, tenant_id TEXT NOT NULL, external_student_id TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      kind TEXT NOT NULL DEFAULT 'student'
    )
  `);
  await ensureIntegrationSchema();
  await databasePool.query(`
    INSERT INTO integration_clients (client_id, client_secret_hash, tenant_id, scopes)
    VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)
  `, [
    CLIENT_ID, await hashPassword(CLIENT_SECRET), TENANT, ALL_SCOPES,
    "results-only", await hashPassword("results-secret"), TENANT, ["results:read"],
  ]);
});

beforeEach(() => {
  resetRateLimits();
});

afterAll(() => {
  delete process.env.PORTAL_PUBLIC_URL;
  vi.restoreAllMocks();
});

describe("POST /api/integrations/oauth/token", () => {
  it("issues a bearer token with a positive expires_in for urlencoded Basic credentials", async () => {
    const response = await tokenPost(tokenRequest({ grant_type: "client_credentials", audience: "exam-portal-api" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ access_token: expect.any(String), token_type: "Bearer", expires_in: 3600 });
    const stored = await databasePool.query("SELECT client_id, tenant_id, audience FROM integration_access_tokens WHERE token_hash = $1", [
      createHash("sha256").update(body.access_token).digest("hex"),
    ]);
    expect(stored.rows[0]).toEqual({ client_id: CLIENT_ID, tenant_id: TENANT, audience: "exam-portal-api" });
  });

  it("grants only allowed scopes and reports the narrowed scope", async () => {
    const response = await tokenPost(tokenRequest({ grant_type: "client_credentials", scope: "results:read admin:everything" }));
    expect(response.status).toBe(200);
    expect((await response.json()).scope).toBe("results:read");

    const rejected = await tokenPost(tokenRequest(
      { grant_type: "client_credentials", scope: "students:write" },
      basicAuth("results-only", "results-secret"),
    ));
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toBe("invalid_scope");
  });

  it("returns 401 invalid_client for a wrong secret, an unknown client or missing credentials", async () => {
    for (const authorization of [basicAuth(CLIENT_ID, "wrong"), basicAuth("nobody", CLIENT_SECRET), ""]) {
      const response = await tokenPost(tokenRequest({ grant_type: "client_credentials" }, authorization));
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: "invalid_client" });
      expect(response.headers.get("www-authenticate")).toMatch(/^Basic/);
    }
  });

  it("returns 400 for a missing or unsupported grant type and a wrong content type", async () => {
    const missing = await tokenPost(tokenRequest({}));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toBe("invalid_request");

    const unsupported = await tokenPost(tokenRequest({ grant_type: "password" }));
    expect(unsupported.status).toBe(400);
    expect((await unsupported.json()).error).toBe("unsupported_grant_type");

    const json = await tokenPost(tokenRequest({ grant_type: "client_credentials" }, undefined, "application/json"));
    expect(json.status).toBe(400);
    expect((await json.json()).error).toBe("invalid_request");

    const audience = await tokenPost(tokenRequest({ grant_type: "client_credentials", audience: "someone-else" }));
    expect(audience.status).toBe(400);
  });

  it("blocks repeated failures for one client, and limits all token requests per IP", async () => {
    const attempt = (clientId: string, address: string) => {
      const request = tokenRequest({ grant_type: "client_credentials" }, basicAuth(clientId, "wrong"));
      request.headers.set("x-forwarded-for", address);
      return tokenPost(request);
    };

    const failures: number[] = [];
    for (let index = 0; index < 11; index += 1) failures.push((await attempt(CLIENT_ID, "203.0.113.10")).status);
    expect(failures.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(failures[10]).toBe(429);

    resetRateLimits();
    const statuses: number[] = [];
    for (let index = 0; index < 31; index += 1) statuses.push((await attempt(`client-${index}`, "203.0.113.11")).status);
    expect(statuses.slice(0, 30).every((status) => status === 401)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});

describe("bearer authorization for /api/integrations/v1/*", () => {
  it("returns 401 without a token, with an unknown token, and with an expired token", async () => {
    const payload = studentPayload();
    expect((await studentsPost(apiRequest("POST", "/api/integrations/v1/students", { body: payload }).request)).status).toBe(401);
    expect((await studentsPost(apiRequest("POST", "/api/integrations/v1/students", { token: "not-a-real-token", body: payload }).request)).status).toBe(401);

    const token = await getToken();
    await databasePool.query("UPDATE integration_access_tokens SET expires_at = NOW() - INTERVAL '1 second' WHERE token_hash = $1", [
      createHash("sha256").update(token).digest("hex"),
    ]);
    const expired = await studentsPost(apiRequest("POST", "/api/integrations/v1/students", { token, body: payload }).request);
    expect(expired.status).toBe(401);
    expect(await expired.json()).toMatchObject({ ok: false, error: "invalid_token" });
  });

  it("returns 403 when the token lacks the route scope", async () => {
    const token = await getToken("results:read");
    const response = await studentsPost(apiRequest("POST", "/api/integrations/v1/students", { token, body: studentPayload() }).request);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("insufficient_scope");
  });

  it("returns 403 when tenant_id does not match the client", async () => {
    const token = await getToken();
    const response = await studentsPost(apiRequest("POST", "/api/integrations/v1/students", {
      token,
      body: studentPayload({ tenant_id: "another-institution" }),
    }).request);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("tenant_mismatch");
  });

  it("accepts cross-origin server calls that carry a valid bearer token", async () => {
    const token = await getToken();
    const response = await assessmentsPut(apiRequest("PUT", "/api/integrations/v1/assessments", {
      token,
      headers: { origin: "https://ums.example.edu", "sec-fetch-site": "cross-site" },
      body: {
        tenant_id: TENANT, external_assessment_id: "EXAM-CORS", name: "Cross origin", examination: "Semester 1", status: "active",
      },
    }).request);
    expect(response.status).toBe(201);
  });
});

describe("PUT /api/integrations/v1/assessments", () => {
  it("creates, then updates by external_assessment_id without touching portal-authored sections", async () => {
    const token = await getToken("assessments:write");
    const created = await putAssessment(token);
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody).toEqual({ ok: true, result: "created", assessment_id: expect.any(Number), external_assessment_id: "EXAM-1", status: "active" });

    await databasePool.query(`UPDATE assessment SET sections = $2::jsonb, pass_mark = 5 WHERE id = $1`, [
      createdBody.assessment_id,
      JSON.stringify([{ name: "Part A", question_type: "MCQ", question_count: 2, correct_mark: 5, wrong_mark: -1 }]),
    ]);

    const updated = await putAssessment(token, { name: "Algorithms II", total_time: 120 });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({ ok: true, result: "updated", assessment_id: createdBody.assessment_id, external_assessment_id: "EXAM-1", status: "active" });
    const row = await databasePool.query("SELECT name, total_time, sections, pass_mark FROM assessment WHERE id = $1", [createdBody.assessment_id]);
    expect(row.rows[0]).toMatchObject({ name: "Algorithms II", total_time: 120 });
    expect(row.rows[0].sections).toHaveLength(1);
    expect(Number(row.rows[0].pass_mark)).toBe(5);
  });

  it("rejects invalid assessments", async () => {
    const token = await getToken("assessments:write");
    const dates = await putAssessment(token, {
      external_assessment_id: "EXAM-BAD", start_date: "2026-11-10T12:00:00Z", end_date: "2026-11-10T09:00:00Z",
    });
    expect(dates.status).toBe(400);
    expect((await dates.json()).error_description).toContain("end_date");

    const duration = await putAssessment(token, { external_assessment_id: "EXAM-BAD", total_time: 0 });
    expect(duration.status).toBe(400);
    expect((await duration.json()).error_description).toContain("total_time");
  });
});

describe("POST /api/integrations/v1/students", () => {
  it("creates a student, maps known assessments and reports unknown ones", async () => {
    const token = await getToken();
    await putAssessment(token);
    const response = await postStudent(token, studentPayload());
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      result: "created",
      status: "active",
      external_student_id: "ENR-2026-0001",
      candidate_id: expect.stringMatching(/^\d{6}$/),
      assigned_assessments: 1,
      unmapped_assessments: ["EXAM-404"],
    });
    const assignments = await databasePool.query(`
      SELECT assignment.source, assessment.external_assessment_id
      FROM assessment_candidate_direct_assignment AS assignment
      JOIN assessment ON assessment.id = assignment.assessment_id
      JOIN "Candidate Information" AS candidate ON candidate.id = assignment.candidate_id
      WHERE candidate.external_student_id = 'ENR-2026-0001'
    `);
    expect(assignments.rows).toEqual([{ source: "ums", external_assessment_id: "EXAM-1" }]);
  });

  it("returns the stored response for a repeated Idempotency-Key without creating a duplicate", async () => {
    const token = await getToken();
    const payload = studentPayload({ external_student_id: "ENR-IDEMP", candidate_id: "ENR-IDEMP" });
    const first = await postStudent(token, payload);
    const firstBody = await first.json();
    const repeat = await postStudent(token, payload);
    expect(repeat.status).toBe(first.status);
    expect(await repeat.json()).toEqual(firstBody);
    const count = await databasePool.query(`SELECT COUNT(*)::int AS count FROM "Candidate Information" WHERE external_student_id = 'ENR-IDEMP'`);
    expect(count.rows[0].count).toBe(1);

    const reused = await postStudent(token, { ...payload, name: "Changed" }, createHash("sha256").update(JSON.stringify(payload)).digest("hex"));
    expect(reused.status).toBe(422);
    expect((await reused.json()).error).toBe("idempotency_key_reused");
  });

  it("updates an existing student by tenant + external_student_id and keeps the portal Candidate ID", async () => {
    const token = await getToken();
    const first = await (await postStudent(token, studentPayload({ external_student_id: "ENR-UPD", candidate_id: "ENR-UPD" }))).json();
    const updated = await postStudent(token, studentPayload({ external_student_id: "ENR-UPD", candidate_id: "ENR-UPD", name: "Asha N." }));
    expect(updated.status).toBe(200);
    expect((await updated.json()).candidate_id).toBe(first.candidate_id);
    const row = await databasePool.query(`SELECT name, candidate_data FROM "Candidate Information" WHERE external_student_id = 'ENR-UPD'`);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].name).toBe("Asha N.");
  });

  it("deactivates an inactive student and removes only UMS-made assignments", async () => {
    const token = await getToken();
    await putAssessment(token, { external_assessment_id: "EXAM-MANUAL", name: "Manual" });
    const created = await postStudent(token, studentPayload({ external_student_id: "ENR-OFF", candidate_id: "ENR-OFF" }));
    expect(created.status).toBe(201);
    const candidate = await databasePool.query(`SELECT id FROM "Candidate Information" WHERE external_student_id = 'ENR-OFF'`);
    const manualAssessment = await databasePool.query(`SELECT id FROM assessment WHERE external_assessment_id = 'EXAM-MANUAL'`);
    await databasePool.query(`INSERT INTO assessment_candidate_direct_assignment (assessment_id, candidate_id) VALUES ($1, $2)`, [
      manualAssessment.rows[0].id, candidate.rows[0].id,
    ]);

    const response = await postStudent(token, studentPayload({ external_student_id: "ENR-OFF", candidate_id: "ENR-OFF", status: "inactive" }));
    expect(response.status).toBe(200);
    expect((await response.json()).assigned_assessments).toBe(0);
    const row = await databasePool.query(`SELECT status FROM "Candidate Information" WHERE id = $1`, [candidate.rows[0].id]);
    expect(row.rows[0].status).toBe(false);
    const remaining = await databasePool.query(`SELECT assessment_id, source FROM assessment_candidate_direct_assignment WHERE candidate_id = $1`, [candidate.rows[0].id]);
    expect(remaining.rows).toEqual([{ assessment_id: manualAssessment.rows[0].id, source: null }]);
  });

  it("reports every assessment as unmapped when none are known", async () => {
    const token = await getToken();
    const response = await postStudent(token, studentPayload({
      external_student_id: "ENR-UNK", candidate_id: "ENR-UNK", assigned_assessments: [{ ums_assessment_id: "NOPE", name: "No such exam", examination: "None" }],
    }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ assigned_assessments: 0, unmapped_assessments: ["NOPE"] });
  });

  it("returns 400 for a non-object body and 422 for invalid fields", async () => {
    const token = await getToken();
    const notJson = await studentsPost(apiRequest("POST", "/api/integrations/v1/students", {
      token, body: "[]", headers: { "content-type": "application/json" },
    }).request);
    // A non-object body has no tenant_id, which the authorization layer rejects first.
    expect(notJson.status).toBe(400);

    for (const [field, invalidValue] of [["external_student_id", ""], ["status", "archived"], ["email", "nope"]] as const) {
      const invalid = await postStudent(token, studentPayload({ [field]: invalidValue }));
      expect(invalid.status).toBe(400);
      const body = await invalid.json();
      expect(body.ok).toBe(false);
      expect(body.error_description).toContain(field);
    }
  });
});

describe("student launch tickets and /launch", () => {
  it("issues a one-time HTTPS launch URL that signs the student in and redirects to the dashboard", async () => {
    const token = await getToken();
    await postStudent(token, studentPayload({ external_student_id: "ENR-SSO", candidate_id: "ENR-SSO" }));
    const response = await launchTicketsPost(apiRequest("POST", "/api/integrations/v1/launch-tickets", {
      token, body: { tenant_id: TENANT, external_student_id: "ENR-SSO" },
    }).request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      launch_url: expect.stringMatching(/^https:\/\/exam\.example\.edu\/launch\?ticket=[A-Za-z0-9_-]{43}$/),
      expires_at: expect.any(String),
      expires_in: 90,
    });
    const lifetime = new Date(body.expires_at).getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(80_000);
    expect(lifetime).toBeLessThanOrEqual(90_000);

    const launchUrl = new URL(body.launch_url);
    const redeemed = await launchGet(new Request(`${ORIGIN}/launch${launchUrl.search}`));
    expect(redeemed.status).toBe(302);
    expect(redeemed.headers.get("location")).toBe(`${PORTAL_URL}/dashboard`);
    const cookie = cookieFrom(redeemed);
    expect(cookie).not.toBe("");

    const session = await sessionGet(new Request(`${ORIGIN}/api/auth/session`, { headers: { cookie } }));
    expect(session.status).toBe(200);
    expect((await session.json()).student).toMatchObject({ name: "Asha Nair", portalType: "student" });

    const reused = await launchGet(new Request(`${ORIGIN}/launch${launchUrl.search}`));
    expect(reused.status).toBe(401);
    expect((await reused.json()).error).toBe("invalid_ticket");
  });

  it("also redeems tickets through /api/auth/launch, sending failures to the login page", async () => {
    const token = await getToken();
    const response = await launchTicketsPost(apiRequest("POST", "/api/integrations/v1/launch-tickets", {
      token, body: { tenant_id: TENANT, external_student_id: "ENR-SSO" },
    }).request);
    const { search } = new URL((await response.json()).launch_url);
    const redeemed = await authLaunchGet(new Request(`${ORIGIN}/api/auth/launch${search}`));
    expect(redeemed.status).toBe(307);
    expect(redeemed.headers.get("location")).toBe(`${PORTAL_URL}/`);
    expect(cookieFrom(redeemed)).not.toBe("");

    const reused = await authLaunchGet(new Request(`${ORIGIN}/api/auth/launch${search}`));
    expect(reused.headers.get("location")).toBe(`${PORTAL_URL}/?sso_error=expired`);
    expect(reused.headers.get("set-cookie")).toBeNull();
  });

  it("rejects an expired ticket", async () => {
    const token = await getToken();
    const response = await launchTicketsPost(apiRequest("POST", "/api/integrations/v1/launch-tickets", {
      token, body: { tenant_id: TENANT, external_student_id: "ENR-SSO" },
    }).request);
    const ticket = new URL((await response.json()).launch_url).searchParams.get("ticket")!;
    await databasePool.query("UPDATE integration_launch_tickets SET expires_at = NOW() - INTERVAL '1 second' WHERE token_hash = $1", [
      createHash("sha256").update(ticket).digest("hex"),
    ]);
    const redeemed = await launchGet(new Request(`${ORIGIN}/launch?ticket=${ticket}`));
    expect(redeemed.status).toBe(401);
    expect(redeemed.headers.get("set-cookie")).toBeNull();
  });

  it("returns 404 for an unknown or inactive student", async () => {
    const token = await getToken();
    for (const externalStudentId of ["ENR-MISSING", "ENR-OFF"]) {
      const response = await launchTicketsPost(apiRequest("POST", "/api/integrations/v1/launch-tickets", {
        token, body: { tenant_id: TENANT, external_student_id: externalStudentId },
      }).request);
      expect(response.status).toBe(404);
    }
  });

  it("returns 403 without the students:launch scope", async () => {
    const token = await getToken("students:write");
    const response = await launchTicketsPost(apiRequest("POST", "/api/integrations/v1/launch-tickets", {
      token, body: { tenant_id: TENANT, external_student_id: "ENR-SSO" },
    }).request);
    expect(response.status).toBe(403);
  });
});

describe("POST /api/integrations/v1/staff-launch-tickets", () => {
  const staff = { tenant_id: TENANT, external_user_id: "ums-user:42", name: "Dr. Rao", email: "rao@example.edu" };

  it("creates a linked administrator user, reuses it, and signs in through /launch", async () => {
    const token = await getToken();
    const first = await staffLaunchTicketsPost(apiRequest("POST", "/api/integrations/v1/staff-launch-tickets", { token, body: staff }).request);
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body).toEqual({ ok: true, launch_url: expect.stringMatching(/^https:\/\/exam\.example\.edu\/launch\?ticket=/), expires_in: 90 });

    const second = await staffLaunchTicketsPost(apiRequest("POST", "/api/integrations/v1/staff-launch-tickets", {
      token, body: { ...staff, name: "Dr. A. Rao" },
    }).request);
    expect(second.status).toBe(200);
    const users = await databasePool.query("SELECT name, role FROM users WHERE external_user_id = 'ums-user:42'");
    expect(users.rows).toEqual([{ name: "Dr. A. Rao", role: "UMS Administrator" }]);

    const redeemed = await launchGet(new Request(`${ORIGIN}/launch${new URL(body.launch_url).search}`));
    expect(redeemed.status).toBe(302);
    const cookie = cookieFrom(redeemed);
    const session = await sessionGet(new Request(`${ORIGIN}/api/auth/session`, { headers: { cookie } }));
    expect((await session.json()).user).toMatchObject({ email: "rao@example.edu", role: "UMS Administrator" });
    // Full administrator access, like a portal administrator.
    expect((await assessmentsAdminGet(new Request(`${ORIGIN}/api/assessments`, { headers: { cookie } }))).status).toBe(200);
    expect((await usersGet(new Request(`${ORIGIN}/api/users`, { headers: { cookie } }))).status).toBe(200);
  });

  it("lists assignable roles and signs staff in with the role chosen in UMS", async () => {
    await databasePool.query("INSERT INTO roles (role_name, administrator_access, dashboard) VALUES ('Evaluator', FALSE, TRUE), ('Invigilator', FALSE, TRUE)");
    const token = await getToken();
    const listed = await rolesGet(apiRequest("GET", `/api/integrations/v1/roles?tenant_id=${TENANT}`, { token }).request);
    expect(listed.status).toBe(200);
    const names = (await listed.json()).roles.map((role: { name: string }) => role.name);
    expect(names).toEqual(expect.arrayContaining(["UMS Administrator", "Evaluator", "Invigilator"]));
    expect(names).not.toContain("UMS Academic Staff");

    const body = { ...staff, external_user_id: "ums-user:45", email: "eval@example.edu", role: "evaluator" };
    expect((await staffLaunchTicketsPost(apiRequest("POST", "/api/integrations/v1/staff-launch-tickets", { token, body }).request)).status).toBe(200);
    const row = await databasePool.query("SELECT role FROM users WHERE external_user_id = 'ums-user:45'");
    expect(row.rows[0].role).toBe("Evaluator");

    // A later change in UMS replaces the role; an unknown role is refused and changes nothing.
    await staffLaunchTicketsPost(apiRequest("POST", "/api/integrations/v1/staff-launch-tickets", { token, body: { ...body, role: "Invigilator" } }).request);
    expect((await databasePool.query("SELECT role FROM users WHERE external_user_id = 'ums-user:45'")).rows[0].role).toBe("Invigilator");
    const unknown = await staffLaunchTicketsPost(apiRequest("POST", "/api/integrations/v1/staff-launch-tickets", { token, body: { ...body, role: "Nope" } }).request);
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toBe("unknown_role");
    expect((await databasePool.query("SELECT role FROM users WHERE external_user_id = 'ums-user:45'")).rows[0].role).toBe("Invigilator");
  });

  it("offers the built-in roles, and revoking ends sessions and blocks access until UMS signs the person in again", async () => {
    const token = await getToken();
    const listed = await rolesGet(apiRequest("GET", `/api/integrations/v1/roles?tenant_id=${TENANT}`, { token }).request);
    expect((await listed.json()).roles.map((role: { name: string }) => role.name)).toEqual(expect.arrayContaining(["Evaluator", "Invigilator"]));

    const body = { ...staff, external_user_id: "ums-user:46", email: "revoke@example.edu" };
    const launched = await staffLaunchTicketsPost(apiRequest("POST", "/api/integrations/v1/staff-launch-tickets", { token, body }).request);
    const redeemed = await launchGet(new Request(`${ORIGIN}/launch${new URL((await launched.json()).launch_url).search}`));
    const cookie = cookieFrom(redeemed);
    const sessionUrl = `${ORIGIN}/api/auth/session`;
    expect((await sessionGet(new Request(sessionUrl, { headers: { cookie } }))).status).toBe(200);

    const revoke = (id: string) => staffRevocationsPost(apiRequest("POST", "/api/integrations/v1/staff-revocations", { token, body: { tenant_id: TENANT, external_user_id: id } }).request);
    expect((await (await revoke("ums-user:46")).json())).toEqual({ ok: true, revoked: true });
    expect((await sessionGet(new Request(sessionUrl, { headers: { cookie } }))).status).toBe(401);
    expect((await (await revoke("ums-user:nobody")).json())).toEqual({ ok: true, revoked: false });

    // A sign-in authorised by UMS brings the account back; one a portal administrator deactivated stays blocked.
    expect((await staffLaunchTicketsPost(apiRequest("POST", "/api/integrations/v1/staff-launch-tickets", { token, body: { ...body, role: "Evaluator" } }).request)).status).toBe(200);
    const row = await databasePool.query("SELECT role, status FROM users WHERE external_user_id = 'ums-user:46'");
    expect(row.rows[0]).toEqual({ role: "Evaluator", status: true });
  });

  it("upgrades an account that still has the former restricted role", async () => {
    const token = await getToken();
    const body = { ...staff, external_user_id: "ums-user:44", email: "legacy@example.edu" };
    expect((await staffLaunchTicketsPost(apiRequest("POST", "/api/integrations/v1/staff-launch-tickets", { token, body }).request)).status).toBe(200);
    await databasePool.query("UPDATE users SET role = 'UMS Academic Staff' WHERE external_user_id = 'ums-user:44'");
    expect((await staffLaunchTicketsPost(apiRequest("POST", "/api/integrations/v1/staff-launch-tickets", { token, body }).request)).status).toBe(200);
    const row = await databasePool.query("SELECT role FROM users WHERE external_user_id = 'ums-user:44'");
    expect(row.rows[0].role).toBe("UMS Administrator");
  });

  it("keeps a role set by an administrator and refuses a deactivated account", async () => {
    const token = await getToken();
    const body = { ...staff, external_user_id: "ums-user:43", email: "kept@example.edu" };
    expect((await staffLaunchTicketsPost(apiRequest("POST", "/api/integrations/v1/staff-launch-tickets", { token, body }).request)).status).toBe(200);
    await databasePool.query("UPDATE users SET role = 'Evaluator' WHERE external_user_id = 'ums-user:43'");
    expect((await staffLaunchTicketsPost(apiRequest("POST", "/api/integrations/v1/staff-launch-tickets", { token, body }).request)).status).toBe(200);
    const row = await databasePool.query("SELECT role FROM users WHERE external_user_id = 'ums-user:43'");
    expect(row.rows[0].role).toBe("Evaluator");

    await databasePool.query("UPDATE users SET status = FALSE WHERE external_user_id = 'ums-user:43'");
    const inactive = await staffLaunchTicketsPost(apiRequest("POST", "/api/integrations/v1/staff-launch-tickets", { token, body }).request);
    expect(inactive.status).toBe(403);
    expect((await inactive.json()).error).toBe("user_inactive");
  });

  it("returns 409 when a different, non-UMS user already owns the email", async () => {
    await databasePool.query(`
      INSERT INTO users (name, email, password, role, mobile) VALUES ('Admin', 'owner@example.edu', 'x', 'Admin', '')
    `);
    const token = await getToken();
    const response = await staffLaunchTicketsPost(apiRequest("POST", "/api/integrations/v1/staff-launch-tickets", {
      token, body: { ...staff, external_user_id: "ums-user:77", email: "OWNER@example.edu" },
    }).request);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("email_conflict");
  });

  it("returns 400 for a missing external_user_id and 403 without the staff:launch scope", async () => {
    const token = await getToken();
    const invalid = await staffLaunchTicketsPost(apiRequest("POST", "/api/integrations/v1/staff-launch-tickets", {
      token, body: { ...staff, external_user_id: "" },
    }).request);
    expect(invalid.status).toBe(400);

    const limited = await getToken("students:launch");
    const forbidden = await staffLaunchTicketsPost(apiRequest("POST", "/api/integrations/v1/staff-launch-tickets", { token: limited, body: staff }).request);
    expect(forbidden.status).toBe(403);
  });
});

describe("GET /api/integrations/v1/results", () => {
  it("returns only published, evaluated results without personal or answer data", async () => {
    const token = await getToken();
    const assessment = await databasePool.query("SELECT id FROM assessment WHERE external_assessment_id = 'EXAM-1'");
    const candidate = await databasePool.query(`SELECT id, candidate_data FROM "Candidate Information" WHERE external_student_id = 'ENR-2026-0001'`);
    await databasePool.query(`
      INSERT INTO assessment_candidate_submissions (assessment_id, candidate_id, answers, questions_snapshot, evaluated_at)
      VALUES ($1, $2, $3::jsonb, $4::jsonb, '2026-11-11T10:00:00Z')
    `, [
      assessment.rows[0].id,
      candidate.rows[0].id,
      JSON.stringify({ 1: "a", 2: "c" }),
      JSON.stringify([
        { id: 1, section: "Part A", question_type: "MCQ", correct_answer: "a" },
        { id: 2, section: "Part A", question_type: "MCQ", correct_answer: "b" },
      ]),
    ]);

    const path = "/api/integrations/v1/results?external_assessment_id=EXAM-1";
    const unpublished = await resultsGet(apiRequest("GET", path, { token }).request);
    expect(unpublished.status).toBe(200);
    expect(await unpublished.json()).toEqual({ ok: true, results: [] });

    await databasePool.query("UPDATE assessment SET results_published = TRUE WHERE id = $1", [assessment.rows[0].id]);
    const published = await resultsGet(apiRequest("GET", path, { token }).request);
    const body = await published.json();
    expect(body.results).toEqual([{
      external_assessment_id: "EXAM-1",
      external_student_id: "ENR-2026-0001",
      candidate_id: expect.stringMatching(/^\d{6}$/),
      obtained_mark: 4,
      negative_mark: -1,
      total_mark: 10,
      pass_mark: 5,
      passed: false,
      evaluated_at: "2026-11-11T10:00:00.000Z",
    }]);

    const later = await resultsGet(apiRequest("GET", `${path}&since=2026-11-12T00:00:00Z`, { token }).request);
    expect((await later.json()).results).toEqual([]);
  });

  it("returns 404 for an unknown assessment and 400 without external_assessment_id", async () => {
    const token = await getToken("results:read");
    expect((await resultsGet(apiRequest("GET", "/api/integrations/v1/results?external_assessment_id=NOPE", { token }).request)).status).toBe(404);
    expect((await resultsGet(apiRequest("GET", "/api/integrations/v1/results", { token }).request)).status).toBe(400);
  });

  it("returns 403 for another tenant's tenant_id query and without the results:read scope", async () => {
    const token = await getToken("results:read");
    const mismatch = await resultsGet(apiRequest("GET", "/api/integrations/v1/results?external_assessment_id=EXAM-1&tenant_id=other", { token }).request);
    expect(mismatch.status).toBe(403);
    const noScope = await resultsGet(apiRequest("GET", "/api/integrations/v1/results?external_assessment_id=EXAM-1", {
      token: await getToken("students:write"),
    }).request);
    expect(noScope.status).toBe(403);
  });
});

describe("assessment matching", () => {
  it("matches a unique unclaimed assessment by name, and lets an administrator remap it", async () => {
    const token = await getToken();
    const inserted = await databasePool.query(`
      INSERT INTO assessment (examination, name) VALUES ('Semester 5', 'Portal Authored'), ('Semester 5', 'Other Paper') RETURNING id
    `);
    const [firstId, secondId] = inserted.rows.map((row) => Number(row.id));
    const created = await postStudent(token, studentPayload({
      external_student_id: "ENR-MAP", candidate_id: "ENR-MAP",
      assigned_assessments: [{ ums_assessment_id: "EXT-5", name: "Portal Authored", examination: "Semester 5" }],
    }));
    expect(await created.json()).toMatchObject({ assigned_assessments: 1, unmapped_assessments: [] });

    await databasePool.query(`
      INSERT INTO users (name, email, password, role, mobile) VALUES ('Map Admin', 'map-admin@example.edu', 'x', 'Admin', '')
    `);
    const adminRow = await databasePool.query("SELECT id FROM users WHERE email = 'map-admin@example.edu'");
    const cookie = `ums_exam_session=${await createSession("user", Number(adminRow.rows[0].id))}`;
    const remap = (headers: Record<string, string>) => assessmentMappingsPut(new Request(`${ORIGIN}/api/integrations/v1/assessment-mappings`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ tenant_id: TENANT, external_assessment_id: "EXT-5", assessment_id: secondId }),
    }));
    // This route is for administrators using their session, not bearer tokens.
    expect((await remap({ authorization: `Bearer ${token}` })).status).toBe(401);

    process.env.INTEGRATION_ISSUER_URL = PORTAL_URL;
    process.env.INTEGRATION_TENANTS = JSON.stringify([{ tenant_id: TENANT, builtin: true }]);
    try {
      const mapped = await remap({ cookie });
      expect(mapped.status).toBe(200);
      expect(await mapped.json()).toEqual({ ok: true, updated_students: 1 });
    } finally {
      delete process.env.INTEGRATION_ISSUER_URL;
      delete process.env.INTEGRATION_TENANTS;
    }
    const assignments = await databasePool.query(`
      SELECT assignment.assessment_id FROM assessment_candidate_direct_assignment AS assignment
      JOIN "Candidate Information" AS candidate ON candidate.id = assignment.candidate_id
      WHERE candidate.external_student_id = 'ENR-MAP'
    `);
    expect(assignments.rows.map((row) => Number(row.assessment_id))).toEqual([secondId]);
    expect(firstId).not.toBe(secondId);
  });
});

describe("clients from the earlier built-in issuer", () => {
  it("keep working after the table upgrade", async () => {
    const response = await tokenPost(tokenRequest({ grant_type: "client_credentials" }, basicAuth(LEGACY_CLIENT_ID, LEGACY_SECRET)));
    expect(response.status).toBe(200);
    const token = (await response.json()).access_token as string;
    const allowed = await resultsGet(apiRequest("GET", "/api/integrations/v1/results?external_assessment_id=EXAM-1", { token }).request);
    expect(allowed.status).toBe(200);
    const notGranted = await launchTicketsPost(apiRequest("POST", "/api/integrations/v1/launch-tickets", {
      token, body: { tenant_id: TENANT, external_student_id: "ENR-SSO" },
    }).request);
    expect(notGranted.status).toBe(403);
  });

  it("can authenticate with credentials in the form body", async () => {
    const response = await tokenPost(new Request(`${ORIGIN}/api/integrations/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: LEGACY_CLIENT_ID, client_secret: LEGACY_SECRET }).toString(),
    }));
    expect(response.status).toBe(200);
  });
});

describe("built-in JWT issuer", () => {
  beforeAll(() => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.INTEGRATION_SIGNING_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    process.env.INTEGRATION_ISSUER_URL = PORTAL_URL;
    process.env.INTEGRATION_TENANTS = JSON.stringify([{ tenant_id: TENANT, builtin: true }, { tenant_id: "other-tenant", builtin: true }]);
  });

  afterAll(() => {
    delete process.env.INTEGRATION_SIGNING_KEY;
    delete process.env.INTEGRATION_ISSUER_URL;
    delete process.env.INTEGRATION_TENANTS;
  });

  it("issues signed JWTs that the v1 routes accept for their own tenant only", async () => {
    const response = await tokenPost(tokenRequest({ grant_type: "client_credentials" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.expires_in).toBe(600);
    const token = body.access_token as string;
    expect(token.split(".")).toHaveLength(3);

    const student = await postStudent(token, studentPayload({ external_student_id: "ENR-JWT", candidate_id: "ENR-JWT" }));
    expect(student.status).toBe(201);
    const results = await resultsGet(apiRequest("GET", "/api/integrations/v1/results?external_assessment_id=EXAM-1", { token }).request);
    expect(results.status).toBe(200);

    const otherTenant = await postStudent(token, studentPayload({ tenant_id: "other-tenant", external_student_id: "ENR-JWT-2", candidate_id: "ENR-JWT-2" }));
    expect(otherTenant.status).toBe(403);
    const unknownTenant = await postStudent(token, studentPayload({ tenant_id: "never-configured", external_student_id: "ENR-JWT-3", candidate_id: "ENR-JWT-3" }));
    expect(unknownTenant.status).toBe(401);
  });

  it("refuses a narrower token on a route it lacks the scope for, and tampered tokens", async () => {
    const token = await getToken("results:read");
    expect((await postStudent(token, studentPayload())).status).toBe(403);
    const [header, payload] = token.split(".");
    expect((await postStudent(`${header}.${payload}.AAAA`, studentPayload())).status).toBe(401);
  });

  it("revokes clients whose tenant is no longer listed", async () => {
    process.env.INTEGRATION_TENANTS = JSON.stringify([{ tenant_id: "other-tenant", builtin: true }]);
    const response = await tokenPost(tokenRequest({ grant_type: "client_credentials" }));
    expect(response.status).toBe(401);
    process.env.INTEGRATION_TENANTS = JSON.stringify([{ tenant_id: TENANT, builtin: true }, { tenant_id: "other-tenant", builtin: true }]);
  });
});

describe("hygiene", () => {
  it("rate-limits repeated login attempts for one account", async () => {
    const attempt = () => candidateLoginPost(new Request(`${ORIGIN}/api/candidates/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidateId: "123456", dateOfBirth: "2000-01-01" }),
    }));
    for (let index = 0; index < 10; index += 1) expect((await attempt()).status).toBe(401);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
  });

  it("logs integration calls without tokens, secrets or student data", async () => {
    const token = await getToken();
    await postStudent(token, studentPayload({ external_student_id: "ENR-LOG", candidate_id: "ENR-LOG", name: "Logged Person" }));
    const integrationLogs = logLines.filter((line) => line.includes("integration_call"));
    expect(integrationLogs.some((line) => line.includes('"route":"/api/integrations/v1/students"') && line.includes(`"client_id":"${CLIENT_ID}"`))).toBe(true);
    const allLogs = logLines.join("\n");
    expect(allLogs).not.toContain(token);
    expect(allLogs).not.toContain(CLIENT_SECRET);
    expect(allLogs).not.toContain("Logged Person");
    expect(allLogs).not.toContain("ENR-LOG");
  });
});
