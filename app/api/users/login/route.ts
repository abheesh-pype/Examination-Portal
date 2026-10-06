import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { authorizeApiRequest, createSession, setSessionCookie } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";

export const runtime = "nodejs";

async function ensureUsersTable() {
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

  await databasePool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE`);
  await databasePool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT`);
}

export async function POST(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json();
    const email = String(body?.email || "").trim();
    const password = String(body?.password || "");

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    await ensureUsersTable();

    const userCheck = await databasePool.query(
      `SELECT id, name, email, password, role, mobile, status, verified, created_on
       FROM users
       WHERE LOWER(email) = LOWER($1)
       LIMIT 1`,
      [email],
    );

    const existingUser = userCheck.rows[0] as ({ password: string } & Record<string, unknown>) | undefined;
    if (existingUser?.status === true && await verifyPassword(password, existingUser.password)) {
      const user = {
        id: existingUser.id,
        name: existingUser.name,
        email: existingUser.email,
        role: existingUser.role,
        mobile: existingUser.mobile,
        status: existingUser.status,
        verified: existingUser.verified,
        created_on: existingUser.created_on,
      };
      const sessionToken = await createSession("user", Number(existingUser.id));
      const response = NextResponse.json({ user }, { status: 200 });
      setSessionCookie(response, sessionToken);
      return response;
    }

    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  } catch (error) {
    console.error("Failed to authenticate user", error);
    return NextResponse.json({ error: "Unable to login right now." }, { status: 500 });
  }
}
