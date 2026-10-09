import { NextResponse } from "next/server";
import { databasePool } from "@/lib/db";
import { authorizeApiRequest } from "@/lib/auth";

export const runtime = "nodejs";

type SignalMessageType = "offer" | "answer" | "ice" | "end";

type LiveFeedPayload = {
  type?: unknown;
  sdp?: unknown;
  candidate?: unknown;
  sdpMid?: unknown;
  sdpMLineIndex?: unknown;
  usernameFragment?: unknown;
};

type LiveFeedRequest = {
  action?: unknown;
  side?: unknown;
  assessmentId?: unknown;
  candidateRecordId?: unknown;
  candidateId?: unknown;
  dateOfBirth?: unknown;
  viewerUserId?: unknown;
  sessionId?: unknown;
  afterId?: unknown;
  messageType?: unknown;
  payload?: unknown;
};

const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let liveFeedTablesReady = false;

async function ensureLiveFeedTables() {
  if (liveFeedTablesReady) return;
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment (
      id SERIAL PRIMARY KEY,
      examination TEXT NOT NULL,
      name TEXT NOT NULL,
      start_date TIMESTAMPTZ,
      end_date TIMESTAMPTZ,
      total_time INTEGER,
      last_login INTEGER,
      question_category TEXT,
      sub_category TEXT,
      topic TEXT,
      question_language TEXT,
      sections JSONB NOT NULL DEFAULT '[]'::jsonb,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      mobile TEXT NOT NULL,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      verified BOOLEAN NOT NULL DEFAULT FALSE,
      created_on TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS "Candidate Information" (
      id SERIAL PRIMARY KEY,
      record_type TEXT NOT NULL DEFAULT 'field',
      name TEXT NOT NULL,
      column_type TEXT NOT NULL,
      is_dependent BOOLEAN NOT NULL DEFAULT FALSE,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      is_required BOOLEAN NOT NULL DEFAULT FALSE,
      min_value NUMERIC,
      max_value NUMERIC,
      options JSONB,
      dependent_on TEXT,
      date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      candidate_data JSONB
    )
  `);
  await databasePool.query('ALTER TABLE "Candidate Information" ADD COLUMN IF NOT EXISTS record_type TEXT NOT NULL DEFAULT \'field\'');
  await databasePool.query('ALTER TABLE "Candidate Information" ADD COLUMN IF NOT EXISTS candidate_data JSONB');
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS candidate_sub_category (
      id SERIAL PRIMARY KEY,
      candidate_sub_category TEXT NOT NULL,
      category TEXT NOT NULL,
      status BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment_candidate_sub_category (
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_sub_category_id INTEGER NOT NULL REFERENCES candidate_sub_category(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (assessment_id, candidate_sub_category_id)
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment_candidate_direct_assignment (
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES "Candidate Information"(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (assessment_id, candidate_id)
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment_candidate_invigilator (
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES "Candidate Information"(id) ON DELETE CASCADE,
      invigilator_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (assessment_id, candidate_id)
    )
  `);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS assessment_candidate_live_feed_signals (
      id BIGSERIAL PRIMARY KEY,
      assessment_id INTEGER NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES "Candidate Information"(id) ON DELETE CASCADE,
      session_id UUID NOT NULL,
      sender_side TEXT NOT NULL CHECK (sender_side IN ('candidate', 'staff')),
      message_type TEXT NOT NULL CHECK (message_type IN ('offer', 'answer', 'ice', 'end')),
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await databasePool.query(`
    CREATE INDEX IF NOT EXISTS assessment_candidate_live_feed_signals_lookup_idx
    ON assessment_candidate_live_feed_signals (assessment_id, candidate_id, session_id, id)
  `);
  liveFeedTablesReady = true;
}

async function findCandidate(candidateRecordId: number) {
  const result = await databasePool.query(`
    SELECT id, candidate_data
    FROM "Candidate Information"
    WHERE id = $1 AND record_type = 'candidate' AND status = TRUE
  `, [candidateRecordId]);
  return result.rows[0];
}

function isValidSignalPayload(messageType: SignalMessageType, value: unknown): value is LiveFeedPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as LiveFeedPayload;
  if (messageType === "offer" || messageType === "answer") {
    return payload.type === messageType
      && typeof payload.sdp === "string"
      && payload.sdp.length > 0
      && payload.sdp.length <= 100_000
      && !payload.sdp.includes("\u0000");
  }
  if (messageType === "ice") {
    return typeof payload.candidate === "string"
      && payload.candidate.length > 0
      && payload.candidate.length <= 4096
      && typeof payload.sdpMid === "string"
      && payload.sdpMid.length <= 128
      && (payload.sdpMLineIndex === null || Number.isInteger(payload.sdpMLineIndex))
      && (payload.usernameFragment === undefined || payload.usernameFragment === null || typeof payload.usernameFragment === "string");
  }
  return messageType === "end" && Object.keys(payload).length === 0;
}

export async function POST(request: Request) {
  try {
    const authorization = await authorizeApiRequest(request);
    if (!authorization.ok) return authorization.response;
    const body = await request.json() as LiveFeedRequest;
    const side = body.side;
    const action = body.action;
    const assessmentId = Number(body.assessmentId);
    const candidateRecordId = side === "candidate"
      ? authorization.candidate?.id ?? 0
      : Number(body.candidateRecordId);
    const requestedSessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const isCandidateDiscoveryPoll = side === "candidate" && action === "poll";

    if ((side !== "candidate" && side !== "staff")
      || (action !== "start" && action !== "poll" && action !== "send")
      || !Number.isInteger(assessmentId)
      || assessmentId <= 0
      || (side === "staff" && (!Number.isInteger(candidateRecordId) || candidateRecordId <= 0))
      || (!isCandidateDiscoveryPoll && !sessionIdPattern.test(requestedSessionId))
      || (isCandidateDiscoveryPoll && requestedSessionId && !sessionIdPattern.test(requestedSessionId))) {
      return NextResponse.json({ error: "Valid live-feed session details are required." }, { status: 400 });
    }

    await ensureLiveFeedTables();
    const assessmentResult = await databasePool.query(
      "SELECT id FROM assessment WHERE id = $1 AND status = TRUE",
      [assessmentId],
    );
    if (!assessmentResult.rowCount) {
      return NextResponse.json({ error: "Assessment not found or inactive." }, { status: 404 });
    }

    if (side === "candidate") {
      const candidate = await findCandidate(authorization.candidate?.id ?? 0);
      if (!candidate || Number(candidate.id) !== candidateRecordId) {
        return NextResponse.json({ error: "Candidate credentials could not be verified." }, { status: 401 });
      }
      const data = candidate.candidate_data as {
        category?: string | null;
        sub_category?: string | null;
      } | null;
      const cohortAssignment = await databasePool.query(`
        SELECT EXISTS (
          SELECT 1
          FROM assessment_candidate_sub_category AS assignment
          JOIN candidate_sub_category AS candidate_group
            ON candidate_group.id = assignment.candidate_sub_category_id
          WHERE assignment.assessment_id = $1
            AND candidate_group.status = TRUE
            AND candidate_group.category = $2
            AND candidate_group.candidate_sub_category = $3
        ) OR EXISTS (
          SELECT 1
          FROM assessment_candidate_direct_assignment AS direct_assignment
          WHERE direct_assignment.assessment_id = $1
            AND direct_assignment.candidate_id = $4
        ) AS is_assigned
        LIMIT 1
      `, [assessmentId, data?.category ?? "", data?.sub_category ?? "", candidate.id]);
      if (!cohortAssignment.rows[0]?.is_assigned) {
        return NextResponse.json({ error: "Candidate is not assigned to this assessment." }, { status: 403 });
      }
    } else {
      const viewerUserId = authorization.user?.id ?? 0;
      if (!Number.isInteger(viewerUserId) || viewerUserId <= 0) {
        return NextResponse.json({ error: "A valid staff account is required." }, { status: 400 });
      }
      const userResult = await databasePool.query(
        `SELECT users.id, users.role,
                COALESCE(roles.administrator_access, FALSE) AS administrator_access
         FROM users
         LEFT JOIN roles ON LOWER(BTRIM(roles.role_name)) = LOWER(BTRIM(users.role)) AND roles.status = TRUE
         WHERE users.id = $1 AND users.status = TRUE`,
        [viewerUserId],
      );
      if (!userResult.rowCount) {
        return NextResponse.json({ error: "An active account is required." }, { status: 403 });
      }
      const role = String(userResult.rows[0].role ?? "").trim().toLocaleLowerCase();
      const isAdmin = role.includes("admin") || Boolean(userResult.rows[0].administrator_access);
      if (!isAdmin && role !== "invigilator") {
        return NextResponse.json({ error: "Only admins and assigned invigilators can view a live feed." }, { status: 403 });
      }
      const candidateAssignment = await databasePool.query(`
        SELECT 1
        FROM "Candidate Information" AS candidate
        LEFT JOIN assessment_candidate_invigilator AS individual_assignment
          ON individual_assignment.assessment_id = $1
          AND individual_assignment.candidate_id = candidate.id
        LEFT JOIN candidate_sub_category AS candidate_group
          ON candidate_group.status = TRUE
          AND candidate_group.category = BTRIM(COALESCE(candidate.candidate_data->>'category', ''))
          AND candidate_group.candidate_sub_category = BTRIM(COALESCE(candidate.candidate_data->>'sub_category', ''))
        LEFT JOIN assessment_candidate_sub_category AS cohort_assignment
          ON cohort_assignment.assessment_id = $1
          AND cohort_assignment.candidate_sub_category_id = candidate_group.id
        LEFT JOIN assessment_candidate_direct_assignment AS direct_assignment
          ON direct_assignment.assessment_id = $1
          AND direct_assignment.candidate_id = candidate.id
        WHERE candidate.id = $2
          AND candidate.record_type = 'candidate'
          AND (
            ($3::boolean AND (
              cohort_assignment.assessment_id IS NOT NULL
              OR direct_assignment.candidate_id IS NOT NULL
            ))
            OR (NOT $3::boolean AND individual_assignment.invigilator_user_id = $4)
          )
        LIMIT 1
      `, [assessmentId, candidateRecordId, isAdmin, viewerUserId]);
      if (!candidateAssignment.rowCount) {
        return NextResponse.json({ error: "This account is not authorized to view this candidate's live feed." }, { status: 403 });
      }
    }

    if (action === "poll") {
      const afterId = Number(body.afterId ?? 0);
      if (!Number.isSafeInteger(afterId) || afterId < 0) {
        return NextResponse.json({ error: "A valid signal cursor is required." }, { status: 400 });
      }
      let sessionId = requestedSessionId;
      if (isCandidateDiscoveryPoll) {
        const latestOffer = await databasePool.query(`
          SELECT offer.session_id
          FROM assessment_candidate_live_feed_signals AS offer
          WHERE offer.assessment_id = $1 AND offer.candidate_id = $2
            AND offer.sender_side = 'staff' AND offer.message_type = 'offer'
            AND offer.created_at >= NOW() - INTERVAL '2 minutes'
            AND NOT EXISTS (
              SELECT 1
              FROM assessment_candidate_live_feed_signals AS ended
              WHERE ended.assessment_id = offer.assessment_id
                AND ended.candidate_id = offer.candidate_id
                AND ended.session_id = offer.session_id
                AND ended.message_type = 'end'
                AND ended.id > offer.id
            )
          ORDER BY offer.id DESC
          LIMIT 1
        `, [assessmentId, candidateRecordId]);
        if (!latestOffer.rowCount) return NextResponse.json({ sessionId: null, signals: [] });
        sessionId = String(latestOffer.rows[0].session_id);
      }
      const effectiveAfterId = isCandidateDiscoveryPoll && sessionId !== requestedSessionId ? 0 : afterId;
      if (side === "staff") {
        await databasePool.query(`
          UPDATE assessment_candidate_live_feed_signals AS offer
          SET created_at = NOW()
          WHERE offer.assessment_id = $1 AND offer.candidate_id = $2
            AND offer.session_id = $3 AND offer.sender_side = 'staff'
            AND offer.message_type = 'offer'
            AND NOT EXISTS (
              SELECT 1
              FROM assessment_candidate_live_feed_signals AS ended
              WHERE ended.assessment_id = offer.assessment_id
                AND ended.candidate_id = offer.candidate_id
                AND ended.session_id = offer.session_id
                AND ended.message_type = 'end'
                AND ended.id > offer.id
            )
        `, [assessmentId, candidateRecordId, sessionId]);
      }
      const result = await databasePool.query(`
        SELECT id, sender_side, message_type, payload, created_at
        FROM assessment_candidate_live_feed_signals
        WHERE assessment_id = $1 AND candidate_id = $2 AND session_id = $3
          AND sender_side <> $4 AND id > $5
          AND created_at >= NOW() - INTERVAL '2 minutes'
        ORDER BY id ASC
        LIMIT 100
      `, [assessmentId, candidateRecordId, sessionId, side, effectiveAfterId]);
      return NextResponse.json({ sessionId, signals: result.rows });
    }

    if (action === "start" && (side !== "staff" || body.messageType !== "offer")) {
      return NextResponse.json({ error: "Only authorized staff can start a live-feed session." }, { status: 400 });
    }
    const messageType = body.messageType as SignalMessageType;
    if (messageType !== "offer" && messageType !== "answer" && messageType !== "ice" && messageType !== "end") {
      return NextResponse.json({ error: "Unsupported live-feed signal." }, { status: 400 });
    }
    if ((side === "staff" && messageType !== "offer" && messageType !== "ice" && messageType !== "end")
      || (side === "candidate" && messageType !== "answer" && messageType !== "ice" && messageType !== "end")
      || !isValidSignalPayload(messageType, body.payload)) {
      return NextResponse.json({ error: "The live-feed signal payload is invalid." }, { status: 400 });
    }

    if (action === "start") {
      await databasePool.query(`
        DELETE FROM assessment_candidate_live_feed_signals
        WHERE assessment_id = $1 AND candidate_id = $2
      `, [assessmentId, candidateRecordId]);
    }
    await databasePool.query(`
      DELETE FROM assessment_candidate_live_feed_signals
      WHERE created_at < NOW() - INTERVAL '2 minutes'
    `);
    await databasePool.query(`
      INSERT INTO assessment_candidate_live_feed_signals
        (assessment_id, candidate_id, session_id, sender_side, message_type, payload)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `, [assessmentId, candidateRecordId, requestedSessionId, side, messageType, JSON.stringify(body.payload)]);
    return NextResponse.json({ sent: true });
  } catch (error) {
    console.error("Failed to process live-feed signaling", error);
    return NextResponse.json({ error: "Unable to process live-feed signaling." }, { status: 500 });
  }
}
