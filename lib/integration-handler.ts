import { authorizeApiRequest } from "@/lib/auth";
import { integrationError, logIntegrationCall, type IntegrationClient } from "@/lib/integrations";

/** Authorizes a /api/integrations/v1/* request, runs the handler, and logs the outcome. */
export async function handleIntegrationRequest(
  request: Request,
  handler: (client: IntegrationClient) => Promise<Response>,
) {
  const startedAt = Date.now();
  let clientId: string | null = null;
  let response: Response;
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) {
      response = authorization.response;
    } else if (!authorization.client) {
      response = integrationError(401, "invalid_token", "A bearer access token is required.");
    } else {
      clientId = authorization.client.clientId;
      response = await handler(authorization.client);
    }
  } catch (error) {
    // Log only the error class and code: driver messages can echo student data.
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
    console.error("Integration request failed", { name: error instanceof Error ? error.name : "Error", code });
    response = integrationError(500, "server_error", "The request could not be completed.");
  }
  logIntegrationCall({
    clientId,
    route: new URL(request.url).pathname,
    method: request.method.toUpperCase(),
    status: response.status,
    durationMs: Date.now() - startedAt,
  });
  return response;
}

export async function readJsonObject(request: Request) {
  const text = await request.text();
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? { text, body: value as Record<string, unknown> }
      : { text, body: null };
  } catch {
    return { text, body: null };
  }
}
