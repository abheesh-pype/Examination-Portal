// Tenant registry and bearer-token verification for server-to-server integrations.
// The Exam Portal is tenant-agnostic: every institution (UMS or any other system) is one entry in
// INTEGRATION_TENANTS, with its own issuer, audience and scope. This file has no project imports so
// it can be unit tested directly.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: string;
  /** Verified id_token claim used to link a first sign-in to a provisioned student. */
  linkClaim: string;
};

export type TenantConfig = {
  tenantId: string;
  issuer: string;
  jwksUrl: string;
  audience: string;
  scope: string;
  /** Issued by this portal's own token endpoint (lib/integrations/issuer.ts) instead of an external IdP. */
  builtin?: boolean;
  oidc?: OidcConfig;
};

export class IntegrationError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Env = Record<string, string | undefined>;

function safeUrl(value: unknown, production: boolean) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    return url.protocol === "https:" || (!production && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  } catch {
    return false;
  }
}

/** Returns valid tenants plus human-readable problems (never secret values). */
export function loadTenants(env: Env = process.env): { tenants: TenantConfig[]; problems: string[] } {
  const raw = env.INTEGRATION_TENANTS?.trim();
  if (!raw) return { tenants: [], problems: ["INTEGRATION_TENANTS is not set"] };
  const production = env.NODE_ENV === "production";
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { tenants: [], problems: ["INTEGRATION_TENANTS is not valid JSON"] }; }
  if (!Array.isArray(parsed)) return { tenants: [], problems: ["INTEGRATION_TENANTS must be a JSON array"] };

  const tenants: TenantConfig[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsed.forEach((entry: Record<string, any>, index) => {
    const label = `INTEGRATION_TENANTS[${index}]`;
    const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const tenantId = text(entry?.tenant_id);
    if (!tenantId || seen.has(tenantId)) { problems.push(`${label}: tenant_id missing or duplicated`); return; }
    if (entry?.builtin === true) {
      const issuer = text(env.INTEGRATION_ISSUER_URL).replace(/\/$/, "");
      if (!safeUrl(issuer, production)) { problems.push(`${label} (${tenantId}): builtin needs INTEGRATION_ISSUER_URL (HTTPS)`); return; }
      seen.add(tenantId);
      tenants.push({
        tenantId, issuer, jwksUrl: `${issuer}/.well-known/jwks.json`, builtin: true,
        audience: text(entry.audience) || text(env.INTEGRATION_AUDIENCE) || "exam-portal-api", scope: text(entry.scope) || "students:write",
      });
      return;
    }
    if (!safeUrl(entry?.issuer, production) || !safeUrl(entry?.jwks_url, production) || !text(entry?.audience)) {
      problems.push(`${label} (${tenantId}): issuer, jwks_url (HTTPS) and audience are required`);
      return;
    }
    const tenant: TenantConfig = {
      tenantId, issuer: text(entry.issuer), jwksUrl: text(entry.jwks_url), audience: text(entry.audience),
      scope: text(entry.scope) || "students:write",
    };
    const oidc = entry.oidc;
    if (oidc !== undefined) {
      if (!safeUrl(oidc?.issuer, production) || !text(oidc?.client_id) || !safeUrl(oidc?.redirect_uri, production)) {
        problems.push(`${label} (${tenantId}): oidc needs issuer, client_id and redirect_uri (HTTPS)`);
        return;
      }
      tenant.oidc = {
        issuer: text(oidc.issuer), clientId: text(oidc.client_id), redirectUri: text(oidc.redirect_uri),
        clientSecret: text(oidc.client_secret) || undefined, scopes: text(oidc.scopes) || "openid email profile",
        linkClaim: text(oidc.link_claim) || "email",
      };
    }
    seen.add(tenantId);
    tenants.push(tenant);
  });
  return { tenants, problems };
}

const keySets = new Map<string, JWTVerifyGetKey>();
const defaultKeySet = (tenant: TenantConfig) => {
  let set = keySets.get(tenant.jwksUrl);
  if (!set) {
    set = createRemoteJWKSet(new URL(tenant.jwksUrl), { timeoutDuration: 5000, cooldownDuration: 30_000 });
    keySets.set(tenant.jwksUrl, set);
  }
  return set;
};

/**
 * Verifies signature (RS/ES only), issuer, audience, expiry and required scope against the tenant's
 * own configuration. 401 = bad token, 403 = missing scope, 503 = key set unavailable.
 */
export async function verifyBearerToken(
  authorization: string | null | undefined,
  tenant: TenantConfig,
  getKeys: (tenant: TenantConfig) => JWTVerifyGetKey = defaultKeySet,
  requiredScope: string = tenant.scope,
) {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization || "");
  if (!match) throw new IntegrationError(401, "unauthorized", "Missing bearer token");
  let payload;
  try {
    ({ payload } = await jwtVerify(match[1], getKeys(tenant), {
      issuer: tenant.issuer, audience: tenant.audience, clockTolerance: 30, requiredClaims: ["exp"],
      algorithms: ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"],
    }));
  } catch (error) {
    // Token problems are 401; anything else (JWKS timeout, network, bad key-set response) is an outage.
    const code = String((error as { code?: unknown })?.code ?? "");
    const tokenProblem = /^ERR_(JWT_|JWS_|JWKS_NO_MATCHING_KEY|JWKS_MULTIPLE_MATCHING_KEYS|JOSE_ALG_NOT_ALLOWED|JOSE_NOT_SUPPORTED)/.test(code);
    if (!tokenProblem) throw new IntegrationError(503, "unavailable", "Token verification is temporarily unavailable");
    throw new IntegrationError(401, "unauthorized", "Invalid or expired token");
  }
  const scopes = new Set<string>([
    ...(typeof payload.scope === "string" ? payload.scope.split(" ") : []),
    ...(Array.isArray(payload.scp) ? payload.scp.map(String) : typeof payload.scp === "string" ? payload.scp.split(" ") : []),
  ]);
  if (!scopes.has(requiredScope)) throw new IntegrationError(403, "forbidden", "Token lacks the required scope");
  // All built-in clients share one issuer and audience, so the tenant claim is what isolates institutions.
  if (tenant.builtin && payload.tenant_id !== tenant.tenantId) throw new IntegrationError(403, "forbidden", "Token was issued for another tenant");
  return payload;
}
