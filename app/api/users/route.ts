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
  // Add columns if they don't exist in case the table was already created
  await databasePool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE`);
  await databasePool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT`);
}

export async function GET() {
  try {
    await ensureUsersTable();
    const result = await databasePool.query(
      `
        SELECT id, name, email, role, mobile, status, verified, created_on
        FROM users
        ORDER BY id DESC
      `
    );
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to fetch users", error);
    return NextResponse.json({ error: "Unable to fetch users" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, email, mobile, role } = body;
    const password = "123456"; // default password

    await ensureUsersTable();
    const result = await databasePool.query(
      `
        INSERT INTO users (name, email, password, role, mobile)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, name, email, role, mobile, status, verified, created_on
      `,
      [name, email, password, role, mobile]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error("Failed to create user", error);
    return NextResponse.json({ error: "Unable to create user" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const userId = Number(body?.id);

    if (!userId) {
      return NextResponse.json({ error: "User id is required" }, { status: 400 });
    }

    await ensureUsersTable();
    const result = await databasePool.query(
      `DELETE FROM users WHERE id = $1 RETURNING id, name, email, role, mobile` ,
      [userId]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error("Failed to delete user", error);
    return NextResponse.json({ error: "Unable to delete user" }, { status: 500 });
  }
}
