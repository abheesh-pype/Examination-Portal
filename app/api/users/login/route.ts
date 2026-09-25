import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";

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
    const body = await request.json();
    const email = String(body?.email || "").trim();
    const password = String(body?.password || "");

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    await ensureUsersTable();

    const userCheck = await databasePool.query(
      `SELECT id, name, email, role, mobile, status, verified, created_on
       FROM users
       WHERE LOWER(email) = LOWER($1) AND password = $2
       LIMIT 1`,
      [email, password]
    );

    if (userCheck.rowCount === 0) {
      const existingUserCount = await databasePool.query(`SELECT COUNT(*)::int AS count FROM users`);
      if (existingUserCount.rows[0].count === 0) {
        await databasePool.query(
          `INSERT INTO users (name, email, password, role, mobile)
           VALUES ($1, $2, $3, $4, $5)`,
          ["Administrator", "admin@eduexpoits.in", "123456", "Administrator", "9999999999"]
        );

        const seededUser = await databasePool.query(
          `SELECT id, name, email, role, mobile, status, verified, created_on
           FROM users WHERE LOWER(email) = LOWER($1) AND password = $2 LIMIT 1`,
          [email, password]
        );

        if (seededUser.rowCount !== null && seededUser.rowCount > 0) {
          return NextResponse.json({ user: seededUser.rows[0] }, { status: 200 });
        }
      }

      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    return NextResponse.json({ user: userCheck.rows[0] }, { status: 200 });
  } catch (error) {
    console.error("Failed to authenticate user", error);
    return NextResponse.json({ error: "Unable to login right now." }, { status: 500 });
  }
}
