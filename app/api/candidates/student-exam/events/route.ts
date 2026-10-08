import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth";
import { databasePool } from "@/lib/db";
import {
  candidateTimelineEventLabels,
  ensureExamTimelineTable,
  examTimelineEventLabels,
  recordExamTimelineEvent,
  type CandidateTimelineEventType,
} from "@/lib/exam-timeline";

export const runtime = "nodejs";

function isCandidateEventType(value: unknown): value is CandidateTimelineEventType {
  return typeof value === "string"
    && Object.prototype.hasOwnProperty.call(candidateTimelineEventLabels, value);
}

export async function POST(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as { assessmentId?: unknown; eventType?: unknown };
    const assessmentId = Number(body.assessmentId);
    if (!Number.isInteger(assessmentId) || assessmentId <= 0 || !isCandidateEventType(body.eventType)) {
      return NextResponse.json({ error: "A valid assessment and monitoring event are required." }, { status: 400 });
    }

    await ensureExamTimelineTable();
    const candidateId = authorization.candidate?.id ?? 0;
    const client = await databasePool.connect();
    let transactionStarted = false;
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      const attemptResult = await client.query(`
        SELECT id
        FROM assessment_candidate_attempts
        WHERE assessment_id = $1
          AND candidate_id = $2
          AND status = 'in_progress'
          AND deadline_at > NOW()
        FOR UPDATE
      `, [assessmentId, candidateId]);
      if (!attemptResult.rowCount) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return NextResponse.json({ error: "No active examination attempt was found for this monitoring event." }, { status: 409 });
      }
      await recordExamTimelineEvent(client, assessmentId, candidateId, body.eventType, "candidate");
      await client.query("COMMIT");
      transactionStarted = false;
      return NextResponse.json({ recorded: true });
    } catch (error) {
      if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Failed to record student examination timeline event", error);
    return NextResponse.json({ error: "Unable to record this examination activity." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    if (!authorization.user) {
      return NextResponse.json({ error: "A staff account is required to view examination activity." }, { status: 403 });
    }
    const params = new URL(request.url).searchParams;
    const assessmentId = Number(params.get("assessmentId"));
    const candidateId = Number(params.get("candidateId"));
    const afterIdParam = params.get("afterId");
    if (afterIdParam !== null && !/^(0|[1-9]\d*)$/.test(afterIdParam)) {
      return NextResponse.json({ error: "A valid timeline event cursor is required." }, { status: 400 });
    }
    const afterId = afterIdParam === null ? null : afterIdParam;
    if (!Number.isInteger(assessmentId) || assessmentId <= 0
      || !Number.isInteger(candidateId) || candidateId <= 0) {
      return NextResponse.json({ error: "Valid assessment and candidate ids are required." }, { status: 400 });
    }

    await ensureExamTimelineTable();
    const roleResult = await databasePool.query(`
      SELECT users.role, COALESCE(roles.administrator_access, FALSE) AS administrator_access
      FROM users
      LEFT JOIN roles ON LOWER(BTRIM(roles.role_name)) = LOWER(BTRIM(users.role)) AND roles.status = TRUE
      WHERE users.id = $1 AND users.status = TRUE
    `, [authorization.user.id]);
    if (!roleResult.rowCount) {
      return NextResponse.json({ error: "An active account is required to view examination activity." }, { status: 403 });
    }
    const role = String(roleResult.rows[0].role ?? "").trim().toLocaleLowerCase();
    const isInvigilator = role === "invigilator";
    const isAdmin = !isInvigilator && (role.includes("admin") || Boolean(roleResult.rows[0].administrator_access));
    if (!isAdmin && !isInvigilator) {
      return NextResponse.json({ error: "Only administrators and invigilators can view examination activity." }, { status: 403 });
    }

    const assignment = await databasePool.query(`
      SELECT 1
      FROM "Candidate Information" AS candidate
      LEFT JOIN assessment_candidate_invigilator AS individual_assignment
        ON individual_assignment.assessment_id = $1
        AND individual_assignment.candidate_id = candidate.id
        AND individual_assignment.invigilator_user_id = $4
      LEFT JOIN candidate_sub_category AS candidate_group
        ON candidate_group.status = TRUE
        AND candidate_group.category = BTRIM(COALESCE(candidate.candidate_data->>'category', ''))
        AND candidate_group.candidate_sub_category = BTRIM(COALESCE(candidate.candidate_data->>'sub_category', ''))
      LEFT JOIN assessment_candidate_sub_category AS cohort_assignment
        ON cohort_assignment.assessment_id = $1
        AND cohort_assignment.candidate_sub_category_id = candidate_group.id
      WHERE candidate.id = $2
        AND candidate.record_type = 'candidate'
        AND EXISTS (SELECT 1 FROM assessment WHERE id = $1)
        AND (
          ($3::boolean AND cohort_assignment.assessment_id IS NOT NULL)
          OR (NOT $3::boolean AND individual_assignment.candidate_id IS NOT NULL)
        )
      LIMIT 1
    `, [assessmentId, candidateId, isAdmin, authorization.user.id]);
    if (!assignment.rowCount) {
      return NextResponse.json({ error: "You are not assigned to view this candidate's examination activity." }, { status: 403 });
    }

    const result = await databasePool.query(`
      SELECT id, event_type, source, occurred_at
      FROM assessment_candidate_timeline_events
      WHERE assessment_id = $1 AND candidate_id = $2
        AND ($3::bigint IS NULL OR id > $3::bigint)
      ORDER BY id ASC
    `, [assessmentId, candidateId, afterId]);
    const events = result.rows.map((row) => {
      const eventType = String(row.event_type) as keyof typeof examTimelineEventLabels;
      return {
        id: String(row.id),
        event_type: eventType,
        label: examTimelineEventLabels[eventType] ?? "Examination activity",
        source: String(row.source),
        occurred_at: new Date(row.occurred_at).toISOString(),
      };
    });
    return NextResponse.json(events, {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch (error) {
    console.error("Failed to load student examination timeline", error);
    return NextResponse.json({ error: "Unable to load this examination timeline." }, { status: 500 });
  }
}
