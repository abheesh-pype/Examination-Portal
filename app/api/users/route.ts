import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { authorizeApiRequest } from "@/lib/auth";

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

export async function GET(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
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
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const mobile = typeof body.mobile === "string" ? body.mobile.trim() : "";
    const role = typeof body.role === "string" ? body.role.trim() : "";
    const plainPassword = typeof body.password === "string" ? body.password : "";
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !mobile || !role) {
      return NextResponse.json({ error: "Valid name, email, mobile, and role are required" }, { status: 400 });
    }
    if (plainPassword.length < 12) {
      return NextResponse.json({ error: "A password of at least 12 characters is required" }, { status: 400 });
    }
    const password = await hashPassword(plainPassword);

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
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });
    }
    console.error("Failed to create user", error);
    return NextResponse.json({ error: "Unable to create user" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as { id?: unknown; password?: unknown; status?: unknown };
    const userId = Number(body.id);

    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "A valid user id is required" }, { status: 400 });
    }

    if ("status" in body) {
      if (typeof body.status !== "boolean") {
        return NextResponse.json({ error: "A valid user status is required" }, { status: 400 });
      }

      await ensureUsersTable();
      const result = await databasePool.query(
        `
          UPDATE users
          SET status = $2
          WHERE id = $1
          RETURNING id, name, email, role, mobile, status, verified, created_on
        `,
        [userId, body.status],
      );

      if (result.rowCount === 0) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      return NextResponse.json(result.rows[0]);
    }

    const password = typeof body.password === "string" ? body.password : "";
    if (!password) {
      return NextResponse.json({ error: "A new password is required" }, { status: 400 });
    }

    await ensureUsersTable();
    const result = await databasePool.query(
      `
        UPDATE users
        SET password = $2
        WHERE id = $1
        RETURNING id, name, email
      `,
      [userId, await hashPassword(password)],
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error("Failed to reset user password", error);
    return NextResponse.json({ error: "Unable to reset user password" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as {
      id?: unknown;
      name?: unknown;
      email?: unknown;
      mobile?: unknown;
      role?: unknown;
    };
    const userId = Number(body.id);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const mobile = typeof body.mobile === "string" ? body.mobile.trim() : "";
    const role = typeof body.role === "string" ? body.role.trim() : "";

    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "A valid user id is required" }, { status: 400 });
    }
    if (!name || !email || !mobile || !role) {
      return NextResponse.json({ error: "Name, email, mobile, and role are required" }, { status: 400 });
    }

    await ensureUsersTable();
    const result = await databasePool.query(
      `
        UPDATE users
        SET name = $2, email = $3, mobile = $4, role = $5
        WHERE id = $1
        RETURNING id, name, email, role, mobile, status, verified, created_on
      `,
      [userId, name, email, mobile, role],
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });
    }
    console.error("Failed to update user", error);
    return NextResponse.json({ error: "Unable to update user" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
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
