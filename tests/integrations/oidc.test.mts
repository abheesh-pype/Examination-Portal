import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, generateKeyPair, createLocalJWKSet, exportJWK } from "jose";
import {
  buildAuthorizationUrl, completeSignIn, createTransaction, linkValue, openTransaction, sealTransaction, type Discovery, type OidcSettings,
} from "../../lib/integrations/oidc.ts";

const secret = "s".repeat(40);
const discovery: Discovery = { issuer: "https://idp.example.edu", authorization_endpoint: "https://idp.example.edu/authorize", token_endpoint: "https://idp.example.edu/token", jwks_uri: "https://idp.example.edu/jwks" };
const oidc: OidcSettings = { issuer: discovery.issuer, clientId: "portal", redirectUri: "https://exam.example.edu/api/auth/oidc/callback", scopes: "openid email", linkClaim: "email" };

const { publicKey, privateKey } = await generateKeyPair("RS256");
const getKeys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k", alg: "RS256" }] });
const idToken = (claims: Record<string, unknown>, aud = "portal") =>
  new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k" }).setIssuer(discovery.issuer).setAudience(aud).setSubject("sub-1").setExpirationTime("5m").sign(privateKey);
const tokenEndpoint = (token: string, ok = true) => (async () => new Response(JSON.stringify({ id_token: token }), { status: ok ? 200 : 400 })) as unknown as typeof fetch;

test("transaction: sealed value round-trips; tampering and expiry are rejected", () => {
  const tx = createTransaction("t1");
  const sealed = sealTransaction(tx, secret);
  assert.equal(openTransaction(sealed, secret)?.state, tx.state);
  assert.equal(openTransaction(sealed, "x".repeat(40)), null);
  assert.equal(openTransaction(`${sealed.slice(0, -2)}${sealed.endsWith("AA") ? "BB" : "AA"}`, secret), null);
  assert.equal(openTransaction(sealed, secret, tx.exp + 1), null);
  assert.equal(openTransaction(undefined, secret), null);
});

test("authorization URL uses code flow with S256 PKCE, state and nonce", () => {
  const tx = createTransaction("t1");
  const url = new URL(buildAuthorizationUrl(discovery, oidc, tx));
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), tx.challenge);
  assert.equal(url.searchParams.get("state"), tx.state);
  assert.equal(url.searchParams.get("nonce"), tx.nonce);
  assert.ok(!url.toString().includes(tx.verifier));
});

test("sign-in: verified id_token claims returned; nonce, audience and token errors rejected", async () => {
  const tx = createTransaction("t1");
  const claims = await completeSignIn("code", tx, discovery, oidc, { fetch: tokenEndpoint(await idToken({ nonce: tx.nonce, email: "a@b.edu", email_verified: true })), getKeys });
  assert.equal(claims.sub, "sub-1");
  await assert.rejects(completeSignIn("code", tx, discovery, oidc, { fetch: tokenEndpoint(await idToken({ nonce: "other" })), getKeys }));
  await assert.rejects(completeSignIn("code", tx, discovery, oidc, { fetch: tokenEndpoint(await idToken({ nonce: tx.nonce }, "someone-else")), getKeys }));
  await assert.rejects(completeSignIn("code", tx, discovery, oidc, { fetch: tokenEndpoint("", false), getKeys }));
});

test("link value: email needs email_verified; other claims used as-is", () => {
  assert.equal(linkValue({ email: "a@b.edu", email_verified: true }, "email"), "a@b.edu");
  assert.equal(linkValue({ email: "a@b.edu" }, "email"), null);
  assert.equal(linkValue({ email: "a@b.edu", email_verified: "true" }, "email"), null);
  assert.equal(linkValue({ student_id: "123" }, "student_id"), "123");
  assert.equal(linkValue({}, "student_id"), null);
});
