import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { jwtVerify, decodeJwt } from "jose";
import {
  createLimiter, generateClientSecret, hashSecret, loadIssuerConfig, parseClientAuth, publicKeySet, signAccessToken, TOKEN_TTL_SECONDS, verifySecret,
} from "../../lib/integrations/issuer.ts";
import { IntegrationError, loadTenants, verifyBearerToken } from "../../lib/integrations/tokens.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const env = { INTEGRATION_ISSUER_URL: "https://exam.example.edu/", INTEGRATION_SIGNING_KEY: pem.replace(/\n/g, "\\n") };
const config = loadIssuerConfig(env)!;
const { tenants } = loadTenants({ ...env, INTEGRATION_TENANTS: JSON.stringify([{ tenant_id: "inst-a", builtin: true }, { tenant_id: "inst-b", builtin: true }]) });
const status = async (p: Promise<unknown>) => { try { await p; return 200; } catch (e) { return (e as IntegrationError).status; } };

test("config: needs an HTTPS issuer and a private key", () => {
  assert.ok(config);
  assert.equal(config.audience, "exam-portal-api");
  assert.equal(loadIssuerConfig({}), null);
  assert.equal(loadIssuerConfig({ ...env, INTEGRATION_SIGNING_KEY: "nope" }), null);
  assert.equal(loadIssuerConfig({ ...env, INTEGRATION_ISSUER_URL: "http://exam.example.edu" }), null);
  assert.equal(loadIssuerConfig({ ...env, NODE_ENV: "production", INTEGRATION_ISSUER_URL: "http://localhost:3000" }), null);
  assert.ok(loadIssuerConfig({ ...env, INTEGRATION_ISSUER_URL: "http://localhost:3000" }));
});

test("builtin tenants take issuer/audience from the issuer settings", () => {
  assert.equal(tenants.length, 2);
  assert.equal(tenants[0].issuer, "https://exam.example.edu");
  assert.equal(tenants[0].audience, "exam-portal-api");
  assert.equal(loadTenants({ INTEGRATION_TENANTS: JSON.stringify([{ tenant_id: "x", builtin: true }]) }).tenants.length, 0);
});

test("issued token: short-lived, signed, verifiable with the published key", async () => {
  const token = await signAccessToken(config, { clientId: "c1", tenantId: "inst-a", scope: "students:write" });
  const claims = decodeJwt(token);
  assert.equal(claims.exp! - claims.iat!, TOKEN_TTL_SECONDS);
  assert.equal(claims.sub, "c1");
  await jwtVerify(token, await publicKeySet(config), { issuer: config.issuer, audience: config.audience });
  await verifyBearerToken(`Bearer ${token}`, tenants[0], () => keys);
});
const keys = await publicKeySet(config);

test("tenant isolation: a token for one tenant is refused by another", async () => {
  const token = await signAccessToken(config, { clientId: "c1", tenantId: "inst-a", scope: "students:write" });
  assert.equal(await status(verifyBearerToken(`Bearer ${token}`, tenants[1], () => keys)), 403);
});

test("scope and signature are enforced", async () => {
  const wrongScope = await signAccessToken(config, { clientId: "c1", tenantId: "inst-a", scope: "other" });
  assert.equal(await status(verifyBearerToken(`Bearer ${wrongScope}`, tenants[0], () => keys)), 403);
  const otherPem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const forged = await signAccessToken({ ...config, privateKeyPem: otherPem }, { clientId: "c1", tenantId: "inst-a", scope: "students:write" });
  assert.equal(await status(verifyBearerToken(`Bearer ${forged}`, tenants[0], () => keys)), 401);
  const expired = await signAccessToken(config, { clientId: "c1", tenantId: "inst-a", scope: "students:write" }, Date.now() - 2 * TOKEN_TTL_SECONDS * 1000);
  assert.equal(await status(verifyBearerToken(`Bearer ${expired}`, tenants[0], () => keys)), 401);
});

test("secrets: hashed, salted, verified; unknown client never matches", () => {
  const secret = generateClientSecret();
  const stored = hashSecret(secret);
  assert.ok(!stored.includes(secret));
  assert.notEqual(stored, hashSecret(secret));
  assert.equal(verifySecret(secret, stored), true);
  assert.equal(verifySecret("wrong", stored), false);
  assert.equal(verifySecret(secret, undefined), false);
});

test("client auth: Basic (url-decoded) or body; incomplete rejected", () => {
  const basic = `Basic ${Buffer.from("my%20id:p%40ss").toString("base64")}`;
  assert.deepEqual(parseClientAuth(basic, new URLSearchParams()), { clientId: "my id", secret: "p@ss" });
  assert.deepEqual(parseClientAuth(null, new URLSearchParams("client_id=a&client_secret=b")), { clientId: "a", secret: "b" });
  assert.equal(parseClientAuth(null, new URLSearchParams("client_id=a")), null);
  assert.equal(parseClientAuth("Basic bm9jb2xvbg==", new URLSearchParams()), null);
});

test("limiter blocks after repeated failures and recovers after the window", () => {
  const limiter = createLimiter(3, 1000);
  for (let i = 0; i < 3; i++) limiter.fail("k", 0);
  assert.equal(limiter.blocked("k", 500), true);
  assert.equal(limiter.blocked("k", 1500), false);
  limiter.fail("j", 0); limiter.clear("j");
  assert.equal(limiter.blocked("j", 0), false);
});
