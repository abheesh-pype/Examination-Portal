import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { databasePool } from "@/lib/db";
import { handleIntegrationRequest, readJsonObject } from "@/lib/integration-handler";
import {
  createLaunchTicket,
  ensureIntegrationSchema,
  getPortalOrigin,
  integrationError,
  UMS_STAFF_ROLE,
  type IntegrationClient,
} from "@/lib/integrations";
import { hashPassword } from "@/lib/password";

export const runtime = "nodejs";

type StaffPayload = { externalUserId: string; name: string; email: string };

class StaffLinkError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

function parseStaffPayload(body: Record<string, unknown>): StaffPayload | string {
  const externalUserId = typeof body.external_user_id === "string" ? body.external_user_id.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!/^ums-user:[A-Za-z0-9._-]{1,128}$/.test(externalUserId)) return 'external_user_id must look like "ums-user:<id>".';
  if (!name || name.length > 200) return "name must be a non-empty string of at most 200 characters.";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "email must be a valid email address.";
  return { externalUserId, name, email };
}

/** Finds or creates the restricted portal account linked to a UMS staff member. */
async function linkStaffUser(db: PoolClient, client: IntegrationClient, payload: StaffPayload) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`ums-staff\n${client.tenantId}\n${payload.externalUserId}`]);
  const linked = await db.query(`
    SELECT id, status
    FROM users
    WHERE tenant_id = $1 AND external_user_id = $2
    FOR UPDATE
  `, [client.tenantId, payload.externalUserId]);
  const emailOwner = await db.query(`
    SELECT id
    FROM users
    WHERE LOWER(email) = LOWER($1)
    LIMIT 1
  `, [payload.email]);
  const linkedUser = linked.rows[0] as { id: number; status: boolean } | undefined;
  const emailOwnerId = emailOwner.rows[0] ? Number(emailOwner.rows[0].id) : null;

  if (emailOwnerId !== null && emailOwnerId !== (linkedUser ? Number(linkedUser.id) : null)) {
    throw new StaffLinkError(409, "email_conflict", "A different portal account already uses this email address.");
  }
  if (linkedUser) {
    if (!linkedUser.status) {
      throw new StaffLinkError(403, "user_inactive", "The linked portal account has been deactivated.");
    }
    // The role is left as is so a portal administrator can grant the user more access.
    await db.query("UPDATE users SET name = $2, email = $3 WHERE id = $1", [linkedUser.id, payload.name, payload.email]);
    return Number(linkedUser.id);
  }

  // The random password is never revealed, so this account can only sign in through UMS.
  const unusablePassword = await hashPassword(randomBytes(32).toString("base64url"));
  const inserted = await db.query(`
    INSERT INTO users (name, email, password, role, mobile, status, verified, tenant_id, external_user_id)
    VALUES ($1, $2, $3, $4, '', TRUE, TRUE, $5, $6)
    RETURNING id
  `, [payload.name, payload.email, unusablePassword, UMS_STAFF_ROLE, client.tenantId, payload.externalUserId]);
  return Number(inserted.rows[0].id);
}

export async function POST(request: Request) {
  return handleIntegrationRequest(request, async (client) => {
    const { body } = await readJsonObject(request);
    if (!body) return integrationError(400, "invalid_request", "The request body must be a JSON object.");
    const payload = parseStaffPayload(body);
    if (typeof payload === "string") return integrationError(422, "invalid_request", payload);
    const origin = getPortalOrigin(request);
    if (!origin) {
      return integrationError(503, "portal_url_not_configured", "PORTAL_PUBLIC_URL must be set to the portal's HTTPS origin.");
    }

    await ensureIntegrationSchema();
    const db = await databasePool.connect();
    let transactionStarted = false;
    try {
      await db.query("BEGIN");
      transactionStarted = true;
      const userId = await linkStaffUser(db, client, payload);
      const { ticket } = await createLaunchTicket(db, client, "user", userId);
      await db.query("COMMIT");
      transactionStarted = false;
      return NextResponse.json({
        ok: true,
        launch_url: `${origin}/launch?ticket=${ticket}`,
      }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (transactionStarted) await db.query("ROLLBACK").catch(() => undefined);
      if (error instanceof StaffLinkError) return integrationError(error.status, error.code, error.message);
      throw error;
    } finally {
      db.release();
    }
  });
}
