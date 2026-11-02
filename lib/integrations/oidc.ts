// OIDC Authorization Code + PKCE helpers for student sign-in through a tenant's institutional IdP.
// No project imports (unit tested directly); route handlers own the HTTP and session wiring.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string };
export type OidcSettings = { issuer: string; clientId: string; clientSecret?: string; redirectUri: string; scopes: string; linkClaim: string };

export const TX_COOKIE = "ums_exam_oidc";
export const TX_MAX_AGE_SECONDS = 600;

const b64 = (buf: Buffer) => buf.toString("base64url");

export function createTransaction(tenantId: string) {
  const verifier = b64(randomBytes(48));
  return {
    tenantId, verifier, state: b64(randomBytes(24)), nonce: b64(randomBytes(24)),
    challenge: b64(createHash("sha256").update(verifier).digest()), exp: Date.now() + TX_MAX_AGE_SECONDS * 1000,
  };
}
export type Transaction = ReturnType<typeof createTransaction>;

const sign = (payload: string, secret: string) => b64(createHmac("sha256", secret).update(payload).digest());

/** Cookie value: base64url(json).signature. Holds the PKCE verifier, so the cookie must stay HttpOnly. */
export function sealTransaction(tx: Transaction, secret: string) {
  const payload = b64(Buffer.from(JSON.stringify(tx)));
  return `${payload}.${sign(payload, secret)}`;
}

export function openTransaction(value: string | undefined, secret: string, now = Date.now()): Transaction | null {
  const [payload, signature] = (value ?? "").split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const tx = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Transaction;
    return typeof tx.exp === "number" && tx.exp > now && tx.verifier && tx.state && tx.nonce && tx.tenantId ? tx : null;
  } catch {
    return null;
  }
}

export function buildAuthorizationUrl(discovery: Discovery, oidc: OidcSettings, tx: Transaction) {
  const url = new URL(discovery.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code", client_id: oidc.clientId, redirect_uri: oidc.redirectUri, scope: oidc.scopes,
    state: tx.state, nonce: tx.nonce, code_challenge: tx.challenge, code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

const discoveryCache = new Map<string, { at: number; value: Discovery }>();

export async function discover(issuer: string, fetchImpl: typeof fetch = fetch): Promise<Discovery> {
  const cached = discoveryCache.get(issuer);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.value;
  const response = await fetchImpl(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`, {
    headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000), redirect: "error",
  });
  if (!response.ok) throw new Error("OIDC discovery failed");
  const value = await response.json() as Discovery;
  if (value.issuer?.replace(/\/$/, "") !== issuer.replace(/\/$/, "") || !value.authorization_endpoint || !value.token_endpoint || !value.jwks_uri) {
    throw new Error("OIDC discovery document does not match the configured issuer");
  }
  discoveryCache.set(issuer, { at: Date.now(), value });
  return value;
}

const keySets = new Map<string, JWTVerifyGetKey>();
const remoteKeys = (uri: string) => {
  let set = keySets.get(uri);
  if (!set) { set = createRemoteJWKSet(new URL(uri), { timeoutDuration: 5000 }); keySets.set(uri, set); }
  return set;
};

/** Exchanges the code and returns the verified id_token claims. Throws on any failure. */
export async function completeSignIn(
  code: string, tx: Transaction, discovery: Discovery, oidc: OidcSettings,
  deps: { fetch?: typeof fetch; getKeys?: JWTVerifyGetKey } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: oidc.redirectUri, code_verifier: tx.verifier, client_id: oidc.clientId });
  if (oidc.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(oidc.clientId)}:${encodeURIComponent(oidc.clientSecret)}`).toString("base64")}`;
    form.delete("client_id");
  }
  const response = await (deps.fetch ?? fetch)(discovery.token_endpoint, {
    method: "POST", headers, body: form, signal: AbortSignal.timeout(10_000), redirect: "error",
  });
  if (!response.ok) throw new Error("Token exchange rejected");
  const body = await response.json() as { id_token?: string };
  if (typeof body.id_token !== "string") throw new Error("No id_token returned");
  const { payload } = await jwtVerify(body.id_token, deps.getKeys ?? remoteKeys(discovery.jwks_uri), {
    issuer: discovery.issuer, audience: oidc.clientId, clockTolerance: 30, requiredClaims: ["exp", "sub"],
    algorithms: ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"],
  });
  if (payload.nonce !== tx.nonce) throw new Error("Nonce mismatch");
  return payload;
}

/** The value used to link a first sign-in to a provisioned student; email must be verified by the IdP. */
export function linkValue(claims: Record<string, unknown>, linkClaim: string) {
  const value = claims[linkClaim];
  if (typeof value !== "string" || !value.trim()) return null;
  if (linkClaim === "email" && claims.email_verified !== true) return null;
  return value.trim();
}
