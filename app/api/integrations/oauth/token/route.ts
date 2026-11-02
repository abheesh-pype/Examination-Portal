import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth";
import {
  ACCESS_TOKEN_LIFETIME_SECONDS,
  INTEGRATION_AUDIENCE,
  issueAccessToken,
  logIntegrationCall,
  verifyClientCredentials,
} from "@/lib/integrations";

export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "no-store", Pragma: "no-cache" };

function oauthError(status: number, error: string, description: string, headers: Record<string, string> = {}) {
  return NextResponse.json(
    { error, error_description: description },
    { status, headers: { ...noStoreHeaders, ...headers } },
  );
}

function invalidClient() {
  return oauthError(401, "invalid_client", "Client authentication failed.", {
    "WWW-Authenticate": `Basic realm="${INTEGRATION_AUDIENCE}", charset="UTF-8"`,
  });
}

// RFC 6749 §2.3.1: client_id and client_secret are form-urlencoded before Base64 encoding.
function decodeFormComponent(value: string) {
  return decodeURIComponent(value.replace(/\+/g, " "));
}

function readBasicCredentials(request: Request) {
  const match = /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(request.headers.get("authorization")?.trim() ?? "");
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator <= 0) return null;
  try {
    const clientId = decodeFormComponent(decoded.slice(0, separator));
    const clientSecret = decodeFormComponent(decoded.slice(separator + 1));
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  } catch {
    return null;
  }
}

async function issueToken(request: Request): Promise<{ response: NextResponse; clientId: string | null }> {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    return { response: oauthError(400, "invalid_request", "Content-Type must be application/x-www-form-urlencoded."), clientId: null };
  }

  const credentials = readBasicCredentials(request);
  if (!credentials) return { response: invalidClient(), clientId: null };
  const client = await verifyClientCredentials(credentials.clientId, credentials.clientSecret);
  if (!client) return { response: invalidClient(), clientId: null };

  const form = new URLSearchParams(await request.text());
  for (const parameter of ["grant_type", "scope", "audience"]) {
    if (form.getAll(parameter).length > 1) {
      return { response: oauthError(400, "invalid_request", `The ${parameter} parameter must not repeat.`), clientId: client.clientId };
    }
  }
  const grantType = form.get("grant_type")?.trim();
  if (!grantType) {
    return { response: oauthError(400, "invalid_request", "grant_type is required."), clientId: client.clientId };
  }
  if (grantType !== "client_credentials") {
    return { response: oauthError(400, "unsupported_grant_type", "Only client_credentials is supported."), clientId: client.clientId };
  }

  const audience = form.get("audience")?.trim();
  if (audience && audience !== INTEGRATION_AUDIENCE) {
    return { response: oauthError(400, "invalid_request", "The requested audience is not served by this portal."), clientId: client.clientId };
  }

  const requestedScopes = [...new Set((form.get("scope") ?? "").split(/\s+/).filter(Boolean))];
  const grantedScopes = requestedScopes.length
    ? requestedScopes.filter((scope) => client.scopes.includes(scope))
    : client.scopes;
  if (!grantedScopes.length) {
    return { response: oauthError(400, "invalid_scope", "None of the requested scopes are allowed for this client."), clientId: client.clientId };
  }

  const accessToken = await issueAccessToken(client, grantedScopes);
  const narrowed = requestedScopes.length > 0 && grantedScopes.length !== requestedScopes.length;
  return {
    response: NextResponse.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_LIFETIME_SECONDS,
      // RFC 6749 §5.1: the granted scope is returned only when it differs from the request.
      ...(narrowed ? { scope: grantedScopes.join(" ") } : {}),
    }, { headers: noStoreHeaders }),
    clientId: client.clientId,
  };
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let clientId: string | null = null;
  let response: NextResponse;
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) {
      response = authorization.response;
    } else {
      ({ response, clientId } = await issueToken(request));
    }
  } catch (error) {
    console.error("Failed to issue integration access token", { name: error instanceof Error ? error.name : "Error" });
    response = oauthError(500, "server_error", "Unable to issue an access token.");
  }
  logIntegrationCall({
    clientId,
    route: "/api/integrations/oauth/token",
    method: "POST",
    status: response.status,
    durationMs: Date.now() - startedAt,
  });
  return response;
}
