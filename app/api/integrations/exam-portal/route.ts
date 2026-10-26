import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth";
import { databasePool } from "@/lib/db";

export const runtime = "nodejs";

const configurationKeys = [
  "UMS_TENANT_ID",
  "EXAM_PORTAL_TOKEN_URL",
  "EXAM_PORTAL_CLIENT_ID",
  "EXAM_PORTAL_CLIENT_SECRET",
  "EXAM_PORTAL_STUDENT_UPSERT_URL",
] as const;

type IntegrationConfiguration = {
  tenantId: string;
  tokenUrl: URL;
  clientId: string;
  clientSecret: string;
  studentUpsertUrl: URL;
  scope: string;
  audience: string;
};

class IntegrationUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationUpstreamError";
  }
}

type CandidateRow = {
  id: number;
  name: string;
  status: boolean;
  candidate_data: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getFields(value: unknown) {
  if (!isRecord(value) || !isRecord(value.fields)) return {};
  return value.fields;
}

function getStringField(fields: Record<string, unknown>, matches: (name: string) => boolean) {
  const entry = Object.entries(fields).find(([name, value]) =>
    matches(name.trim()) && typeof value === "string" && value.trim(),
  );
  return entry ? String(entry[1]).trim() : "";
}

function isAllowedServiceUrl(value: string | undefined) {
  if (!value?.trim()) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const isLocalHttp = process.env.NODE_ENV !== "production"
    && url.protocol === "http:"
    && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLocalHttp) return null;
  if (url.username || url.password || url.hash) return null;
  return url;
}

function getConfiguration() {
  const missing: string[] = configurationKeys.filter((key) => !process.env[key]?.trim());
  const tokenUrl = isAllowedServiceUrl(process.env.EXAM_PORTAL_TOKEN_URL);
  const studentUpsertUrl = isAllowedServiceUrl(process.env.EXAM_PORTAL_STUDENT_UPSERT_URL);
  if (process.env.EXAM_PORTAL_TOKEN_URL?.trim() && !tokenUrl) missing.push("EXAM_PORTAL_TOKEN_URL (must be HTTPS)");
  if (process.env.EXAM_PORTAL_STUDENT_UPSERT_URL?.trim() && !studentUpsertUrl) {
    missing.push("EXAM_PORTAL_STUDENT_UPSERT_URL (must be HTTPS)");
  }
  if (missing.length || !tokenUrl || !studentUpsertUrl) {
    return { missing: [...new Set(missing)], configuration: null };
  }

  const configuration: IntegrationConfiguration = {
    tenantId: process.env.UMS_TENANT_ID!.trim(),
    tokenUrl,
    clientId: process.env.EXAM_PORTAL_CLIENT_ID!.trim(),
    clientSecret: process.env.EXAM_PORTAL_CLIENT_SECRET!,
    studentUpsertUrl,
    scope: process.env.EXAM_PORTAL_SCOPE?.trim() ?? "",
    audience: process.env.EXAM_PORTAL_AUDIENCE?.trim() ?? "",
  };
  return { missing: [], configuration };
}

async function ensureProvisioningTables() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment (
      id SERIAL PRIMARY KEY,
      examination TEXT NOT NULL,
      name TEXT NOT NULL,
      status BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS candidate_sub_category (
      id SERIAL PRIMARY KEY,
      candidate_sub_category TEXT NOT NULL,
      category TEXT NOT NULL,
      status BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment_candidate_sub_category (
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_sub_category_id INTEGER NOT NULL REFERENCES candidate_sub_category(id) ON DELETE CASCADE,
      PRIMARY KEY (assessment_id, candidate_sub_category_id)
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment_candidate_direct_assignment (
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL,
      PRIMARY KEY (assessment_id, candidate_id)
    )
  `);
}

async function findCandidate(candidateId: string) {
  const result = await databasePool.query(`
    SELECT candidate.id, candidate.name, candidate.status, candidate.candidate_data
    FROM "Candidate Information" AS candidate
    WHERE candidate.record_type = 'candidate'
      AND EXISTS (
        SELECT 1
        FROM jsonb_each_text(
          CASE
            WHEN jsonb_typeof(candidate.candidate_data->'fields') = 'object'
              THEN candidate.candidate_data->'fields'
            ELSE '{}'::jsonb
          END
        ) AS candidate_field(field_name, field_value)
        WHERE candidate_field.field_name ~* '^candidate id([[:space:]]*\\([^)]*\\))?$'
          AND candidate_field.field_value = $1
      )
    LIMIT 1
  `, [candidateId]);
  return result.rows[0] as CandidateRow | undefined;
}

async function getAssignedAssessments(candidate: CandidateRow, category: string, subCategory: string) {
  const result = await databasePool.query(`
    SELECT DISTINCT assessment.id AS ums_assessment_id,
           assessment.name,
           assessment.examination
    FROM assessment
    LEFT JOIN assessment_candidate_direct_assignment AS direct_assignment
      ON direct_assignment.assessment_id = assessment.id
     AND direct_assignment.candidate_id = $1
    LEFT JOIN assessment_candidate_sub_category AS sub_category_assignment
      ON sub_category_assignment.assessment_id = assessment.id
    LEFT JOIN candidate_sub_category AS sub_category
      ON sub_category.id = sub_category_assignment.candidate_sub_category_id
     AND sub_category.status = TRUE
     AND LOWER(TRIM(sub_category.category)) = LOWER(TRIM($2))
     AND LOWER(TRIM(sub_category.candidate_sub_category)) = LOWER(TRIM($3))
    WHERE assessment.status = TRUE
      AND (direct_assignment.candidate_id IS NOT NULL OR sub_category.id IS NOT NULL)
    ORDER BY assessment.name, assessment.id
  `, [candidate.id, category, subCategory]);
  return result.rows.map((assessment) => ({
    ums_assessment_id: Number(assessment.ums_assessment_id),
    name: String(assessment.name ?? ""),
    examination: String(assessment.examination ?? ""),
  }));
}

async function requestAccessToken(configuration: IntegrationConfiguration) {
  const form = new URLSearchParams({ grant_type: "client_credentials" });
  if (configuration.scope) form.set("scope", configuration.scope);
  if (configuration.audience) form.set("audience", configuration.audience);
  const credentials = Buffer.from(`${configuration.clientId}:${configuration.clientSecret}`).toString("base64");
  let response: Response;
  try {
    response = await fetch(configuration.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new IntegrationUpstreamError("Could not reach the Exam Portal token endpoint.");
  }
  if (!response.ok) {
    throw new IntegrationUpstreamError(`The Exam Portal token endpoint returned HTTP ${response.status}.`);
  }
  let tokenPayload: unknown;
  try {
    tokenPayload = await response.json();
  } catch {
    throw new IntegrationUpstreamError("The Exam Portal token endpoint returned invalid JSON.");
  }
  if (!isRecord(tokenPayload)
    || typeof tokenPayload.access_token !== "string"
    || !tokenPayload.access_token.trim()
    || tokenPayload.access_token.length > 8192
    || String(tokenPayload.token_type ?? "").toLocaleLowerCase() !== "bearer") {
    throw new IntegrationUpstreamError("The Exam Portal token endpoint returned an invalid bearer token response.");
  }
  return tokenPayload.access_token;
}

export async function GET(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    if (!authorization.user?.isAdmin) {
      return NextResponse.json({ error: "Only administrators can view integration status." }, { status: 403 });
    }

    const { configuration, missing } = getConfiguration();
    return NextResponse.json({
      configured: Boolean(configuration),
      missing,
      endpointHost: configuration?.studentUpsertUrl.host ?? null,
    });
  } catch (error) {
    console.error("Failed to load Exam Portal integration status", error);
    return NextResponse.json({ error: "Unable to load integration status." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    if (!authorization.user?.isAdmin) {
      return NextResponse.json({ error: "Only administrators can provision students." }, { status: 403 });
    }

    const { configuration, missing } = getConfiguration();
    if (!configuration) {
      return NextResponse.json({
        error: "The Exam Portal integration is not configured on the server.",
        missing,
      }, { status: 503 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "A JSON request body is required." }, { status: 400 });
    }
    const candidateId = isRecord(body) && typeof body.candidateId === "string"
      ? body.candidateId.trim()
      : "";
    if (!/^\d{6}$/.test(candidateId)) {
      return NextResponse.json({ error: "Enter a valid six-digit Candidate ID." }, { status: 400 });
    }

    await ensureProvisioningTables();
    const candidate = await findCandidate(candidateId);
    if (!candidate) {
      return NextResponse.json({ error: "No student was found for that Candidate ID." }, { status: 404 });
    }

    const fields = getFields(candidate.candidate_data);
    const storedCandidateId = getStringField(fields, (name) => /^candidate id(?:\s*\([^)]*\))?$/i.test(name));
    if (storedCandidateId !== candidateId) {
      return NextResponse.json({ error: "The student Candidate ID could not be verified." }, { status: 409 });
    }
    const candidateName = getStringField(fields, (name) => /^candidate name(?:\s*\([^)]*\))?$/i.test(name))
      || String(candidate.name || "Student");
    const email = getStringField(fields, (name) => /e-?mail/i.test(name));
    const candidateData = isRecord(candidate.candidate_data) ? candidate.candidate_data : {};
    const category = typeof candidateData.category === "string" ? candidateData.category : "";
    const subCategory = typeof candidateData.sub_category === "string" ? candidateData.sub_category : "";
    const assignedAssessments = await getAssignedAssessments(candidate, category, subCategory);
    const payload = {
      tenant_id: configuration.tenantId,
      external_student_id: candidateId,
      candidate_id: candidateId,
      name: candidateName,
      email: email || null,
      category,
      sub_category: subCategory,
      status: candidate.status ? "active" : "inactive",
      assigned_assessments: assignedAssessments,
    };

    const accessToken = await requestAccessToken(configuration);
    const idempotencyKey = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    let response: Response;
    try {
      response = await fetch(configuration.studentUpsertUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(payload),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new IntegrationUpstreamError("Could not reach the Exam Portal student endpoint.");
    }
    if (!response.ok) {
      throw new IntegrationUpstreamError(`The Exam Portal student endpoint returned HTTP ${response.status}.`);
    }

    return NextResponse.json({
      synced: true,
      candidate_id: candidateId,
      assigned_assessments_count: assignedAssessments.length,
    });
  } catch (error) {
    console.error("Failed to provision student to Exam Portal", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to provision the student.",
    }, { status: error instanceof IntegrationUpstreamError ? 502 : 500 });
  }
}
