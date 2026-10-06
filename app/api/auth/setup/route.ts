import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { hashPassword } from "@/lib/password";

export const runtime = "nodejs";

function validSetupToken(request: Request, expectedToken: string) {
  const providedToken = request.headers.get("x-initial-admin-setup-token") ?? "";
  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(expectedToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function POST(request: Request) {
  try {
    const setupToken = process.env.INITIAL_ADMIN_SETUP_TOKEN ?? "";
    const email = process.env.INITIAL_ADMIN_EMAIL?.trim() ?? "";
    const password = process.env.INITIAL_ADMIN_PASSWORD ?? "";
    if (setupToken.length < 32 || !email || password.length < 12) {
      return NextResponse.json({ error: "Initial administrator setup is not configured." }, { status: 503 });
    }
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin)
      || request.headers.get("sec-fetch-site") === "cross-site") {
      return NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
    }
    if (!validSetupToken(request, setupToken)) {
      return NextResponse.json({ error: "A valid setup token is required." }, { status: 401 });
    }

    await databasePool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role TEXT NOT NULL,
        mobile TEXT NOT NULL,
        status BOOLEAN NOT NULL DEFAULT TRUE,
        verified BOOLEAN NOT NULL DEFAULT FALSE,
        created_on TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await databasePool.query(`
      CREATE TABLE IF NOT EXISTS ums_auth_setup (
        id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
        completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const client = await databasePool.connect();
    try {
      await client.query("BEGIN");
      await client.query("LOCK TABLE users IN EXCLUSIVE MODE");
      await client.query("LOCK TABLE ums_auth_setup IN EXCLUSIVE MODE");
      const completedSetup = await client.query("SELECT 1 FROM ums_auth_setup LIMIT 1");
      if (completedSetup.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Initial administrator setup has already been completed." }, { status: 409 });
      }
      const existingUsers = await client.query("SELECT 1 FROM users LIMIT 1");
      if (existingUsers.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Initial administrator setup has already been completed." }, { status: 409 });
      }
      await client.query(`
        INSERT INTO users (name, email, password, role, mobile, status, verified)
        VALUES ('Administrator', $1, $2, 'Administrator', '', TRUE, TRUE)
      `, [email, await hashPassword(password)]);
      await client.query("INSERT INTO ums_auth_setup (id) VALUES (TRUE)");
      await client.query("COMMIT");
      return NextResponse.json({ created: true }, { status: 201 });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Failed to configure initial administrator", error);
    return NextResponse.json({ error: "Unable to configure initial administrator." }, { status: 500 });
  }
}
