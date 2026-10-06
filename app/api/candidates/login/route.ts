import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { authorizeApiRequest, createSession, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

function isCandidateIdFieldName(name: string) {
  return /^candidate id(?:\s*\([^)]*\))?$/i.test(name.trim());
}

function isDateOfBirthFieldName(name: string) {
  const normalizedName = name.trim().toLowerCase();
  return normalizedName === "dob"
    || /^(date of birth|birth date)(?:\s*\([^)]*\))?$/.test(normalizedName);
}

function getStringField(fields: Record<string, unknown>, matches: (name: string) => boolean) {
  const entry = Object.entries(fields).find(([name, value]) =>
    matches(name) && typeof value === "string" && value.trim(),
  );
  return entry ? String(entry[1]).trim() : "";
}

function normalizeDate(value: string) {
  const dateValue = value.trim();
  const datePrefix = /^(\d{4}-\d{2}-\d{2})/.exec(dateValue);
  if (datePrefix) {
    const parsedDate = new Date(`${datePrefix[1]}T00:00:00.000Z`);
    return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === datePrefix[1]
      ? datePrefix[1]
      : "";
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? "" : parsedDate.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as { candidateId?: unknown; dateOfBirth?: unknown };
    const candidateId = typeof body.candidateId === "string" ? body.candidateId.trim() : "";
    const dateOfBirth = typeof body.dateOfBirth === "string" ? normalizeDate(body.dateOfBirth) : "";

    if (!/^\d{6}$/.test(candidateId) || !dateOfBirth) {
      return NextResponse.json({ error: "Invalid Candidate ID or date of birth." }, { status: 401 });
    }

    const result = await databasePool.query(`
      SELECT id, name, candidate_data
      FROM "Candidate Information"
      WHERE record_type = 'candidate' AND status = TRUE
      ORDER BY id ASC
    `);

    const candidate = result.rows.find((row) => {
      const candidateData = row.candidate_data as { fields?: Record<string, unknown> } | null;
      const fields = candidateData?.fields;
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) return false;

      const storedCandidateId = getStringField(fields, isCandidateIdFieldName);
      const storedDateOfBirth = getStringField(fields, isDateOfBirthFieldName);
      return storedCandidateId === candidateId && normalizeDate(storedDateOfBirth) === dateOfBirth;
    });

    if (!candidate) {
      return NextResponse.json({ error: "Invalid Candidate ID or date of birth." }, { status: 401 });
    }

    const candidateData = candidate.candidate_data as {
      fields?: Record<string, unknown>;
      category?: string | null;
      sub_category?: string | null;
    } | null;
    const fields = candidateData?.fields ?? {};
    const studentName = getStringField(fields, (name) => /^candidate name(?:\s*\([^)]*\))?$/i.test(name.trim()))
      || String(candidate.name || "Student");

    const sessionToken = await createSession("candidate", Number(candidate.id));
    const response = NextResponse.json({
      student: {
        id: candidate.id,
        name: studentName,
        category: candidateData?.category ?? null,
        subCategory: candidateData?.sub_category ?? null,
        portalType: "student",
      },
    });
    setSessionCookie(response, sessionToken);
    return response;
  } catch (error) {
    console.error("Failed to authenticate student candidate", error);
    return NextResponse.json({ error: "Unable to login right now." }, { status: 500 });
  }
}
