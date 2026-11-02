import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import {
  acquireCandidateIdLock,
  generateUniqueCandidateId,
  getCandidateIdFieldName,
  isCandidateIdFieldName,
  loadExistingCandidateIds,
} from "@/lib/candidate-ids";
import { databasePool } from "@/lib/db";
import { handleIntegrationRequest, readJsonObject } from "@/lib/integration-handler";
import {
  ensureIntegrationSchema,
  integrationError,
  runIdempotent,
  sha256Hex,
  UMS_ASSIGNMENT_SOURCE,
  type IntegrationClient,
} from "@/lib/integrations";

export const runtime = "nodejs";

const ROUTE = "/api/integrations/v1/students";
const MAX_ASSIGNED_ASSESSMENTS = 500;

type StudentPayload = {
  externalStudentId: string;
  name: string;
  email: string;
  category: string;
  subCategory: string;
  active: boolean;
  umsAssessmentIds: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedText(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim().length <= maxLength ? value.trim() : null;
}

function parseStudentPayload(body: Record<string, unknown>): { payload: StudentPayload } | { errors: string[] } {
  const errors: string[] = [];
  const externalStudentId = boundedText(body.external_student_id, 128);
  const name = boundedText(body.name, 200);
  const email = body.email === null || body.email === undefined ? "" : boundedText(body.email, 254);
  const category = boundedText(body.category, 200);
  const subCategory = body.sub_category === null || body.sub_category === undefined ? "" : boundedText(body.sub_category, 200);

  if (!externalStudentId) errors.push("external_student_id must be a non-empty string of at most 128 characters.");
  if (!name) errors.push("name must be a non-empty string of at most 200 characters.");
  if (email === null || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) errors.push("email must be a valid email address or empty.");
  if (category === null) errors.push("category must be a string of at most 200 characters.");
  if (subCategory === null) errors.push("sub_category must be a string of at most 200 characters.");
  if (body.status !== "active" && body.status !== "inactive") errors.push('status must be "active" or "inactive".');
  if (body.candidate_id !== undefined && body.candidate_id !== null && typeof body.candidate_id !== "string") {
    errors.push("candidate_id must be a string when provided.");
  }

  const umsAssessmentIds: string[] = [];
  const assessments = body.assigned_assessments ?? [];
  if (!Array.isArray(assessments) || assessments.length > MAX_ASSIGNED_ASSESSMENTS) {
    errors.push(`assigned_assessments must be an array of at most ${MAX_ASSIGNED_ASSESSMENTS} items.`);
  } else {
    assessments.forEach((assessment, index) => {
      const id = isRecord(assessment) ? assessment.ums_assessment_id : undefined;
      const normalizedId = typeof id === "number" && Number.isFinite(id) ? String(id) : boundedText(id, 128);
      if (!normalizedId) {
        errors.push(`assigned_assessments[${index}].ums_assessment_id must be a non-empty string.`);
      } else if (!umsAssessmentIds.includes(normalizedId)) {
        umsAssessmentIds.push(normalizedId);
      }
    });
  }

  if (errors.length) return { errors };
  return {
    payload: {
      externalStudentId: externalStudentId!,
      name: name!,
      email: email!,
      category: category!,
      subCategory: subCategory!,
      active: body.status === "active",
      umsAssessmentIds,
    },
  };
}

async function getEmailFieldName(db: PoolClient, fields: Record<string, unknown>) {
  const existing = Object.keys(fields).find((name) => /e-?mail/i.test(name));
  if (existing) return existing;
  const result = await db.query(`
    SELECT name
    FROM "Candidate Information"
    WHERE record_type = 'field'
    ORDER BY date ASC, id ASC
  `);
  return (result.rows as Array<{ name: string }>).map((row) => row.name).find((name) => /e-?mail/i.test(name)) ?? "Email";
}

async function syncAssignments(db: PoolClient, client: IntegrationClient, candidateId: number, payload: StudentPayload) {
  const mapped = payload.umsAssessmentIds.length
    ? await db.query(`
      SELECT id, external_assessment_id
      FROM assessment
      WHERE tenant_id = $1 AND external_assessment_id = ANY($2::text[])
    `, [client.tenantId, payload.umsAssessmentIds])
    : { rows: [] };
  const mappedRows = mapped.rows as Array<{ id: number; external_assessment_id: string }>;
  const mappedExternalIds = new Set(mappedRows.map((row) => row.external_assessment_id));
  const unmappedAssessments = payload.umsAssessmentIds.filter((id) => !mappedExternalIds.has(id));
  const assessmentIds = payload.active ? mappedRows.map((row) => Number(row.id)) : [];

  // Only rows created by this sync are replaced; assignments made in the portal are untouched.
  await db.query(`
    DELETE FROM assessment_candidate_direct_assignment
    WHERE candidate_id = $1 AND source = $2 AND NOT (assessment_id = ANY($3::int[]))
  `, [candidateId, UMS_ASSIGNMENT_SOURCE, assessmentIds]);
  if (assessmentIds.length) {
    await db.query(`
      INSERT INTO assessment_candidate_direct_assignment (assessment_id, candidate_id, source)
      SELECT assessment_id, $1, $2
      FROM UNNEST($3::int[]) AS assessment_id
      ON CONFLICT (assessment_id, candidate_id) DO NOTHING
    `, [candidateId, UMS_ASSIGNMENT_SOURCE, assessmentIds]);
  }
  return { assignedAssessments: assessmentIds.length, unmappedAssessments };
}

async function upsertStudent(db: PoolClient, client: IntegrationClient, payload: StudentPayload) {
  await acquireCandidateIdLock(db);
  const existing = await db.query(`
    SELECT id, candidate_data
    FROM "Candidate Information"
    WHERE record_type = 'candidate' AND tenant_id = $1 AND external_student_id = $2
    FOR UPDATE
  `, [client.tenantId, payload.externalStudentId]);
  const existingRow = existing.rows[0] as { id: number; candidate_data: unknown } | undefined;
  const existingData = isRecord(existingRow?.candidate_data) ? existingRow.candidate_data : {};
  const fields: Record<string, unknown> = isRecord(existingData.fields) ? { ...existingData.fields } : {};

  let candidateCode = Object.entries(fields).find(([name, value]) =>
    isCandidateIdFieldName(name) && typeof value === "string" && /^\d{6}$/.test(value))?.[1] as string | undefined;
  if (!candidateCode) {
    const candidateIdFieldName = await getCandidateIdFieldName(db);
    candidateCode = generateUniqueCandidateId(await loadExistingCandidateIds(db));
    fields[candidateIdFieldName] = candidateCode;
  }
  const nameFieldName = Object.keys(fields).find((name) => /^candidate name(?:\s*\([^)]*\))?$/i.test(name.trim())) ?? "Candidate Name";
  fields[nameFieldName] = payload.name;
  const emailFieldName = await getEmailFieldName(db, fields);
  if (payload.email) fields[emailFieldName] = payload.email;
  else delete fields[emailFieldName];

  const candidateData = { ...existingData, category: payload.category, sub_category: payload.subCategory, fields };
  let candidateId: number;
  if (existingRow) {
    candidateId = Number(existingRow.id);
    await db.query(`
      UPDATE "Candidate Information"
      SET name = $2, candidate_data = $3::jsonb, status = $4
      WHERE id = $1
    `, [candidateId, payload.name, JSON.stringify(candidateData), payload.active]);
  } else {
    const inserted = await db.query(`
      INSERT INTO "Candidate Information" (record_type, name, column_type, candidate_data, status, tenant_id, external_student_id)
      VALUES ('candidate', $1, 'Candidate', $2::jsonb, $3, $4, $5)
      RETURNING id
    `, [payload.name, JSON.stringify(candidateData), payload.active, client.tenantId, payload.externalStudentId]);
    candidateId = Number(inserted.rows[0].id);
  }

  const { assignedAssessments, unmappedAssessments } = await syncAssignments(db, client, candidateId, payload);
  return {
    status: existingRow ? 200 : 201,
    body: {
      ok: true,
      external_student_id: payload.externalStudentId,
      candidate_id: candidateCode,
      assigned_assessments: assignedAssessments,
      unmapped_assessments: unmappedAssessments,
    },
  };
}

export async function POST(request: Request) {
  return handleIntegrationRequest(request, async (client) => {
    const { text, body } = await readJsonObject(request);
    if (!body) return integrationError(400, "invalid_request", "The request body must be a JSON object.");
    const parsed = parseStudentPayload(body);
    if ("errors" in parsed) return integrationError(422, "invalid_student", parsed.errors.join(" "));

    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || null;
    if (idempotencyKey && idempotencyKey.length > 255) {
      return integrationError(400, "invalid_request", "Idempotency-Key must be at most 255 characters.");
    }

    await ensureIntegrationSchema();
    const db = await databasePool.connect();
    let transactionStarted = false;
    try {
      await db.query("BEGIN");
      transactionStarted = true;
      const outcome = await runIdempotent(
        db,
        { clientId: client.clientId, route: ROUTE, key: idempotencyKey, requestHash: sha256Hex(text) },
        () => upsertStudent(db, client, parsed.payload),
      );
      await db.query("COMMIT");
      transactionStarted = false;
      return NextResponse.json(outcome.body, { status: outcome.status });
    } catch (error) {
      if (transactionStarted) await db.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      db.release();
    }
  });
}
