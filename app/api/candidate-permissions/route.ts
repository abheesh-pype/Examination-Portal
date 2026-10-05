import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { getExamCamPermission, setExamCamPermission } from "@/lib/candidate-permissions";

export const runtime = "nodejs";

export async function GET() {
  try {
    const examCamPermissionActive = await getExamCamPermission();
    return NextResponse.json({ exam_cam_permission_active: examCamPermissionActive });
  } catch (error) {
    console.error("Failed to load candidate permissions", error);
    return NextResponse.json({ error: "Unable to load candidate permissions." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { accountUserId?: unknown; examCamPermissionActive?: unknown };
    const accountUserId = Number(body.accountUserId);
    if (!Number.isInteger(accountUserId) || accountUserId <= 0 || typeof body.examCamPermissionActive !== "boolean") {
      return NextResponse.json({ error: "A valid administrator and permission status are required." }, { status: 400 });
    }

    await databasePool.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id SERIAL PRIMARY KEY,
        role_name TEXT NOT NULL,
        administrator_access BOOLEAN NOT NULL DEFAULT FALSE,
        dashboard BOOLEAN NOT NULL DEFAULT FALSE,
        permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
        status BOOLEAN NOT NULL DEFAULT TRUE,
        created_on TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const userResult = await databasePool.query(`
      SELECT users.role, COALESCE(roles.administrator_access, FALSE) AS administrator_access
      FROM users
      LEFT JOIN roles ON LOWER(roles.role_name) = LOWER(users.role) AND roles.status = TRUE
      WHERE users.id = $1 AND users.status = TRUE
      LIMIT 1
    `, [accountUserId]);
    if (!userResult.rowCount) {
      return NextResponse.json({ error: "An active administrator account is required." }, { status: 403 });
    }

    const role = String(userResult.rows[0].role ?? "").trim().toLocaleLowerCase();
    if (!role.includes("admin") && !userResult.rows[0].administrator_access) {
      return NextResponse.json({ error: "Only administrators can change candidate permissions." }, { status: 403 });
    }

    await setExamCamPermission(body.examCamPermissionActive);
    return NextResponse.json({ exam_cam_permission_active: body.examCamPermissionActive });
  } catch (error) {
    console.error("Failed to update candidate permissions", error);
    return NextResponse.json({ error: "Unable to update candidate permissions." }, { status: 500 });
  }
}
