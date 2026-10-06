import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { authorizeApiRequest } from "@/lib/auth";

export const runtime = "nodejs";

async function ensureRolesTable() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id SERIAL PRIMARY KEY,
      role_name TEXT NOT NULL,
      administrator_access BOOLEAN NOT NULL DEFAULT FALSE,
      dashboard BOOLEAN NOT NULL DEFAULT FALSE,
      permissions JSONB NOT NULL DEFAULT '{}',
      status BOOLEAN NOT NULL DEFAULT TRUE,
      created_on TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function GET(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    await ensureRolesTable();
    const result = authorization.user?.isAdmin
      ? await databasePool.query(`
        SELECT id, role_name, administrator_access, dashboard, permissions, status, created_on
        FROM roles
        ORDER BY id DESC
      `)
      : await databasePool.query(`
        SELECT id, role_name, administrator_access, dashboard, permissions, status, created_on
        FROM roles
        WHERE LOWER(BTRIM(role_name)) = LOWER(BTRIM($1)) AND status = TRUE
        ORDER BY id DESC
      `, [authorization.user?.role ?? ""]);
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Failed to fetch roles", error);
    return NextResponse.json({ error: "Unable to fetch roles" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json();
    const { role_name, administrator_access, dashboard, permissions } = body;

    await ensureRolesTable();
    const result = await databasePool.query(
      `
        INSERT INTO roles (role_name, administrator_access, dashboard, permissions)
        VALUES ($1, $2, $3, $4)
        RETURNING id, role_name, administrator_access, dashboard, permissions, status, created_on
      `,
      [role_name, administrator_access || false, dashboard || false, JSON.stringify(permissions || {})]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error("Failed to save role", error);
    return NextResponse.json({ error: "Unable to save role" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json();
    const { id, role_name, administrator_access, dashboard, permissions } = body;

    if (!id) {
      return NextResponse.json({ error: "Role id is required" }, { status: 400 });
    }

    await ensureRolesTable();
    const result = await databasePool.query(
      `
        UPDATE roles
        SET role_name = $2,
            administrator_access = $3,
            dashboard = $4,
            permissions = $5
        WHERE id = $1
        RETURNING id, role_name, administrator_access, dashboard, permissions, status, created_on
      `,
      [id, role_name, administrator_access || false, dashboard || false, JSON.stringify(permissions || {})]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    return NextResponse.json(result.rows[0], { status: 200 });
  } catch (error) {
    console.error("Failed to update role", error);
    return NextResponse.json({ error: "Unable to update role" }, { status: 500 });
  }
}
