import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, generateKeyPair, createLocalJWKSet, exportJWK } from "jose";
import { IntegrationError, loadTenants, verifyBearerToken } from "../../lib/integrations/tokens.ts";
import { peekTenantId, validateAssessmentPayload, validateStaffPayload, validateStudentPayload } from "../../lib/integrations/payload.ts";

const tenantJson = {
  tenant_id: "institution-001", issuer: "https://idp.example.edu/", jwks_url: "https://idp.example.edu/jwks.json", audience: "exam-portal-api",
};
const { tenants } = loadTenants({ INTEGRATION_TENANTS: JSON.stringify([tenantJson]) });
const tenant = tenants[0];

const { publicKey, privateKey } = await generateKeyPair("RS256");
const other = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
const keys = () => createLocalJWKSet({ keys: [jwk] });
const token = (claims: Record<string, unknown> = {}, opts: { iss?: string; aud?: string; exp?: string; key?: CryptoKey } = {}) =>
  new SignJWT({ scope: "students:write", ...claims }).setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? tenant.issuer).setAudience(opts.aud ?? tenant.audience).setExpirationTime(opts.exp ?? "5m").sign(opts.key ?? privateKey);
const status = async (p: Promise<unknown>) => { try { await p; return 200; } catch (e) { return (e as IntegrationError).status; } };
const verify = async (t: string | null, getKeys = keys) => verifyBearerToken(t === null ? undefined : `Bearer ${t}`, tenant, getKeys);

test("config: tenants are validated; secrets and non-HTTPS URLs rejected", () => {
  assert.equal(loadTenants({}).tenants.length, 0);
  assert.equal(loadTenants({ INTEGRATION_TENANTS: "nope" }).tenants.length, 0);
  assert.equal(loadTenants({ INTEGRATION_TENANTS: JSON.stringify([{ ...tenantJson, audience: "" }]) }).tenants.length, 0);
  const prod = { NODE_ENV: "production", INTEGRATION_TENANTS: JSON.stringify([{ ...tenantJson, jwks_url: "http://localhost/jwks" }]) };
  assert.equal(loadTenants(prod).tenants.length, 0);
  const dup = loadTenants({ INTEGRATION_TENANTS: JSON.stringify([tenantJson, tenantJson]) });
  assert.equal(dup.tenants.length, 1);
  assert.equal(tenant.scope, "students:write");
  assert.ok(!JSON.stringify(loadTenants({ INTEGRATION_TENANTS: JSON.stringify([{ ...tenantJson, oidc: { issuer: "x" } }]) }).problems).includes("secret"));
});

test("config: oidc block requires issuer, client id and HTTPS redirect", () => {
  const ok = loadTenants({ INTEGRATION_TENANTS: JSON.stringify([{ ...tenantJson, oidc: { issuer: "https://idp.example.edu", client_id: "c", redirect_uri: "https://exam.example.edu/api/auth/oidc/callback" } }]) });
  assert.equal(ok.tenants[0].oidc?.linkClaim, "email");
  assert.equal(loadTenants({ INTEGRATION_TENANTS: JSON.stringify([{ ...tenantJson, oidc: { issuer: "https://idp.example.edu", client_id: "c", redirect_uri: "http://exam.example.edu/cb" } }]) }).tenants.length, 0);
});

test("token: valid accepted; scp array also accepted", async () => {
  await verify(await token());
  await verify(await token({ scope: undefined, scp: ["students:write"] }));
});

test("token: missing, forged, wrong issuer/audience, expired, wrong alg => 401", async () => {
  assert.equal(await status(verify(null)), 401);
  assert.equal(await status(verify("garbage")), 401);
  assert.equal(await status(verify(await token({}, { key: other.privateKey }))), 401);
  assert.equal(await status(verify(await token({}, { iss: "https://evil.example/" }))), 401);
  assert.equal(await status(verify(await token({}, { aud: "other-api" }))), 401);
  assert.equal(await status(verify(await token({}, { exp: "-10m" }))), 401);
  const hs = await new SignJWT({ scope: "students:write" }).setProtectedHeader({ alg: "HS256" }).setIssuer(tenant.issuer).setAudience(tenant.audience).setExpirationTime("5m").sign(new TextEncoder().encode("0".repeat(32)));
  assert.equal(await status(verify(hs)), 401);
});

test("token: wrong scope => 403; unreachable key set => 503", async () => {
  assert.equal(await status(verify(await token({ scope: "students:read" }))), 403);
  const down = () => (async () => { throw new Error("connect ECONNREFUSED"); }) as never;
  assert.equal(await status(verify(await token(), down)), 503);
});

const body = (over: Record<string, unknown> = {}) => ({
  tenant_id: "institution-001", external_student_id: "123456", candidate_id: "123456", name: "Ex Student", email: "A@B.edu",
  category: "UG", sub_category: "Y1", status: "active",
  assigned_assessments: [{ ums_assessment_id: 42, name: "Midterm", examination: "Sem 1" }], ...over,
});

test("payload: valid body mapped; numeric id stringified; dob/password dropped", () => {
  const s = validateStudentPayload(body({ dob: "2000-01-01", password: "x" }));
  assert.deepEqual(s.assessments, [{ externalAssessmentId: "42", name: "Midterm", examination: "Sem 1" }]);
  assert.equal(s.email, "a@b.edu");
  assert.doesNotMatch(JSON.stringify(s), /2000|password|dob/);
  assert.equal(peekTenantId(body()), "institution-001");
});

test("payload: inactive students keep no assignments", () => {
  assert.deepEqual(validateStudentPayload(body({ status: "inactive" })).assessments, []);
});

test("payload: malformed bodies are rejected", () => {
  for (const bad of [null, [], body({ tenant_id: "" }), body({ external_student_id: undefined }), body({ name: "" }), body({ status: "gone" }),
    body({ email: "nope" }), body({ assigned_assessments: "x" }), body({ assigned_assessments: [{ name: "n" }] }),
    body({ assigned_assessments: [{ ums_assessment_id: 1, name: "a" }, { ums_assessment_id: 1, name: "b" }] })]) {
    assert.throws(() => validateStudentPayload(bad), { name: "Error" });
  }
});

test("staff payload: valid mapped and lower-cased; bad input rejected", () => {
  const staff = validateStaffPayload({ tenant_id: "t", external_user_id: "ums-user:1", name: " Ann ", email: "Ann@X.edu", role: "admin" });
  assert.deepEqual(staff, { tenantId: "t", externalUserId: "ums-user:1", name: "Ann", email: "ann@x.edu" });
  for (const bad of [null, {}, { tenant_id: "t", external_user_id: "u", name: "A", email: "nope" }, { tenant_id: "t", external_user_id: "", name: "A", email: "a@b.co" }]) {
    assert.throws(() => validateStaffPayload(bad), { name: "Error" });
  }
});

const assessment = (over: Record<string, unknown> = {}) => ({
  tenant_id: "t", external_assessment_id: "exam-1", name: "Midterm", examination: "Semester 1",
  start_date: "2026-11-01T04:00:00.000Z", end_date: "2026-11-01T06:30:00.000Z", total_time: 120, status: "active", ...over,
});

test("assessment payload: valid; inactive; numeric id", () => {
  const a = validateAssessmentPayload(assessment());
  assert.equal(a.externalAssessmentId, "exam-1");
  assert.equal(a.active, true);
  assert.equal(a.totalTime, 120);
  assert.equal(validateAssessmentPayload(assessment({ status: "inactive" })).active, false);
  assert.equal(validateAssessmentPayload(assessment({ external_assessment_id: 42 })).externalAssessmentId, "42");
});

test("assessment payload: malformed values rejected", () => {
  for (const bad of [null, assessment({ name: "" }), assessment({ examination: undefined }), assessment({ external_assessment_id: undefined }),
    assessment({ start_date: "nope" }), assessment({ end_date: "2026-10-01T00:00:00Z" }), assessment({ total_time: 0 }), assessment({ total_time: 2000 }),
    assessment({ total_time: 1.5 }), assessment({ status: "deleted" })]) {
    assert.throws(() => validateAssessmentPayload(bad), { name: "Error" });
  }
});
