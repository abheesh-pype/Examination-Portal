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
  /** Values for the portal's own candidate form fields, entered by an admin on the institution side. */
  fields?: Record<string, string>;
  /** Keep the category an admin already chose (used by automatic re-syncs). */
  preserveCategory?: boolean;
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

  if (body.fields != null) {
    const entries = typeof body.fields === "object" && !Array.isArray(body.fields) ? Object.entries(body.fields) : null;
    if (!entries || entries.length > 50 || entries.some(([name, value]) => name.length > 200 || typeof value !== "string" || value.length > 500)) {
      throw bad("fields must be an object of short text values");
    }
  }

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
    ...(body.fields ? { fields: body.fields as Record<string, string> } : {}),
    ...(body.preserve_category === true ? { preserveCategory: true } : {}),
  };
}

/** `role` is the portal role name chosen in the institution system; null means the default administrator role. */
export type StaffPayload = { tenantId: string; externalUserId: string; name: string; email: string; role: string | null };

/** Staff (e.g. a university's Academic Admin) asking for a portal sign-in. */
export function validateStaffPayload(raw: unknown): StaffPayload {
  const body = raw as Loose | null;
  const bad = (message: string) => new PayloadError(400, message);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bad("Body must be a JSON object");
  if (!text(body.tenant_id, 100)) throw bad("tenant_id is required");
  if (!text(body.external_user_id, 100)) throw bad("external_user_id is required");
  if (!text(body.name, 200)) throw bad("name is required");
  if (typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) throw bad("A valid email is required");
  if (body.role != null && !text(body.role, 100)) throw bad("role must be a role name");
  return {
    tenantId: body.tenant_id.trim(), externalUserId: body.external_user_id.trim(), name: body.name.trim(),
    email: body.email.trim().toLowerCase(), role: typeof body.role === "string" ? body.role.trim() : null,
  };
}

export type AssessmentUpsert = {
  tenantId: string; externalAssessmentId: string; name: string; examination: string;
  startDate: string | null; endDate: string | null; totalTime: number | null; active: boolean;
  /** Present when the whole assessment form was filled in on the institution side. */
  details?: AssessmentDetails;
  /** Publishing the shell keeps the examination, name and total time chosen in that form. */
  keepFormDetails?: boolean;
};

export type AssessmentDetails = {
  lastLogin: string; questionCategory: string; subCategory: string; topic: string; questionLanguage: string;
  passMark: string; sections: Record<string, unknown>[];
};

const isoDate = (value: unknown, label: string) => {
  if (value == null || value === "") return null;
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  if (Number.isNaN(time)) throw new PayloadError(400, `${label} must be an ISO date-time`);
  return new Date(time).toISOString();
};

/** Shell of an assessment pushed by the institution system. Questions/sections are authored in the portal. */
export function validateAssessmentPayload(raw: unknown): AssessmentUpsert {
  const body = raw as Loose | null;
  const bad = (message: string) => new PayloadError(400, message);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bad("Body must be a JSON object");
  if (!text(body.tenant_id, 100)) throw bad("tenant_id is required");
  const id = body.external_assessment_id;
  if (!(Number.isInteger(id) || text(id, 100))) throw bad("external_assessment_id is required");
  if (!text(body.name, 300)) throw bad("name is required");
  if (!text(body.examination, 300)) throw bad("examination is required");
  const startDate = isoDate(body.start_date, "start_date");
  const endDate = isoDate(body.end_date, "end_date");
  if (startDate && endDate && Date.parse(endDate) <= Date.parse(startDate)) throw bad("end_date must be after start_date");
  let totalTime: number | null = null;
  if (body.total_time != null) {
    if (!Number.isInteger(body.total_time) || body.total_time < 1 || body.total_time > 1440) throw bad("total_time must be 1-1440 minutes");
    totalTime = body.total_time;
  }
  if (body.status != null && body.status !== "active" && body.status !== "inactive") throw bad('status must be "active" or "inactive"');
  return {
    tenantId: body.tenant_id.trim(), externalAssessmentId: String(id).trim(), name: body.name.trim(), examination: body.examination.trim(),
    startDate, endDate, totalTime, active: body.status !== "inactive",
    ...(body.details != null ? { details: validateAssessmentDetails(body.details) } : {}),
    ...(body.keep_form_details === true ? { keepFormDetails: true } : {}),
  };
}

function validateAssessmentDetails(raw: Loose): AssessmentDetails {
  const bad = (message: string) => new PayloadError(400, message);
  if (typeof raw !== "object" || Array.isArray(raw)) throw bad("details must be a JSON object");
  const value = (name: string) => {
    const item = raw[name];
    if (item == null) return "";
    if (typeof item !== "string" && typeof item !== "number") throw bad(`details.${name} must be text`);
    return String(item).trim();
  };
  if (!value("question_category")) throw bad("Question Category is required");
  if (!value("sub_category")) throw bad("Sub-Category is required");
  if (!Array.isArray(raw.sections) || raw.sections.length === 0 || raw.sections.length > 100) throw bad("details.sections must list 1 to 100 sections");
  return {
    lastLogin: value("last_login"), questionCategory: value("question_category"), subCategory: value("sub_category"),
    topic: value("topic"), questionLanguage: value("question_language"), passMark: value("pass_mark"), sections: raw.sections,
  };
}
