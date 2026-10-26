// Validation for POST /api/integrations/v1/students. No project imports (unit tested directly).
export type ProvisionedStudent = {
  tenantId: string;
  externalStudentId: string;
  name: string;
  email: string | null;
  category: string;
  subCategory: string;
  status: "active" | "inactive";
  assessments: { externalAssessmentId: string; name: string; examination: string }[];
};

export class PayloadError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max;

/** Extracts tenant_id without trusting anything else, to select the verifier. */
export const peekTenantId = (body: unknown) =>
  body && typeof body === "object" && typeof (body as { tenant_id: string }).tenant_id === "string" ? (body as { tenant_id: string }).tenant_id.trim() : "";

/** Returns only known fields. Unknown fields (e.g. dob, password) are dropped, never stored. */
type Loose = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export function validateStudentPayload(raw: unknown): ProvisionedStudent {
  const body = raw as Loose | null;
  const bad = (message: string) => new PayloadError(400, message);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bad("Body must be a JSON object");
  if (!text(body.tenant_id, 100)) throw bad("tenant_id is required");
  if (!text(body.external_student_id, 100)) throw bad("external_student_id is required");
  if (!text(body.name, 200)) throw bad("name is required");
  if (body.email != null && !(typeof body.email === "string" && body.email.length <= 254 && (body.email === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)))) {
    throw bad("email must be a valid address or null");
  }
  if (body.status !== "active" && body.status !== "inactive") throw bad('status must be "active" or "inactive"');
  for (const field of ["category", "sub_category"]) {
    if (body[field] != null && !(typeof body[field] === "string" && body[field].length <= 200)) throw bad(`${field} must be a string`);
  }
  if (!Array.isArray(body.assigned_assessments) || body.assigned_assessments.length > 500) throw bad("assigned_assessments must be an array (max 500)");

  const seen = new Set<string>();
  const assessments = body.assigned_assessments.map((item: Loose) => {
    const id = item?.ums_assessment_id ?? item?.external_assessment_id;
    const valid = item && typeof item === "object" && (Number.isInteger(id) || text(id, 100)) && text(item.name, 300)
      && (item.examination == null || (typeof item.examination === "string" && item.examination.length <= 300));
    if (!valid) throw bad("Each assessment needs ums_assessment_id (or external_assessment_id), name and examination");
    const externalAssessmentId = String(id);
    if (seen.has(externalAssessmentId)) throw bad("Duplicate assessment id in assigned_assessments");
    seen.add(externalAssessmentId);
    return { externalAssessmentId, name: item.name.trim(), examination: String(item.examination ?? "").trim() };
  });

  return {
    tenantId: body.tenant_id.trim(),
    externalStudentId: body.external_student_id.trim(),
    name: body.name.trim(),
    email: body.email ? String(body.email).trim().toLowerCase() : null,
    category: String(body.category ?? "").trim(),
    subCategory: String(body.sub_category ?? "").trim(),
    status: body.status,
    // Inactive students keep no assignments regardless of what was sent.
    assessments: body.status === "active" ? assessments : [],
  };
}
