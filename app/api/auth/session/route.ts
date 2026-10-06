import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth";
import { databasePool } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    if (authorization.user) {
      const result = await databasePool.query(`
        SELECT id, name, email, role, mobile, status, verified, created_on
        FROM users
        WHERE id = $1 AND status = TRUE
      `, [authorization.user.id]);
      if (!result.rowCount) return NextResponse.json({ error: "The account is inactive." }, { status: 401 });
      return NextResponse.json({ user: result.rows[0] });
    }
    if (authorization.candidate) {
      const result = await databasePool.query(`
        SELECT name, candidate_data
        FROM "Candidate Information"
        WHERE id = $1 AND record_type = 'candidate' AND status = TRUE
      `, [authorization.candidate.id]);
      if (!result.rowCount) return NextResponse.json({ error: "The student account is inactive." }, { status: 401 });
      const data = result.rows[0].candidate_data as {
        fields?: Record<string, unknown>;
        category?: string | null;
        sub_category?: string | null;
      } | null;
      const nameField = Object.entries(data?.fields ?? {}).find(([name, value]) =>
        /^candidate name(?:\s*\([^)]*\))?$/i.test(name.trim())
        && typeof value === "string"
        && value.trim(),
      );
      return NextResponse.json({
        student: {
          id: authorization.candidate.id,
          name: nameField ? String(nameField[1]).trim() : String(result.rows[0].name ?? "Student"),
          category: data?.category ?? null,
          subCategory: data?.sub_category ?? null,
          portalType: "student",
        },
      });
    }
    return NextResponse.json({ error: "No authenticated session." }, { status: 401 });
  } catch (error) {
    console.error("Failed to load authenticated session", error);
    return NextResponse.json({ error: "Unable to load the current session." }, { status: 500 });
  }
}
