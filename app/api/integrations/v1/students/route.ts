import { NextResponse } from "next/server";
import { IntegrationError, loadTenants, verifyBearerToken } from "@/lib/integrations/tokens";
import { PayloadError, peekTenantId, validateStudentPayload } from "@/lib/integrations/payload";
import { provisionStudent } from "@/lib/integrations/store";
import { loadIssuerConfig, publicKeySet } from "@/lib/integrations/issuer";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 1_000_000;

// Machine-to-machine receiver. Authenticated only by an OAuth bearer token verified against the tenant named
// in the body; it never uses (or accepts) browser sessions or cookies.
export async function POST(request: Request) {
  try {
    const { tenants } = loadTenants();
    if (tenants.length === 0) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });

    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(await request.text()); } catch { return NextResponse.json({ ok: false, error: "invalid_payload", message: "Body must be JSON" }, { status: 400 }); }

    // Unknown tenant and bad token are indistinguishable to the caller.
    const tenant = tenants.find((entry) => entry.tenantId === peekTenantId(body));
    if (!tenant) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
    const issuer = tenant.builtin ? loadIssuerConfig() : null;
    if (tenant.builtin && !issuer) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
    const localKeys = issuer ? await publicKeySet(issuer) : null;
    await verifyBearerToken(request.headers.get("authorization"), tenant, localKeys ? () => localKeys : undefined);

    const student = validateStudentPayload(body);
    const header = request.headers.get("idempotency-key");
    const result = await provisionStudent(student, header ? header.slice(0, 128) : undefined);
    return NextResponse.json({
      ok: true,
      result: result.created ? "created" : "updated",
      external_student_id: student.externalStudentId,
      candidate_id: result.candidateId,
      status: result.status,
      assigned_assessments: result.assigned,
      unmapped_assessments: result.unmappedAssessmentIds,
    }, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof IntegrationError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, {
        status: error.status, headers: error.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined,
      });
    }
    if (error instanceof PayloadError) return NextResponse.json({ ok: false, error: "invalid_payload", message: error.message }, { status: error.status });
    console.error("Failed to provision integration student", error);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
