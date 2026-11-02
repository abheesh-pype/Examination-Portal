// Built-in OAuth 2.0 token issuer (client-credentials grant) for machine clients such as UMS.
// Access tokens are RS256 JWTs signed with INTEGRATION_SIGNING_KEY; the public key is published at
// /.well-known/jwks.json. No project imports (unit tested directly).
import { createPrivateKey, createPublicKey, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { SignJWT, calculateJwkThumbprint, exportJWK, importPKCS8, createLocalJWKSet, type JWK, type JWTVerifyGetKey } from "jose";

export const TOKEN_TTL_SECONDS = 600;
const DEFAULT_AUDIENCE = "exam-portal-api";

export type IssuerConfig = { issuer: string; audience: string; privateKeyPem: string };

type Env = Record<string, string | undefined>;

export function loadIssuerConfig(env: Env = process.env): IssuerConfig | null {
  const issuer = env.INTEGRATION_ISSUER_URL?.trim().replace(/\/$/, "");
  const pem = env.INTEGRATION_SIGNING_KEY?.replace(/\\n/g, "\n").trim();
  if (!issuer || !pem || !pem.includes("PRIVATE KEY")) return null;
  try {
    const url = new URL(issuer);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.hash || url.username || (url.protocol !== "https:" && !(local && env.NODE_ENV !== "production"))) return null;
    createPrivateKey(pem);
  } catch {
    return null;
  }
  return { issuer, audience: env.INTEGRATION_AUDIENCE?.trim() || DEFAULT_AUDIENCE, privateKeyPem: pem };
}

export async function publicJwk(config: IssuerConfig): Promise<JWK> {
  const jwk = await exportJWK(createPublicKey(createPrivateKey(config.privateKeyPem)));
  return { ...jwk, kid: await calculateJwkThumbprint(jwk), alg: "RS256", use: "sig" };
}

export async function publicKeySet(config: IssuerConfig): Promise<JWTVerifyGetKey> {
  return createLocalJWKSet({ keys: [await publicJwk(config)] });
}

export async function signAccessToken(config: IssuerConfig, claims: { clientId: string; tenantId: string; scope: string }, now = Date.now()) {
  const key = await importPKCS8(config.privateKeyPem, "RS256");
  const kid = (await publicJwk(config)).kid;
  const issuedAt = Math.floor(now / 1000);
  return new SignJWT({ scope: claims.scope, tenant_id: claims.tenantId })
    .setProtectedHeader({ alg: "RS256", kid, typ: "at+jwt" })
    .setIssuer(config.issuer).setAudience(config.audience).setSubject(claims.clientId)
    .setIssuedAt(issuedAt).setExpirationTime(issuedAt + TOKEN_TTL_SECONDS).setJti(randomBytes(12).toString("base64url"))
    .sign(key);
}

// ---- client secrets: scrypt, random salt, constant-time compare ----

export function hashSecret(secret: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64url")}$${scryptSync(secret, salt, 32).toString("base64url")}`;
}

const DUMMY_HASH = hashSecret("unused");

/** Always performs one scrypt, so unknown clients and wrong secrets take the same time. */
export function verifySecret(secret: string, stored: string | null | undefined) {
  const [scheme, salt, hash] = (stored ?? DUMMY_HASH).split("$");
  const expected = Buffer.from(hash ?? "", "base64url");
  const actual = scryptSync(secret, Buffer.from(salt ?? "", "base64url"), 32);
  return Boolean(stored) && scheme === "scrypt" && expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const generateClientSecret = () => randomBytes(32).toString("base64url");

/** RFC 6749 client authentication: HTTP Basic (form-urlencoded values) or client_id/client_secret in the body. */
export function parseClientAuth(authorization: string | null, form: URLSearchParams) {
  const basic = /^Basic\s+(\S+)$/i.exec(authorization ?? "");
  if (basic) {
    const decoded = Buffer.from(basic[1], "base64").toString("utf8");
    const index = decoded.indexOf(":");
    if (index < 0) return null;
    try { return { clientId: decodeURIComponent(decoded.slice(0, index)), secret: decodeURIComponent(decoded.slice(index + 1)) }; } catch { return null; }
  }
  const clientId = form.get("client_id"), secret = form.get("client_secret");
  return clientId && secret ? { clientId, secret } : null;
}

/** Failed-attempt limiter (per process): blocks guessing without needing shared storage. */
export function createLimiter(max = 10, windowMs = 5 * 60_000) {
  const hits = new Map<string, { count: number; reset: number }>();
  return {
    blocked(key: string, now = Date.now()) { const h = hits.get(key); return Boolean(h && h.reset > now && h.count >= max); },
    fail(key: string, now = Date.now()) {
      const h = hits.get(key);
      if (!h || h.reset <= now) hits.set(key, { count: 1, reset: now + windowMs }); else h.count += 1;
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    },
    clear(key: string) { hits.delete(key); },
  };
}
